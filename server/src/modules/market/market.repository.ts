import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  listings,
  marketplaces,
  offers,
  priceObservations,
  productCatalogIds,
  productMarketSnapshots,
  products,
  sellers,
} from "../../db/schema.js";
import type { MarketSellerOffer, ProductMarket } from "../../ingestion/types.js";
import { PARSER_VERSION } from "../../ingestion/ingestion.service.js";
import { normalizeQuery } from "../../ingestion/queryKey.js";
import {
  distribution,
  segmentByCondition,
  type CompetitorOffer,
  type MarketTrendPoint,
  type PriceDistribution,
} from "./competition.js";

/**
 * PERSISTING A COMPETITIVE MARKET
 * ===============================
 *
 * Turns one or more catalogue-id responses into the entity graph the rest of
 * the application already reads:
 *
 *   store      → marketplaces   (one row per commerce destination)
 *   merchant   → sellers        (keyed on the provider's merchant id)
 *   product×store → listings
 *   listing×seller×condition → offers
 *   offer×day  → price_observations      ← the per-seller history
 *   product×day → product_market_snapshots ← the competitive history
 *
 * Two things here are different from what came before, and both are the point.
 *
 * MANY SELLERS, NOT ONE. The previous writer took the single result a user
 * clicked and recorded that. Here every seller returned for every catalogue
 * id in the product's cluster is written, deduplicated by merchant id. Ten
 * rows where there was one.
 *
 * SELLERS HAVE IDENTITY. Sellers were previously keyed as "storefront", one
 * per store, so a price series could not be attributed to a merchant. They are
 * now keyed on the provider's merchant id, which the live data shows is stable
 * across catalogue ids. Rows written under the old key are ADOPTED rather than
 * duplicated the first time a merchant id is seen for them, so the series they
 * already carry stays continuous instead of being orphaned beside a new row.
 */

/** Stable id from stable inputs, so re-running a capture does not duplicate. */
function derivedId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha1").update(parts.join("\u0000")).digest("hex").slice(0, 24);
  return `${prefix}_${digest}`;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

/** The provider's words for condition, in this schema's vocabulary. */
function conditionOf(offer: MarketSellerOffer): "new" | "renewed" | "used" {
  return offer.condition === "refurbished" ? "renewed" : offer.condition === "used" ? "used" : "new";
}

/** How often a product's market is re-captured once somebody follows it. */
const DEFAULT_INTERVAL_HOURS = 24;

export type PersistedMarket = {
  productId: string;
  sellersWritten: number;
  observationsWritten: number;
  marketplacesWritten: number;
  snapshotWritten: boolean;
};

export class MarketRepository {
  constructor(private readonly db: Db) {}

  /* ===================================================== product identity */

