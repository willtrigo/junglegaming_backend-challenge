import { Module } from "@nestjs/common";

import { CreateWalletUseCase } from "./application/create-wallet.use-case";
import { WalletsController } from "./presentation/wallets.controller";

@Module({
  controllers: [WalletsController],
  providers: [CreateWalletUseCase],
  exports: [CreateWalletUseCase],
})
export class WalletsModule {}
