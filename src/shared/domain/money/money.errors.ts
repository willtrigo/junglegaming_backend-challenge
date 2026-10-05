import { DomainError } from "../domain-error";

export class InvalidAmountError extends DomainError {
  readonly code = "MONEY_INVALID_AMOUNT";

  constructor(reason: string) {
    super(`Invalid monetary amount: ${reason}`);
  }
}

export class AmountOutOfRangeError extends DomainError {
  readonly code = "MONEY_AMOUNT_OUT_OF_RANGE";

  constructor(maxIntegerDigits: number) {
    super(`Monetary amount exceeds the supported range of ${maxIntegerDigits} integer digits`);
  }
}

export class InvalidCurrencyError extends DomainError {
  readonly code = "MONEY_INVALID_CURRENCY";

  constructor(reason: string) {
    super(`Invalid currency: ${reason}`);
  }
}

export class CurrencyMismatchError extends DomainError {
  readonly code = "MONEY_CURRENCY_MISMATCH";

  constructor(
    readonly expected: string,
    readonly received: string,
  ) {
    super(`Currency mismatch: expected ${expected}, received ${received}`);
  }
}