  /**
   * The canonical product for a catalogue id.
   *
   * IDENTITY IS THE PROVIDER'S CATALOGUE ID, not the title. That is the
   * change: a title is a string many stores write differently, while the
   * catalogue id is the thing the provider will accept back when asked for
   * this product's sellers. Keying on it means "the market for this product"
   * is a question with an answer.
   *
   * A product stored before this existed is matched on its normalised title
   * and ADOPTS the catalogue id. Existing tracked products therefore gain a
   * market on their next capture instead of being shadowed by a new row.
   */
  async resolveOrCreateProduct(input: {
    market: ProductMarket;
    searchQuery: string;
  }): Promise<{ id: string; canonicalName: string; created: boolean }> {
    const { market } = input;
    const title = market.title || input.searchQuery;
    const key = normalizeQuery(title);

    const byExternal = (await this.db.execute(
      sql`select id, canonical_name from products where external_product_id = ${market.externalProductId} limit 1`
    )) as unknown as { rows: { id: string; canonical_name: string }[] };
    if (byExternal.rows[0]) {
      await this.db.execute(
        sql`update products set canonical_query = coalesce(canonical_query, ${key}) where id = ${byExternal.rows[0].id}`
      );
      return { id: byExternal.rows[0].id, canonicalName: byExternal.rows[0].canonical_name, created: false };
    }

    const byTitle = (await this.db.execute(
      sql`select id, canonical_name from products
           where canonical_query = ${key} and external_product_id is null limit 1`
    )) as unknown as { rows: { id: string; canonical_name: string }[] };
    if (byTitle.rows[0]) {
      await this.db.execute(
        sql`update products set external_product_id = ${market.externalProductId} where id = ${byTitle.rows[0].id}`
      );
      return { id: byTitle.rows[0].id, canonicalName: byTitle.rows[0].canonical_name, created: false };
    }

    const id = derivedId("prod_live", market.provider, market.externalProductId);
    await this.db
      .insert(products)
      .values({
        id,
        canonicalName: title,
        modelName: title,
        /**
         * No brand, category or product type from a marketplace title — the
         * same rule as before. The provider DOES supply a brand string and
         * structured attributes, and those are kept in `specifications`,
         * which is evidence rather than taxonomy. Promoting a brand string to
         * a `brands` row would invent an entity from one response.
         */
        brandId: null,
        categoryId: null,
        productTypeId: null,
        specifications: Object.fromEntries([
          ...(market.brand ? [["brand", market.brand] as const] : []),
          ...market.attributes.map((a) => [a.name, a.value] as const),
        ]),
        lifecycleStatus: "active",
        origin: "live",
        externalProductId: market.externalProductId,
        canonicalQuery: key,
        captureIntervalHours: DEFAULT_INTERVAL_HOURS,
        lastCapturedAt: new Date(),
        trackerCount: 0,
        lastInterestAt: new Date(),
      })
      .onConflictDoNothing();

    // Re-read: `onConflictDoNothing` is silent about which constraint it hit.
    const [row] = await this.db.select({ id: products.id, canonicalName: products.canonicalName }).from(products).where(eq(products.id, id)).limit(1);
    if (!row) {
      const fallback = (await this.db.execute(
        sql`select id, canonical_name from products where external_product_id = ${market.externalProductId} limit 1`
      )) as unknown as { rows: { id: string; canonical_name: string }[] };
      if (!fallback.rows[0]) throw new Error(`Product for catalogue id ${market.externalProductId} could not be created or found.`);
      return { id: fallback.rows[0].id, canonicalName: fallback.rows[0].canonical_name, created: false };
    }
    return { id: row.id, canonicalName: row.canonicalName, created: true };
  }

  /**
   * Record which catalogue ids are believed to be this product.
   *
   * Written whether or not the id was opened, because a cluster the system
   * declined to spend a call on is still part of the record of what it
   * believed. `sellerCount` is updated only when an id was actually fetched,
   * so a null there means "not yet opened" rather than "no sellers".
   */
  async recordCatalogIds(
    productId: string,
    provider: string,
    entries: Array<{ externalProductId: string; title: string | null; isPrimary: boolean; confidence: number; sellerCount?: number | null }>
  ): Promise<void> {
    for (const entry of entries) {
      const id = derivedId("pcid", provider, entry.externalProductId);
      await this.db
        .insert(productCatalogIds)
        .values({
          id,
          productId,
          provider,
          externalProductId: entry.externalProductId,
          title: entry.title,
          isPrimary: entry.isPrimary,
          matchConfidence: entry.confidence,
          sellerCount: entry.sellerCount ?? null,
          lastFetchedAt: entry.sellerCount == null ? null : new Date(),
        })
        /**
         * On a re-capture the confidence and yield are refreshed but the
         * product is NOT reassigned. If a catalogue id is already filed under
         * a different product, that is a clustering disagreement worth
         * leaving visible rather than silently resolving in favour of
         * whichever capture ran last.
         */
        .onConflictDoUpdate({
          target: [productCatalogIds.provider, productCatalogIds.externalProductId],
          set: {
            title: entry.title,
            matchConfidence: entry.confidence,
            ...(entry.sellerCount == null ? {} : { sellerCount: entry.sellerCount, lastFetchedAt: new Date() }),
          },
        });
    }
  }

