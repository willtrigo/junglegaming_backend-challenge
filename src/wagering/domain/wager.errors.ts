import { DomainError } from "@/shared/domain/domain-error";
import type { WagerTransactionKind } from "./wager-transaction-kind.enum";
import type { WagerTransactionStatus } from "./wager-transaction-status.enum";

export class InvalidTransactionStateError extends DomainError {
  readonly code = "WAGER_INVALID_TRANSACTION_STATE";

  constructor(
    readonly transactionId: string,
    readonly from: WagerTransactionStatus,
    readonly to: WagerTransactionStatus,
  ) {
    super(`Transaction ${transactionId} cannot move from ${from} to ${to}`);
  }
}

export class InvalidTransactionError extends DomainError {
  readonly code = "WAGER_INVALID_TRANSACTION";

  constructor(reason: string) {
    super(`Invalid wager transaction: ${reason}`);
  }
}

export class OpeningNotSubmittableError extends DomainError {
  readonly code = "WAGER_OPENING_NOT_SUBMITTABLE";

  constructor() {
    super("OPENING transactions are internal and cannot be submitted");
  }
}

export class ReferenceRequiredError extends DomainError {
  readonly code = "WAGER_REFERENCE_REQUIRED";

  constructor(kind: WagerTransactionKind) {
    super(`${kind} requires a reference`);
  }
}

export class NoLedgerEffectError extends DomainError {
  readonly code = "WAGER_NO_LEDGER_EFFECT";

  constructor(kind: WagerTransactionKind) {
    super(`${kind} has no ledger effect`);
  }
}
