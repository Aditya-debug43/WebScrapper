import "./helpers/env.js";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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

  /**
   * Rows that exist ONLY because a live provider put them there.
   *
   * Since market-data ingestion landed, this database holds two kinds of
   * row in the same tables, and the Phase 2 guarantee has to be stated
   * against the seeded kind rather than against the table as a whole. A
   * frozen total would now fail the moment the system did its job, which
   * would make the test an obstacle rather than a guard.
   *
   * No provenance column was needed for this — the existing fields already
   * separate the two exactly:
   *
   *   observations   `parser_version` ('market-data-v1' vs the seeded
   *                  dataset's 'catalogue-parser-v1.2', 'fk-parser-v2.1', …),
   *                  and `raw_document_id` resolves to the capture run and
   *                  its provider
   *   marketplaces   `is_discovered`
   *   sellers        the `storefront` external id ingestion assigns
   *   listings       has live observations and no seeded ones. A listing
   *   offers         ingestion REUSES rather than creates still fails that
   *                  test, which is right: it is a seeded row.
   */
  const LIVE = "market-data-v1";
  const liveOnly: Record<string, string> = {
    marketplaces: `select count(*)::int n from marketplaces where is_discovered`,
    sellers: `select count(*)::int n from sellers where external_seller_id = 'storefront'`,
    price_observations: `select count(*)::int n from price_observations where parser_version = '${LIVE}'`,
    listings: `select count(*)::int n from listings l
       where exists (select 1 from offers o join price_observations po on po.offer_id = o.id
                     where o.listing_id = l.id and po.parser_version = '${LIVE}')
         and not exists (select 1 from offers o join price_observations po on po.offer_id = o.id
                         where o.listing_id = l.id and po.parser_version is distinct from '${LIVE}')`,
    offers: `select count(*)::int n from offers o
       where exists (select 1 from price_observations po where po.offer_id = o.id and po.parser_version = '${LIVE}')
         and not exists (select 1 from price_observations po where po.offer_id = o.id and po.parser_version is distinct from '${LIVE}')`,
  };

  it("REG-11: the Phase 2 baseline is intact, and any growth is live-ingested", async (t) => {
    if (!available) return t.skip("development database not seeded");
    const drift: string[] = [];

    for (const [table, expected] of Object.entries(BASELINE_COUNTS)) {
      const actual = await count(table);
      if (actual === expected) continue;

      /**
       * Shrinking is always wrong — the seeded dataset is never deleted
       * from. Growth is only acceptable when every extra row is one a live
       * capture created, counted independently rather than inferred from
       * the difference.
       */
      if (actual < expected) {
        drift.push(`${table}: SHRANK — expected ${expected}, found ${actual}`);
        continue;
      }

      const probe = liveOnly[table];
      if (!probe) {
        drift.push(`${table}: grew to ${actual} from ${expected}, and ingestion does not write this table`);
        continue;
      }
      const live = (await db!.query<{ n: number }>(probe)).rows[0]!.n;
      if (actual - expected !== live) {
        drift.push(
          `${table}: expected ${expected} + ${live} live = ${expected + live}, found ${actual} — ` +
            `${actual - expected - live} row(s) unaccounted for`
        );
      }
    }

    assert.deepEqual(drift, [], `baseline counts drifted:\n${drift.join("\n")}`);
  });

  it("REG-11c: seeded observations are untouched by ingestion", async (t) => {
    if (!available) return t.skip("development database not seeded");
    const seeded = (
      await db!.query<{ n: number }>(
        `select count(*)::int n from price_observations where parser_version is distinct from '${LIVE}'`
      )
    ).rows[0]!.n;
    assert.equal(
      seeded,
      BASELINE_COUNTS["price_observations"],
      "ingestion must add observations, never rewrite the seeded ones"
    );
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
              and po.observed_at=(select max(observed_at) from price_observations
                                   where parser_version is distinct from '${LIVE}')) as cheapest`
    );
    assert.deepEqual(r.rows[0], { listings: 6, offers: 30, cheapest: 56900 });
  });

  /**
   * The reason the qualifier above exists, pinned so it cannot regress
   * silently.
   *
   * `max(observed_at)` over the whole table is the seeded dataset's last day
   * only while the table holds nothing else. One live observation dated now
   * moves it weeks forward, past the end of the seeded timeline, and every
   * seeded product then has nothing on "the latest date" — this check
   * returned null for the golden record before it was anchored on the seed's
   * own clock.
   *
   * This is not merely a test concern. `referenceDate()` in the analysis and
   * marketplace repositories uses the same global maximum to anchor every
   * window, so short windows over seeded products lose their basis once live
   * data arrives. Measured, reported, and deliberately NOT worked around
   * here — that is analysis behaviour, and changing it is a product decision
   * rather than a test fix.
   */
  it("REG-12d: the seeded timeline and the live timeline are far apart", async (t) => {
    if (!available) return t.skip("development database not seeded");
    const r = await db!.query<{ seeded: string | null; live: string | null }>(
      `select max(observed_at) filter (where parser_version is distinct from '${LIVE}')::text as seeded,
              max(observed_at) filter (where parser_version = '${LIVE}')::text as live
       from price_observations`
    );
    const { seeded, live } = r.rows[0]!;
    assert.ok(seeded, "the seeded dataset must still have a timeline");
    if (!live) return; // no live data in this database — nothing to compare
    assert.ok(
      live > seeded,
      "live observations are dated now; the seed ends in the past. If this ever inverts, " +
        "the reference-date assumptions in analysis need revisiting."
    );
  });

  it("the authentication tables exist, and the seed does not own them", async (t) => {
    if (!available) return t.skip("development database not seeded");

    // They must exist and be queryable.
    for (const table of ["users", "otp_challenges", "sessions"]) {
      assert.equal(typeof (await count(table)), "number", `${table} is not queryable`);
    }

    /**
     * This used to assert the tables were EMPTY, which was true only while
     * nobody had used the application locally. Registering an account is the
     * intended behaviour, so that assertion started failing for a good
     * reason and has been replaced by the invariant it was really standing
     * in for: a data reload must not sign anybody out.
     *
     * `seed.ts` truncates every table it loads. These three are not among
     * them, and asserting that directly is both stable and the thing that
     * actually matters.
     */
    const seed = await readFile(join(SERVER_DIR, "src", "scripts", "seed.ts"), "utf8");
    const loaders = [...seed.matchAll(/file:\s*"([a-z_]+)"/g)].map((m) => m[1]);
    assert.ok(loaders.length > 10, "the loader list could not be read from seed.ts");
    for (const table of ["users", "otp_challenges", "sessions", "tracked_products"]) {
      assert.ok(!loaders.includes(table), `seed.ts truncates ${table} — a reload would destroy account data`);
    }
  });

  it("the users table carries the password-authentication shape, and nothing older", async (t) => {
    if (!available) return t.skip("development database not seeded");
    const r = await db!.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `select column_name, data_type, is_nullable from information_schema.columns where table_name='users'`
    );
    const columns = new Map(r.rows.map((c) => [c.column_name, c]));

    // Reintroduced in 0003 for email + password authentication. Nullable on
    // purpose: an account created before password auth has no digest, and
    // inventing one would be worse than recording the absence.
    const hash = columns.get("password_hash");
    assert.ok(hash, "password_hash was reintroduced in 0003");
    assert.equal(hash!.data_type, "text");
    assert.equal(hash!.is_nullable, "YES");

    assert.ok(!columns.has("role"), "role was dropped in 0002 and has not come back");
    assert.ok(!columns.has("password"), "a plaintext password column must never exist");
    assert.ok(columns.has("email_verified_at"));
    assert.ok(columns.has("last_login_at"));
  });

  it("one-time codes are scoped to a purpose, and logging is no longer one of them", async (t) => {
    if (!available) return t.skip("development database not seeded");
    const cols = await db!.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name='otp_challenges'`
    );
    const columns = cols.rows.map((c) => c.column_name);
    for (const expected of ["purpose", "reset_token_hash", "reset_token_expires_at"]) {
      assert.ok(columns.includes(expected), `otp_challenges.${expected} is missing`);
    }

    // The check constraint, not convention, is what stops a verification code
    // authorising a reset — and what removed 'login' as a purpose entirely.
    const check = await db!.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition from pg_constraint where conname='otp_purpose_known'`
    );
    assert.equal(check.rows.length, 1, "otp_purpose_known is missing");
    const definition = check.rows[0]!.definition;
    assert.match(definition, /email_verification/);
    assert.match(definition, /password_reset/);
    assert.ok(!/'login'/.test(definition), "'login' is no longer a valid purpose");
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
