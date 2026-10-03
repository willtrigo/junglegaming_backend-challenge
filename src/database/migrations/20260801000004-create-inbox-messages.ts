import { Migration } from "@mikro-orm/migrations";

export class Migration20260801000004 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE inbox_messages (
        consumer_name  text         NOT NULL,
        message_id     text         NOT NULL,
        payload_hash   char(64)     NOT NULL,
        received_at    timestamptz  NOT NULL,
        processed_at   timestamptz,

        CONSTRAINT inbox_messages_pkey PRIMARY KEY (consumer_name, message_id),
        CONSTRAINT inbox_messages_payload_hash_chk CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT inbox_messages_processed_after_received_chk
          CHECK (processed_at IS NULL OR processed_at >= received_at)
      )
    `);

    // Supports retention sweeps of old, processed messages.
    this.addSql(`
      CREATE INDEX inbox_messages_received_at_idx
        ON inbox_messages (received_at)
    `);
  }

  override async down(): Promise<void> {
    this.addSql("DROP TABLE IF EXISTS inbox_messages");
  }
}
