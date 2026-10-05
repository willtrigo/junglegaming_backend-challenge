// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { EntityManager } from "@mikro-orm/core";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";

// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { CreateWalletUseCase } from "@/wallets/application/create-wallet.use-case";
import { WalletOrmEntity } from "@/wallets/infrastructure/persistence/wallet.orm-entity";
import { WalletLedgerEntryOrmEntity } from "@/wallets/infrastructure/persistence/wallet-ledger-entry.orm-entity";
import { createWalletBodySchema } from "./wallets.dto";

@Controller("wallets")
export class WalletsController {
  constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly em: EntityManager,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown) {
    const parsed = createWalletBodySchema.parse(body);
    return this.createWallet.execute({
      playerId: parsed.playerId,
      initialBalance: parsed.initialBalance,
      correlationId: `http-create-wallet:${parsed.playerId}`,
    });
  }

  @Get(":walletId")
  async getOne(@Param("walletId") walletId: string) {
    const wallet = await this.em.findOne(WalletOrmEntity, { id: walletId });
    if (wallet === null) {
      throw new NotFoundException({ code: "WALLET_NOT_FOUND", message: "Wallet not found" });
    }
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: { amount: wallet.balance, currency: wallet.currency },
      version: Number(wallet.version),
    };
  }

  @Get(":walletId/ledger")
  async ledger(@Param("walletId") walletId: string) {
    const wallet = await this.em.findOne(WalletOrmEntity, { id: walletId });
    if (wallet === null) {
      throw new NotFoundException({ code: "WALLET_NOT_FOUND", message: "Wallet not found" });
    }

    const entries = await this.em.find(
      WalletLedgerEntryOrmEntity,
      { walletId },
      { orderBy: { walletVersion: "ASC" }, limit: 50 },
    );

    return {
      items: entries.map((e) => ({
        id: e.id,
        walletId: e.walletId,
        transactionId: e.transactionId,
        walletVersion: Number(e.walletVersion),
        direction: e.direction,
        money: { amount: e.amount, currency: e.currency },
        balanceBefore: e.balanceBefore,
        balanceAfter: e.balanceAfter,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }
}
