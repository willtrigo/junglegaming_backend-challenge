import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { MikroORM } from "@mikro-orm/core";
import { OutboxMessageOrmEntity } from "@/messaging/infrastructure/persistence/outbox-message.orm-entity";
import { newId } from "@/shared/domain/id/uuid";
import {
  IdempotencyConflictError,
  WalletNotFoundError,
} from "@/wagering/application/submit-wager-transaction.errors";
import { SubmitWagerTransactionUseCase } from "@/wagering/application/submit-wager-transaction.use-case";
import { FailureCode } from "@/wagering/domain/failure-code.enum";
import { WagerTransactionKind } from "@/wagering/domain/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "@/wagering/domain/wager-transaction-status.enum";
import { WagerTransactionOrmEntity } from "@/wagering/infrastructure/persistence/wager-transaction.orm-entity";
import { CreateWalletUseCase } from "@/wallets/application/create-wallet.use-case";
import { WalletOrmEntity } from "@/wallets/infrastructure/persistence/wallet.orm-entity";
import { WalletLedgerEntryOrmEntity } from "@/wallets/infrastructure/persistence/wallet-ledger-entry.orm-entity";
import { createTestOrm, resetDatabase } from "../helpers/orm";

describe("SubmitWagerTransactionUseCase (integration)", () => {
  let orm: MikroORM;
  let createWallet: CreateWalletUseCase;
  let submit: SubmitWagerTransactionUseCase;

  beforeAll(async () => {
    orm = await createTestOrm();
    createWallet = new CreateWalletUseCase(orm.em);
    submit = new SubmitWagerTransactionUseCase(orm.em);
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  beforeEach(async () => {
    await resetDatabase(orm);
  });

  async function fundedWallet(balance = "100.00") {
    const playerId = newId();
    const wallet = await createWallet.execute({
      playerId,
      initialBalance: { amount: balance, currency: "BRL" },
      correlationId: `open-${playerId}`,
    });
    return { playerId, walletId: wallet.id, balance: wallet.balance };
  }

  function betCommand(
    wallet: { playerId: string; walletId: string },
    overrides: Partial<{
      externalTransactionId: string;
      idempotencyKey: string;
      amount: string;
      kind: WagerTransactionKind;
      referenceExternalTransactionId: string;
      providerId: string;
    }> = {},
  ) {
    const externalTransactionId = overrides.externalTransactionId ?? `tx-${newId()}`;
    const providerId = overrides.providerId ?? "provider-a";
    return {
      correlationId: `corr-${externalTransactionId}`,
      idempotencyKey: overrides.idempotencyKey ?? `${providerId}:${externalTransactionId}`,
      providerId,
      externalTransactionId,
      playerId: wallet.playerId,
      walletId: wallet.walletId,
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: overrides.kind ?? WagerTransactionKind.Bet,
      money: { amount: overrides.amount ?? "25.00", currency: "BRL" as const },
      referenceExternalTransactionId: overrides.referenceExternalTransactionId,
    };
  }

  test("BET debits wallet, writes ledger DEBIT, PROCESSED, and outbox events", async () => {
    const w = await fundedWallet("100.00");
    const result = await submit.execute(betCommand(w, { amount: "30.00" }));

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.idempotentReplay).toBe(false);
    expect(result.balance).toEqual({ amount: "70.00", currency: "BRL" });
    expect(result.failureCode).toBeUndefined();

    const wallet = await orm.em.findOneOrFail(WalletOrmEntity, { id: w.walletId });
    expect(wallet.balance).toBe("70.00");
    expect(Number(wallet.version)).toBe(2);

    const ledger = await orm.em.find(
      WalletLedgerEntryOrmEntity,
      { walletId: w.walletId },
      { orderBy: { walletVersion: "ASC" } },
    );
    expect(ledger).toHaveLength(2);
    expect(ledger[1]!.direction).toBe("DEBIT");
    expect(ledger[1]!.amount).toBe("30.00");
    expect(ledger[1]!.balanceAfter).toBe("70.00");

    const outbox = await orm.em.find(OutboxMessageOrmEntity, {
      eventType: { $in: ["WagerTransactionProcessed", "WalletBalanceChanged"] },
    });
    expect(outbox.length).toBeGreaterThanOrEqual(2);
  });

  test("WIN credits wallet", async () => {
    const w = await fundedWallet("50.00");
    const result = await submit.execute(
      betCommand(w, {
        kind: WagerTransactionKind.Win,
        amount: "20.00",
        externalTransactionId: "win-1",
      }),
    );

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance.amount).toBe("70.00");
  });

  test("LOSS does not move balance and does not write ledger", async () => {
    const w = await fundedWallet("100.00");
    const before = await orm.em.find(WalletLedgerEntryOrmEntity, { walletId: w.walletId });

    const result = await submit.execute(
      betCommand(w, {
        kind: WagerTransactionKind.Loss,
        amount: "0.00",
        externalTransactionId: "loss-1",
      }),
    );

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance.amount).toBe("100.00");

    const after = await orm.em.find(WalletLedgerEntryOrmEntity, { walletId: w.walletId });
    expect(after).toHaveLength(before.length);
  });

  test("BET with insufficient funds is REJECTED with INSUFFICIENT_FUNDS", async () => {
    const w = await fundedWallet("20.00");
    const result = await submit.execute(betCommand(w, { amount: "50.00" }));

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(result.balance.amount).toBe("20.00");

    const wallet = await orm.em.findOneOrFail(WalletOrmEntity, { id: w.walletId });
    expect(wallet.balance).toBe("20.00");

    const ledger = await orm.em.find(WalletLedgerEntryOrmEntity, { walletId: w.walletId });
    expect(ledger).toHaveLength(1);

    const tx = await orm.em.findOneOrFail(WagerTransactionOrmEntity, {
      id: result.transactionId,
    });
    expect(tx.status).toBe("REJECTED");
    expect(tx.failureCode).toBe(FailureCode.InsufficientFunds);
  });

  test("identical replay returns same result with idempotentReplay=true", async () => {
    const w = await fundedWallet("100.00");
    const cmd = betCommand(w, {
      externalTransactionId: "idem-1",
      amount: "10.00",
    });

    const first = await submit.execute(cmd);
    const second = await submit.execute(cmd);

    expect(second.idempotentReplay).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(second.status).toBe(first.status);
    expect(second.balance).toEqual(first.balance);

    const wallet = await orm.em.findOneOrFail(WalletOrmEntity, { id: w.walletId });
    expect(wallet.balance).toBe("90.00");

    const bets = await orm.em.find(WagerTransactionOrmEntity, {
      walletId: w.walletId,
      kind: "BET",
    });
    expect(bets).toHaveLength(1);
  });

  test("same idempotency key with different payload raises conflict", async () => {
    const w = await fundedWallet("100.00");
    const key = "provider-a:conflict-1";

    await submit.execute(
      betCommand(w, {
        externalTransactionId: "conflict-1",
        idempotencyKey: key,
        amount: "10.00",
      }),
    );

    await expect(
      submit.execute(
        betCommand(w, {
          externalTransactionId: "conflict-1",
          idempotencyKey: key,
          amount: "99.00",
        }),
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  test("REFUND of PROCESSED BET credits wallet once", async () => {
    const w = await fundedWallet("100.00");
    const bet = await submit.execute(
      betCommand(w, { externalTransactionId: "bet-ref-1", amount: "40.00" }),
    );
    expect(bet.balance.amount).toBe("60.00");

    const refund = await submit.execute(
      betCommand(w, {
        kind: WagerTransactionKind.Refund,
        externalTransactionId: "refund-1",
        amount: "40.00",
        referenceExternalTransactionId: "bet-ref-1",
      }),
    );

    expect(refund.status).toBe(WagerTransactionStatus.Processed);
    expect(refund.balance.amount).toBe("100.00");
  });

  test("second REFUND of same BET is REJECTED as ALREADY_REVERSED", async () => {
    const w = await fundedWallet("100.00");
    await submit.execute(betCommand(w, { externalTransactionId: "bet-rev-1", amount: "40.00" }));
    await submit.execute(
      betCommand(w, {
        kind: WagerTransactionKind.Refund,
        externalTransactionId: "refund-a",
        amount: "40.00",
        referenceExternalTransactionId: "bet-rev-1",
      }),
    );

    const second = await submit.execute(
      betCommand(w, {
        kind: WagerTransactionKind.Refund,
        externalTransactionId: "refund-b",
        amount: "40.00",
        referenceExternalTransactionId: "bet-rev-1",
      }),
    );

    expect(second.status).toBe(WagerTransactionStatus.Rejected);
    expect(second.failureCode).toBe(FailureCode.AlreadyReversed);

    const wallet = await orm.em.findOneOrFail(WalletOrmEntity, { id: w.walletId });
    expect(wallet.balance).toBe("100.00");
  });

  test("REFUND before BET arrives stays PENDING_REFERENCE", async () => {
    const w = await fundedWallet("100.00");
    const result = await submit.execute(
      betCommand(w, {
        kind: WagerTransactionKind.Refund,
        externalTransactionId: "refund-early",
        amount: "25.00",
        referenceExternalTransactionId: "missing-bet",
      }),
    );

    expect(result.status).toBe(WagerTransactionStatus.PendingReference);
    expect(result.balance.amount).toBe("100.00");

    const outbox = await orm.em.find(OutboxMessageOrmEntity, {
      eventType: "WagerTransactionPendingReference",
    });
    expect(outbox.length).toBeGreaterThanOrEqual(1);
  });

  test("ROLLBACK of WIN debits the previous credit", async () => {
    const w = await fundedWallet("100.00");
    await submit.execute(
      betCommand(w, {
        kind: WagerTransactionKind.Win,
        externalTransactionId: "win-rb",
        amount: "30.00",
      }),
    );

    const rb = await submit.execute(
      betCommand(w, {
        kind: WagerTransactionKind.Rollback,
        externalTransactionId: "rb-1",
        amount: "30.00",
        referenceExternalTransactionId: "win-rb",
      }),
    );

    expect(rb.status).toBe(WagerTransactionStatus.Processed);
    expect(rb.balance.amount).toBe("100.00");
  });

  test("unknown wallet raises WalletNotFoundError", async () => {
    await expect(
      submit.execute(betCommand({ playerId: newId(), walletId: newId() }, { amount: "1.00" })),
    ).rejects.toBeInstanceOf(WalletNotFoundError);
  });

  test("currency mismatch is REJECTED", async () => {
    const w = await fundedWallet("100.00");
    const cmd = betCommand(w, { amount: "10.00" });
    const result = await submit.execute({
      ...cmd,
      money: { amount: "10.00", currency: "USD" },
    });

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.failureCode).toBe(FailureCode.CurrencyMismatch);
  });

  test("two concurrent 80 BETs on 100: exactly one PROCESSED, one REJECTED, balance 20", async () => {
    const w = await fundedWallet("100.00");

    const [a, b] = await Promise.all([
      submit.execute(betCommand(w, { externalTransactionId: "race-a", amount: "80.00" })),
      submit.execute(betCommand(w, { externalTransactionId: "race-b", amount: "80.00" })),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([WagerTransactionStatus.Processed, WagerTransactionStatus.Rejected]);

    const processed = a.status === WagerTransactionStatus.Processed ? a : b;
    const rejected = a.status === WagerTransactionStatus.Rejected ? a : b;

    expect(processed.balance.amount).toBe("20.00");
    expect(rejected.failureCode).toBe(FailureCode.InsufficientFunds);

    const wallet = await orm.em.findOneOrFail(WalletOrmEntity, { id: w.walletId });
    expect(wallet.balance).toBe("20.00");

    const debitEntries = await orm.em.find(WalletLedgerEntryOrmEntity, {
      walletId: w.walletId,
      direction: "DEBIT",
    });
    expect(debitEntries).toHaveLength(1);
  });

  test("same BET submitted 20 times in parallel produces a single debit", async () => {
    const w = await fundedWallet("100.00");
    const cmd = betCommand(w, {
      externalTransactionId: "burst-1",
      amount: "15.00",
    });

    const results = await Promise.all(Array.from({ length: 20 }, () => submit.execute(cmd)));

    const ids = new Set(results.map((r) => r.transactionId));
    expect(ids.size).toBe(1);

    const wallet = await orm.em.findOneOrFail(WalletOrmEntity, { id: w.walletId });
    expect(wallet.balance).toBe("85.00");

    const bets = await orm.em.find(WagerTransactionOrmEntity, {
      walletId: w.walletId,
      kind: "BET",
    });
    expect(bets).toHaveLength(1);

    const debits = await orm.em.find(WalletLedgerEntryOrmEntity, {
      walletId: w.walletId,
      direction: "DEBIT",
    });
    expect(debits).toHaveLength(1);
  });

  test("wallet.balance matches ledger reconstruction after a sequence of ops", async () => {
    const w = await fundedWallet("100.00");

    await submit.execute(betCommand(w, { externalTransactionId: "s1", amount: "30.00" }));
    await submit.execute(
      betCommand(w, {
        kind: WagerTransactionKind.Win,
        externalTransactionId: "s2",
        amount: "10.00",
      }),
    );
    await submit.execute(betCommand(w, { externalTransactionId: "s3", amount: "5.00" }));

    const wallet = await orm.em.findOneOrFail(WalletOrmEntity, { id: w.walletId });
    const entries = await orm.em.find(
      WalletLedgerEntryOrmEntity,
      { walletId: w.walletId },
      { orderBy: { walletVersion: "ASC" } },
    );

    let reconstructed = "0.00";
    for (const e of entries) {
      expect(e.balanceBefore).toBe(reconstructed);
      reconstructed = e.balanceAfter;
    }
    expect(wallet.balance).toBe(reconstructed);
    expect(wallet.balance).toBe("75.00");
  });
});
