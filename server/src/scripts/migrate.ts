import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";
import { createDb } from "../db/client.js";

/**
 * Applies the generated .sql migrations in order, against whichever driver the
 * environment selects.
 *
 * Deliberately not using drizzle-kit's own migrator: it resolves its journal
 * differently per driver, and the whole point of this setup is that the same
 * files execute identically against PGlite and a real server. Reading the
 * directory and tracking applied files in a table is simpler and driver-blind.
 *
 *   npm run db:migrate            apply anything outstanding
 *   npm run db:migrate -- --reset drop everything first (development only)
 */

// fileURLToPath, not URL.pathname: the latter leaves %20 in a path containing
// spaces, which this project's directory happens to have.
const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle/", import.meta.url));

async function main() {
  const reset = process.argv.includes("--reset");
  if (reset && env.NODE_ENV === "production") {
    throw new Error("--reset refuses to run with NODE_ENV=production.");
  }

  const conn = await createDb();
  console.log(`· driver ${conn.driver}${conn.driver === "pglite" ? ` (${env.PGLITE_DATA_DIR})` : ""}`);

  try {
    if (reset) {
      console.log("· dropping public schema");
      await conn.exec("drop schema if exists public cascade; create schema public;");
      if (conn.driver === "pglite") {
        // PGlite keeps its journal in the same directory; dropping the schema
        // is enough, but the applied-migrations table goes with it.
      }
    }

    await conn.exec(`
      create table if not exists __migrations (
        filename    text primary key,
        applied_at  timestamptz not null default now()
      );
    `);

    const applied = new Set(
      (await conn.query<{ filename: string }>("select filename from __migrations")).map((r) => r.filename)
    );

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

    if (files.length === 0) {
      console.log("· no migration files found — run `npm run db:generate` first");
      return;
    }

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      // drizzle-kit separates statements with this marker; splitting on it
      // keeps multi-statement DDL working on drivers that dislike batches.
      const statements = sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);

      for (const statement of statements) await conn.exec(statement);
      await conn.exec(`insert into __migrations (filename) values ('${file.replace(/'/g, "''")}')`);
      console.log(`  ✓ ${file} (${statements.length} statements)`);
      ran++;
    }

    console.log(ran === 0 ? "· already up to date" : `· applied ${ran} migration(s)`);

    const tables = await conn.query<{ count: string }>(
      "select count(*)::text as count from information_schema.tables where table_schema = 'public'"
    );
    console.log(`· ${tables[0]?.count ?? "?"} tables in public`);
  } finally {
    await conn.close();
  }
}

main().catch(async (err) => {
  console.error("\nMigration failed:\n", err);
  // Leave a half-applied PGlite directory behind rather than silently
  // deleting it — the state is diagnostic.
  if (process.env.MIGRATE_CLEAN_ON_FAIL === "1" && env.DB_DRIVER === "pglite") {
    await rm(env.PGLITE_DATA_DIR, { recursive: true, force: true });
  }
  process.exit(1);
});
