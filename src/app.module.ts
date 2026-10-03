import { Module } from "@nestjs/common";

import { ConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { HelloController } from "./hello.controller";

@Module({
  imports: [ConfigModule, DatabaseModule, HealthModule],
  controllers: [HelloController],
})
export class AppModule {}
