import { describe, expect, test } from "bun:test";
import { DomainError } from "@/shared/domain/domain-error";
import { Money } from "@/shared/domain/money/money";
import { CurrencyMismatchError } from "@/shared/domain/money/money.errors";
import { LedgerDirection } from "@/wallets/domain/ledger-direction.enum";
import { Wallet, type WalletMovement } from "@/wallets/domain/wallet";
import {
  InsufficientFundsError,
  InvalidInitialBalanceError,
  InvalidWalletMovementError,
} from "@/wallets/domain/wallet.errors";
import type { WalletLedgerEntry } from "@/wallets/domain/wallet-ledger-entry";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });
const usd = (amount: string): Money => Money.from({ amount, currency: "USD" });

const T0 = new Date("2026-10-03T12:00:00.000Z");
const T1 = new Date("2026-10-03T12:00:01.000Z");
const T2 = new Date("2026-10-03T12:00:02.000Z");

let sequence = 0;
const movement = (amount: Money, at: Date = T1): WalletMovement => {
  sequence += 1;
  return { entryId: `entry-${sequence}`, transactionId: `tx-${sequence}`, amount, at };
};

const openWallet = (initialBalance = "100.00"): Wallet =>
  Wallet.open({
    id: "wallet-1",
    playerId: "player-1",
    initialBalance: brl(initialBalance),
    openingTransactionId: "tx-opening",
    openingEntryId: "entry-opening",
    at: T0,
  }).wallet;

