import { createHash } from "node:crypto";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { EntityManager } from "@mikro-orm/core";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "@/config/app-config";
import { InboxMessageOrmEntity } from "@/messaging/infrastructure/persistence/inbox-message.orm-entity";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { SqsClientService } from "@/messaging/infrastructure/sqs/sqs.client";
import { DomainError } from "@/shared/domain/domain-error";
import {
  IdempotencyConflictError,
  WalletNotFoundError,
} from "@/wagering/application/submit-wager-transaction.errors";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { SubmitWagerTransactionUseCase } from "@/wagering/application/submit-wager-transaction.use-case";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { WagerTransactionKind } from "@/wagering/domain/wager-transaction-kind.enum";

const CONSUMER_NAME = "wager-transactions-consumer";

interface SqsWagerPayload {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: { amount: string; currency: string };
  referenceExternalTransactionId?: string;
  idempotencyKey?: string;
  correlationId?: string;
}

@Injectable()
export class WagerSqsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WagerSqsConsumer.name);
  private running = false;
  private loopPromise?: Promise<void>;

  constructor(
    private readonly sqs: SqsClientService,
    private readonly submit: SubmitWagerTransactionUseCase,
    private readonly em: EntityManager,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.running = true;
    this.loopPromise = this.loop();
    this.logger.log("SQS wager consumer started");
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    await this.loopPromise;
    this.logger.log("SQS wager consumer stopped");
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const messages = await this.sqs.receiveWagerMessages(
          Math.min(this.config.sqsConsumerConcurrency, 10),
        );
        if (messages.length === 0) {
          continue;
        }
        await Promise.all(messages.map((m) => this.handleOne(m)));
      } catch (error) {
        this.logger.error(`Consumer loop error: ${String(error)}`);
        await sleep(1_000);
      }
    }
  }

  private async handleOne(message: {
    messageId: string;
    receiptHandle: string;
    body: string;
  }): Promise<void> {
    let payload: SqsWagerPayload;
    try {
      payload = JSON.parse(message.body) as SqsWagerPayload;
    } catch {
      this.logger.error(`Invalid JSON body for message ${message.messageId}; deleting`);
      await this.sqs.deleteWagerMessage(message.receiptHandle);
      return;
    }

    const payloadHash = createHash("sha256").update(message.body).digest("hex");
    const idempotencyKey =
      payload.idempotencyKey ?? `${payload.providerId}:${payload.externalTransactionId}`;

    try {
      const isDuplicate = await this.em.fork().transactional(async (em) => {
        const existing = await em.findOne(InboxMessageOrmEntity, {
          consumerName: CONSUMER_NAME,
          messageId: message.messageId,
        });
        if (existing !== null) {
          return true;
        }
        em.persist(
          Object.assign(new InboxMessageOrmEntity(), {
            consumerName: CONSUMER_NAME,
            messageId: message.messageId,
            payloadHash,
            receivedAt: new Date(),
            processedAt: null,
          }),
        );
        return false;
      });

      if (isDuplicate) {
        await this.sqs.deleteWagerMessage(message.receiptHandle);
        return;
      }

      await this.submit.execute({
        correlationId: payload.correlationId ?? `sqs:${message.messageId}`,
        idempotencyKey,
        providerId: payload.providerId,
        externalTransactionId: payload.externalTransactionId,
        playerId: payload.playerId,
        walletId: payload.walletId,
        roundId: payload.roundId,
        gameId: payload.gameId,
        kind: payload.kind,
        money: payload.money,
        referenceExternalTransactionId: payload.referenceExternalTransactionId,
      });

      await this.em
        .fork()
        .nativeUpdate(
          InboxMessageOrmEntity,
          { consumerName: CONSUMER_NAME, messageId: message.messageId },
          { processedAt: new Date() },
        );

      await this.sqs.deleteWagerMessage(message.receiptHandle);
    } catch (error) {
      if (
        error instanceof DomainError ||
        error instanceof IdempotencyConflictError ||
        error instanceof WalletNotFoundError
      ) {
        this.logger.warn(`Business error on ${message.messageId}: ${error.message}; ack`);
        await this.sqs.deleteWagerMessage(message.receiptHandle);
        return;
      }
      this.logger.error(`Transient error on ${message.messageId}: ${String(error)}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