  /**
   * The product a catalogue id already belongs to, with the state of its
   * stored market.
   *
   * The lookup that makes shared capture possible. Fifty people following one
   * product must cost one capture, not fifty, and the only way to know that
   * the fiftieth does not need a call is to ask — before spending it — whether
   * this catalogue id is already a product whose market was read recently.
   */
  async productByExternalId(provider: string, externalProductId: string) {
    const rows = (await this.db.execute(sql`
      select p.id,
             p.canonical_name,
             p.canonical_query,
             p.last_captured_at,
             (select count(*)::int from product_catalog_ids pc
               where pc.product_id = p.id and pc.provider = ${provider}) as catalog_id_count,
             s.seller_count,
             s.marketplace_count,
             s.captured_on
        from products p
        left join product_catalog_ids pci
               on pci.product_id = p.id
              and pci.provider = ${provider}
              and pci.external_product_id = ${externalProductId}
        left join lateral (
               select seller_count, marketplace_count, captured_on
                 from product_market_snapshots
                where product_id = p.id
                order by captured_on desc
                limit 1
             ) s on true
       where p.external_product_id = ${externalProductId} or pci.id is not null
       limit 1
    `)) as unknown as {
      rows: Array<{
        id: string;
        canonical_name: string;
        canonical_query: string | null;
        last_captured_at: string | Date | null;
        catalog_id_count: number;
        seller_count: number | null;
        marketplace_count: number | null;
        captured_on: string | null;
      }>;
    };
    return rows.rows[0] ?? null;
  }

  /** The catalogue ids to re-open when refreshing this product's market. */
  async catalogIdsFor(productId: string, provider: string, limit: number): Promise<string[]> {
    const rows = (await this.db.execute(
      sql`select external_product_id, is_primary, seller_count, match_confidence
            from product_catalog_ids
           where product_id = ${productId} and provider = ${provider}
           order by is_primary desc,
                    /* ids that yielded sellers before are worth re-opening;
                       ones that yielded none are tried last, not never --
                       a store list can refill. */
                    coalesce(seller_count, 1) desc,
                    coalesce(match_confidence, 0) desc
           limit ${limit}`
    )) as unknown as { rows: { external_product_id: string }[] };
    return rows.rows.map((r) => r.external_product_id);
  }

  /* ==================================================== writing the market */

