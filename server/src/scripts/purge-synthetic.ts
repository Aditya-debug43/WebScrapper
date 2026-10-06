import "../config/env.js";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "../db/client.js";

/**
 * REMOVE THE SEEDED CATALOGUE, KEEP EVERYTHING THAT IS REAL
 * =========================================================
 *
 *   node dist/scripts/purge-synthetic.js            # dry run — counts only
 *   node dist/scripts/purge-synthetic.js --execute  # actually delete
 *
 * DRY RUN BY DEFAULT, and never wired into a deployment. Deleting most of a
 * production database is a decision somebody makes on purpose, at a moment
 * of their choosing, having read the counts.
 *
 * WHAT MAKES THIS SAFE TO RUN AT ALL
 *
 * Nothing here guesses. The one thing that must never happen is deleting a
 * genuinely captured row because it looked synthetic, and the trap is real:
 * a SEEDED product can carry REAL observations — `prod_dove_hair_fall` was
 * seeded and has live SerpApi offers attached to it. So "has real
 * observations" is not evidence that a product was originally live, and the
 * reverse is not evidence either.
 *
 * That is why migration 0008 added an explicit `origin`, defaulting to
 * `seed`: every row that predates the column is assumed synthetic, and the
 * backfill below promotes only what can be PROVEN live. An unknown row is
 * treated as seed — the conservative direction is to delete, not to keep,
 * because a kept synthetic row silently corrupts analysis while a deleted
 * one is merely gone and re-capturable.
 *
 * WHAT IS NEVER TOUCHED
 *   users, sessions, otp_challenges        the accounts themselves
 *   capture_runs, raw_documents,
 *   rejected_records, field_coverage       the audit trail, including for
 *                                          captures whose rows are deleted
 *   anything with origin = 'live'          genuinely captured data
 *   tracked_products for surviving rows    what people chose to follow
 *
 * Deletion runs child-to-parent in one transaction, so a foreign-key
 * violation rolls the whole thing back rather than leaving the database
 * half-emptied.
 */

const EXECUTE = process.argv.includes("--execute");

/** Child → parent. Reversing any pair is a foreign-key violation. */
const DELETE_ORDER = [
  ["price_observations", "observations on seeded offers"],
  ["promotions", "promotions on seeded offers"],
  ["offers", "seeded offers"],
  ["review_snapshots", "reviews on seeded listings"],
  ["seller_rating_snapshots", "ratings of seeded sellers"],
  ["listings", "seeded listings"],
  ["sellers", "seeded sellers"],
  ["seller_cost_inputs", "cost inputs for seeded products"],
  ["tracked_products", "tracking rows pointing at seeded products"],
  ["products", "seeded products"],
] as const;

/**
 * Promote rows that can be PROVEN to be live.
 *
 * Only ever seed → live, never the reverse: this can rescue a row that was
 * mislabelled by the default, and can never condemn one.
 */
async function backfillOrigin(db: Db) {
  const promoted: Record<string, number> = {};

  // A listing is live if a real observation sits beneath it. `market-data-v1`
  // is written only by the ingestion layer.
  const listingsToPromote = await scalar(db, sql`select count(*)::int as n from listings where origin = 'seed' and exists (select 1 from offers o join price_observations po on po.offer_id = o.id where o.listing_id = listings.id and po.parser_version = 'market-data-v1')`);
  (await db.execute(sql`
    update listings set origin = 'live'
     where origin = 'seed'
       and exists (
         select 1 from offers o
           join price_observations po on po.offer_id = o.id
          where o.listing_id = listings.id and po.parser_version = 'market-data-v1'
       )
  `));
  promoted.listings = listingsToPromote;

  const sellersToPromote = await scalar(db, sql`select count(*)::int as n from sellers where origin = 'seed' and exists (select 1 from offers o join price_observations po on po.offer_id = o.id where o.seller_id = sellers.id and po.parser_version = 'market-data-v1')`);
  (await db.execute(sql`
    update sellers set origin = 'live'
     where origin = 'seed'
       and exists (
         select 1 from offers o
           join price_observations po on po.offer_id = o.id
          where o.seller_id = sellers.id and po.parser_version = 'market-data-v1'
       )
  `));
  promoted.sellers = sellersToPromote;

  /**
   * Products are NOT promoted from their observations.
   *
   * This is the trap. A seeded product that a live capture matched against
   * has real observations and is still a seeded product — promoting it would
   * preserve the synthetic catalogue entry that the matching happened to
   * land on. Only a product the discovery flow created is live, and those
   * are already marked at creation.
   *
   * A product somebody is actively tracking is spared regardless of origin,
   * handled separately below.
   */
  return promoted;
}

