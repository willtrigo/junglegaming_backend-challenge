import "dotenv/config";
import { MikroORM, type Options } from "@mikro-orm/core";
import { defineConfig, PostgreSqlDriver } from "@mikro-orm/postgresql";

import { OutboxMessageOrmEntity } from "@/messaging/infrastructure/persistence/outbox-message.orm-entity";
import { WagerTransactionOrmEntity } from "@/wagering/infrastructure/persistence/wager-transaction.orm-entity";
import { WalletOrmEntity } from "@/wallets/infrastructure/persistence/wallet.orm-entity";
import { WalletLedgerEntryOrmEntity } from "@/wallets/infrastructure/persistence/wallet-ledger-entry.orm-entity";

const ENTITIES = [
  WalletOrmEntity,
  WalletLedgerEntryOrmEntity,
  WagerTransactionOrmEntity,
  OutboxMessageOrmEntity,
];

export async function createTestOrm(): Promise<MikroORM> {
  const clientUrl =
    process.env.DATABASE_URL ?? "postgres://wagering:wagering@localhost:5432/wagering";

  const config: Options = defineConfig({
    clientUrl,
    driver: PostgreSqlDriver,
    entities: ENTITIES,
    forceUtcTimezone: true,
    allowGlobalContext: true,
    discovery: { warnWhenNoEntities: false },
  });

  return MikroORM.init(config);
}

export async function resetDatabase(orm: MikroORM): Promise<void> {
  const conn = orm.em.getConnection();
  await conn.execute(`
    SET session_replication_role = 'replica';
    TRUNCATE TABLE
      outbox_messages,
      inbox_messages,
      wallet_ledger_entries,
      wager_transactions,
      wallets
    RESTART IDENTITY CASCADE;
    SET session_replication_role = 'origin';
  `);
  orm.em.clear();
}

export { ENTITIES };
