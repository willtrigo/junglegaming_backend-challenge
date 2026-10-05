import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "@/config/app-config";

@Injectable()
export class SqsClientService implements OnModuleInit {
  private readonly logger = new Logger(SqsClientService.name);
  private readonly client: SQSClient;
  private wagerQueueUrl?: string;
  private eventsQueueUrl?: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.client = new SQSClient({
      region: config.awsRegion,
      endpoint: config.awsEndpointUrl,
      credentials: {
        accessKeyId: config.awsAccessKeyId,
        secretAccessKey: config.awsSecretAccessKey,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      this.wagerQueueUrl = await this.resolveQueueUrl(this.config.sqsWagerQueueName);
      this.logger.log(`Wager queue URL: ${this.wagerQueueUrl}`);
    } catch (error) {
      this.logger.warn(
        `Could not resolve wager queue (${this.config.sqsWagerQueueName}): ${String(error)}`,
      );
    }
  }

  async receiveWagerMessages(maxMessages = 1): Promise<
    Array<{
      messageId: string;
      receiptHandle: string;
      body: string;
      attributes: Record<string, string>;
    }>
  > {
    const queueUrl = await this.ensureWagerQueueUrl();
    const result = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: Math.min(maxMessages, 10),
        WaitTimeSeconds: this.config.sqsWaitTimeSeconds,
        VisibilityTimeout: this.config.sqsVisibilityTimeoutSeconds,
        MessageAttributeNames: ["All"],
        AttributeNames: ["All"],
      }),
    );

    return (result.Messages ?? []).map((m) => ({
      messageId: m.MessageId!,
      receiptHandle: m.ReceiptHandle!,
      body: m.Body ?? "",
      attributes: Object.fromEntries(
        Object.entries(m.MessageAttributes ?? {}).map(([k, v]) => [k, v.StringValue ?? ""]),
      ),
    }));
  }

  async deleteWagerMessage(receiptHandle: string): Promise<void> {
    const queueUrl = await this.ensureWagerQueueUrl();
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  async publishIntegrationEvent(params: {
    eventType: string;
    payload: string;
    groupId: string;
    deduplicationId: string;
  }): Promise<void> {
    const queueName = "integration-events.fifo";
    if (this.eventsQueueUrl === undefined) {
      this.eventsQueueUrl = await this.resolveQueueUrl(queueName);
    }

    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.eventsQueueUrl,
        MessageBody: params.payload,
        MessageGroupId: params.groupId,
        MessageDeduplicationId: params.deduplicationId,
        MessageAttributes: {
          eventType: { DataType: "String", StringValue: params.eventType },
        },
      }),
    );
  }

  private async ensureWagerQueueUrl(): Promise<string> {
    if (this.wagerQueueUrl === undefined) {
      this.wagerQueueUrl = await this.resolveQueueUrl(this.config.sqsWagerQueueName);
    }
    return this.wagerQueueUrl;
  }

  private async resolveQueueUrl(name: string): Promise<string> {
    const result = await this.client.send(new GetQueueUrlCommand({ QueueName: name }));
    if (result.QueueUrl === undefined) {
      throw new Error(`Queue URL not found for ${name}`);
    }
    return result.QueueUrl;
  }
}
