import "./helpers/env.js";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const run = promisify(execFile);
const SERVER_DIR = fileURLToPath(new URL("..", import.meta.url));
const DEV_DB = join(SERVER_DIR, ".pglite");

/**
 * OUT-OF-SCOPE REGRESSION — REG-11, REG-12 and the Phase 2 baseline.
 *
 * Everything here runs against the REAL development database rather than an
 * isolated fixture, because the question being asked is precisely "did Phase 3
 * disturb the data Phase 2 loaded?". An isolated database cannot answer that.
 *
 * All queries are reads. The suite never writes to this database.
 *
 * The frontend-side regressions (REG-01..REG-10) are exercised separately —
 * the build, the lint and the analytical sweep across all 1,172 products —
 * because they run in the browser bundle, not against Postgres.
 */

/** The Phase 2 baseline, recorded when the dataset was first loaded. */
const BASELINE_COUNTS: Record<string, number> = {
  products: 1172,
  categories: 179,
  product_types: 125,
  brands: 314,
  marketplaces: 6,
  listings: 2947,
  sellers: 1177,
  offers: 9717,
  price_observations: 354940,
  review_snapshots: 9962,
  promotions: 5962,
  seller_rating_snapshots: 2015,
  marketplace_categories: 418,
  attribute_definitions: 545,
  fee_rules: 13,
};

let db: PGlite | null = null;
const available = existsSync(DEV_DB);

before(async () => {
  if (!available) return;
  db = new PGlite(DEV_DB);
  await db.waitReady;
});
after(async () => {
  await db?.close();
});

const count = async (table: string) => {
  const r = await db!.query<{ n: number }>(`select count(*)::int as n from "${table}"`);
  return r.rows[0]!.n;
};

describe("REG — Phase 2 baseline is undisturbed", () => {
  it("skips with an explanation when the development database has not been seeded", (t) => {
    if (available) return;
    t.skip(
      "No .pglite database. Run: node scripts/export-dataset.mjs && npm run db:migrate -- --reset && npm run db:seed"
    );
  });

  it("REG-11: every seeded table still holds exactly the Phase 2 row count", async (t) => {
    if (!available) return t.skip("development database not seeded");
    const drift: string[] = [];
    for (const [table, expected] of Object.entries(BASELINE_COUNTS)) {
      const actual = await count(table);
      if (actual !== expected) drift.push(`${table}: expected ${expected}, found ${actual}`);
    }
    assert.deepEqual(drift, [], `baseline counts drifted:\n${drift.join("\n")}`);
  });

  it("REG-11b: the entity chain still resolves — no orphans anywhere", async (t) => {
    if (!available) return t.skip("development database not seeded");
    const checks: Array<[string, string]> = [
      ["listings→products", `select count(*)::int n from listings l left join products p on p.id=l.product_id where p.id is null`],
      ["offers→listings", `select count(*)::int n from offers o left join listings l on l.id=o.listing_id where l.id is null`],
      ["offers→sellers", `select count(*)::int n from offers o left join sellers s on s.id=o.seller_id where s.id is null`],
      ["observations→offers", `select count(*)::int n from price_observations po left join offers o on o.id=po.offer_id where o.id is null`],
      ["promotions→offers", `select count(*)::int n from promotions pr left join offers o on o.id=pr.offer_id where o.id is null`],
    ];
    for (const [label, sql] of checks) {
      const r = await db!.query<{ n: number }>(sql);
      assert.equal(r.rows[0]!.n, 0, `${label}: orphaned rows found`);
    }
  });

  it("REG-12: the domain invariants still hold", async (t) => {
    if (!available) return t.skip("development database not seeded");
    const invariants: Array<[string, string]> = [
      ["no negative selling price", `select count(*)::int n from price_observations where selling_price_minor < 0`],
      ["no negative shipping fee", `select count(*)::int n from price_observations where shipping_fee_minor < 0`],
      [
        "nothing sells above its MRP",
        `select count(*)::int n from price_observations where mrp_minor is not null and selling_price_minor > mrp_minor`,
      ],
      [
        "one observation per offer per day",
        `select count(*)::int n from (select offer_id, observed_at from price_observations group by 1,2 having count(*)>1) t`,
      ],
      [
        "one featured offer per listing per day",
        `select count(*)::int n from (select o.listing_id, po.observed_at from price_observations po
           join offers o on o.id=po.offer_id where po.is_buybox_winner group by 1,2 having count(*)>1) t`,
      ],
    ];
    for (const [label, sql] of invariants) {
      const r = await db!.query<{ n: number }>(sql);
      assert.equal(r.rows[0]!.n, 0, label);
    }
  });

  it("REG-12b: the golden record is unchanged", async (t) => {
    if (!available) return t.skip("development database not seeded");
    const r = await db!.query<{ listings: number; offers: number; cheapest: number }>(
      `select
         (select count(*)::int from listings where product_id='prod_dove_hair_fall') as listings,
         (select count(*)::int from offers o join listings l on l.id=o.listing_id
            where l.product_id='prod_dove_hair_fall') as offers,
         (select min(po.selling_price_minor + po.shipping_fee_minor)::int from price_observations po
            join offers o on o.id=po.offer_id join listings l on l.id=o.listing_id
            where l.product_id='prod_dove_hair_fall' and po.is_in_stock
              and po.observed_at=(select max(observed_at) from price_observations)) as cheapest`
    );
    assert.deepEqual(r.rows[0], { listings: 6, offers: 30, cheapest: 56900 });
  });

  it("Phase 3 tables exist and are empty — authentication added structure, not data", async (t) => {
    if (!available) return t.skip("development database not seeded");
    for (const table of ["users", "otp_challenges", "sessions"]) {
      assert.equal(await count(table), 0, `${table} should be empty in the development database`);
    }
  });

  it("the users table no longer carries a password column", async (t) => {
    if (!available) return t.skip("development database not seeded");
    const r = await db!.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name='users'`
    );
    const columns = r.rows.map((c) => c.column_name);
    assert.ok(!columns.includes("password_hash"), "password_hash was dropped in 0002");
    assert.ok(!columns.includes("role"), "role was dropped in 0002");
    assert.ok(columns.includes("email_verified_at"));
    assert.ok(columns.includes("last_login_at"));
  });
});

describe("REG — the Phase 2 verification script still passes end to end", () => {
  it("REG-12c: npm run db:verify reports 37/37", async (t) => {
    if (!available) return t.skip("development database not seeded");
    // Spawned rather than re-implemented, so this asserts the documented
    // command a human would actually run.
    const { stdout } = await run("npm", ["run", "--silent", "db:verify"], {
      cwd: SERVER_DIR,
      shell: process.platform === "win32",
      maxBuffer: 1024 * 1024 * 8,
    });
    assert.match(stdout, /37\/37 checks passed/, stdout.slice(-600));
    assert.ok(!stdout.includes("✗"), "no individual check may fail");
  });
});