  /**
   * Write every seller of every catalogue id as a real, timestamped
   * observation, then record the day's competitive picture.
   *
   * Deduplicated by merchant id ACROSS catalogue ids, because the same store
   * appears under several of them — the live data shows one merchant id
   * recurring across two ids, and writing it twice would both double-count
   * the competition and violate the one-listing-per-product-per-store
   * invariant the cross-marketplace comparison rests on.
   */
  async persistMarket(input: {
    productId: string;
    markets: ProductMarket[];
    providerCalls: number;
    observedAt?: Date;
  }): Promise<PersistedMarket> {
    const observedAt = input.observedAt ?? new Date();
    const observedOn = observedAt.toISOString().slice(0, 10);

    /** merchant key → the best offer seen for it across the cluster. */
    const bySeller = new Map<string, { offer: MarketSellerOffer; provider: string }>();
    for (const market of input.markets) {
      for (const seller of market.sellers) {
        if (seller.priceMinor == null || seller.priceMinor <= 0) continue;
        const key = seller.sellerExternalId ?? `name:${slugify(seller.sellerName)}`;
        const existing = bySeller.get(key);
        /**
         * When one store appears under two catalogue ids at two prices, keep
         * the LOWER. It is the price that store is actually offering the
         * product at; the higher one is a stale or worse-configured listing of
         * the same thing, and taking it would overstate the market floor.
         */
        if (!existing || seller.priceMinor < existing.offer.priceMinor!) {
          bySeller.set(key, { offer: seller, provider: market.provider });
        }
      }
    }

    const marketplaceIds = new Set<string>();
    let observationsWritten = 0;
    /** sellerId → the price written, for the day's aggregate. */
    const written: Array<{ sellerId: string; priceMinor: number }> = [];

    for (const [, { offer } ] of bySeller) {
      const marketplaceId = await this.resolveMarketplace(offer.sellerName, offer.currency);
      marketplaceIds.add(marketplaceId);

      const sellerId = await this.resolveSeller(marketplaceId, offer.sellerExternalId, offer.sellerName);
      const listingId = await this.resolveListing({
        productId: input.productId,
        marketplaceId,
        url: offer.url,
        rawTitle: offer.listingTitle ?? offer.sellerName,
      });
      const offerId = await this.resolveOffer(listingId, sellerId, conditionOf(offer));

      const inserted = await this.db
        .insert(priceObservations)
        .values({
          id: derivedId("obs", offerId, observedOn),
          offerId,
          observedAt: observedOn,
          recordedAt: observedAt,
          mrpMinor: null,
          sellingPriceMinor: offer.priceMinor!,
          /**
           * Zero only when the provider SAID free. An unstated shipping cost
           * is recorded as zero in this column because it is `not null` in the
           * schema, and the fact that it was unstated survives in the
           * delivery note on the listing rather than being asserted here.
           */
          shippingFeeMinor: offer.shippingMinor ?? 0,
          currencyCode: offer.currency,
          /**
           * The provider often does not report stock. Treated as buyable
           * because it was returned as a purchasable offer; where it DID say
           * out of stock, that is recorded.
           */
          isInStock: offer.inStock ?? true,
          isBuyboxWinner: false,
          parserVersion: PARSER_VERSION,
        })
        .onConflictDoNothing({ target: [priceObservations.offerId, priceObservations.observedAt] })
        .returning({ id: priceObservations.id });

      if (inserted.length > 0) observationsWritten++;
      written.push({ sellerId, priceMinor: offer.priceMinor! });
    }

    /** Mark the cheapest in-stock offer on each listing for the day. */
    await this.markBuyboxWinners(input.productId, observedOn);

    const snapshotWritten = await this.writeMarketSnapshot({
      productId: input.productId,
      observedAt,
      observedOn,
      catalogIdsUsed: input.markets.length,
      providerCalls: input.providerCalls,
      /**
       * The currency the sellers quoted, not a configured default. The live
       * data returns a dollar range for some Indian catalogue ids, so
       * assuming the market currency would mislabel those figures.
       */
      currency: [...bySeller.values()][0]?.offer.currency ?? "INR",
    });

    await this.db.execute(
      sql`update products set last_captured_at = ${observedAt.toISOString()} where id = ${input.productId}`
    );

    return {
      productId: input.productId,
      sellersWritten: written.length,
      observationsWritten,
      marketplacesWritten: marketplaceIds.size,
      snapshotWritten,
    };
  }

  /**
   * The day's competitive picture, computed from what was just stored.
   *
   * Computed by re-reading rather than from the in-memory offers on purpose:
   * the aggregate then describes exactly what the database holds, including
   * sellers written by an earlier capture today that this one did not return.
   * An aggregate that disagreed with its own underlying rows would be the
   * worst kind of wrong.
   */
  private async writeMarketSnapshot(input: {
    productId: string;
    observedAt: Date;
    observedOn: string;
    catalogIdsUsed: number;
    providerCalls: number;
    currency: string;
  }): Promise<boolean> {
    const allOffers = await this.currentMarket(input.productId, input.observedOn);

    /**
     * SEGMENTED THE SAME WAY THE ANALYSIS READS IT.
     *
     * This is the aggregate the trend line is drawn from, so it has to
     * describe the same population as the current figures beside it. Written
     * over every condition pooled, it did not: a product's market screen
     * showed 5 new sellers at a median of 1,39,400 above a history line
     * claiming 7 sellers at 1,14,999 — the second silently including a
     * refurbished unit and a used one. Two numbers for one market, neither
     * wrong on its own terms, and no way for a reader to tell which they had.
     */
    const segmented = segmentByCondition(allOffers);
    const offers = segmented?.primary ?? [];
    const dist = distribution(offers);
    if (!dist) return false;

    const cheapest = [...offers].sort((a, b) => a.priceMinor - b.priceMinor)[0];

    await this.db
      .insert(productMarketSnapshots)
      .values({
        id: derivedId("pms", input.productId, input.observedOn),
        productId: input.productId,
        capturedOn: input.observedOn,
        recordedAt: input.observedAt,
        sellerCount: dist.sellerCount,
        marketplaceCount: dist.marketplaceCount,
        inStockCount: dist.inStockCount,
        lowMinor: dist.lowMinor,
        p25Minor: dist.p25Minor,
        medianMinor: dist.medianMinor,
        p75Minor: dist.p75Minor,
        highMinor: dist.highMinor,
        currencyCode: input.currency,
        cheapestSellerId: cheapest?.sellerId ?? null,
        catalogIdsUsed: input.catalogIdsUsed,
        providerCalls: input.providerCalls,
      })
      /**
       * Revised, not appended. This is an aggregate OF a day, so a second
       * capture the same day produces a better one — unlike an observation,
       * which is a fact about a moment and is never overwritten.
       */
      .onConflictDoUpdate({
        target: [productMarketSnapshots.productId, productMarketSnapshots.capturedOn],
        set: {
          recordedAt: input.observedAt,
          sellerCount: dist.sellerCount,
          marketplaceCount: dist.marketplaceCount,
          inStockCount: dist.inStockCount,
          lowMinor: dist.lowMinor,
          p25Minor: dist.p25Minor,
          medianMinor: dist.medianMinor,
          p75Minor: dist.p75Minor,
          highMinor: dist.highMinor,
          cheapestSellerId: cheapest?.sellerId ?? null,
          catalogIdsUsed: input.catalogIdsUsed,
          providerCalls: input.providerCalls,
        },
      });

    return true;
  }

