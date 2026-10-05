// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { EntityManager } from "@mikro-orm/core";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";

// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { SubmitWagerTransactionUseCase } from "@/wagering/application/submit-wager-transaction.use-case";
import { WagerTransactionKind } from "@/wagering/domain/wager-transaction-kind.enum";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { WagerTransactionStatus } from "@/wagering/domain/wager-transaction-status.enum";
import { WagerTransactionOrmEntity } from "@/wagering/infrastructure/persistence/wager-transaction.orm-entity";
import { submitWagerBodySchema } from "./wagering.dto";

@Controller()
export class WageringController {
  constructor(
    private readonly submit: SubmitWagerTransactionUseCase,
    private readonly em: EntityManager,
  ) {}

  @Post("wagering/transactions")
  @HttpCode(HttpStatus.OK)
  async submitTransaction(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    if (idempotencyKey === undefined || idempotencyKey.trim() === "") {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Header Idempotency-Key is required",
      });
    }

    const parsed = submitWagerBodySchema.parse(body);

    if (parsed.kind === WagerTransactionKind.Opening) {
      throw new BadRequestException({
        code: "OPENING_NOT_SUBMITTABLE",
        message: "OPENING transactions cannot be submitted via API",
      });
    }

    return this.submit.execute({
      correlationId: `http:${idempotencyKey}`,
      idempotencyKey: idempotencyKey.trim(),
      providerId: parsed.providerId,
      externalTransactionId: parsed.externalTransactionId,
      playerId: parsed.playerId,
      walletId: parsed.walletId,
      roundId: parsed.roundId,
      gameId: parsed.gameId,
      kind: parsed.kind,
      money: parsed.money,
      referenceExternalTransactionId: parsed.referenceExternalTransactionId,
    });
  }

  @Get("wagering/transactions/:transactionId")
  async getById(@Param("transactionId") transactionId: string) {
    const tx = await this.em.findOne(WagerTransactionOrmEntity, { id: transactionId });
    if (tx === null) {
      throw new NotFoundException({ code: "TRANSACTION_NOT_FOUND", message: "Not found" });
    }
    return this.toView(tx);
  }

  @Get("providers/:providerId/wagering/transactions/:externalTransactionId")
  async getByExternal(
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string,
  ) {
    const tx = await this.em.findOne(WagerTransactionOrmEntity, {
      providerId,
      externalTransactionId,
    });
    if (tx === null) {
      throw new NotFoundException({ code: "TRANSACTION_NOT_FOUND", message: "Not found" });
    }
    return this.toView(tx);
  }

  private toView(tx: WagerTransactionOrmEntity) {
    return {
      transactionId: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      playerId: tx.playerId,
      walletId: tx.walletId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      money: { amount: tx.amount, currency: tx.currency },
      status: tx.status as WagerTransactionStatus,
      failureCode: tx.failureCode ?? undefined,
      referenceExternalTransactionId: tx.referenceExternalTransactionId ?? undefined,
      observedBalance:
        tx.observedBalance !== null && tx.observedBalance !== undefined
          ? { amount: tx.observedBalance, currency: tx.currency }
          : undefined,
      createdAt: tx.createdAt.toISOString(),
      processedAt: tx.processedAt?.toISOString(),
    };
  }
}
