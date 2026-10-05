import { Entity, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

@Entity({ tableName: "inbox_messages" })
export class InboxMessageOrmEntity {
  @PrimaryKey({ type: "text", fieldName: "consumer_name" })
  consumerName!: string;

  @PrimaryKey({ type: "text", fieldName: "message_id" })
  messageId!: string;

  @Property({ type: "string", length: 64, fieldName: "payload_hash" })
  payloadHash!: string;

  @Property({ type: "timestamptz", fieldName: "received_at" })
  receivedAt!: Date;

  @Property({ type: "timestamptz", fieldName: "processed_at", nullable: true })
  processedAt?: Date | null;
}
