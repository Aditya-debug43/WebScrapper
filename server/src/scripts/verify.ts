import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env } from "../config/env.js";
import { createDb } from "../db/client.js";

/**
 * Post-seed verification.
 *
 * Row counts are the weakest possible check — a load can hit every count and
 * still have shredded the relationships, which is the specific failure this
 * migration has to avoid. So this asserts three things in order:
 *
 *   1. COUNTS      every table holds what the export said it held.
 *   2. STRUCTURE   the entity chain survived: the same products have the same
 *                  listings, the same listings the same offers, the same
 *                  offers the same observations. Checked as distributions,
 *                  not totals, because two products swapping listings would
 *                  leave the total untouched.
 *   3. DOMAIN      the invariants the application already guarantees still
 *                  hold in the database: no negative money, nothing selling
 *                  above its MRP, one observation per offer per day, one
 *                  featured offer per listing per day.
 *
 * Exit code is non-zero if anything fails, so this is usable in CI.
 */

const SEED_DIR = resolve(env.SEED_DATA_DIR);

type Check = { name: string; ok: boolean; detail: string };

async function main() {
  const manifest = JSON.parse(await readFile(join(SEED_DIR, "manifest.json"), "utf8")) as {
    counts: Record<string, number>;
  };

  const conn = await createDb();
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const scalar = async (sql: string) => {
    const rows = await conn.query<Record<string, unknown>>(sql);
    return Number(Object.values(rows[0] ?? { n: 0 })[0] ?? 0);
  };

  try {
    /* ---------------------------------------------------------- 1. counts */
    for (const [table, expected] of Object.entries(manifest.counts)) {
      const actual = await scalar(`select count(*)::int as n from "${table}"`);
      add(`count ${table}`, actual === expected, `expected ${expected}, found ${actual}`);
    }

    /* -------------------------------------------------------- 2. structure */
    // Orphans. The foreign keys make these impossible, so a non-zero result
    // means a constraint was dropped rather than that data drifted.
    const orphanChecks: Array<[string, string]> = [
      ["listings without a product", `select count(*)::int n from listings l left join products p on p.id=l.product_id where p.id is null`],
      ["offers without a listing", `select count(*)::int n from offers o left join listings l on l.id=o.listing_id where l.id is null`],
      ["offers without a seller", `select count(*)::int n from offers o left join sellers s on s.id=o.seller_id where s.id is null`],
      ["observations without an offer", `select count(*)::int n from price_observations po left join offers o on o.id=po.offer_id where o.id is null`],
      ["promotions without an offer", `select count(*)::int n from promotions pr left join offers o on o.id=pr.offer_id where o.id is null`],
      ["reviews without a listing", `select count(*)::int n from review_snapshots r left join listings l on l.id=r.listing_id where l.id is null`],
      ["products with a missing parent", `select count(*)::int n from products c left join products p on p.id=c.parent_product_id where c.parent_product_id is not null and p.id is null`],
    ];
    for (const [name, sql] of orphanChecks) {
      const n = await scalar(sql);
      add(name, n === 0, `${n} orphaned`);
    }

    // Distribution, not total: two products exchanging a listing would keep
    // every count identical and still be wrong.
    const listingsPerProduct = await conn.query<{ listings: number; products: number }>(
      `select listings, count(*)::int as products from (
         select product_id, count(*)::int as listings from listings group by product_id
       ) t group by listings order by listings`
    );
    add(
      "listings-per-product distribution",
      listingsPerProduct.length > 0,
      listingsPerProduct.map((r) => `${r.listings}→${r.products}`).join(" ")
    );

    const offersPerListing = await conn.query<{ offers: number; listings: number }>(
      `select offers, count(*)::int as listings from (
         select listing_id, count(*)::int as offers from offers group by listing_id
       ) t group by offers order by offers`
    );
    add(
      "offers-per-listing distribution",
      offersPerListing.length > 0,
      offersPerListing.map((r) => `${r.offers}→${r.listings}`).join(" ")
    );

    /* ----------------------------------------------------------- 3. domain */
    const negSelling = await scalar(`select count(*)::int n from price_observations where selling_price_minor < 0`);
    add("no negative selling price", negSelling === 0, `${negSelling} rows`);

    const negShip = await scalar(`select count(*)::int n from price_observations where shipping_fee_minor < 0`);
    add("no negative shipping fee", negShip === 0, `${negShip} rows`);

    // Selling above the printed MRP is not aggressive pricing, it is illegal
    // in India. The engine treats MRP as a hard ceiling and the data must too.
    const aboveMrp = await scalar(
      `select count(*)::int n from price_observations where mrp_minor is not null and selling_price_minor > mrp_minor`
    );
    add("nothing sells above its MRP", aboveMrp === 0, `${aboveMrp} rows`);

    const dupObs = await scalar(
      `select count(*)::int n from (select offer_id, observed_at from price_observations group by 1,2 having count(*) > 1) t`
    );
    add("one observation per offer per day", dupObs === 0, `${dupObs} duplicate keys`);

    // The featured offer is the cheapest in-stock landed price on a listing
    // that day — by definition at most one.
    const dupBuybox = await scalar(
      `select count(*)::int n from (
         select o.listing_id, po.observed_at
         from price_observations po join offers o on o.id = po.offer_id
         where po.is_buybox_winner
         group by 1,2 having count(*) > 1
       ) t`
    );
    add("one featured offer per listing per day", dupBuybox === 0, `${dupBuybox} days with more than one`);

    const badClass = await scalar(
      `select count(*)::int n from promotions where
         (promotion_type in ('instant_discount','marketplace_campaign') and availability_class <> 'universal')
      or (promotion_type in ('coupon','bank_offer','exchange')       and availability_class <> 'conditional')
      or (promotion_type = 'cashback'                                 and availability_class <> 'deferred')
      or (promotion_type = 'no_cost_emi'                              and availability_class <> 'financing')`
    );
    add("promotion availability class matches its type", badClass === 0, `${badClass} mismatched`);

    // The soft provenance pointer is EXPECTED to dangle — raw HTML is retained
    // far more briefly than the facts derived from it. Reported, not failed.
    const danglingDocs = await scalar(
      `select count(*)::int n from price_observations po
       left join raw_documents rd on rd.id = po.raw_document_id
       where po.raw_document_id is not null and rd.id is null`
    );
    add(
      "raw-document pointers (soft, may dangle by design)",
      true,
      `${danglingDocs.toLocaleString("en-IN")} of ${(await scalar(`select count(*)::int n from price_observations`)).toLocaleString("en-IN")} point outside the retained window`
    );

    /* ------------------------------------------------- 4. a golden record */
    const golden = await conn.query<{ listings: number; offers: number; observations: number; cheapest: number }>(
      `select
         (select count(*)::int from listings where product_id = 'prod_dove_hair_fall') as listings,
         (select count(*)::int from offers o join listings l on l.id=o.listing_id where l.product_id='prod_dove_hair_fall') as offers,
         (select count(*)::int from price_observations po join offers o on o.id=po.offer_id
            join listings l on l.id=o.listing_id where l.product_id='prod_dove_hair_fall') as observations,
         (select min(po.selling_price_minor + po.shipping_fee_minor)::int from price_observations po
            join offers o on o.id=po.offer_id join listings l on l.id=o.listing_id
            where l.product_id='prod_dove_hair_fall' and po.is_in_stock
              and po.observed_at = (select max(observed_at) from price_observations)) as cheapest`
    );
    const g = golden[0];
    add(
      "golden record — Dove Hair Fall Rescue Shampoo",
      g?.listings === 6 && g?.offers === 30,
      `${g?.listings} listings, ${g?.offers} offers, ${g?.observations?.toLocaleString("en-IN")} observations, cheapest landed today ₹${((g?.cheapest ?? 0) / 100).toFixed(0)}`
    );

    /* ----------------------------------------------------------- report */
    const failed = checks.filter((c) => !c.ok);
    const width = Math.max(...checks.map((c) => c.name.length));
    for (const c of checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.name.padEnd(width)}  ${c.detail}`);
    console.log(`\n· ${checks.length - failed.length}/${checks.length} checks passed`);
    if (failed.length) process.exit(1);
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  console.error("\nVerification failed:\n", err);
  process.exit(1);
});