/**
 * Seeded products that must survive, and why.
 *
 * TWO reasons, and the second was found by this script's own safety check
 * failing on a real database.
 *
 * 1. Somebody follows it. Deleting it would silently empty their desk.
 *
 * 2. IT CARRIES GENUINELY CAPTURED OBSERVATIONS. This is the one that is
 *    easy to miss. The old ingestion attached live SerpApi offers to whatever
 *    SEEDED product they matched — `prod_dove_hair_fall` was seeded and has
 *    real captured prices beneath it. Deleting the product cascades through
 *    listings and offers and takes those real observations with it.
 *
 *    The first version of this script did exactly that, and the assertion at
 *    the end caught it: "live observations changed from 2 to 1 — real data
 *    was deleted". The guard worked; the logic did not.
 *
 * Both are marked `manual` rather than `live`: they are not products that
 * discovery created, and calling them live would misreport where they came
 * from. `manual` says "retained deliberately", which is the truth, and what
 * they are retained FOR is reported separately below.
 */
async function protectSeeded(db: Db) {
  const trackedCount = await scalar(db, sql`select count(*)::int as n from products where origin = 'seed' and exists (select 1 from tracked_products tp where tp.product_id = products.id)`);
  (await db.execute(sql`
    update products set origin = 'manual'
     where origin = 'seed'
       and exists (select 1 from tracked_products tp where tp.product_id = products.id)
  `));

  const realDataCount = await scalar(db, sql`select count(*)::int as n from products where origin = 'seed' and exists (select 1 from listings l join offers o on o.listing_id = l.id join price_observations po on po.offer_id = o.id where l.product_id = products.id and po.parser_version = 'market-data-v1')`);
  (await db.execute(sql`
    update products set origin = 'manual'
     where origin = 'seed'
       and exists (
         select 1
           from listings l
           join offers o              on o.listing_id = l.id
           join price_observations po on po.offer_id = o.id
          where l.product_id = products.id
            and po.parser_version = 'market-data-v1'
       )
  `));

  return { tracked: trackedCount, carryingRealData: realDataCount };
}

/** A single integer from a counting query. */
async function scalar(db: Db, query: ReturnType<typeof sql>): Promise<number> {
  const rows = (await db.execute(query)) as unknown as { rows: Array<{ n: number }> };
  return rows.rows[0]?.n ?? 0;
}

/** One table's row count, by name. Table names here are literals, never input. */
async function tableCount(db: Db, table: string): Promise<number> {
  const rows = (await db.execute(
    sql.raw(`select count(*)::int as n from "${table}"`)
  )) as unknown as { rows: Array<{ n: number }> };
  return rows.rows[0]?.n ?? 0;
}

async function counts(db: Db) {
  const rows = (await db.execute(sql`
    select
      (select count(*)::int from products where origin = 'seed')  as "seedProducts",
      (select count(*)::int from products where origin = 'live')  as "liveProducts",
      (select count(*)::int from products where origin = 'manual') as "keptProducts",
      (select count(*)::int from listings where origin = 'seed')  as "seedListings",
      (select count(*)::int from listings where origin = 'live')  as "liveListings",
      (select count(*)::int from price_observations)              as "observations",
      (select count(*)::int from price_observations
         where parser_version = 'market-data-v1')                 as "liveObservations",
      (select count(*)::int from users)                           as "users",
      (select count(*)::int from tracked_products)                as "tracking",
      (select count(*)::int from capture_runs)                    as "captureRuns"
  `)) as unknown as { rows: Array<Record<string, number>> };
  return rows.rows[0]!;
}

