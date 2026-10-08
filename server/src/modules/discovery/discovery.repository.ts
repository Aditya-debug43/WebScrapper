import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { trackedProducts } from "../../db/schema.js";
import { normalizeQuery } from "../../ingestion/queryKey.js";

/**
 * TRACKING, AND WHAT A USER ALREADY HOLDS.
 *
 * Deliberately no longer a writer of market data. It used to own a path that
 * turned one chosen search result into a product with one seller, and that
 * path is gone: a product's sellers are written by `market.repository.ts`,
 * from the provider's own catalogue entry for the product. One place creates
 * competitive data, and one definition decides what counts as a competitor.
 *
 * What remains is tracking itself — who follows what, and the interest signal
 * that earns a product a scheduled capture.
 */

/** How often a product's market is re-captured once somebody follows it. */
const DEFAULT_INTERVAL_HOURS = 24;

export class DiscoveryRepository {
  constructor(private readonly db: Db) {}

  /**
   * Which of these titles the catalogue already holds.
   *
   * Matched on the normalised title, the same key the capture layer dedupes
   * queries with, so "iPhone 15 (128GB)" finds a product stored as
   * "iPhone 15 128 GB".
   */
  async resolveKnownProducts(titles: string[]): Promise<Map<string, string>> {
    if (titles.length === 0) return new Map();
    const keys = [...new Set(titles.map(normalizeQuery))];
    const rows = (await this.db.execute(
      sql`select id, canonical_query, canonical_name from products
           where canonical_query in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`
    )) as unknown as { rows: { id: string; canonical_query: string | null }[] };

    const byKey = new Map(rows.rows.map((r) => [r.canonical_query ?? "", r.id]));
    const out = new Map<string, string>();
    for (const title of titles) {
      const hit = byKey.get(normalizeQuery(title));
      if (hit) out.set(title, hit);
    }
    return out;
  }

  /* ------------------------------------------------------------- tracking */

  async startTracking(input: { userId: string; productId: string; searchQuery: string; sourceUrl: string | null }) {
    const id = `trk_${randomUUID().replace(/-/g, "")}`;
    await this.db
      .insert(trackedProducts)
      .values({
        id,
        userId: input.userId,
        productId: input.productId,
        status: "active",
        searchQuery: input.searchQuery,
        sourceUrl: input.sourceUrl,
      })
      // Following something twice is following it.
      .onConflictDoNothing({ target: [trackedProducts.userId, trackedProducts.productId] });

    await this.refreshTrackerCount(input.productId);

    const [row] = await this.db
      .select({ id: trackedProducts.id, trackedAt: trackedProducts.trackedAt, status: trackedProducts.status })
      .from(trackedProducts)
      .where(and(eq(trackedProducts.userId, input.userId), eq(trackedProducts.productId, input.productId)))
      .limit(1);
    return row ?? { id, trackedAt: new Date(), status: "active" as const };
  }

  async stopTracking(userId: string, trackingId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ productId: trackedProducts.productId })
      .from(trackedProducts)
      // Scoped by user: one person cannot remove another's tracking by id.
      .where(and(eq(trackedProducts.userId, userId), eq(trackedProducts.id, trackingId)))
      .limit(1);
    if (!row) return false;

    await this.db
      .delete(trackedProducts)
      .where(and(eq(trackedProducts.userId, userId), eq(trackedProducts.id, trackingId)));
    await this.refreshTrackerCount(row.productId);
    return true;
  }

  /**
   * What this user follows — with the state of each product's MARKET, not
   * just one price.
   *
   * The seller and marketplace counts are here rather than behind a second
   * request because they are what make the row honest. "Rs 26,990" alone
   * invites the reader to assume it is the market; "Rs 26,990, cheapest of 10
   * sellers across 5 marketplaces" is the same number with its evidence
   * attached, and the difference is the whole point of this redesign.
   *
   * A product with no observation yet returns nulls rather than zeros — it is
   * waiting for its first capture, which is a different thing from being
   * free.
   */
  async trackedFor(userId: string) {
    const rows = (await this.db.execute(sql`
      with latest as (
        select distinct on (l.product_id)
               l.product_id,
               po.selling_price_minor + coalesce(po.shipping_fee_minor, 0) as landed_minor,
               po.observed_at,
               m.name as marketplace_name
          from price_observations po
          join offers       o on o.id = po.offer_id
          join listings     l on l.id = o.listing_id
          join marketplaces m on m.id = l.marketplace_id
         order by l.product_id, po.observed_at desc, landed_minor asc
      ),
      previous as (
        select l.product_id, min(po.observed_at) as first_seen, count(*)::int as observation_count
          from price_observations po
          join offers   o on o.id = po.offer_id
          join listings l on l.id = o.listing_id
         group by l.product_id
      ),
      /*
       * The most recent competitive picture for each product, from the
       * per-product aggregate rather than recomputed here. One source for
       * "how wide is this market" means the tracked list and the market
       * screen cannot disagree about it.
       */
      market as (
        select distinct on (product_id)
               product_id, seller_count, marketplace_count, low_minor, median_minor,
               high_minor, captured_on
          from product_market_snapshots
         order by product_id, captured_on desc
      )
      select tp.id                      as "trackingId",
             tp.product_id              as "productId",
             tp.status                  as "status",
             tp.search_query            as "searchQuery",
             tp.source_url              as "sourceUrl",
             tp.tracked_at::text        as "trackedAt",
             p.canonical_name           as "name",
             p.origin                   as "origin",
             p.last_captured_at::text   as "lastCapturedAt",
             p.next_capture_at::text    as "nextCaptureAt",
             p.tracker_count            as "trackerCount",
             lt.landed_minor            as "currentPriceMinor",
             lt.observed_at::text       as "currentObservedAt",
             lt.marketplace_name        as "currentMarketplace",
             coalesce(pv.observation_count, 0) as "observationCount",
             mk.seller_count            as "sellerCount",
             mk.marketplace_count       as "marketplaceCount",
             mk.low_minor               as "marketLowMinor",
             mk.median_minor            as "marketMedianMinor",
             mk.high_minor              as "marketHighMinor",
             mk.captured_on::text       as "marketCapturedOn"
        from tracked_products tp
        join products p  on p.id = tp.product_id
        left join latest   lt on lt.product_id = tp.product_id
        left join previous pv on pv.product_id = tp.product_id
        left join market   mk on mk.product_id = tp.product_id
       where tp.user_id = ${userId}
       order by tp.tracked_at desc
    `)) as unknown as { rows: Record<string, unknown>[] };
    return rows.rows;
  }

  /**
   * Interest is what earns a scheduled capture.
   *
   * A product nobody follows and nobody has opened is never captured
   * automatically — the single largest saving available, because most of a
   * catalogue is cold at any moment.
   */
  async noteInterest(productId: string) {
    await this.db.execute(sql`
      update products
         set last_interest_at = now(),
             next_capture_at = coalesce(
               next_capture_at,
               now() + (coalesce(capture_interval_hours, ${DEFAULT_INTERVAL_HOURS}) || ' hours')::interval
             )
       where id = ${productId}
    `);
  }

  private async refreshTrackerCount(productId: string) {
    await this.db.execute(sql`
      update products
         set tracker_count = (
               select count(*)::int from tracked_products
                where product_id = ${productId} and status = 'active'
             )
       where id = ${productId}
    `);
  }
}