describe("Wallet", () => {
  describe("open", () => {
    test("starts at version 1 with the initial balance and its currency", () => {
      const { wallet } = Wallet.open({
        id: "wallet-1",
        playerId: "player-1",
        initialBalance: brl("1000.00"),
        openingTransactionId: "tx-opening",
        openingEntryId: "entry-opening",
        at: T0,
      });

      expect(wallet.balance.amount).toBe("1000.00");
      expect(wallet.currency).toBe("BRL");
      expect(wallet.version).toBe(1);
      expect(wallet.createdAt).toEqual(T0);
      expect(wallet.updatedAt).toEqual(T0);
    });

    test("a positive initial balance produces the OPENING credit entry", () => {
      const { openingEntry } = Wallet.open({
        id: "wallet-1",
        playerId: "player-1",
        initialBalance: brl("1000.00"),
        openingTransactionId: "tx-opening",
        openingEntryId: "entry-opening",
        at: T0,
      });

      expect(openingEntry).toBeDefined();
      expect(openingEntry?.direction).toBe(LedgerDirection.Credit);
      expect(openingEntry?.balanceBefore.amount).toBe("0.00");
      expect(openingEntry?.balanceAfter.amount).toBe("1000.00");
      expect(openingEntry?.walletVersion).toBe(1);
      expect(openingEntry?.transactionId).toBe("tx-opening");
      expect(openingEntry?.isBalanced()).toBe(true);
    });

    test("a zero initial balance produces no ledger entry", () => {
      const { wallet, openingEntry } = Wallet.open({
        id: "wallet-1",
        playerId: "player-1",
        initialBalance: brl("0.00"),
        openingTransactionId: "tx-opening",
        openingEntryId: "entry-opening",
        at: T0,
      });

      expect(openingEntry).toBeUndefined();
      expect(wallet.balance.isZero()).toBe(true);
      expect(wallet.version).toBe(1);
    });

    test("rejects a negative initial balance", () => {
      expect(() =>
        Wallet.open({
          id: "wallet-1",
          playerId: "player-1",
          initialBalance: brl("10.00").negate(),
          openingTransactionId: "tx-opening",
          openingEntryId: "entry-opening",
          at: T0,
        }),
      ).toThrow(InvalidInitialBalanceError);
    });
  });

  describe("debit", () => {
    test("reduces the balance, bumps the version and returns the explaining entry", () => {
      const wallet = openWallet("100.00");
      const request = movement(brl("80.00"));

      const entry = wallet.debit(request);

      expect(wallet.balance.amount).toBe("20.00");
      expect(wallet.version).toBe(2);
      expect(wallet.updatedAt).toEqual(T1);
      expect(entry.id).toBe(request.entryId);
      expect(entry.walletId).toBe("wallet-1");
      expect(entry.transactionId).toBe(request.transactionId);
      expect(entry.direction).toBe(LedgerDirection.Debit);
      expect(entry.money.amount).toBe("80.00");
      expect(entry.balanceBefore.amount).toBe("100.00");
      expect(entry.balanceAfter.amount).toBe("20.00");
      expect(entry.walletVersion).toBe(2);
      expect(entry.createdAt).toEqual(T1);
      expect(entry.isBalanced()).toBe(true);
    });

    test("can empty the wallet exactly", () => {
      const wallet = openWallet("100.00");

      wallet.debit(movement(brl("100.00")));

      expect(wallet.balance.amount).toBe("0.00");
      expect(wallet.balance.isNegative()).toBe(false);
    });

    test("rejects insufficient funds and leaves the wallet untouched", () => {
      const wallet = openWallet("20.00");

      expect(() => wallet.debit(movement(brl("20.01")))).toThrow(InsufficientFundsError);

      expect(wallet.balance.amount).toBe("20.00");
      expect(wallet.version).toBe(1);
      expect(wallet.updatedAt).toEqual(T0);
    });

    test("the insufficient-funds error carries a stable code and no amounts", () => {
      const wallet = openWallet("20.00");

      try {
        wallet.debit(movement(brl("50.00")));
        expect.unreachable("expected an InsufficientFundsError");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as InsufficientFundsError).code).toBe("WALLET_INSUFFICIENT_FUNDS");
        expect((error as InsufficientFundsError).walletId).toBe("wallet-1");
        expect((error as Error).message).not.toContain("50.00");
      }
    });
  });

  describe("credit", () => {
    test("increases the balance, bumps the version and returns the explaining entry", () => {
      const wallet = openWallet("20.00");

      const entry = wallet.credit(movement(brl("160.00")));

      expect(wallet.balance.amount).toBe("180.00");
      expect(wallet.version).toBe(2);
      expect(entry.direction).toBe(LedgerDirection.Credit);
      expect(entry.balanceBefore.amount).toBe("20.00");
      expect(entry.balanceAfter.amount).toBe("180.00");
      expect(entry.isBalanced()).toBe(true);
    });

    test("credits a zero-balance wallet: first entry carries version 2", () => {
      const wallet = openWallet("0.00");

      const entry = wallet.credit(movement(brl("5.00")));

      expect(entry.walletVersion).toBe(2);
      expect(entry.balanceBefore.amount).toBe("0.00");
      expect(wallet.version).toBe(2);
    });
  });

  describe("invalid movements", () => {
    test.each([
      ["debit", "zero", "0.00"],
      ["credit", "zero", "0.00"],
    ])("%s rejects a %s amount", (operation, _label, amount) => {
      const wallet = openWallet();
      const request = movement(brl(amount));

      expect(() =>
        operation === "debit" ? wallet.debit(request) : wallet.credit(request),
      ).toThrow(InvalidWalletMovementError);
      expect(wallet.version).toBe(1);
    });

    test.each(["debit", "credit"] as const)("%s rejects a negative amount", (operation) => {
      const wallet = openWallet();
      const request = movement(brl("5.00").negate());

      expect(() => wallet[operation](request)).toThrow(InvalidWalletMovementError);
      expect(wallet.balance.amount).toBe("100.00");
      expect(wallet.version).toBe(1);
    });

    test.each(["debit", "credit"] as const)(
      "%s rejects a currency different from the wallet and leaves it untouched",
      (operation) => {
        const wallet = openWallet();

        expect(() => wallet[operation](movement(usd("5.00")))).toThrow(CurrencyMismatchError);

        expect(wallet.balance.amount).toBe("100.00");
        expect(wallet.version).toBe(1);
        expect(wallet.updatedAt).toEqual(T0);
      },
    );
  });

  describe("mandatory scenario: two 80.00 bets over a 100.00 balance", () => {
    test("exactly one debit succeeds, the other is rejected, final balance is 20.00", () => {
      const wallet = openWallet("100.00");
      const entries: WalletLedgerEntry[] = [];
      const outcomes: string[] = [];

      for (const request of [movement(brl("80.00")), movement(brl("80.00"))]) {
        try {
          entries.push(wallet.debit(request));
          outcomes.push("PROCESSED");
        } catch (error) {
          expect(error).toBeInstanceOf(InsufficientFundsError);
          outcomes.push("REJECTED");
        }
      }

      expect(outcomes).toEqual(["PROCESSED", "REJECTED"]);
      expect(wallet.balance.amount).toBe("20.00");
      expect(entries).toHaveLength(1);
      expect(entries[0]?.direction).toBe(LedgerDirection.Debit);
    });
  });

  describe("rehydrate", () => {
    test("restores persisted state without revalidating it", () => {
      const wallet = Wallet.rehydrate({
        id: "wallet-1",
        playerId: "player-1",
        currency: "BRL",
        balance: brl("42.00"),
        version: 7,
        createdAt: T0,
        updatedAt: T1,
      });

      expect(wallet.balance.amount).toBe("42.00");
      expect(wallet.version).toBe(7);
      expect(wallet.updatedAt).toEqual(T1);
    });

    test("keeps working from the persisted version", () => {
      const wallet = Wallet.rehydrate({
        id: "wallet-1",
        playerId: "player-1",
        currency: "BRL",
        balance: brl("42.00"),
        version: 7,
        createdAt: T0,
        updatedAt: T1,
      });

      const entry = wallet.debit(movement(brl("2.00"), T2));

      expect(entry.walletVersion).toBe(8);
      expect(wallet.version).toBe(8);
      expect(wallet.balance.amount).toBe("40.00");
    });
  });

  describe("invariants over a pseudo-random sequence of movements", () => {
    test("balance equals the ledger, never goes negative, versions and balances chain", () => {
      let seed = 7;
      const next = (): number => {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
        return seed;
      };

      const { wallet, openingEntry } = Wallet.open({
        id: "wallet-1",
        playerId: "player-1",
        initialBalance: brl("500.00"),
        openingTransactionId: "tx-opening",
        openingEntryId: "entry-opening",
        at: T0,
      });
      const ledger: WalletLedgerEntry[] = openingEntry ? [openingEntry] : [];

      for (let i = 0; i < 1000; i += 1) {
        const cents = (next() % 20_000) + 1;
        const amount = brl(`${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`);
        const request = movement(amount);

        try {
          ledger.push(next() % 2 === 0 ? wallet.credit(request) : wallet.debit(request));
        } catch (error) {
          expect(error).toBeInstanceOf(InsufficientFundsError);
        }

        expect(wallet.balance.isNegative()).toBe(false);
      }

      const reconstructed = ledger.reduce(
        (total, entry) =>
          entry.direction === LedgerDirection.Credit
            ? total.add(entry.money)
            : total.subtract(entry.money),
        Money.zero("BRL"),
      );

      expect(reconstructed.equals(wallet.balance)).toBe(true);
      expect(ledger.length).toBeGreaterThan(100);
      expect(wallet.version).toBe(ledger.length);

      ledger.forEach((entry, index) => {
        expect(entry.walletVersion).toBe(index + 1);
        expect(entry.isBalanced()).toBe(true);
        if (index > 0) {
          expect(
            entry.balanceBefore.equals((ledger[index - 1] as WalletLedgerEntry).balanceAfter),
          ).toBe(true);
        }
      });
    });
  });
});