  /**
   * Rewrite one day's aggregate from a recomputed distribution.
   *
   * For the maintenance script that repairs the series after the aggregation
   * rule changes — see `scripts/rebuild-market-snapshots.ts`. It lives here,
   * beside the writer the live path uses, so both go through this file and
   * there is one place that knows the table's shape.
   *
   * `catalogIdsUsed` and `providerCalls` are passed in rather than derived:
   * they record what a past capture SPENT, and recomputing a distribution
   * does not change that.
   */
  async writeRebuiltSnapshot(input: {
    productId: string;
    capturedOn: string;
    distribution: PriceDistribution;
    cheapestSellerId: string | null;
    catalogIdsUsed: number;
    providerCalls: number;
  }): Promise<void> {
    const d = input.distribution;
    await this.db
      .insert(productMarketSnapshots)
      .values({
        id: derivedId("pms", input.productId, input.capturedOn),
        productId: input.productId,
        capturedOn: input.capturedOn,
        recordedAt: new Date(),
        sellerCount: d.sellerCount,
        marketplaceCount: d.marketplaceCount,
        inStockCount: d.inStockCount,
        lowMinor: d.lowMinor,
        p25Minor: d.p25Minor,
        medianMinor: d.medianMinor,
        p75Minor: d.p75Minor,
        highMinor: d.highMinor,
        cheapestSellerId: input.cheapestSellerId,
        catalogIdsUsed: input.catalogIdsUsed,
        providerCalls: input.providerCalls,
      })
      .onConflictDoUpdate({
        target: [productMarketSnapshots.productId, productMarketSnapshots.capturedOn],
        set: {
          recordedAt: new Date(),
          sellerCount: d.sellerCount,
          marketplaceCount: d.marketplaceCount,
          inStockCount: d.inStockCount,
          lowMinor: d.lowMinor,
          p25Minor: d.p25Minor,
          medianMinor: d.medianMinor,
          p75Minor: d.p75Minor,
          highMinor: d.highMinor,
          cheapestSellerId: input.cheapestSellerId,
        },
      });
  }

  /**
   * Cheapest in-stock landed price per listing per day, computed from the
   * data rather than hand-assigned — the column's own stated contract.
   */
  private async markBuyboxWinners(productId: string, observedOn: string): Promise<void> {
    await this.db.execute(sql`
      with day_rows as (
        select po.id,
               l.id as listing_id,
               po.selling_price_minor + po.shipping_fee_minor as landed,
               po.is_in_stock
          from price_observations po
          join offers o   on o.id = po.offer_id
          join listings l on l.id = o.listing_id
         where l.product_id = ${productId} and po.observed_at = ${observedOn}
      ),
      winners as (
        select distinct on (listing_id) id
          from day_rows
         where is_in_stock
         order by listing_id, landed asc, id asc
      )
      update price_observations po
         set is_buybox_winner = (po.id in (select id from winners))
       where po.id in (select id from day_rows)
    `);
  }

