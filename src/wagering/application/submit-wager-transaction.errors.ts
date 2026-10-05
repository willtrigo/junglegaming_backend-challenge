import { DomainError } from "@/shared/domain/domain-error";
import type { FailureCode } from "@/wagering/domain/failure-code.enum";

export class IdempotencyConflictError extends DomainError {
  readonly code = "IDEMPOTENCY_CONFLICT";

  constructor(
    readonly idempotencyKey: string,
    readonly existingTransactionId: string,
  ) {
    super(
      `Idempotency key "${idempotencyKey}" was already used with a different payload (tx ${existingTransactionId})`,
    );
  }
}

export class WalletNotFoundError extends DomainError {
  readonly code = "WALLET_NOT_FOUND";

  constructor(readonly walletId: string) {
    super(`Wallet ${walletId} was not found`);
  }
}

export class PlayerWalletMismatchError extends DomainError {
  readonly code = "PLAYER_WALLET_MISMATCH";

  constructor(
    readonly walletId: string,
    readonly expectedPlayerId: string,
    readonly actualPlayerId: string,
  ) {
    super(`Wallet ${walletId} belongs to player ${actualPlayerId}, expected ${expectedPlayerId}`);
  }
}

export class WagerRejectedError extends DomainError {
  readonly code = "WAGER_REJECTED";

  constructor(
    readonly failureCode: FailureCode,
    readonly transactionId: string,
    message?: string,
  ) {
    super(message ?? `Transaction ${transactionId} rejected: ${failureCode}`);
  }
}
