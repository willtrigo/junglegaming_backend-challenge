import { Entity, PrimaryKey, Property, Unique } from "@mikro-orm/decorators/legacy";

@Entity({ tableName: "wager_transactions" })
@Unique({
  name: "wager_transactions_provider_external_key",
  properties: ["providerId", "externalTransactionId"],
})
@Unique({
  name: "wager_transactions_provider_idempotency_key",
  properties: ["providerId", "idempotencyKey"],
})
export class WagerTransactionOrmEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ fieldName: "provider_id", type: "string" })
  providerId!: string;

  @Property({ fieldName: "external_transaction_id", type: "string" })
  externalTransactionId!: string;

  @Property({ fieldName: "idempotency_key", type: "string" })
  idempotencyKey!: string;

  @Property({ fieldName: "payload_hash", type: "string", length: 64, columnType: "char(64)" })
  payloadHash!: string;

  @Property({ fieldName: "wallet_id", type: "uuid" })
  walletId!: string;

  @Property({ fieldName: "player_id", type: "uuid" })
  playerId!: string;

  @Property({ type: "string", length: 3, columnType: "char(3)" })
  currency!: string;

  @Property({ fieldName: "round_id", type: "string" })
  roundId!: string;

  @Property({ fieldName: "game_id", type: "string" })
  gameId!: string;

  @Property({ type: "string" })
  kind!: string;

  @Property({ type: "decimal", precision: 20, scale: 2 })
  amount!: string;

  @Property({
    fieldName: "reference_external_transaction_id",
    type: "string",
    nullable: true,
  })
  referenceExternalTransactionId?: string | null;

  @Property({ fieldName: "reference_transaction_id", type: "uuid", nullable: true })
  referenceTransactionId?: string | null;

  @Property({ type: "string" })
  status!: string;

  @Property({ fieldName: "failure_code", type: "string", nullable: true })
  failureCode?: string | null;

  @Property({
    fieldName: "observed_balance",
    type: "decimal",
    precision: 20,
    scale: 2,
    nullable: true,
  })
  observedBalance?: string | null;

  @Property({ fieldName: "reference_attempts", type: "integer" })
  referenceAttempts!: number;

  @Property({ fieldName: "next_reference_attempt_at", type: "timestamptz", nullable: true })
  nextReferenceAttemptAt?: Date | null;

  @Property({ fieldName: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Property({ fieldName: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @Property({ fieldName: "processed_at", type: "timestamptz", nullable: true })
  processedAt?: Date | null;
}
