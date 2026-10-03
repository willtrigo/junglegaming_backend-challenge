import { Migration } from "@mikro-orm/migrations";

export class Migration20260801000002 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE wager_transactions (
        id                                 uuid           NOT NULL,
        provider_id                        text           NOT NULL,
        external_transaction_id            text           NOT NULL,
        idempotency_key                    text           NOT NULL,
        payload_hash                       char(64)       NOT NULL,
        wallet_id                          uuid           NOT NULL,
        player_id                          uuid           NOT NULL,
        currency                           char(3)        NOT NULL,
        round_id                           text           NOT NULL,
        game_id                            text           NOT NULL,
        kind                               text           NOT NULL,
        amount                             numeric(20, 2) NOT NULL,
        reference_external_transaction_id  text,
        reference_transaction_id           uuid,
        status                             text           NOT NULL,
        failure_code                       text,
        observed_balance                   numeric(20, 2),
        reference_attempts                 integer        NOT NULL DEFAULT 0,
        next_reference_attempt_at          timestamptz,
        created_at                         timestamptz    NOT NULL,
        updated_at                         timestamptz    NOT NULL,
        processed_at                       timestamptz,

        CONSTRAINT wager_transactions_pkey PRIMARY KEY (id),

        -- Deduplication by the provider's own identity and by idempotency key.
        CONSTRAINT wager_transactions_provider_external_key
          UNIQUE (provider_id, external_transaction_id),
        CONSTRAINT wager_transactions_provider_idempotency_key
          UNIQUE (provider_id, idempotency_key),

        -- Target for the reference foreign key below: a reference must belong to
        -- the same provider, wallet, player, currency and round.
        CONSTRAINT wager_transactions_reference_scope_key
          UNIQUE (id, provider_id, wallet_id, player_id, currency, round_id),

        CONSTRAINT wager_transactions_wallet_fk
          FOREIGN KEY (wallet_id, player_id, currency)
          REFERENCES wallets (id, player_id, currency),

        CONSTRAINT wager_transactions_reference_fk
          FOREIGN KEY (reference_transaction_id, provider_id, wallet_id, player_id, currency, round_id)
          REFERENCES wager_transactions (id, provider_id, wallet_id, player_id, currency, round_id),

        CONSTRAINT wager_transactions_kind_chk
          CHECK (kind IN ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')),
        CONSTRAINT wager_transactions_status_chk
          CHECK (status IN ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')),
        CONSTRAINT wager_transactions_currency_format_chk CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT wager_transactions_payload_hash_chk CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT wager_transactions_amount_non_negative_chk CHECK (amount >= 0),
        CONSTRAINT wager_transactions_observed_balance_chk
          CHECK (observed_balance IS NULL OR observed_balance >= 0),
        CONSTRAINT wager_transactions_attempts_chk CHECK (reference_attempts >= 0),

        -- OPENING is internal: only the reserved provider may carry it, and only it.
        CONSTRAINT wager_transactions_opening_internal_chk
          CHECK ((kind = 'OPENING') = (provider_id = 'internal')),

        -- REFUND and ROLLBACK must name the transaction they reverse.
        CONSTRAINT wager_transactions_reversal_requires_reference_chk
          CHECK (kind NOT IN ('REFUND', 'ROLLBACK') OR reference_external_transaction_id IS NOT NULL),
        CONSTRAINT wager_transactions_resolved_reference_chk
          CHECK (reference_transaction_id IS NULL OR reference_external_transaction_id IS NOT NULL),

        -- A failure code exists exactly when the transaction was rejected or failed.
        CONSTRAINT wager_transactions_failure_code_chk
          CHECK ((status IN ('REJECTED', 'FAILED')) = (failure_code IS NOT NULL)),

        -- A processing timestamp exists exactly when the transaction was applied.
        CONSTRAINT wager_transactions_processed_at_chk
          CHECK ((status = 'PROCESSED') = (processed_at IS NOT NULL)),

        -- A reversal can only be PROCESSED once its reference is resolved.
        CONSTRAINT wager_transactions_processed_reversal_chk
          CHECK (NOT (kind IN ('REFUND', 'ROLLBACK') AND status = 'PROCESSED')
                 OR reference_transaction_id IS NOT NULL)
      )
    `);

    // A reference can be reverted at most once per reversal kind.
    this.addSql(`
      CREATE UNIQUE INDEX wager_transactions_single_reversal_idx
        ON wager_transactions (reference_transaction_id, kind)
        WHERE status = 'PROCESSED' AND kind IN ('REFUND', 'ROLLBACK')
    `);

    // Reference-retry worker: due PENDING_REFERENCE rows.
    this.addSql(`
      CREATE INDEX wager_transactions_pending_reference_due_idx
        ON wager_transactions (next_reference_attempt_at)
        WHERE status = 'PENDING_REFERENCE'
    `);

    // Re-evaluate dependants as soon as a reference is processed.
    this.addSql(`
      CREATE INDEX wager_transactions_pending_reference_lookup_idx
        ON wager_transactions (provider_id, reference_external_transaction_id)
        WHERE status = 'PENDING_REFERENCE'
    `);

    this.addSql(`
      CREATE INDEX wager_transactions_wallet_created_idx
        ON wager_transactions (wallet_id, created_at DESC)
    `);
  }

  override async down(): Promise<void> {
    this.addSql("DROP TABLE IF EXISTS wager_transactions");
  }
}
