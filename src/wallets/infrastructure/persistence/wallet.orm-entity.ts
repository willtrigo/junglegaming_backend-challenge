import { Entity, PrimaryKey, Property, Unique } from "@mikro-orm/decorators/legacy";

@Entity({ tableName: "wallets" })
@Unique({ name: "wallets_player_currency_key", properties: ["playerId", "currency"] })
export class WalletOrmEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ fieldName: "player_id", type: "uuid" })
  playerId!: string;

  @Property({ type: "string", length: 3, columnType: "char(3)" })
  currency!: string;

  @Property({ type: "decimal", precision: 20, scale: 2 })
  balance!: string;

  @Property({ type: "bigint" })
  version!: string;

  @Property({ fieldName: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Property({ fieldName: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
