import { Migration } from "@mikro-orm/migrations";

export class Migration20260801000003 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE wallet_ledger_entries (
        id              uuid           NOT NULL,
        wallet_id       uuid           NOT NULL,
        transaction_id  uuid           NOT NULL,
        -- Wallet version produced by this entry: a strict per-wallet sequence
        -- and a stable pagination cursor.
        wallet_version  bigint         NOT NULL,
        currency        char(3)        NOT NULL,
        direction       text           NOT NULL,
        amount          numeric(20, 2) NOT NULL,
        balance_before  numeric(20, 2) NOT NULL,
        balance_after   numeric(20, 2) NOT NULL,
        created_at      timestamptz    NOT NULL,

        CONSTRAINT wallet_ledger_entries_pkey PRIMARY KEY (id),
        CONSTRAINT wallet_ledger_entries_wallet_fk
          FOREIGN KEY (wallet_id, currency) REFERENCES wallets (id, currency),
        CONSTRAINT wallet_ledger_entries_transaction_fk
          FOREIGN KEY (transaction_id) REFERENCES wager_transactions (id),

        -- At most one entry per wallet for a given transaction.
        CONSTRAINT wallet_ledger_entries_transaction_wallet_key
          UNIQUE (transaction_id, wallet_id),
        CONSTRAINT wallet_ledger_entries_wallet_version_key
          UNIQUE (wallet_id, wallet_version),

        CONSTRAINT wallet_ledger_entries_direction_chk CHECK (direction IN ('DEBIT', 'CREDIT')),
        CONSTRAINT wallet_ledger_entries_amount_positive_chk CHECK (amount > 0),
        CONSTRAINT wallet_ledger_entries_version_positive_chk CHECK (wallet_version >= 1),
        CONSTRAINT wallet_ledger_entries_balances_non_negative_chk
          CHECK (balance_before >= 0 AND balance_after >= 0),
        CONSTRAINT wallet_ledger_entries_arithmetic_chk CHECK (
          (direction = 'CREDIT' AND balance_after = balance_before + amount)
          OR (direction = 'DEBIT' AND balance_after = balance_before - amount)
        )
      )
    `);

    this.addSql(`
      CREATE INDEX wallet_ledger_entries_transaction_idx
        ON wallet_ledger_entries (transaction_id)
    `);
  }

  override async down(): Promise<void> {
    this.addSql("DROP TABLE IF EXISTS wallet_ledger_entries");
  }
}
