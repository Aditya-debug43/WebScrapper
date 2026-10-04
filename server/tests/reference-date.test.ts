import "./helpers/env.js";

import { strict as assert } from "node:assert";
import { sql } from "drizzle-orm";
import { after, before, describe, test } from "node:test";
import { createAnalysisTestApp, type Harness } from "./helpers/harness.js";

/**
 * THE REFERENCE DATE IS RESOLVED PER PRODUCT
 * ==========================================
 *
 * "Today", for a dataset whose data ends in the past. Every window is
 * anchored on it, so getting it wrong empties every window at once.
 *
 * ── The defect this rule fixes ──────────────────────────────────────────
 * It used to be `max(observed_at)` across the WHOLE table. That is only
 * meaningful while every product shares one timeline, and live provider data
 * ended that: a single product captured today moved the anchor for all 1,172
 * products, and every seeded product was then measured against a window its
 * own data ends seven weeks before.
 *
 * It was not theoretical. Measured on the development dataset, the one-month
 * window went from 96,149 seeded observations to zero, and the price-history
 * screen rendered "no price history to observe yet" for listings holding
 * months of it.
 *
 * ── Why per-product is the right scope ──────────────────────────────────
 * A product's "today" is the last day IT was observed. That answer is
 * unchanged for a uniformly captured dataset, correct for a mixed one, and
 * advances by itself as a product receives fresh captures — which is what a
 * growing live timeline requires. A product never observed falls back to the
 * dataset maximum, so it still resolves a window rather than failing.
 *
 * These tests construct the mixed timeline directly rather than relying on
 * the seeded one, so they keep testing the rule after a reseed.
 */

let h: Harness;

before(async () => {
  // Peers included, so the fixture holds more than one product: the central
  // regression needs a SECOND product to receive a newer capture.
  h = await createAnalysisTestApp(["prod_dove_hair_fall"]);
});
after(async () => {
  await h.close();
});

const rows = async (q: ReturnType<typeof sql>) =>
  ((await h.db.execute(q)) as unknown as { rows: Array<Record<string, any>> }).rows;

const get = async (url: string) => {
  const res = await h.app.inject({ method: "GET", url: `/api/v1${url}` });
  return { status: res.statusCode, body: res.json() };
};

