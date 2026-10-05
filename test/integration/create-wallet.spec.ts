import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { MikroORM } from "@mikro-orm/core";

import { OutboxMessageOrmEntity } from "@/messaging/infrastructure/persistence/outbox-message.orm-entity";
import { newId } from "@/shared/domain/id/uuid";
import { WagerTransactionOrmEntity } from "@/wagering/infrastructure/persistence/wager-transaction.orm-entity";
import {
  CreateWalletUseCase,
  WalletAlreadyExistsError,
} from "@/wallets/application/create-wallet.use-case";
import { WalletOrmEntity } from "@/wallets/infrastructure/persistence/wallet.orm-entity";
import { WalletLedgerEntryOrmEntity } from "@/wallets/infrastructure/persistence/wallet-ledger-entry.orm-entity";
import { createTestOrm, resetDatabase } from "../helpers/orm";

describe("CreateWalletUseCase (integration)", () => {
  let orm: MikroORM;
  let useCase: CreateWalletUseCase;

  beforeAll(async () => {
    orm = await createTestOrm();
    useCase = new CreateWalletUseCase(orm.em);
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  beforeEach(async () => {
    await resetDatabase(orm);
  });

  test("creates wallet with positive balance, OPENING tx, ledger CREDIT and outbox events", async () => {
    const playerId = newId();
    const result = await useCase.execute({
      playerId,
      initialBalance: { amount: "1000.00", currency: "BRL" },
      correlationId: "corr-create-1",
    });

    expect(result.playerId).toBe(playerId);
    expect(result.balance).toEqual({ amount: "1000.00", currency: "BRL" });
    expect(result.version).toBe(1);

    const wallet = await orm.em.findOneOrFail(WalletOrmEntity, { id: result.id });
    expect(wallet.balance).toBe("1000.00");
    expect(Number(wallet.version)).toBe(1);

    const ledger = await orm.em.find(WalletLedgerEntryOrmEntity, { walletId: result.id });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.direction).toBe("CREDIT");
    expect(ledger[0]!.amount).toBe("1000.00");
    expect(ledger[0]!.balanceBefore).toBe("0.00");
    expect(ledger[0]!.balanceAfter).toBe("1000.00");
    expect(Number(ledger[0]!.walletVersion)).toBe(1);

    const txs = await orm.em.find(WagerTransactionOrmEntity, { walletId: result.id });
    expect(txs).toHaveLength(1);
    expect(txs[0]!.kind).toBe("OPENING");
    expect(txs[0]!.status).toBe("PROCESSED");
    expect(txs[0]!.providerId).toBe("internal");

    const outbox = await orm.em.find(OutboxMessageOrmEntity, {});
    const types = outbox.map((o) => o.eventType).sort();
    expect(types).toContain("WagerTransactionProcessed");
    expect(types).toContain("WalletBalanceChanged");
  });

  test("creates wallet with zero balance without ledger or OPENING", async () => {
    const playerId = newId();
    const result = await useCase.execute({
      playerId,
      initialBalance: { amount: "0.00", currency: "BRL" },
      correlationId: "corr-create-0",
    });

    expect(result.balance).toEqual({ amount: "0.00", currency: "BRL" });
    expect(result.version).toBe(1);

    const ledger = await orm.em.find(WalletLedgerEntryOrmEntity, { walletId: result.id });
    expect(ledger).toHaveLength(0);

    const txs = await orm.em.find(WagerTransactionOrmEntity, { walletId: result.id });
    expect(txs).toHaveLength(0);
  });

  test("rejects duplicate playerId + currency", async () => {
    const playerId = newId();
    await useCase.execute({
      playerId,
      initialBalance: { amount: "10.00", currency: "BRL" },
      correlationId: "corr-dup-1",
    });

    await expect(
      useCase.execute({
        playerId,
        initialBalance: { amount: "20.00", currency: "BRL" },
        correlationId: "corr-dup-2",
      }),
    ).rejects.toBeInstanceOf(WalletAlreadyExistsError);
  });

  test("allows same playerId with different currency", async () => {
    const playerId = newId();
    const brl = await useCase.execute({
      playerId,
      initialBalance: { amount: "10.00", currency: "BRL" },
      correlationId: "corr-brl",
    });
    const usd = await useCase.execute({
      playerId,
      initialBalance: { amount: "5.00", currency: "USD" },
      correlationId: "corr-usd",
    });

    expect(brl.id).not.toBe(usd.id);
    expect(brl.balance.currency).toBe("BRL");
    expect(usd.balance.currency).toBe("USD");
  });
});
