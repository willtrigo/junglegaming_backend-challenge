import type { MoneyProps } from "@/shared/domain/money/money";
import type { FailureCode } from "@/wagering/domain/failure-code.enum";
import type { WagerTransactionKind } from "@/wagering/domain/wager-transaction-kind.enum";
import type { WagerTransactionStatus } from "@/wagering/domain/wager-transaction-status.enum";

export interface SubmitWagerTransactionCommand {
  correlationId: string;
  idempotencyKey: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string | undefined;
}

export interface SubmitWagerTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: MoneyProps;
  idempotentReplay: boolean;
  failureCode?: FailureCode;
}
