import { Module } from "@nestjs/common";

import { ConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { WageringModule } from "./wagering/wagering.module";
import { WalletsModule } from "./wallets/wallets.module";

@Module({
  imports: [ConfigModule, DatabaseModule, HealthModule, WalletsModule, WageringModule],
})
export class AppModule {}
