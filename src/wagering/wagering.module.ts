import { Module } from "@nestjs/common";

import { ProcessPendingReferenceUseCase } from "./application/process-pending-reference.use-case";
import { SubmitWagerTransactionUseCase } from "./application/submit-wager-transaction.use-case";
import { WageringController } from "./presentation/wagering.controller";

@Module({
  controllers: [WageringController],
  providers: [SubmitWagerTransactionUseCase, ProcessPendingReferenceUseCase],
  exports: [SubmitWagerTransactionUseCase, ProcessPendingReferenceUseCase],
})
export class WageringModule {}
