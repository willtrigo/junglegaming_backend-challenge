import { Entity, PrimaryKey, Property, Unique } from "@mikro-orm/decorators/legacy";

@Entity({ tableName: "wallet_ledger_entries" })
@Unique({
  name: "wallet_ledger_entries_transaction_wallet_key",
  properties: ["transactionId", "walletId"],
})
@Unique({
  name: "wallet_ledger_entries_wallet_version_key",
  properties: ["walletId", "walletVersion"],
})
export class WalletLedgerEntryOrmEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ fieldName: "wallet_id", type: "uuid" })
  walletId!: string;

  @Property({ fieldName: "transaction_id", type: "uuid" })
  transactionId!: string;

  @Property({ fieldName: "wallet_version", type: "bigint" })
  walletVersion!: string;

  @Property({ type: "string", length: 3, columnType: "char(3)" })
  currency!: string;

  @Property({ type: "string" })
  direction!: string;

  @Property({ type: "decimal", precision: 20, scale: 2 })
  amount!: string;

  @Property({ fieldName: "balance_before", type: "decimal", precision: 20, scale: 2 })
  balanceBefore!: string;

  @Property({ fieldName: "balance_after", type: "decimal", precision: 20, scale: 2 })
  balanceAfter!: string;

  @Property({ fieldName: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
