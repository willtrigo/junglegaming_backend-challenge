import type { IntegrationEvent } from "./integration-event";

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date;
  publishedAt?: Date | undefined;
  lastError?: string | undefined;
}

export class OutboxMessage {
  public readonly id: string;
  public readonly aggregateId: string;
  public readonly eventType: string;
  public readonly payload: Readonly<Record<string, unknown>>;
  public readonly occurredAt: Date;

  private _attempts: number;
  private _nextAttemptAt: Date;
  private _publishedAt: Date | undefined;
  private _lastError: string | undefined;

  private constructor(state: OutboxMessageState) {
    this.id = state.id;
    this.aggregateId = state.aggregateId;
    this.eventType = state.eventType;
    this.payload = state.payload;
    this.occurredAt = state.occurredAt;
    this._attempts = state.attempts;
    this._nextAttemptAt = state.nextAttemptAt;
    this._publishedAt = state.publishedAt;
    this._lastError = state.lastError;
  }

  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    const json = event.toJSON();
    return new OutboxMessage({
      id: event.eventId,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: json as unknown as Readonly<Record<string, unknown>>,
      occurredAt: event.occurredAt,
      attempts: 0,
      nextAttemptAt: event.occurredAt,
    });
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(state);
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  get lastError(): string | undefined {
    return this._lastError;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    return this.isPending() && this._nextAttemptAt.getTime() <= now.getTime();
  }

  markPublished(at: Date): void {
    this._publishedAt = at;
  }

  scheduleRetry(now: Date, maxBackoffMs = 60_000): void {
    this._attempts += 1;
    const delay = Math.min(maxBackoffMs, 2 ** Math.min(this._attempts, 10) * 100);
    this._nextAttemptAt = new Date(now.getTime() + delay);
  }

  recordError(message: string): void {
    this._lastError = message.slice(0, 1000);
  }
}
