// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { EntityManager, UniqueConstraintViolationException } from "@mikro-orm/core";
import { Injectable } from "@nestjs/common";

import { OutboxMessage } from "@/messaging/domain/outbox-message";
import { outboxMessageToOrm } from "@/messaging/infrastructure/persistence/outbox-message.mapper";
import { DomainError } from "@/shared/domain/domain-error";
import { newId } from "@/shared/domain/id/uuid";
import { Money, type MoneyProps } from "@/shared/domain/money/money";
import {
  WagerTransactionProcessed,
  WalletBalanceChanged,
} from "@/wagering/domain/events/wager-transaction-events";
import { WagerTransaction } from "@/wagering/domain/wager-transaction";
import { wagerTransactionToOrm } from "@/wagering/infrastructure/persistence/wager-transaction.mapper";
import { Wallet } from "@/wallets/domain/wallet";
import { ledgerEntryToOrm, walletToOrm } from "@/wallets/infrastructure/persistence/wallet.mapper";

export class WalletAlreadyExistsError extends DomainError {
  readonly code = "WALLET_ALREADY_EXISTS";

  constructor(
    readonly playerId: string,
    readonly currency: string,
  ) {
    super(`Wallet already exists for player ${playerId} and currency ${currency}`);
  }
}

export interface CreateWalletCommand {
  playerId: string;
  initialBalance: MoneyProps;
  correlationId: string;
}

export interface CreateWalletResult {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

@Injectable()
export class CreateWalletUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(command: CreateWalletCommand): Promise<CreateWalletResult> {
    const initialBalance = Money.from(command.initialBalance);
    const now = new Date();
    const walletId = newId();
    const openingTxId = newId();
    const openingEntryId = newId();

    const { wallet, openingEntry } = Wallet.open({
      id: walletId,
      playerId: command.playerId,
      initialBalance,
      openingTransactionId: openingTxId,
      openingEntryId,
      at: now,
    });

    try {
      await this.em.fork().transactional(async (em) => {
        em.persist(walletToOrm(wallet));
        await em.flush();

        if (openingEntry !== undefined) {
          const openingTx = WagerTransaction.createOpening({
            id: openingTxId,
            walletId,
            playerId: command.playerId,
            money: initialBalance,
            createdAt: now,
          });
          openingTx.markProcessed(undefined, now, wallet.balance);

          em.persist(wagerTransactionToOrm(openingTx));
          await em.flush();

          em.persist(ledgerEntryToOrm(openingEntry));
          em.persist(
            outboxMessageToOrm(
              OutboxMessage.enqueue(
                WagerTransactionProcessed.from(openingTx, {
                  eventId: newId(),
                  correlationId: command.correlationId,
                  causationId: openingTx.id,
                  occurredAt: now,
                }),
              ),
            ),
          );
          em.persist(
            outboxMessageToOrm(
              OutboxMessage.enqueue(
                WalletBalanceChanged.from(wallet, openingEntry, {
                  eventId: newId(),
                  correlationId: command.correlationId,
                  causationId: openingTx.id,
                  occurredAt: now,
                }),
              ),
            ),
          );
        }
      });
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new WalletAlreadyExistsError(command.playerId, initialBalance.currency);
      }
      throw error;
    }

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    };
  }
}