  /* ==================================================== reading the market */

  /**
   * The product's competition as of a given day, one row per seller.
   *
   * Takes the LATEST observation at or before the day for each offer, so a
   * seller that was not in today's response still counts at the price it was
   * last seen at — within a staleness bound, below. Dropping it instead would
   * make the market shrink and grow with the provider's own flakiness.
   */
  async currentMarket(productId: string, onDate?: string, maxStaleDays = 7): Promise<CompetitorOffer[]> {
    const asOf = onDate ?? new Date().toISOString().slice(0, 10);
    const rows = (await this.db.execute(sql`
      select distinct on (o.id)
             s.id            as seller_id,
             s.name          as seller_name,
             m.id            as marketplace_id,
             m.name          as marketplace_name,
             po.selling_price_minor,
             po.shipping_fee_minor,
             po.is_in_stock,
             po.observed_at,
             o.item_condition,
             l.listing_url,
             (select rating from seller_rating_snapshots srs
               where srs.seller_id = s.id order by srs.captured_at desc limit 1) as rating,
             (select rating_count from seller_rating_snapshots srs
               where srs.seller_id = s.id order by srs.captured_at desc limit 1) as rating_count
        from price_observations po
        join offers o       on o.id = po.offer_id
        join listings l     on l.id = o.listing_id
        join sellers s      on s.id = o.seller_id
        join marketplaces m on m.id = l.marketplace_id
       where l.product_id = ${productId}
         and po.observed_at <= ${asOf}
         and po.observed_at >= (${asOf}::date - ${maxStaleDays}::int)
         and o.offer_status = 'active'
         /*
          * CAPTURED LISTINGS ONLY.
          *
          * The seeded dataset is synthetic, and this is the market a price
          * gets argued from. A seeded listing admitted here would be a
          * made-up competitor presented as a real one — the single failure
          * this whole pipeline exists to prevent — and it would be
          * indistinguishable downstream, because the row is well-formed.
          *
          * So the filter is on provenance rather than on plausibility. A
          * seeded product therefore has no competitive market at all, which
          * is the correct answer: nothing real is known about it.
          */
         and l.origin <> 'seed'
       order by o.id, po.observed_at desc
    `)) as unknown as {
      rows: Array<{
        seller_id: string;
        seller_name: string;
        marketplace_id: string;
        marketplace_name: string;
        selling_price_minor: number;
        shipping_fee_minor: number;
        is_in_stock: boolean;
        item_condition: "new" | "renewed" | "used";
        listing_url: string | null;
        rating: number | null;
        rating_count: number | null;
      }>;
    };

    return rows.rows.map((r) => ({
      sellerId: r.seller_id,
      sellerName: r.seller_name,
      marketplaceId: r.marketplace_id,
      marketplaceName: r.marketplace_name,
      priceMinor: Number(r.selling_price_minor),
      landedMinor: Number(r.selling_price_minor) + Number(r.shipping_fee_minor),
      shippingMinor: Number(r.shipping_fee_minor),
      inStock: Boolean(r.is_in_stock),
      rating: r.rating == null ? null : Number(r.rating),
      reviewCount: r.rating_count == null ? null : Number(r.rating_count),
      url: r.listing_url,
      condition: r.item_condition,
    }));
  }

  /** The product's own captured competitive history. Never backfilled. */
  async marketTrendPoints(productId: string, days = 90): Promise<MarketTrendPoint[]> {
    const rows = (await this.db.execute(sql`
      select captured_on, median_minor, seller_count
        from product_market_snapshots
       where product_id = ${productId}
         and captured_on >= (current_date - ${days}::int)
       order by captured_on asc
    `)) as unknown as { rows: Array<{ captured_on: string; median_minor: number; seller_count: number }> };

    return rows.rows.map((r) => ({
      capturedOn: typeof r.captured_on === "string" ? r.captured_on.slice(0, 10) : new Date(r.captured_on).toISOString().slice(0, 10),
      medianMinor: Number(r.median_minor),
      sellerCount: Number(r.seller_count),
    }));
  }