describe("the anchor follows the product, not the table", () => {
  test("a product's windows are anchored on its own last capture", async () => {
    const [own] = await rows(sql`
      select max(po.observed_at)::text as d
        from price_observations po
        join offers o   on o.id = po.offer_id
        join listings l on l.id = o.listing_id
       where l.product_id = 'prod_dove_hair_fall'`);

    const { body } = await get("/api/v1/products/prod_dove_hair_fall/price-history?window=7d".replace("/api/v1", ""));
    assert.equal(body.meta.range.to, own.d, "the window ends on the product's own last capture");
  });

  /**
   * THE REGRESSION ITSELF.
   *
   * A newer observation is inserted for a DIFFERENT product, exactly as live
   * ingestion does. The untouched product's window must not move: before the
   * fix it jumped to the new date and went empty.
   */
  test("a newer capture elsewhere does not move this product's window", async () => {
    const before = await get("/products/prod_dove_hair_fall/price-history?window=1m");
    const beforeTo = before.body.meta.range.to;
    const beforeCount = before.body.meta.observationCount;
    assert.ok(beforeCount > 0, "the golden product has observations in a one-month window");

    // Borrow any offer belonging to another product and observe it in the future.
    const [other] = await rows(sql`
      select o.id as offer_id
        from offers o
        join listings l on l.id = o.listing_id
       where l.product_id <> 'prod_dove_hair_fall'
       limit 1`);
    assert.ok(other, "the fixture carries more than one product");

    const future = "2027-01-15";
    await h.db.execute(sql`
      insert into price_observations
        (id, offer_id, observed_at, recorded_at, selling_price_minor, shipping_fee_minor,
         currency_code, is_in_stock, is_buybox_winner, parser_version)
      values ('obs_reference_date_probe', ${other.offer_id}, ${future}, now(),
              123400, 0, 'INR', true, false, 'reference-date-test')`);

    const [max] = await rows(sql`select max(observed_at)::text as d from price_observations`);
    assert.equal(max.d, future, "the dataset maximum did move");

    const after = await get("/products/prod_dove_hair_fall/price-history?window=1m");
    assert.equal(after.body.meta.range.to, beforeTo, "this product's anchor must not follow another product's capture");
    assert.equal(
      after.body.meta.observationCount,
      beforeCount,
      "and its window must therefore still hold the same observations"
    );

    await h.db.execute(sql`delete from price_observations where id = 'obs_reference_date_probe'`);
  });

  test("a product's own new capture does move its anchor forward", async () => {
    const before = await get("/products/prod_dove_hair_fall/price-history?window=1m");
    const beforeTo = before.body.meta.range.to;

    const [own] = await rows(sql`
      select o.id as offer_id
        from offers o
        join listings l on l.id = o.listing_id
       where l.product_id = 'prod_dove_hair_fall'
       limit 1`);

    const future = "2027-02-20";
    await h.db.execute(sql`
      insert into price_observations
        (id, offer_id, observed_at, recorded_at, selling_price_minor, shipping_fee_minor,
         currency_code, is_in_stock, is_buybox_winner, parser_version)
      values ('obs_reference_date_own', ${own.offer_id}, ${future}, now(),
              123400, 0, 'INR', true, false, 'reference-date-test')`);

    const after = await get("/products/prod_dove_hair_fall/price-history?window=1m");
    assert.notEqual(after.body.meta.range.to, beforeTo, "a fresh capture on this product must advance its anchor");
    assert.equal(after.body.meta.range.to, future, "to the day it was captured");

    await h.db.execute(sql`delete from price_observations where id = 'obs_reference_date_own'`);
  });

  /**
   * The cache that used to hold the reference date for the process lifetime
   * assumed the data could not change under a running server. Ingestion
   * writes while the server is up, so a cached anchor would hide a capture
   * until restart.
   */
  test("a capture taken while the server is running is visible immediately", async () => {
    const [own] = await rows(sql`
      select o.id as offer_id
        from offers o
        join listings l on l.id = o.listing_id
       where l.product_id = 'prod_dove_hair_fall'
       limit 1`);

    const first = await get("/products/prod_dove_hair_fall/price-history?window=1m");

    const future = "2027-03-25";
    await h.db.execute(sql`
      insert into price_observations
        (id, offer_id, observed_at, recorded_at, selling_price_minor, shipping_fee_minor,
         currency_code, is_in_stock, is_buybox_winner, parser_version)
      values ('obs_reference_date_live', ${own.offer_id}, ${future}, now(),
              123400, 0, 'INR', true, false, 'reference-date-test')`);

    const second = await get("/products/prod_dove_hair_fall/price-history?window=1m");
    assert.notEqual(
      second.body.meta.range.to,
      first.body.meta.range.to,
      "the anchor must be read fresh, not served from a process-lifetime cache"
    );

    await h.db.execute(sql`delete from price_observations where id = 'obs_reference_date_live'`);
  });

  /**
   * ONE LEVEL FINER THAN THE PRODUCT, and necessary.
   *
   * A product can be captured today on one platform and seven weeks ago on
   * another. Anchoring a LISTING's history on its product then still empties
   * the window — which is exactly what happened: the iPhone 15 was captured
   * on a discovered store on 4 October while its Amazon listing had not been
   * seen since 13 August, and the Amazon price history rendered "no price
   * history to observe yet" over sixty observations.
   */
  test("a listing's history is anchored on that listing, not its product", async () => {
    const [listing] = await rows(sql`
      select l.id,
             max(po.observed_at)::text as own_max
        from listings l
        join offers o            on o.listing_id = l.id
        join price_observations po on po.offer_id = o.id
       where l.product_id = 'prod_dove_hair_fall'
       group by l.id
       limit 1`);
    assert.ok(listing, "the fixture carries a listing with observations");

    const { status, body } = await get(`/listings/${listing.id}/price-history`);
    assert.equal(status, 200);
    assert.equal(
      body.meta.range.to,
      listing.own_max,
      "the window must end on this listing's own last capture"
    );
    assert.ok(body.meta.observationCount > 0, "a listing with observations must not render an empty window");
  });

  test("a newer capture on a sibling listing does not empty this one", async () => {
    const listings = await rows(sql`
      select distinct l.id
        from listings l
        join offers o on o.listing_id = l.id
       where l.product_id = 'prod_dove_hair_fall'
       limit 2`);
    assert.equal(listings.length, 2, "the golden product is sold on more than one platform");

    const [subject, sibling] = listings;
    const before = await get(`/listings/${subject.id}/price-history`);
    assert.ok(before.body.meta.observationCount > 0);

    const [siblingOffer] = await rows(
      sql`select id from offers where listing_id = ${sibling.id} limit 1`
    );
    await h.db.execute(sql`
      insert into price_observations
        (id, offer_id, observed_at, recorded_at, selling_price_minor, shipping_fee_minor,
         currency_code, is_in_stock, is_buybox_winner, parser_version)
      values ('obs_sibling_probe', ${siblingOffer.id}, '2027-04-30', now(),
              99900, 0, 'INR', true, false, 'reference-date-test')`);

    const after = await get(`/listings/${subject.id}/price-history`);
    assert.equal(after.body.meta.range.to, before.body.meta.range.to, "a sibling's capture must not move this anchor");
    assert.equal(after.body.meta.observationCount, before.body.meta.observationCount);

    await h.db.execute(sql`delete from price_observations where id = 'obs_sibling_probe'`);
  });

  test("the analysis and the price history agree on the same anchor", async () => {
    const history = await get("/products/prod_dove_hair_fall/price-history?window=7d");
    const summary = await get("/products/prod_dove_hair_fall/price-summary");
    assert.equal(
      summary.body.meta.referenceDate,
      history.body.meta.referenceDate,
      "two endpoints disagreeing about today would put two timelines on one screen"
    );
  });
});
