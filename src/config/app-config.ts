import "dotenv/config";

export const APP_CONFIG = Symbol("APP_CONFIG");

export interface AppConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly awsRegion: string;
  readonly awsEndpointUrl: string;
  readonly awsAccessKeyId: string;
  readonly awsSecretAccessKey: string;
  readonly sqsWagerQueueName: string;
  readonly sqsWagerDlqName: string;
  readonly sqsWaitTimeSeconds: number;
  readonly sqsVisibilityTimeoutSeconds: number;
  readonly sqsConsumerConcurrency: number;
  readonly outboxBatchSize: number;
  readonly outboxPollIntervalMs: number;
  readonly pendingReferenceBatchSize: number;
  readonly pendingReferencePollIntervalMs: number;
}

function requireEnv(source: NodeJS.ProcessEnv, key: string): string {
  const value = source[key];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalInt(source: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = source[key];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${key} must be a positive integer`);
  }
  return value;
}

export function loadAppConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number.parseInt(requireEnv(source, "PORT"), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("Environment variable PORT must be a valid TCP port");
  }

  return {
    port,
    databaseUrl: requireEnv(source, "DATABASE_URL"),
    awsRegion: source.AWS_REGION ?? "us-east-1",
    awsEndpointUrl: requireEnv(source, "SQS_ENDPOINT"),
    awsAccessKeyId: source.AWS_ACCESS_KEY_ID ?? "test",
    awsSecretAccessKey: source.AWS_SECRET_ACCESS_KEY ?? "test",
    sqsWagerQueueName: source.SQS_WAGER_QUEUE_NAME ?? "wager-transactions.fifo",
    sqsWagerDlqName: source.SQS_WAGER_DLQ_NAME ?? "wager-transactions-dlq.fifo",
    sqsWaitTimeSeconds: optionalInt(source, "SQS_WAIT_TIME_SECONDS", 10),
    sqsVisibilityTimeoutSeconds: optionalInt(source, "SQS_VISIBILITY_TIMEOUT_SECONDS", 30),
    sqsConsumerConcurrency: optionalInt(source, "SQS_CONSUMER_CONCURRENCY", 5),
    outboxBatchSize: optionalInt(source, "OUTBOX_BATCH_SIZE", 50),
    outboxPollIntervalMs: optionalInt(source, "OUTBOX_POLL_INTERVAL_MS", 1_000),
    pendingReferenceBatchSize: optionalInt(source, "PENDING_REFERENCE_BATCH_SIZE", 25),
    pendingReferencePollIntervalMs: optionalInt(
      source,
      "PENDING_REFERENCE_POLL_INTERVAL_MS",
      2_000,
    ),
  };
}
