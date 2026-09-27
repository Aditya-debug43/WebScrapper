import type { Config } from "drizzle-kit";

/**
 * Migrations are generated as plain .sql so they can be read and reviewed.
 * `drizzle-kit generate` only needs the dialect and the schema; applying them
 * is done by src/scripts/migrate.ts, which selects the driver from the
 * environment so the same files run against PGlite and real PostgreSQL.
 */
export default {
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
} satisfies Config;
