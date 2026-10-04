import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { env } from "../config/env.js";
import { createDb } from "../db/client.js";

/**
 * BACKFILL `display_order`
 * ========================
 *
 * Migrations 0005–0007 added `display_order` to `categories`,
 * `marketplaces` and `attribute_definitions`. They are additive, so rows that
 * already existed have NULL — and with NULL the lists fall back to
 * alphabetical, which puts "Automotive" before "Electronics" and "AJIO" before
 * "Flipkart". Correct code, wrong sequence.
 *
 * A re-seed would populate it, and on a database holding real captured
 * observations a re-seed is destructive — it truncates and reloads. So this
 * does the one thing that is needed instead: reads the ordinal each row has in
 * the dataset file and UPDATEs that column.
 *
 * It only ever writes `display_order`. It inserts nothing, deletes nothing,
 * and touches no other column, so it is safe to run against a live database
 * and safe to run twice.
 *
 *   npm run db:backfill:order        (tsx, for development)
 *   npm run db:backfill:order:prod   (compiled, for a deployment)
 */

const SEED_DIR = resolve(env.SEED_DATA_DIR);

/** Each table, with the file whose line order defines its sequence. */
const TARGETS = [
  { file: "categories", table: "categories" },
  { file: "marketplaces", table: "marketplaces" },
  { file: "attribute_definitions", table: "attribute_definitions" },
] as const;

async function main() {
  const conn = await createDb();

  try {
    for (const target of TARGETS) {
      const path = join(SEED_DIR, `${target.file}.ndjson`);

      /**
       * id → position in the file. Read fully before writing, so a partially
       * read file cannot leave half the table ordered and half not.
       */
      const ordinals: Array<[string, number]> = [];
      const rl = createInterface({
        input: createReadStream(path, { encoding: "utf8" }),
        crlfDelay: Infinity,
      });
      let index = 0;
      for await (const line of rl) {
        if (!line.trim()) continue;
        const row = JSON.parse(line) as { id?: string };
        if (row.id) ordinals.push([row.id, index]);
        index += 1;
      }

      if (ordinals.length === 0) {
        console.log(`· ${target.table}: nothing in ${target.file}.ndjson`);
        continue;
      }

      /**
       * One statement per table, as a VALUES join rather than a thousand
       * updates. Every id reaches SQL as a bound parameter through Drizzle's
       * tagged template; the only interpolated text is the table name, which
       * comes from the closed list above and never from input.
       *
       * Rows absent from the dataset — a marketplace discovered by a provider,
       * for instance — are simply not in the join and keep their NULL, which
       * is the intended meaning: no editorial position.
       *
       * `is distinct from` makes a second run a no-op rather than a rewrite of
       * every row.
       */
      const values = sql.join(
        ordinals.map(([id, position]) => sql`(${id}, ${position}::int)`),
        sql`, `
      );
      await conn.db.execute(sql`
        with v(id, display_order) as (values ${values})
        update ${sql.identifier(target.table)} t
           set display_order = v.display_order
          from v
         where t.id = v.id
           and t.display_order is distinct from v.display_order`);

      const remaining = (await conn.db.execute(
        sql`select count(*)::int as n from ${sql.identifier(target.table)} where display_order is null`
      )) as unknown as { rows: Array<{ n: number }> };

      console.log(
        `  ✓ ${target.table.padEnd(23)} ${String(ordinals.length).padStart(4)} ordinal(s) from the dataset; ` +
          `${remaining.rows[0]?.n ?? 0} row(s) still null (rows the dataset does not contain)`
      );
    }
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  console.error("\nBackfill failed:\n", err);
  process.exit(1);
});
