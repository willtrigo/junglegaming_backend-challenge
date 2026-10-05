import { Entity, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

@Entity({ tableName: "outbox_messages" })
export class OutboxMessageOrmEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "bigint", generated: "identity", nullable: true })
  sequence?: string;

  @Property({ fieldName: "aggregate_id", type: "uuid" })
  aggregateId!: string;

  @Property({ fieldName: "event_type", type: "string" })
  eventType!: string;

  @Property({ type: "json" })
  payload!: Record<string, unknown>;

  @Property({ fieldName: "occurred_at", type: "timestamptz" })
  occurredAt!: Date;

  @Property({ type: "integer" })
  attempts!: number;

  @Property({ fieldName: "next_attempt_at", type: "timestamptz" })
  nextAttemptAt!: Date;

  @Property({ fieldName: "published_at", type: "timestamptz", nullable: true })
  publishedAt?: Date | null;

  @Property({ fieldName: "last_error", type: "string", nullable: true })
  lastError?: string | null;
}
