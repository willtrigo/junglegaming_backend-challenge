import { Migration } from "@mikro-orm/migrations";

export class Migration20260801000006 extends Migration {
  override async up(): Promise<void> {
    // ------------------------------------------------------------------
    // Ledger: append-only.
    // ------------------------------------------------------------------
    this.addSql(`
      CREATE FUNCTION ledger_reject_mutation() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'wallet_ledger_entries is append-only (% rejected)', TG_OP
          USING ERRCODE = 'integrity_constraint_violation';
      END;
      $$
    `);
    this.addSql(`
      CREATE TRIGGER wallet_ledger_entries_no_update_delete
        BEFORE UPDATE OR DELETE ON wallet_ledger_entries
        FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation()
    `);
    this.addSql(`
      CREATE TRIGGER wallet_ledger_entries_no_truncate
        BEFORE TRUNCATE ON wallet_ledger_entries
        FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_mutation()
    `);

    // ------------------------------------------------------------------
    // Ledger: each entry continues the previous balance of its wallet.
    // ------------------------------------------------------------------
    this.addSql(`
      CREATE FUNCTION ledger_assert_chain() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        previous wallet_ledger_entries%ROWTYPE;
      BEGIN
        SELECT * INTO previous
          FROM wallet_ledger_entries
         WHERE wallet_id = NEW.wallet_id
         ORDER BY wallet_version DESC
         LIMIT 1;

        IF NOT FOUND THEN
          IF NEW.balance_before <> 0 THEN
            RAISE EXCEPTION 'first ledger entry of wallet % must start from a zero balance', NEW.wallet_id
              USING ERRCODE = 'integrity_constraint_violation';
          END IF;
        ELSIF NEW.wallet_version <> previous.wallet_version + 1
           OR NEW.balance_before <> previous.balance_after THEN
          RAISE EXCEPTION 'ledger entry for wallet % breaks the balance chain', NEW.wallet_id
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;

        RETURN NEW;
      END;
      $$
    `);
    this.addSql(`
      CREATE TRIGGER wallet_ledger_entries_assert_chain
        BEFORE INSERT ON wallet_ledger_entries
        FOR EACH ROW EXECUTE FUNCTION ledger_assert_chain()
    `);

    // ------------------------------------------------------------------
    // Wallet: identity is immutable; version moves only with the balance.
    // ------------------------------------------------------------------
    this.addSql(`
      CREATE FUNCTION wallet_guard() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'wallets cannot be deleted'
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;

        IF NEW.id <> OLD.id
           OR NEW.player_id <> OLD.player_id
           OR NEW.currency <> OLD.currency
           OR NEW.created_at <> OLD.created_at THEN
          RAISE EXCEPTION 'wallet identity columns are immutable'
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;

        IF NEW.balance <> OLD.balance THEN
          IF NEW.version <> OLD.version + 1 THEN
            RAISE EXCEPTION 'wallet version must increment by one when the balance changes'
              USING ERRCODE = 'integrity_constraint_violation';
          END IF;
        ELSIF NEW.version <> OLD.version THEN
          RAISE EXCEPTION 'wallet version can only change together with the balance'
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;

        RETURN NEW;
      END;
      $$
    `);
    this.addSql(`
      CREATE TRIGGER wallets_guard
        BEFORE UPDATE OR DELETE ON wallets
        FOR EACH ROW EXECUTE FUNCTION wallet_guard()
    `);

    // ------------------------------------------------------------------
    // Wallet <-> ledger: checked at COMMIT, in both directions.
    // The materialized balance and version must equal the last ledger entry.
    // ------------------------------------------------------------------
    this.addSql(`
      CREATE FUNCTION wallet_assert_matches_ledger(p_wallet_id uuid) RETURNS void
      LANGUAGE plpgsql AS $$
      DECLARE
        current_wallet wallet_ledger_entries%ROWTYPE;
        wallet_row     wallets%ROWTYPE;
      BEGIN
        SELECT * INTO wallet_row FROM wallets WHERE id = p_wallet_id;
        IF NOT FOUND THEN
          RETURN;
        END IF;

        SELECT * INTO current_wallet
          FROM wallet_ledger_entries
         WHERE wallet_id = p_wallet_id
         ORDER BY wallet_version DESC
         LIMIT 1;

        IF NOT FOUND THEN
          IF wallet_row.balance <> 0 OR wallet_row.version <> 1 THEN
            RAISE EXCEPTION 'wallet % has a balance or version without a ledger entry', p_wallet_id
              USING ERRCODE = 'integrity_constraint_violation';
          END IF;
        ELSIF current_wallet.balance_after <> wallet_row.balance
           OR current_wallet.wallet_version <> wallet_row.version THEN
          RAISE EXCEPTION 'wallet % diverges from its ledger', p_wallet_id
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
      END;
      $$
    `);
    this.addSql(`
      CREATE FUNCTION wallets_check_ledger() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM wallet_assert_matches_ledger(NEW.id);
        RETURN NULL;
      END;
      $$
    `);
    this.addSql(`
      CREATE FUNCTION ledger_check_wallet() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM wallet_assert_matches_ledger(NEW.wallet_id);
        RETURN NULL;
      END;
      $$
    `);
    this.addSql(`
      CREATE CONSTRAINT TRIGGER wallets_match_ledger
        AFTER INSERT OR UPDATE ON wallets
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION wallets_check_ledger()
    `);
    this.addSql(`
      CREATE CONSTRAINT TRIGGER wallet_ledger_entries_match_wallet
        AFTER INSERT ON wallet_ledger_entries
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION ledger_check_wallet()
    `);

    // ------------------------------------------------------------------
    // Wager transactions: immutable business fields, terminal states are final,
    // and only declared transitions are allowed.
    // ------------------------------------------------------------------
    this.addSql(`
      CREATE FUNCTION wager_transaction_guard() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'wager_transactions cannot be deleted'
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;

        IF OLD.status IN ('PROCESSED', 'REJECTED', 'FAILED') THEN
          RAISE EXCEPTION 'transaction % is in terminal state %', OLD.id, OLD.status
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;

        IF NEW.id <> OLD.id
           OR NEW.provider_id <> OLD.provider_id
           OR NEW.external_transaction_id <> OLD.external_transaction_id
           OR NEW.idempotency_key <> OLD.idempotency_key
           OR NEW.payload_hash <> OLD.payload_hash
           OR NEW.wallet_id <> OLD.wallet_id
           OR NEW.player_id <> OLD.player_id
           OR NEW.currency <> OLD.currency
           OR NEW.round_id <> OLD.round_id
           OR NEW.game_id <> OLD.game_id
           OR NEW.kind <> OLD.kind
           OR NEW.amount <> OLD.amount
           OR NEW.reference_external_transaction_id IS DISTINCT FROM OLD.reference_external_transaction_id
           OR NEW.created_at <> OLD.created_at THEN
          RAISE EXCEPTION 'business fields of transaction % are immutable', OLD.id
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;

        IF NEW.status <> OLD.status AND NOT (
             (OLD.status = 'PENDING'
               AND NEW.status IN ('PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED'))
          OR (OLD.status = 'PENDING_REFERENCE'
               AND NEW.status IN ('PROCESSED', 'REJECTED', 'FAILED'))
        ) THEN
          RAISE EXCEPTION 'invalid transition % -> % for transaction %', OLD.status, NEW.status, OLD.id
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;

        RETURN NEW;
      END;
      $$
    `);
    this.addSql(`
      CREATE TRIGGER wager_transactions_guard
        BEFORE UPDATE OR DELETE ON wager_transactions
        FOR EACH ROW EXECUTE FUNCTION wager_transaction_guard()
    `);
  }

