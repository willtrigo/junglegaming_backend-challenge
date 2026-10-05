// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { EntityManager, LockMode } from "@mikro-orm/core";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "@/config/app-config";
import { OutboxMessageOrmEntity } from "@/messaging/infrastructure/persistence/outbox-message.orm-entity";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { SqsClientService } from "@/messaging/infrastructure/sqs/sqs.client";

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private running = false;
  private loopPromise?: Promise<void>;

  constructor(
    private readonly em: EntityManager,
    private readonly sqs: SqsClientService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.running = true;
    this.loopPromise = this.loop();
    this.logger.log("Outbox publisher started");
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    await this.loopPromise;
    this.logger.log("Outbox publisher stopped");
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const published = await this.publishBatch();
        if (published === 0) {
          await sleep(this.config.outboxPollIntervalMs);
        }
      } catch (error) {
        this.logger.error(`Outbox loop error: ${String(error)}`);
        await sleep(this.config.outboxPollIntervalMs);
      }
    }
  }

  private async publishBatch(): Promise<number> {
    return this.em.fork().transactional(async (em) => {
      const due = await em.find(
        OutboxMessageOrmEntity,
        {
          publishedAt: null,
          nextAttemptAt: { $lte: new Date() },
        },
        {
          orderBy: { sequence: "ASC" },
          limit: this.config.outboxBatchSize,
          lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
        },
      );

      if (due.length === 0) {
        return 0;
      }

      let published = 0;
      for (const row of due) {
        try {
          const payload =
            typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload);
          await this.sqs.publishIntegrationEvent({
            eventType: row.eventType,
            payload,
            groupId: row.aggregateId,
            deduplicationId: row.id,
          });
          row.publishedAt = new Date();
          row.lastError = null;
          published += 1;
        } catch (error) {
          row.attempts = Number(row.attempts) + 1;
          row.lastError = String(error).slice(0, 250);
          const delayMs = Math.min(60_000 * 5, 1_000 * 2 ** Math.min(row.attempts, 8));
          row.nextAttemptAt = new Date(Date.now() + delayMs);
          this.logger.warn(`Failed to publish outbox ${row.id}: ${String(error)}`);
        }
      }
      return published;
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
