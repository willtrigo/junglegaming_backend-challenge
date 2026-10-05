import { Module } from "@nestjs/common";

import { WageringModule } from "@/wagering/wagering.module";
import { OutboxPublisher } from "./application/outbox.publisher";
import { PendingReferenceProcessor } from "./application/pending-reference.processor";
import { WagerSqsConsumer } from "./application/wager-sqs.consumer";
import { SqsClientService } from "./infrastructure/sqs/sqs.client";

@Module({
  imports: [WageringModule],
  providers: [SqsClientService, WagerSqsConsumer, OutboxPublisher, PendingReferenceProcessor],
  exports: [SqsClientService],
})
export class MessagingModule {}
