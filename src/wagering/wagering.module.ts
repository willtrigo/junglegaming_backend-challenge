import { MikroOrmModule } from "@mikro-orm/nestjs";
import { Module } from "@nestjs/common";
import { SubmitWagerTransactionUseCase } from "./application/submit-wager-transaction.use-case";

@Module({
  imports: [MikroOrmModule.forFeature([])],
  providers: [SubmitWagerTransactionUseCase],
  exports: [SubmitWagerTransactionUseCase],
})
export class WageringModule {}
