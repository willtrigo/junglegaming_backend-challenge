// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { EntityManager, LockMode, UniqueConstraintViolationException } from "@mikro-orm/core";
import { Injectable } from "@nestjs/common";

import { OutboxMessage } from "@/messaging/domain/outbox-message";
import { outboxMessageToOrm } from "@/messaging/infrastructure/persistence/outbox-message.mapper";
import { newId } from "@/shared/domain/id/uuid";
import { Money } from "@/shared/domain/money/money";
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from "@/wagering/domain/events/wager-transaction-events";
import { FailureCode } from "@/wagering/domain/failure-code.enum";
import { computePayloadHash } from "@/wagering/domain/payload-hash";
import { WagerTransaction } from "@/wagering/domain/wager-transaction";
import { WagerTransactionKind } from "@/wagering/domain/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "@/wagering/domain/wager-transaction-status.enum";
import {
  wagerTransactionFromOrm,
  wagerTransactionToOrm,
} from "@/wagering/infrastructure/persistence/wager-transaction.mapper";
import { WagerTransactionOrmEntity } from "@/wagering/infrastructure/persistence/wager-transaction.orm-entity";
import { LedgerDirection } from "@/wallets/domain/ledger-direction.enum";
import type { Wallet } from "@/wallets/domain/wallet";
import { InsufficientFundsError } from "@/wallets/domain/wallet.errors";
import type { WalletLedgerEntry } from "@/wallets/domain/wallet-ledger-entry";
import {
  applyWalletToOrm,
  ledgerEntryToOrm,
  walletFromOrm,
} from "@/wallets/infrastructure/persistence/wallet.mapper";
import { WalletOrmEntity } from "@/wallets/infrastructure/persistence/wallet.orm-entity";

import type {
  SubmitWagerTransactionCommand,
  SubmitWagerTransactionResult,
} from "./submit-wager-transaction.command";
import {
  IdempotencyConflictError,
  PlayerWalletMismatchError,
  WalletNotFoundError,
} from "./submit-wager-transaction.errors";

const PENDING_REFERENCE_BASE_BACKOFF_MS = 1_000;

@Injectable()
export class SubmitWagerTransactionUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(command: SubmitWagerTransactionCommand): Promise<SubmitWagerTransactionResult> {
    const money = Money.from(command.money);
    const payloadHash = computePayloadHash({
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      playerId: command.playerId,
      walletId: command.walletId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money,
      referenceExternalTransactionId: command.referenceExternalTransactionId,
    });