  override async down(): Promise<void> {
    this.addSql("DROP TRIGGER IF EXISTS wager_transactions_guard ON wager_transactions");
    this.addSql("DROP FUNCTION IF EXISTS wager_transaction_guard()");

    this.addSql(
      "DROP TRIGGER IF EXISTS wallet_ledger_entries_match_wallet ON wallet_ledger_entries",
    );
    this.addSql("DROP TRIGGER IF EXISTS wallets_match_ledger ON wallets");
    this.addSql("DROP FUNCTION IF EXISTS ledger_check_wallet()");
    this.addSql("DROP FUNCTION IF EXISTS wallets_check_ledger()");
    this.addSql("DROP FUNCTION IF EXISTS wallet_assert_matches_ledger(uuid)");

    this.addSql("DROP TRIGGER IF EXISTS wallets_guard ON wallets");
    this.addSql("DROP FUNCTION IF EXISTS wallet_guard()");

    this.addSql(
      "DROP TRIGGER IF EXISTS wallet_ledger_entries_assert_chain ON wallet_ledger_entries",
    );
    this.addSql("DROP FUNCTION IF EXISTS ledger_assert_chain()");

    this.addSql(
      "DROP TRIGGER IF EXISTS wallet_ledger_entries_no_truncate ON wallet_ledger_entries",
    );
    this.addSql(
      "DROP TRIGGER IF EXISTS wallet_ledger_entries_no_update_delete ON wallet_ledger_entries",
    );
    this.addSql("DROP FUNCTION IF EXISTS ledger_reject_mutation()");
  }
}