  /** Per-seller price series, for showing who moved rather than that prices moved. */
  async sellerSeries(productId: string, days = 90) {
    const rows = (await this.db.execute(sql`
      select s.id as seller_id, s.name as seller_name, po.observed_at, po.selling_price_minor
        from price_observations po
        join offers o   on o.id = po.offer_id
        join listings l on l.id = o.listing_id
        join sellers s  on s.id = o.seller_id
       where l.product_id = ${productId}
         and po.observed_at >= (current_date - ${days}::int)
       order by s.name asc, po.observed_at asc
    `)) as unknown as {
      rows: Array<{ seller_id: string; seller_name: string; observed_at: string; selling_price_minor: number }>;
    };

    const bySeller = new Map<string, { sellerId: string; sellerName: string; points: Array<{ date: string; minor: number }> }>();
    for (const r of rows.rows) {
      const entry = bySeller.get(r.seller_id) ?? { sellerId: r.seller_id, sellerName: r.seller_name, points: [] };
      entry.points.push({
        date: typeof r.observed_at === "string" ? r.observed_at.slice(0, 10) : new Date(r.observed_at).toISOString().slice(0, 10),
        minor: Number(r.selling_price_minor),
      });
      bySeller.set(r.seller_id, entry);
    }
    return [...bySeller.values()];
  }

  async productById(productId: string) {
    const rows = (await this.db.execute(sql`
      select id, canonical_name, external_product_id, canonical_query, origin, specifications,
             tracker_count, last_captured_at, capture_interval_hours
        from products where id = ${productId} limit 1
    `)) as unknown as {
      rows: Array<{
        id: string;
        canonical_name: string;
        external_product_id: string | null;
        canonical_query: string | null;
        origin: "seed" | "live" | "manual";
        specifications: Record<string, unknown> | null;
        tracker_count: number;
        last_captured_at: string | Date | null;
        capture_interval_hours: number | null;
      }>;
    };
    return rows.rows[0] ?? null;
  }

  /* ------------------------------------------------- the graph beneath it */

  /**
   * A store, as a commerce destination in its own right.
   *
   * The store IS the marketplace dimension for this data, and that is the
   * honest mapping rather than a convenient one: "where can a buyer buy this,
   * and at what price" is the question the cross-marketplace comparison
   * exists to answer, and Amazon, Flipkart, Croma and an independent retailer
   * are all answers to it. Recorded as discovered, with no display order, so
   * none of them is ranked against the curated platforms this system was
   * built around.
   */
  private async resolveMarketplace(storeName: string, currency: string): Promise<string> {
    const slug = slugify(storeName) || "unknown-store";
    const id = `mp_live_${slug}`.slice(0, 64);
    await this.db
      .insert(marketplaces)
      .values({
        id,
        name: storeName,
        countryCode: "IN",
        defaultCurrency: currency,
        websiteDomain: slug,
        isActive: true,
        marketplaceType: "unclassified",
        isDiscovered: true,
        displayOrder: null,
        categoryAffinity: [],
      })
      .onConflictDoNothing();
    return id;
  }

