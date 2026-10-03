import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { loadAppConfig } from "./config/app-config";

async function bootstrap(): Promise<void> {
  const { port } = loadAppConfig();
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();

  await app.listen(port, "0.0.0.0");
  new Logger("Bootstrap").log(`Listening on port ${port}`);
}

void bootstrap();
