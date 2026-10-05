import { Money } from "@/shared/domain/money/money";
import type { FailureCode } from "@/wagering/domain/failure-code.enum";
import { WagerTransaction } from "@/wagering/domain/wager-transaction";
import type { WagerTransactionKind } from "@/wagering/domain/wager-transaction-kind.enum";
import type { WagerTransactionStatus } from "@/wagering/domain/wager-transaction-status.enum";
import { WagerTransactionOrmEntity } from "./wager-transaction.orm-entity";

export function wagerTransactionToOrm(tx: WagerTransaction): WagerTransactionOrmEntity {
  const row = new WagerTransactionOrmEntity();
  applyWagerTransactionToOrm(tx, row);
  return row;
}

export function applyWagerTransactionToOrm(
  tx: WagerTransaction,
  row: WagerTransactionOrmEntity,
): void {
  row.id = tx.id;
  row.providerId = tx.providerId;
  row.externalTransactionId = tx.externalTransactionId;
  row.idempotencyKey = tx.idempotencyKey;
  row.payloadHash = tx.payloadHash;
  row.walletId = tx.walletId;
  row.playerId = tx.playerId;
  row.currency = tx.money.currency;
  row.roundId = tx.roundId;
  row.gameId = tx.gameId;
  row.kind = tx.kind;
  row.amount = tx.money.amount;
  row.referenceExternalTransactionId = tx.referenceExternalTransactionId ?? null;
  row.referenceTransactionId = tx.referenceTransactionId ?? null;
  row.status = tx.status;
  row.failureCode = tx.failureCode ?? null;
  row.observedBalance = tx.observedBalance?.amount ?? null;
  row.referenceAttempts = tx.referenceAttempts;
  row.nextReferenceAttemptAt = tx.nextReferenceAttemptAt ?? null;
  row.createdAt = tx.createdAt;
  row.updatedAt = tx.updatedAt;
  row.processedAt = tx.processedAt ?? null;
}

export function wagerTransactionFromOrm(row: WagerTransactionOrmEntity): WagerTransaction {
  const currency = row.currency;
  return WagerTransaction.rehydrate({
    id: row.id,
    providerId: row.providerId,
    externalTransactionId: row.externalTransactionId,
    idempotencyKey: row.idempotencyKey,
    payloadHash: row.payloadHash,
    walletId: row.walletId,
    playerId: row.playerId,
    roundId: row.roundId,
    gameId: row.gameId,
    kind: row.kind as WagerTransactionKind,
    money: Money.from({ amount: row.amount, currency }),
    referenceExternalTransactionId: row.referenceExternalTransactionId ?? undefined,
    status: row.status as WagerTransactionStatus,
    referenceTransactionId: row.referenceTransactionId ?? undefined,
    failureCode: (row.failureCode as FailureCode | null) ?? undefined,
    observedBalance:
      row.observedBalance !== null && row.observedBalance !== undefined
        ? Money.from({ amount: row.observedBalance, currency })
        : undefined,
    referenceAttempts: row.referenceAttempts,
    nextReferenceAttemptAt: row.nextReferenceAttemptAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    processedAt: row.processedAt ?? undefined,
  });
}