    try {
      return await this.em.fork().transactional(async (em) => {
        const existing = await em.findOne(WagerTransactionOrmEntity, {
          providerId: command.providerId,
          idempotencyKey: command.idempotencyKey,
        });

        if (existing !== null) {
          if (existing.payloadHash !== payloadHash) {
            throw new IdempotencyConflictError(command.idempotencyKey, existing.id);
          }
          return this.toReplayResult(wagerTransactionFromOrm(existing));
        }

        const walletRow = await em.findOne(
          WalletOrmEntity,
          { id: command.walletId },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        );

        if (walletRow === null) {
          throw new WalletNotFoundError(command.walletId);
        }

        const existingAfterLock = await em.findOne(WagerTransactionOrmEntity, {
          providerId: command.providerId,
          idempotencyKey: command.idempotencyKey,
        });
        if (existingAfterLock !== null) {
          if (existingAfterLock.payloadHash !== payloadHash) {
            throw new IdempotencyConflictError(command.idempotencyKey, existingAfterLock.id);
          }
          return this.toReplayResult(wagerTransactionFromOrm(existingAfterLock));
        }

        const wallet = walletFromOrm(walletRow);
        const now = new Date();

        if (command.playerId !== wallet.playerId) {
          throw new PlayerWalletMismatchError(command.playerId, command.walletId);
        }

        const tx = WagerTransaction.create({
          id: newId(),
          providerId: command.providerId,
          externalTransactionId: command.externalTransactionId,
          idempotencyKey: command.idempotencyKey,
          payloadHash,
          walletId: command.walletId,
          playerId: command.playerId,
          roundId: command.roundId,
          gameId: command.gameId,
          kind: command.kind,
          money,
          referenceExternalTransactionId: command.referenceExternalTransactionId,
          createdAt: now,
        });

        if (money.currency !== wallet.currency) {
          tx.reject(FailureCode.CurrencyMismatch, now, wallet.balance);
          return this.toResult(tx, wallet.balance, false);
        }

        let reference: WagerTransaction | undefined;

        if (tx.requiresReference()) {
          const refRow = await em.findOne(WagerTransactionOrmEntity, {
            providerId: command.providerId,
            externalTransactionId: command.referenceExternalTransactionId!,
          });

          if (refRow === null) {
            const nextAttempt = new Date(now.getTime() + PENDING_REFERENCE_BASE_BACKOFF_MS);
            tx.markPendingReference(now, nextAttempt);
            em.persist(wagerTransactionToOrm(tx));
            this.enqueue(
              em,
              WagerTransactionPendingReference.from(tx, {
                eventId: newId(),
                correlationId: command.correlationId,
                causationId: tx.id,
                occurredAt: now,
              }),
            );
            return this.toResult(tx, wallet.balance, false);
          }

          reference = wagerTransactionFromOrm(refRow);

          const refFailure = await this.validateReference(em, tx, reference, wallet);
          if (refFailure !== undefined) {
            return this.reject(em, tx, refFailure, wallet, command.correlationId, now);
          }
        }

        let ledgerEntry: WalletLedgerEntry | undefined;

        if (tx.affectsBalance()) {
          try {
            const direction = tx.ledgerDirectionFor(reference);
            const movement = {
              entryId: newId(),
              transactionId: tx.id,
              amount: tx.money,
              at: now,
            };
            ledgerEntry =
              direction === LedgerDirection.Debit
                ? wallet.debit(movement)
                : wallet.credit(movement);
          } catch (error) {
            if (error instanceof InsufficientFundsError) {
              const code =
                tx.kind === WagerTransactionKind.Bet
                  ? FailureCode.InsufficientFunds
                  : FailureCode.ReversalWouldOverdraw;
              return this.reject(em, tx, code, wallet, command.correlationId, now);
            }
            throw error;
          }
        }

        tx.markProcessed(reference?.id, now, wallet.balance);

        em.persist(wagerTransactionToOrm(tx));
        if (ledgerEntry !== undefined) {
          applyWalletToOrm(wallet, walletRow);
          await em.flush();
          em.persist(ledgerEntryToOrm(ledgerEntry));
        }

        this.enqueue(
          em,
          WagerTransactionProcessed.from(tx, {
            eventId: newId(),
            correlationId: command.correlationId,
            causationId: tx.id,
            occurredAt: now,
          }),
        );

        if (ledgerEntry !== undefined) {
          this.enqueue(
            em,
            WalletBalanceChanged.from(wallet, ledgerEntry, {
              eventId: newId(),
              correlationId: command.correlationId,
              causationId: tx.id,
              occurredAt: now,
            }),
          );
        }

        return this.toResult(tx, wallet.balance, false);
      });
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        const existing = await this.em.fork().findOne(WagerTransactionOrmEntity, {
          providerId: command.providerId,
          idempotencyKey: command.idempotencyKey,
        });
        if (existing !== null) {
          if (existing.payloadHash !== payloadHash) {
            throw new IdempotencyConflictError(command.idempotencyKey, existing.id);
          }
          return this.toReplayResult(wagerTransactionFromOrm(existing));
        }
      }
      throw error;
    }
  }

  private async validateReference(
    em: EntityManager,
    tx: WagerTransaction,
    reference: WagerTransaction,
    wallet: Wallet,
  ): Promise<FailureCode | undefined> {
    if (
      reference.walletId !== wallet.id ||
      reference.playerId !== wallet.playerId ||
      reference.money.currency !== wallet.currency ||
      reference.roundId !== tx.roundId
    ) {
      return FailureCode.ReferenceScopeMismatch;
    }

    if (reference.status !== WagerTransactionStatus.Processed) {
      return FailureCode.ReferenceNotProcessed;
    }

    if (!reference.canBeRevertedBy(tx.kind)) {
      return FailureCode.ReferenceKindMismatch;
    }

    if (!reference.money.equals(tx.money)) {
      return FailureCode.ReferenceAmountMismatch;
    }

    const prior = await em.findOne(WagerTransactionOrmEntity, {
      referenceTransactionId: reference.id,
      kind: tx.kind,
      status: WagerTransactionStatus.Processed,
    });
    if (prior !== null) {
      return FailureCode.AlreadyReversed;
    }

    return undefined;
  }

  private async reject(
    em: EntityManager,
    tx: WagerTransaction,
    code: FailureCode,
    wallet: Wallet,
    correlationId: string,
    now: Date,
  ): Promise<SubmitWagerTransactionResult> {
    tx.reject(code, now, wallet.balance);
    em.persist(wagerTransactionToOrm(tx));
    this.enqueue(
      em,
      WagerTransactionRejected.from(tx, {
        eventId: newId(),
        correlationId,
        causationId: tx.id,
        occurredAt: now,
      }),
    );
    return this.toResult(tx, wallet.balance, false);
  }

  private enqueue(em: EntityManager, event: Parameters<typeof OutboxMessage.enqueue>[0]): void {
    em.persist(outboxMessageToOrm(OutboxMessage.enqueue(event)));
  }

  private toResult(
    tx: WagerTransaction,
    balance: Money,
    idempotentReplay: boolean,
  ): SubmitWagerTransactionResult {
    return {
      transactionId: tx.id,
      status: tx.status,
      balance: balance.toJSON(),
      idempotentReplay,
      ...(tx.failureCode !== undefined ? { failureCode: tx.failureCode } : {}),
    };
  }

  private toReplayResult(tx: WagerTransaction): SubmitWagerTransactionResult {
    const balance = tx.observedBalance ?? Money.zero(tx.money.currency);
    return this.toResult(tx, balance, true);
  }
}
