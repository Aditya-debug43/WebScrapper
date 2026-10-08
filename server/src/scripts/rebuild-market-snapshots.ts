import "../config/env.js";
import { createDb } from "../db/client.js";
import { MarketRepository } from "../modules/market/market.repository.js";
import { distribution, segmentByCondition } from "../modules/market/competition.js";

/**
 * REBUILD THE DAILY COMPETITIVE AGGREGATES
 * ========================================
 *
 * `product_market_snapshots` is a DERIVED row: the distribution of a
 * product's sellers on a given day, computed from `price_observations`. The
 * observations are facts and are never rewritten here. The aggregate is an
 * interpretation of them, and interpretations change.
 *
 * So when the rule changes, the stored rows must be recomputed or the series
 * silently mixes two definitions — and a chart drawn from it shows a movement
 * no price made. Not hypothetical: segmenting the market by condition changed
 * one product's stored median from ₹1,14,999 (a refurbished unit pooled in
 * with new stock) to ₹1,39,400, and the step between the two rules read as a
 * genuine 21% rise.
 *
 * IT REUSES THE REPOSITORY'S OWN MARKET QUERY, and that is the point of the
 * script rather than an implementation detail. The first version grouped raw
 * observations by the day they were recorded, which looked equivalent and was
 * not: the live query carries a seller's last-seen price forward within a
 * staleness window, so a store the provider failed to return today is still
 * in today's market. Grouping by day instead dropped it, and the rebuild
 * disagreed with the service it was supposed to be repairing — a second
 * definition introduced by the tool meant to remove one.
 *
 *   npm run db:rebuild-market-snapshots            report what would change
 *   npm run db:rebuild-market-snapshots -- --apply write it
 *
 * Dry by default, because a maintenance script that acts on an unflagged run
 * is one typo away from doing it in production.
 */

const asDate = (v: string | Date): string =>
  typeof v === "string" ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10);

async function main() {
  const apply = process.argv.includes("--apply");
  const conn = await createDb();

  try {
    console.log(`· driver ${conn.driver}${apply ? "" : "  (DRY RUN — pass --apply to write)"}`);
    const repo = new MarketRepository(conn.db);

    /**
     * Every (product, day) that has either a captured observation or an
     * existing aggregate. The second half matters: a rule change can leave a
     * stored row that the new rule would not produce at all, and it has to be
     * visited to be reported.
     */
    const pairs = await conn.query<{ product_id: string; day: string }>(`
      select distinct l.product_id, po.observed_at as day
        from price_observations po
        join offers o   on o.id = po.offer_id
        join listings l on l.id = o.listing_id
       where l.origin <> 'seed' and o.offer_status = 'active'
      union
      select product_id, captured_on as day from product_market_snapshots
      order by product_id, day
    `);

    const existing = await conn.query<{
      product_id: string;
      captured_on: string;
      seller_count: number;
      median_minor: number;
      catalog_ids_used: number;
      provider_calls: number;
    }>(`select product_id, captured_on, seller_count, median_minor, catalog_ids_used, provider_calls
          from product_market_snapshots`);
    const before = new Map(existing.map((r) => [`${r.product_id}|${asDate(r.captured_on)}`, r]));

    let differ = 0;
    let agree = 0;
    let written = 0;
    let orphaned = 0;
    const notes: string[] = [];

    for (const { product_id: productId, day: rawDay } of pairs) {
      const day = asDate(rawDay);
      const key = `${productId}|${day}`;
      const old = before.get(key);

      // The service's own definition of this product's market on that day.
      const offers = await repo.currentMarket(productId, day);
      const segmented = segmentByCondition(offers);
      const dist = distribution(segmented?.primary ?? []);

      if (!dist) {
        if (old) {
          orphaned++;
          notes.push(`  ${productId} ${day}: stored row has no observations behind it any more — left alone`);
        }
        continue;
      }

      const differs = !old || Number(old.seller_count) !== dist.sellerCount || Number(old.median_minor) !== dist.medianMinor;
      if (!differs) {
        agree++;
        continue;
      }

      differ++;
      notes.push(
        `  ${productId} ${day}: ` +
          (old
            ? `${old.seller_count} sellers @ ${old.median_minor} → ${dist.sellerCount} @ ${dist.medianMinor}`
            : `new row — ${dist.sellerCount} @ ${dist.medianMinor}`)
      );

      if (!apply) continue;

      const cheapest = [...(segmented?.primary ?? [])].sort((a, b) => a.priceMinor - b.priceMinor)[0];
      await repo.writeRebuiltSnapshot({
        productId,
        capturedOn: day,
        distribution: dist,
        cheapestSellerId: cheapest?.sellerId ?? null,
        /**
         * Preserved, not recomputed. These record what a past capture SPENT;
         * recomputing the distribution does not change what it cost, and
         * inventing a figure here would make the cost record fiction.
         */
        catalogIdsUsed: old ? Number(old.catalog_ids_used) : 1,
        providerCalls: old ? Number(old.provider_calls) : 0,
      });
      written++;
    }

    for (const note of notes.slice(0, 40)) console.log(note);
    if (notes.length > 40) console.log(`  … and ${notes.length - 40} more`);

    console.log(
      `· ${differ} aggregate(s) differ from what is stored; ${agree} already agree` +
        (orphaned ? `; ${orphaned} stored row(s) have no observations left` : "") +
        (apply ? `; ${written} rewritten` : "; nothing written")
    );

    /**
     * An aggregate that disagrees with its own observations is the defect
     * this script exists to remove, so a successful apply must leave none.
     */
    if (apply && differ !== written) {
      throw new Error(`${differ} rows needed rewriting but ${written} were written — refusing to report success.`);
    }
  } finally {
    await conn.close();
  }
}

main().catch((error) => {
  console.error("rebuild failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
