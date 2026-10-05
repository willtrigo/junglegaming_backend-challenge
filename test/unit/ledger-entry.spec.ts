import { describe, expect, test } from "bun:test";
import { Money } from "@/shared/domain/money/money";
import { CurrencyMismatchError } from "@/shared/domain/money/money.errors";
import { LedgerDirection } from "@/wallets/domain/ledger-direction.enum";
import { InvalidLedgerEntryError } from "@/wallets/domain/wallet.errors";
import {
  type CreateLedgerEntryProps,
  WalletLedgerEntry,
} from "@/wallets/domain/wallet-ledger-entry";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });

const props = (overrides: Partial<CreateLedgerEntryProps> = {}): CreateLedgerEntryProps => ({
  id: "entry-1",
  walletId: "wallet-1",
  transactionId: "tx-1",
  walletVersion: 2,
  direction: LedgerDirection.Debit,
  money: brl("80.00"),
  balanceBefore: brl("100.00"),
  balanceAfter: brl("20.00"),
  createdAt: new Date("2026-10-03T12:00:00.000Z"),
  ...overrides,
});

describe("WalletLedgerEntry", () => {
  describe("create", () => {
    test("creates a balanced debit entry", () => {
      const entry = WalletLedgerEntry.create(props());

      expect(entry.isBalanced()).toBe(true);
      expect(entry.direction).toBe(LedgerDirection.Debit);
      expect(entry.balanceAfter.amount).toBe("20.00");
      expect(entry.walletVersion).toBe(2);
    });

    test("creates a balanced credit entry", () => {
      const entry = WalletLedgerEntry.create(
        props({
          direction: LedgerDirection.Credit,
          money: brl("25.00"),
          balanceBefore: brl("20.00"),
          balanceAfter: brl("45.00"),
        }),
      );

      expect(entry.isBalanced()).toBe(true);
    });

    test("allows a debit that empties the balance", () => {
      const entry = WalletLedgerEntry.create(
        props({ balanceAfter: brl("0.00"), money: brl("100.00") }),
      );

      expect(entry.balanceAfter.isZero()).toBe(true);
    });

    test.each([
      ["a debit whose arithmetic is off", { balanceAfter: brl("30.00") }],
      ["a credit recorded as a debit", { direction: LedgerDirection.Credit }],
      [
        "a debit recorded as a credit",
        {
          direction: LedgerDirection.Credit,
          balanceBefore: brl("20.00"),
          balanceAfter: brl("100.00"),
          money: brl("70.00"),
        },
      ],
    ])("rejects %s", (_label, overrides) => {
      expect(() => WalletLedgerEntry.create(props(overrides))).toThrow(InvalidLedgerEntryError);
    });

    test.each([
      ["zero amount", brl("0.00")],
      ["negative amount", brl("80.00").negate()],
    ])("rejects a %s", (_label, money) => {
      expect(() =>
        WalletLedgerEntry.create(
          props({ money, balanceBefore: brl("100.00"), balanceAfter: brl("100.00") }),
        ),
      ).toThrow(InvalidLedgerEntryError);
    });

    test("rejects a negative resulting balance", () => {
      expect(() =>
        WalletLedgerEntry.create(
          props({
            money: brl("120.00"),
            balanceBefore: brl("100.00"),
            balanceAfter: brl("20.00").negate(),
          }),
        ),
      ).toThrow(InvalidLedgerEntryError);
    });

    test.each([0, -1, 1.5, Number.NaN])("rejects wallet version %p", (walletVersion) => {
      expect(() => WalletLedgerEntry.create(props({ walletVersion }))).toThrow(
        InvalidLedgerEntryError,
      );
    });

    test("rejects balances in a different currency than the amount", () => {
      const usd = (amount: string): Money => Money.from({ amount, currency: "USD" });

      expect(() =>
        WalletLedgerEntry.create(
          props({ balanceBefore: usd("100.00"), balanceAfter: usd("20.00") }),
        ),
      ).toThrow(CurrencyMismatchError);
    });

    test("carries a stable error code", () => {
      try {
        WalletLedgerEntry.create(props({ balanceAfter: brl("30.00") }));
        expect.unreachable("expected an InvalidLedgerEntryError");
      } catch (error) {
        expect((error as InvalidLedgerEntryError).code).toBe("LEDGER_ENTRY_INVALID");
      }
    });
  });

  describe("rehydrate", () => {
    test("rebuilds persisted state without revalidating it", () => {
      const entry = WalletLedgerEntry.rehydrate(props({ balanceAfter: brl("30.00") }));

      expect(entry.balanceAfter.amount).toBe("30.00");
      expect(entry.isBalanced()).toBe(false);
    });
  });

  describe("immutability", () => {
    test("instances are frozen and expose no mutators", () => {
      const entry = WalletLedgerEntry.create(props());

      expect(Object.isFrozen(entry)).toBe(true);
      expect(() => {
        (entry as unknown as { direction: LedgerDirection }).direction = LedgerDirection.Credit;
      }).toThrow();
      expect(entry.direction).toBe(LedgerDirection.Debit);
    });
  });
});