  /**
   * A merchant, keyed on the provider's merchant id.
   *
   * The adoption path matters. Rows written before merchant ids were captured
   * carry the placeholder key `storefront`; when a merchant id first arrives
   * for such a store, the existing row is UPDATED to it rather than a second
   * row inserted. Inserting would split that store's price history in two —
   * the old series stranded on a row nothing writes to again, the new one
   * starting from zero — which is exactly the kind of silent discontinuity a
   * trend line cannot survive.
   */
  private async resolveSeller(marketplaceId: string, merchantId: string | null, name: string): Promise<string> {
    const externalId = merchantId ?? "storefront";

    const [exact] = await this.db
      .select({ id: sellers.id })
      .from(sellers)
      .where(and(eq(sellers.marketplaceId, marketplaceId), eq(sellers.externalSellerId, externalId)))
      .limit(1);
    if (exact) return exact.id;

    if (merchantId) {
      const [legacy] = await this.db
        .select({ id: sellers.id })
        .from(sellers)
        .where(and(eq(sellers.marketplaceId, marketplaceId), eq(sellers.externalSellerId, "storefront")))
        .limit(1);
      if (legacy) {
        await this.db
          .update(sellers)
          .set({ externalSellerId: merchantId, name })
          .where(eq(sellers.id, legacy.id));
        return legacy.id;
      }
    }

    const id = derivedId("slr_live", marketplaceId, externalId);
    await this.db
      .insert(sellers)
      .values({
        id,
        marketplaceId,
        externalSellerId: externalId,
        name,
        origin: "live",
        /**
         * The provider does not say whether a store sells its own stock or
         * hosts others. `marketplace_owned` is the literal truth for a
         * storefront returned under its own name, which is every row here.
         */
        sellerType: "marketplace_owned",
        defaultFulfilmentType: "self_ship",
      })
      .onConflictDoNothing();

    const [row] = await this.db
      .select({ id: sellers.id })
      .from(sellers)
      .where(and(eq(sellers.marketplaceId, marketplaceId), eq(sellers.externalSellerId, externalId)))
      .limit(1);
    if (!row) throw new Error(`Seller ${externalId} on ${marketplaceId} could not be created or found.`);
    return row.id;
  }

  private async resolveListing(input: {
    productId: string;
    marketplaceId: string;
    url: string | null;
    rawTitle: string;
  }): Promise<string> {
    const [existing] = await this.db
      .select({ id: listings.id })
      .from(listings)
      .where(and(eq(listings.productId, input.productId), eq(listings.marketplaceId, input.marketplaceId)))
      .limit(1);
    if (existing) return existing.id;

    const id = derivedId("lst_live", input.productId, input.marketplaceId);
    await this.db
      .insert(listings)
      .values({
        id,
        productId: input.productId,
        marketplaceId: input.marketplaceId,
        /**
         * Derived from the product AS WELL AS the store: `listings` carries
         * two unique constraints, and keying this on the store and URL alone
         * collided on the second as soon as a different product appeared at
         * the same store.
         */
        externalListingId: derivedId("ext", input.productId, input.marketplaceId),
        listingUrl: input.url,
        rawTitle: input.rawTitle,
        origin: "live",
        /**
         * Matched by the provider's own catalogue, not by this system's
         * fuzzy matcher and not by a user's click: the store was returned as
         * a seller OF this catalogue id. That is a stronger and more specific
         * claim than a title match, so it is recorded as automatic rather
         * than human-confirmed, with the confidence of the clustering.
         */
        matchStatus: "auto_matched",
        matchConfidence: 1,
        listingStatus: "active",
      })
      .onConflictDoNothing();

    const [row] = await this.db
      .select({ id: listings.id })
      .from(listings)
      .where(and(eq(listings.productId, input.productId), eq(listings.marketplaceId, input.marketplaceId)))
      .limit(1);
    if (!row) {
      throw new Error(
        `Listing for ${input.productId} on ${input.marketplaceId} could not be created or found — a unique constraint was hit and nothing matched afterwards.`
      );
    }
    return row.id;
  }

  private async resolveOffer(listingId: string, sellerId: string, condition: "new" | "renewed" | "used"): Promise<string> {
    const id = derivedId("ofr_live", listingId, sellerId, condition);
    await this.db
      .insert(offers)
      .values({ id, listingId, sellerId, itemCondition: condition, offerStatus: "active" })
      .onConflictDoNothing();

    const [row] = await this.db
      .select({ id: offers.id })
      .from(offers)
      .where(and(eq(offers.listingId, listingId), eq(offers.sellerId, sellerId), eq(offers.itemCondition, condition)))
      .limit(1);
    if (!row) throw new Error(`Offer on ${listingId} for ${sellerId} could not be created or found.`);
    return row.id;
  }
}
