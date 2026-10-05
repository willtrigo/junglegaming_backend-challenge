import { DomainError } from "@/shared/domain/domain-error";

export class InsufficientFundsError extends DomainError {
  readonly code = "WALLET_INSUFFICIENT_FUNDS";

  constructor(readonly walletId: string) {
    super(`Wallet ${walletId} has insufficient funds for the requested debit`);
  }
}

export class InvalidWalletMovementError extends DomainError {
  readonly code = "WALLET_INVALID_MOVEMENT";

  constructor(reason: string) {
    super(`Invalid wallet movement: ${reason}`);
  }
}

export class InvalidInitialBalanceError extends DomainError {
  readonly code = "WALLET_INVALID_INITIAL_BALANCE";

  constructor() {
    super("Initial balance cannot be negative");
  }
}

export class InvalidLedgerEntryError extends DomainError {
  readonly code = "LEDGER_ENTRY_INVALID";

  constructor(reason: string) {
    super(`Invalid ledger entry: ${reason}`);
  }
}
