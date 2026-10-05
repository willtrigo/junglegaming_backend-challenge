import "dotenv/config";
import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { WorkerModule } from "./worker.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["log", "error", "warn"],
  });

  app.enableShutdownHooks();
  new Logger("WorkerBootstrap").log("Worker running (SQS consumer + outbox + pending-reference)");
}

void bootstrap();
