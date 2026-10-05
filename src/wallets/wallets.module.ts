import { MikroOrmModule } from "@mikro-orm/nestjs";
import { Module } from "@nestjs/common";
import { CreateWalletUseCase } from "./application/create-wallet.use-case";

@Module({
  imports: [MikroOrmModule.forFeature([])],
  providers: [CreateWalletUseCase],
  exports: [CreateWalletUseCase],
})
export class WalletsModule {}
