// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { EntityManager, LockMode } from "@mikro-orm/core";
import { Injectable } from "@nestjs/common";

import { OutboxMessage } from "@/messaging/domain/outbox-message";
import { outboxMessageToOrm } from "@/messaging/infrastructure/persistence/outbox-message.mapper";
import { newId } from "@/shared/domain/id/uuid";
import {
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from "@/wagering/domain/events/wager-transaction-events";
import { FailureCode } from "@/wagering/domain/failure-code.enum";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { WagerTransaction } from "@/wagering/domain/wager-transaction";
import { WagerTransactionStatus } from "@/wagering/domain/wager-transaction-status.enum";
import { wagerTransactionFromOrm } from "@/wagering/infrastructure/persistence/wager-transaction.mapper";
import { WagerTransactionOrmEntity } from "@/wagering/infrastructure/persistence/wager-transaction.orm-entity";
import { LedgerDirection } from "@/wallets/domain/ledger-direction.enum";
import { InsufficientFundsError } from "@/wallets/domain/wallet.errors";
import {
  applyWalletToOrm,
  ledgerEntryToOrm,
  walletFromOrm,
} from "@/wallets/infrastructure/persistence/wallet.mapper";
import { WalletOrmEntity } from "@/wallets/infrastructure/persistence/wallet.orm-entity";

const BASE_BACKOFF_MS = 1_000;
const MAX_ATTEMPTS = 10;

@Injectable()
export class ProcessPendingReferenceUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(transactionId: string): Promise<boolean> {
    return this.em.fork().transactional(async (em) => {
      const row = await em.findOne(
        WagerTransactionOrmEntity,
        { id: transactionId, status: WagerTransactionStatus.PendingReference },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (row === null) {
        return false;
      }

      const tx = wagerTransactionFromOrm(row);
      const now = new Date();

      const refRow = await em.findOne(WagerTransactionOrmEntity, {
        providerId: tx.providerId,
        externalTransactionId: tx.referenceExternalTransactionId!,
      });

      if (refRow === null) {
        if (Number(row.referenceAttempts) + 1 >= MAX_ATTEMPTS) {
          tx.reject(FailureCode.ReferenceNotFound, now);
          em.assign(row, {
            status: tx.status,
            failureCode: tx.failureCode,
            updatedAt: now,
            nextReferenceAttemptAt: null,
            referenceAttempts: Number(row.referenceAttempts) + 1,
          });
          em.persist(
            outboxMessageToOrm(
              OutboxMessage.enqueue(
                WagerTransactionRejected.from(tx, {
                  eventId: newId(),
                  correlationId: `pending-ref:${tx.id}`,
                  causationId: tx.id,
                  occurredAt: now,
                }),
              ),
            ),
          );
          return true;
        }

        const attempts = Number(row.referenceAttempts) + 1;
        const delay = BASE_BACKOFF_MS * 2 ** Math.min(attempts, 8);
        tx.recordReferenceAttempt(now, new Date(now.getTime() + delay));
        em.assign(row, {
          referenceAttempts: attempts,
          nextReferenceAttemptAt: tx.nextReferenceAttemptAt,
          updatedAt: now,
        });
        return false;
      }

      const reference = wagerTransactionFromOrm(refRow);

      if (
        reference.walletId !== tx.walletId ||
        reference.playerId !== tx.playerId ||
        reference.money.currency !== tx.money.currency ||
        reference.roundId !== tx.roundId
      ) {
        return this.rejectRow(em, row, tx, FailureCode.ReferenceScopeMismatch, now);
      }
      if (reference.status !== WagerTransactionStatus.Processed) {
        const attempts = Number(row.referenceAttempts) + 1;
        const delay = BASE_BACKOFF_MS * 2 ** Math.min(attempts, 8);
        em.assign(row, {
          referenceAttempts: attempts,
          nextReferenceAttemptAt: new Date(now.getTime() + delay),
          updatedAt: now,
        });
        return false;
      }
      if (!reference.canBeRevertedBy(tx.kind)) {
        return this.rejectRow(em, row, tx, FailureCode.ReferenceKindMismatch, now);
      }
      if (!reference.money.equals(tx.money)) {
        return this.rejectRow(em, row, tx, FailureCode.ReferenceAmountMismatch, now);
      }

      const prior = await em.findOne(WagerTransactionOrmEntity, {
        referenceTransactionId: reference.id,
        kind: tx.kind,
        status: WagerTransactionStatus.Processed,
      });
      if (prior !== null) {
        return this.rejectRow(em, row, tx, FailureCode.AlreadyReversed, now);
      }

      const walletRow = await em.findOne(
        WalletOrmEntity,
        { id: tx.walletId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (walletRow === null) {
        return this.rejectRow(em, row, tx, FailureCode.WalletNotFound, now);
      }
      const wallet = walletFromOrm(walletRow);

      try {
        const direction = tx.ledgerDirectionFor(reference);
        const movement = {
          entryId: newId(),
          transactionId: tx.id,
          amount: tx.money,
          at: now,
        };
        const entry =
          direction === LedgerDirection.Debit ? wallet.debit(movement) : wallet.credit(movement);

        tx.markProcessed(reference.id, now, wallet.balance);

        applyWalletToOrm(wallet, walletRow);
        await em.flush();

        em.assign(row, {
          status: tx.status,
          referenceTransactionId: reference.id,
          processedAt: now,
          observedBalance: wallet.balance.amount,
          updatedAt: now,
          nextReferenceAttemptAt: null,
          failureCode: null,
        });
        em.persist(ledgerEntryToOrm(entry));

        em.persist(
          outboxMessageToOrm(
            OutboxMessage.enqueue(
              WagerTransactionProcessed.from(tx, {
                eventId: newId(),
                correlationId: `pending-ref:${tx.id}`,
                causationId: tx.id,
                occurredAt: now,
              }),
            ),
          ),
        );
        em.persist(
          outboxMessageToOrm(
            OutboxMessage.enqueue(
              WalletBalanceChanged.from(wallet, entry, {
                eventId: newId(),
                correlationId: `pending-ref:${tx.id}`,
                causationId: tx.id,
                occurredAt: now,
              }),
            ),
          ),
        );
        return true;
      } catch (error) {
        if (error instanceof InsufficientFundsError) {
          return this.rejectRow(em, row, tx, FailureCode.ReversalWouldOverdraw, now);
        }
        throw error;
      }
    });
  }

  private rejectRow(
    em: EntityManager,
    row: WagerTransactionOrmEntity,
    tx: WagerTransaction,
    code: FailureCode,
    now: Date,
  ): boolean {
    tx.reject(code, now);
    em.assign(row, {
      status: tx.status,
      failureCode: code,
      updatedAt: now,
      nextReferenceAttemptAt: null,
    });
    em.persist(
      outboxMessageToOrm(
        OutboxMessage.enqueue(
          WagerTransactionRejected.from(tx, {
            eventId: newId(),
            correlationId: `pending-ref:${tx.id}`,
            causationId: tx.id,
            occurredAt: now,
          }),
        ),
      ),
    );
    return true;
  }
}
