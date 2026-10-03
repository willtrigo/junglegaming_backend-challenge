import "dotenv/config";

import { Migrator } from "@mikro-orm/migrations";
import { defineConfig } from "@mikro-orm/postgresql";

const clientUrl = process.env.DATABASE_URL;
if (!clientUrl) {
  throw new Error("DATABASE_URL is not set");
}

const DEFAULT_POOL_MIN = 2;
const DEFAULT_POOL_MAX = 20;

const poolMin = Number(process.env.DATABASE_POOL_MIN ?? DEFAULT_POOL_MIN);
const poolMax = Number(process.env.DATABASE_POOL_MAX ?? DEFAULT_POOL_MAX);

export default defineConfig({
  clientUrl,
  entities: ["./src/**/*.orm-entity.ts"],
  extensions: [Migrator],
  forceUtcTimezone: true,
  allowGlobalContext: false,
  pool: { min: poolMin, max: poolMax },
  discovery: {
    warnWhenNoEntities: false,
  },
  migrations: {
    path: "src/database/migrations",
    pathTs: "src/database/migrations",
    glob: "!(*.d).{js,ts}",
    tableName: "mikro_orm_migrations",
    transactional: true,
    allOrNothing: true,
    snapshot: false,
    emit: "ts",
    fileName: (timestamp: string, name?: string): string => `${timestamp}-${name ?? "migration"}`,
  },
});
