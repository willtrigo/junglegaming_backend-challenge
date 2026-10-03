import { Migration } from "@mikro-orm/migrations";

export class Migration20260801000005 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE outbox_messages (
        id               uuid         NOT NULL,
        sequence         bigint       GENERATED ALWAYS AS IDENTITY,
        aggregate_id     uuid         NOT NULL,
        event_type       text         NOT NULL,
        payload          jsonb        NOT NULL,
        occurred_at      timestamptz  NOT NULL,
        attempts         integer      NOT NULL DEFAULT 0,
        next_attempt_at  timestamptz  NOT NULL DEFAULT now(),
        published_at     timestamptz,
        last_error       text,

        CONSTRAINT outbox_messages_pkey PRIMARY KEY (id),
        CONSTRAINT outbox_messages_payload_object_chk CHECK (jsonb_typeof(payload) = 'object'),
        CONSTRAINT outbox_messages_attempts_chk CHECK (attempts >= 0)
      )
    `);

    // Publisher poll: due, unpublished rows (FOR UPDATE SKIP LOCKED).
    this.addSql(`
      CREATE INDEX outbox_messages_due_idx
        ON outbox_messages (next_attempt_at, sequence)
        WHERE published_at IS NULL
    `);

    // Per-aggregate ordering and outbox-lag diagnostics.
    this.addSql(`
      CREATE INDEX outbox_messages_aggregate_idx
        ON outbox_messages (aggregate_id, sequence)
    `);
  }

  override async down(): Promise<void> {
    this.addSql("DROP TABLE IF EXISTS outbox_messages");
  }
}
