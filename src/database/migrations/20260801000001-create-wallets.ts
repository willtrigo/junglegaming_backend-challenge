import { Migration } from "@mikro-orm/migrations";

export class Migration20260801000001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE wallets (
        id          uuid           NOT NULL,
        player_id   uuid           NOT NULL,
        currency    char(3)        NOT NULL,
        balance     numeric(20, 2) NOT NULL,
        version     bigint         NOT NULL DEFAULT 1,
        created_at  timestamptz    NOT NULL,
        updated_at  timestamptz    NOT NULL,

        CONSTRAINT wallets_pkey PRIMARY KEY (id),
        CONSTRAINT wallets_player_currency_key UNIQUE (player_id, currency),
        -- Targets for composite foreign keys that pin (wallet, player, currency).
        CONSTRAINT wallets_id_player_currency_key UNIQUE (id, player_id, currency),
        CONSTRAINT wallets_id_currency_key UNIQUE (id, currency),
        CONSTRAINT wallets_currency_format_chk CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT wallets_balance_non_negative_chk CHECK (balance >= 0),
        CONSTRAINT wallets_version_positive_chk CHECK (version >= 1)
      )
    `);
  }

  override async down(): Promise<void> {
    this.addSql("DROP TABLE IF EXISTS wallets");
  }
}
