import { Decimal } from "decimal.js";
import {
  AmountOutOfRangeError,
  CurrencyMismatchError,
  InvalidAmountError,
  InvalidCurrencyError,
} from "./money.errors";

export interface MoneyProps {
  amount: string;
  currency: string;
}

const SCALE = 2;
const MAX_INTEGER_DIGITS = 18;

const AMOUNT_PATTERN = /^(0|[1-9]\d*)(\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {
    Object.freeze(this);
  }

  static from(props: MoneyProps): Money {
    const currency = Money.parseCurrency(props.currency);
    const value = Money.parseAmount(props.amount);
    return Money.of(value, currency);
  }

  static zero(currency: string): Money {
    return Money.of(new Dec(0), Money.parseCurrency(currency));
  }

  get amount(): string {
    return this.value.toFixed(SCALE);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return Money.of(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative() && !this.value.isZero();
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return { amount: this.amount, currency: this.currency };
  }

  toString(): string {
    return `${this.amount} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  private static of(value: Decimal, currency: string): Money {
    if (value.abs().truncated().toFixed(0).length > MAX_INTEGER_DIGITS) {
      throw new AmountOutOfRangeError(MAX_INTEGER_DIGITS);
    }
    return new Money(value.isZero() ? new Dec(0) : value, currency);
  }

  private static parseAmount(amount: unknown): Decimal {
    if (typeof amount !== "string") {
      throw new InvalidAmountError("amount must be a decimal string");
    }
    if (!AMOUNT_PATTERN.test(amount)) {
      throw new InvalidAmountError(
        "expected a non-negative decimal with at most 2 fractional digits and no exponent",
      );
    }
    return new Dec(amount);
  }

  private static parseCurrency(currency: unknown): string {
    if (typeof currency !== "string" || !CURRENCY_PATTERN.test(currency)) {
      throw new InvalidCurrencyError("expected a 3-letter uppercase ISO-4217 code");
    }
    return currency;
  }
}
