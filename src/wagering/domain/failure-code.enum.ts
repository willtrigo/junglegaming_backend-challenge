export enum FailureCode {
  InsufficientFunds = "INSUFFICIENT_FUNDS",
  ReversalWouldOverdraw = "REVERSAL_WOULD_OVERDRAW",
  ReferenceNotFound = "REFERENCE_NOT_FOUND",
  ReferenceNotProcessed = "REFERENCE_NOT_PROCESSED",
  ReferenceKindMismatch = "REFERENCE_KIND_MISMATCH",
  ReferenceScopeMismatch = "REFERENCE_SCOPE_MISMATCH",
  ReferenceAmountMismatch = "REFERENCE_AMOUNT_MISMATCH",
  AlreadyReversed = "ALREADY_REVERSED",
  WalletNotFound = "WALLET_NOT_FOUND",
  PlayerWalletMismatch = "PLAYER_WALLET_MISMATCH",
  CurrencyMismatch = "CURRENCY_MISMATCH",
  InfrastructureFailure = "INFRASTRUCTURE_FAILURE",
}

export type ProviderAction = "FIX_PAYLOAD" | "DO_NOT_RETRY" | "CONTACT_SUPPORT";

const PROVIDER_ACTION: Readonly<Record<FailureCode, ProviderAction>> = {
  [FailureCode.InsufficientFunds]: "DO_NOT_RETRY",
  [FailureCode.ReversalWouldOverdraw]: "DO_NOT_RETRY",
  [FailureCode.ReferenceNotFound]: "FIX_PAYLOAD",
  [FailureCode.ReferenceNotProcessed]: "DO_NOT_RETRY",
  [FailureCode.ReferenceKindMismatch]: "FIX_PAYLOAD",
  [FailureCode.ReferenceScopeMismatch]: "FIX_PAYLOAD",
  [FailureCode.ReferenceAmountMismatch]: "FIX_PAYLOAD",
  [FailureCode.AlreadyReversed]: "DO_NOT_RETRY",
  [FailureCode.WalletNotFound]: "FIX_PAYLOAD",
  [FailureCode.PlayerWalletMismatch]: "FIX_PAYLOAD",
  [FailureCode.CurrencyMismatch]: "FIX_PAYLOAD",
  [FailureCode.InfrastructureFailure]: "CONTACT_SUPPORT",
};

export function providerActionFor(code: FailureCode): ProviderAction {
  return PROVIDER_ACTION[code];
}