async function main() {
  const conn = await createDb();
  const db = conn.db;

  try {
    console.log(EXECUTE ? "· EXECUTING — rows will be deleted" : "· DRY RUN — nothing will be deleted");
    console.log("");

    const promoted = await backfillOrigin(db);
    const kept = await protectSeeded(db);
    console.log("· provenance backfill (seed → live, never the reverse)");
    for (const [table, n] of Object.entries(promoted)) console.log(`    ${table.padEnd(12)} ${n} promoted`);
    console.log(`    ${"products".padEnd(12)} ${kept.tracked} kept — somebody follows them`);
    console.log(`    ${"products".padEnd(12)} ${kept.carryingRealData} kept — they carry genuinely captured observations`);
    console.log("");

    const before = await counts(db);
    console.log("· before");
    for (const [k, v] of Object.entries(before)) console.log(`    ${k.padEnd(18)} ${v}`);
    console.log("");

    /**
     * What each delete targets.
     *
     * Every statement reaches `products.origin = 'seed'` through its own
     * foreign keys, so nothing is deleted on the strength of its own table
     * looking synthetic — the product is the single source of truth.
     */
    const statements: Array<readonly [string, ReturnType<typeof sql>]> = [
      ["price_observations", sql`delete from price_observations where offer_id in (
          select o.id from offers o join listings l on l.id = o.listing_id
            join products p on p.id = l.product_id where p.origin = 'seed')`],
      ["promotions", sql`delete from promotions where offer_id in (
          select o.id from offers o join listings l on l.id = o.listing_id
            join products p on p.id = l.product_id where p.origin = 'seed')`],
      ["offers", sql`delete from offers where listing_id in (
          select l.id from listings l join products p on p.id = l.product_id where p.origin = 'seed')`],
      ["review_snapshots", sql`delete from review_snapshots where listing_id in (
          select l.id from listings l join products p on p.id = l.product_id where p.origin = 'seed')`],
      ["seller_rating_snapshots", sql`delete from seller_rating_snapshots where seller_id in (
          select s.id from sellers s where s.origin = 'seed'
            and not exists (select 1 from offers o where o.seller_id = s.id))`],
      ["listings", sql`delete from listings where product_id in (select id from products where origin = 'seed')`],
      ["sellers", sql`delete from sellers where origin = 'seed'
          and not exists (select 1 from offers o where o.seller_id = sellers.id)`],
      ["seller_cost_inputs", sql`delete from seller_cost_inputs where product_id in (
          select id from products where origin = 'seed')`],
      ["tracked_products", sql`delete from tracked_products where product_id in (
          select id from products where origin = 'seed')`],
      ["products", sql`delete from products where origin = 'seed'`],

      /**
       * Finally, the synthetic history hiding under RETAINED products.
       *
       * A product kept because it carries real observations usually carries
       * seeded ones too — `prod_dove_hair_fall` was retained for seven
       * genuine captures and brought 233 fabricated ones with it. Leaving
       * those would hand the price history, the analysis and the
       * recommendation exactly the invented data this whole migration exists
       * to remove, on the products most likely to be looked at.
       *
       * `market-data-v1` is written only by the ingestion layer, so anything
       * else is seeded by definition. The retained product ends up with a
       * short, real history — which is the honest outcome, not a defect.
       */
      ["price_observations", sql`delete from price_observations where parser_version is distinct from 'market-data-v1'`],
      ["promotions", sql`delete from promotions where offer_id not in (select offer_id from price_observations)`],
      ["review_snapshots", sql`delete from review_snapshots where listing_id in (
          select l.id from listings l join products p on p.id = l.product_id where p.origin = 'manual')`],
    ];

    if (!EXECUTE) {
      console.log("· would delete, in this order (child → parent)");
      for (const [table, description] of DELETE_ORDER) {
        console.log(`    ${table.padEnd(24)} ${description}`);
      }
      console.log("");
      console.log("· re-run with --execute to apply");
      return;
    }

    /**
     * One transaction. A foreign-key violation anywhere rolls back
     * everything rather than leaving the database half-emptied.
     */
    await db.transaction(async (tx) => {
      for (const [table, statement] of statements) {
        /**
         * Counted before and after rather than read from , which
         * PGlite does not report for DELETE — the first run of this script
         * printed "0 deleted" for every table while actually removing
         * 1,172 products, which is precisely the kind of reassuring and
         * wrong output a destructive script must not produce.
         */
        const before = await tableCount(tx as unknown as Db, table);
        await tx.execute(statement);
        const after = await tableCount(tx as unknown as Db, table);
        console.log(`    ${table.padEnd(24)} ${before - after} deleted (${after} remain)`);
      }
    });

    console.log("");
    const after = await counts(db);
    console.log("· after");
    for (const [k, v] of Object.entries(after)) console.log(`    ${k.padEnd(18)} ${v}`);

    if (after.users !== before.users) {
      throw new Error(`users changed from ${before.users} to ${after.users} — this must never happen`);
    }
    if (after.liveObservations !== before.liveObservations) {
      throw new Error(
        `live observations changed from ${before.liveObservations} to ${after.liveObservations} — real data was deleted`
      );
    }
    console.log("");
    console.log("· users and live observations are unchanged, as required");
  } finally {
    await conn.close();
  }
}

main().catch((error) => {
  console.error("purge failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
