import { describe, expect, test } from "bun:test";
import { DomainError } from "@/shared/domain/domain-error";
import { Money, type MoneyProps } from "@/shared/domain/money/money";
import {
  AmountOutOfRangeError,
  CurrencyMismatchError,
  InvalidAmountError,
  InvalidCurrencyError,
} from "@/shared/domain/money/money.errors";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });
const usd = (amount: string): Money => Money.from({ amount, currency: "USD" });

describe("Money", () => {
  describe("from", () => {
    test.each([
      ["25.00", "25.00"],
      ["25.5", "25.50"],
      ["25", "25.00"],
      ["0", "0.00"],
      ["0.00", "0.00"],
      ["0.01", "0.01"],
      ["1000000.99", "1000000.99"],
      ["999999999999999999.99", "999999999999999999.99"],
    ])("accepts %p and normalizes it to %p", (input, expected) => {
      expect(brl(input).amount).toBe(expected);
    });

    test.each([
      ["empty string", ""],
      ["whitespace only", "   "],
      ["NaN", "NaN"],
      ["Infinity", "Infinity"],
      ["negative Infinity", "-Infinity"],
      ["scientific notation", "1e3"],
      ["uppercase scientific notation", "1E3"],
      ["scientific notation with fraction", "2.5e1"],
      ["more than 2 decimals", "1.234"],
      ["more than 2 decimals ending in zero", "1.000"],
      ["negative value", "-1.00"],
      ["negative zero", "-0.00"],
      ["explicit plus sign", "+1.00"],
      ["comma separator", "1,00"],
      ["thousands separator", "1,000.00"],
      ["missing integer part", ".5"],
      ["trailing dot", "5."],
      ["leading zeros", "007.00"],
      ["leading space", " 1.00"],
      ["trailing space", "1.00 "],
      ["hexadecimal", "0x10"],
      ["letters", "abc"],
      ["two dots", "1.0.0"],
    ])("rejects %s (%p)", (_label, input) => {
      expect(() => brl(input)).toThrow(InvalidAmountError);
    });

    test.each([
      ["number", 25],
      ["null", null],
      ["undefined", undefined],
      ["object", {}],
      ["boolean", true],
    ])("rejects a non-string amount (%s)", (_label, input) => {
      expect(() => Money.from({ amount: input as unknown as string, currency: "BRL" })).toThrow(
        InvalidAmountError,
      );
    });

    test.each([
      ["lowercase", "brl"],
      ["too short", "BR"],
      ["too long", "BRLL"],
      ["empty", ""],
      ["digits", "B1L"],
      ["padded", " BRL"],
    ])("rejects an invalid currency (%s: %p)", (_label, currency) => {
      expect(() => Money.from({ amount: "1.00", currency })).toThrow(InvalidCurrencyError);
    });

    test("rejects a non-string currency", () => {
      expect(() => Money.from({ amount: "1.00", currency: 986 as unknown as string })).toThrow(
        InvalidCurrencyError,
      );
    });

    test("accepts the largest supported value and rejects one more integer digit", () => {
      expect(brl("999999999999999999.99").amount).toBe("999999999999999999.99");
      expect(() => brl("1000000000000000000.00")).toThrow(AmountOutOfRangeError);
    });
  });

  describe("zero", () => {
    test("creates a zero value in the given currency", () => {
      const zero = Money.zero("BRL");

      expect(zero.amount).toBe("0.00");
      expect(zero.currency).toBe("BRL");
      expect(zero.isZero()).toBe(true);
    });

    test("rejects an invalid currency", () => {
      expect(() => Money.zero("real")).toThrow(InvalidCurrencyError);
    });
  });

  describe("arithmetic", () => {
    test("adds exactly where binary floats would not (0.10 + 0.20)", () => {
      expect(brl("0.10").add(brl("0.20")).amount).toBe("0.30");
    });

    test("subtracts exactly (0.30 - 0.10)", () => {
      expect(brl("0.30").subtract(brl("0.10")).amount).toBe("0.20");
    });

    test("accumulates 10000 cents without drift", () => {
      const cent = brl("0.01");
      let total = Money.zero("BRL");

      for (let i = 0; i < 10_000; i += 1) {
        total = total.add(cent);
      }

      expect(total.amount).toBe("100.00");
    });

    test("subtracting more than the balance yields a negative value", () => {
      const result = brl("20.00").subtract(brl("80.00"));

      expect(result.amount).toBe("-60.00");
      expect(result.isNegative()).toBe(true);
      expect(result.isPositive()).toBe(false);
    });

    test("negate flips the sign and negating twice restores the value", () => {
      const value = brl("12.34");

      expect(value.negate().amount).toBe("-12.34");
      expect(value.negate().negate().equals(value)).toBe(true);
    });

    test("negating zero never produces negative zero", () => {
      const result = Money.zero("BRL").negate();

      expect(result.amount).toBe("0.00");
      expect(result.isNegative()).toBe(false);
      expect(result.isZero()).toBe(true);
    });

    test("x - x is exactly zero", () => {
      const result = brl("80.00").subtract(brl("80.00"));

      expect(result.amount).toBe("0.00");
      expect(result.isZero()).toBe(true);
    });

    test("rejects results beyond the supported range", () => {
      expect(() => brl("999999999999999999.99").add(brl("1.00"))).toThrow(AmountOutOfRangeError);
    });

    test("add followed by subtract is the identity for pseudo-random amounts", () => {
      let seed = 42;
      const next = (): number => {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
        return seed;
      };

      for (let i = 0; i < 500; i += 1) {
        const a = brl(centsToAmount(next() % 100_000_000));
        const b = brl(centsToAmount(next() % 100_000_000));

        expect(a.add(b).subtract(b).equals(a)).toBe(true);
        expect(a.add(b).equals(b.add(a))).toBe(true);
      }
    });
  });

  describe("immutability", () => {
    test("operations return new instances and leave operands untouched", () => {
      const a = brl("10.00");
      const b = brl("5.00");

      const sum = a.add(b);
      const difference = a.subtract(b);
      const negated = a.negate();

      expect(sum).not.toBe(a);
      expect(difference).not.toBe(a);
      expect(negated).not.toBe(a);
      expect(a.amount).toBe("10.00");
      expect(b.amount).toBe("5.00");
    });

    test("instances are frozen", () => {
      const value = brl("10.00");

      expect(Object.isFrozen(value)).toBe(true);
      expect(() => {
        (value as unknown as { currency: string }).currency = "USD";
      }).toThrow();
    });
  });

  describe("comparisons", () => {
    test("isZero, isPositive and isNegative are mutually consistent", () => {
      const zero = brl("0.00");
      const positive = brl("0.01");
      const negative = positive.negate();

      expect([zero.isZero(), zero.isPositive(), zero.isNegative()]).toEqual([true, false, false]);
      expect([positive.isZero(), positive.isPositive(), positive.isNegative()]).toEqual([
        false,
        true,
        false,
      ]);
      expect([negative.isZero(), negative.isPositive(), negative.isNegative()]).toEqual([
        false,
        false,
        true,
      ]);
    });

    test("isLessThan is strict", () => {
      expect(brl("20.00").isLessThan(brl("80.00"))).toBe(true);
      expect(brl("80.00").isLessThan(brl("20.00"))).toBe(false);
      expect(brl("80.00").isLessThan(brl("80.00"))).toBe(false);
    });

    test("equals compares value and currency, ignoring input formatting", () => {
      expect(brl("25").equals(brl("25.00"))).toBe(true);
      expect(brl("25.00").equals(brl("25.01"))).toBe(false);
    });

    test("equals is false across currencies instead of throwing", () => {
      expect(brl("25.00").equals(usd("25.00"))).toBe(false);
    });
  });

  describe("currency mismatch", () => {
    test.each([
      ["add", (a: Money, b: Money) => a.add(b)],
      ["subtract", (a: Money, b: Money) => a.subtract(b)],
      ["isLessThan", (a: Money, b: Money) => a.isLessThan(b)],
    ])("%s throws a domain error", (_name, operation) => {
      expect(() => operation(brl("1.00"), usd("1.00"))).toThrow(CurrencyMismatchError);
    });

    test("the error carries a stable code and both currencies", () => {
      try {
        brl("1.00").add(usd("1.00"));
        expect.unreachable("expected a CurrencyMismatchError");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect(error).toBeInstanceOf(CurrencyMismatchError);
        expect((error as CurrencyMismatchError).code).toBe("MONEY_CURRENCY_MISMATCH");
        expect((error as CurrencyMismatchError).expected).toBe("BRL");
        expect((error as CurrencyMismatchError).received).toBe("USD");
      }
    });
  });

  describe("error contract", () => {
    test.each([
      [() => brl("1.234"), "MONEY_INVALID_AMOUNT"],
      [() => Money.zero("x"), "MONEY_INVALID_CURRENCY"],
      [() => brl("1000000000000000000.00"), "MONEY_AMOUNT_OUT_OF_RANGE"],
    ])("exposes a stable machine-readable code (%#)", (operation, code) => {
      try {
        operation();
        expect.unreachable("expected a DomainError");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe(code);
      }
    });
  });

  describe("serialization", () => {
    test("toJSON returns a decimal string, never a number", () => {
      const json = brl("25").toJSON();

      expect(json).toEqual({ amount: "25.00", currency: "BRL" });
      expect(typeof json.amount).toBe("string");
    });

    test("JSON.stringify uses toJSON", () => {
      expect(JSON.stringify({ money: brl("975.00") })).toBe(
        '{"money":{"amount":"975.00","currency":"BRL"}}',
      );
    });

    test("round-trips through JSON without loss", () => {
      const original = brl("1234567.89");
      const restored = Money.from(JSON.parse(JSON.stringify(original)) as MoneyProps);

      expect(restored.equals(original)).toBe(true);
    });

    test("a negative result serializes with a sign", () => {
      expect(brl("1.00").subtract(brl("2.50")).toJSON()).toEqual({
        amount: "-1.50",
        currency: "BRL",
      });
    });

    test("toString includes amount and currency", () => {
      expect(brl("25").toString()).toBe("25.00 BRL");
    });
  });

  describe("scenario: concurrent bets of 80.00 over a 100.00 balance", () => {
    test("exactly one bet fits and the remaining balance is 20.00", () => {
      const balance = brl("100.00");
      const bet = brl("80.00");

      const afterFirst = balance.subtract(bet);
      const secondFits = !afterFirst.subtract(bet).isNegative();

      expect(afterFirst.amount).toBe("20.00");
      expect(secondFits).toBe(false);
    });
  });
});

function centsToAmount(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}
