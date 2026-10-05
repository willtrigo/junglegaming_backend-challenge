import { OutboxMessage } from "@/messaging/domain/outbox-message";
import { OutboxMessageOrmEntity } from "./outbox-message.orm-entity";

export function outboxMessageToOrm(msg: OutboxMessage): OutboxMessageOrmEntity {
  const row = new OutboxMessageOrmEntity();
  row.id = msg.id;
  row.aggregateId = msg.aggregateId;
  row.eventType = msg.eventType;
  row.payload = { ...msg.payload };
  row.occurredAt = msg.occurredAt;
  row.attempts = msg.attempts;
  row.nextAttemptAt = msg.nextAttemptAt;
  row.publishedAt = msg.publishedAt ?? null;
  row.lastError = msg.lastError ?? null;
  return row;
}

export function outboxMessageFromOrm(row: OutboxMessageOrmEntity): OutboxMessage {
  return OutboxMessage.rehydrate({
    id: row.id,
    aggregateId: row.aggregateId,
    eventType: row.eventType,
    payload: row.payload,
    occurredAt: row.occurredAt,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    publishedAt: row.publishedAt ?? undefined,
    lastError: row.lastError ?? undefined,
  });
}
