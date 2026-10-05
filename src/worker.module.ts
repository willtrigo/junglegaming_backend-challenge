import { Module } from "@nestjs/common";

import { ConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { MessagingModule } from "./messaging/messaging.module";
import { WageringModule } from "./wagering/wagering.module";

@Module({
  imports: [ConfigModule, DatabaseModule, WageringModule, MessagingModule],
})
export class WorkerModule {}
