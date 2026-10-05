// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { EntityManager, LockMode } from "@mikro-orm/core";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "@/config/app-config";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { ProcessPendingReferenceUseCase } from "@/wagering/application/process-pending-reference.use-case";
import { WagerTransactionStatus } from "@/wagering/domain/wager-transaction-status.enum";
import { WagerTransactionOrmEntity } from "@/wagering/infrastructure/persistence/wager-transaction.orm-entity";

@Injectable()
export class PendingReferenceProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PendingReferenceProcessor.name);
  private running = false;
  private loopPromise?: Promise<void>;

  constructor(
    private readonly em: EntityManager,
    private readonly processPending: ProcessPendingReferenceUseCase,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.running = true;
    this.loopPromise = this.loop();
    this.logger.log("Pending-reference processor started");
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    await this.loopPromise;
    this.logger.log("Pending-reference processor stopped");
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const n = await this.processBatch();
        if (n === 0) {
          await sleep(this.config.pendingReferencePollIntervalMs);
        }
      } catch (error) {
        this.logger.error(`Pending-reference loop error: ${String(error)}`);
        await sleep(this.config.pendingReferencePollIntervalMs);
      }
    }
  }

  private async processBatch(): Promise<number> {
    const ids = await this.em.fork().transactional(async (em) => {
      const due = await em.find(
        WagerTransactionOrmEntity,
        {
          status: WagerTransactionStatus.PendingReference,
          nextReferenceAttemptAt: { $lte: new Date() },
        },
        {
          orderBy: { nextReferenceAttemptAt: "ASC" },
          limit: this.config.pendingReferenceBatchSize,
          lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
          fields: ["id"],
        },
      );
      return due.map((r) => r.id);
    });

    for (const id of ids) {
      try {
        await this.processPending.execute(id);
      } catch (error) {
        this.logger.warn(`Pending-reference failed for ${id}: ${String(error)}`);
      }
    }

    return ids.length;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
