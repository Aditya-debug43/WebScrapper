import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { listings, marketplaces, offers, priceObservations, products, sellers, trackedProducts } from "../../db/schema.js";
import type { SnapshotOffer } from "../../ingestion/snapshot.service.js";
import { PARSER_VERSION } from "../../ingestion/ingestion.service.js";
import { normalizeQuery } from "../../ingestion/queryKey.js";

/**
 * Writes for live discovery and tracking.
 *
 * Everything created here is marked `origin: "live"`, which is what makes the
 * synthetic-data cleanup possible: the database currently mixes seeded rows
 * with genuinely captured ones and nothing distinguished them, so a seeded
 * product carrying real observations looked identical to a real one.
 */

/** Stable id from stable inputs, so re-running a capture does not duplicate rows. */
function derivedId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha1").update(parts.join("\u0000")).digest("hex").slice(0, 24);
  return `${prefix}_${digest}`;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

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

  /**
   * The canonical product for a selected result — reused if we already hold
   * it, created if not.
   *
   * Identity is the normalised title. Deliberately conservative: it collapses
   * formatting only, so "iPhone 15 128GB" and "iPhone 15 256GB" stay separate
   * products. Merging them would be the capacity-confusion bug this project
   * has already fixed once in the matcher.
   */
  /**
   * `canonicalQuery` here is the REFRESH query, and it is the product's own
   * title rather than whatever the user typed to find it.
   *
   * Those are different questions and conflating them produces bad data. A
   * search for "iPhone 18" returns base models, Pro, Pro Max and a pile of
   * cases; re-running it to refresh one specific Pro Max would record every
   * one of those as that product's market. The title is the narrower, more
   * precise question, so it is what gets re-asked.
   *
   * What the user typed is kept too — on `tracked_products.search_query` —
   * because it is provenance, not a scheduling input.
   */
  async resolveOrCreateProduct(input: { title: string; searchQuery: string; captureRunId: string }) {
    const key = normalizeQuery(input.title);

    const existing = (await this.db.execute(
      sql`select id, canonical_name from products where canonical_query = ${key} limit 1`
    )) as unknown as { rows: { id: string; canonical_name: string }[] };

    if (existing.rows[0]) {
      return { id: existing.rows[0].id, canonicalName: existing.rows[0].canonical_name, created: false };
    }

    const id = derivedId("prod_live", key);
    await this.db
      .insert(products)
      .values({
        id,
        canonicalName: input.title,
        modelName: input.title,
        /**
         * No brand, category or product type. A marketplace title does not
         * state them, and guessing is the same mistake as guessing a price.
         * Nullable since migration 0009; classification can come later from
         * evidence.
         */
        brandId: null,
        categoryId: null,
        productTypeId: null,
        specifications: {},
        lifecycleStatus: "active",
        origin: "live",
        canonicalQuery: key,
        captureIntervalHours: DEFAULT_INTERVAL_HOURS,
        lastCapturedAt: new Date(),
        trackerCount: 0,
        lastInterestAt: new Date(),
      })
      .onConflictDoNothing();

    return { id, canonicalName: input.title, created: true };
  }

  /**
   * Store one selected offer as a real, timestamped observation.
   *
   * Everything beneath it — marketplace, seller, listing, offer — is resolved
   * or created on the way down, so the row sits in the same entity graph the
   * rest of the application already reads. The user gets a price immediately
   * instead of an empty chart until tomorrow.
   */
  async recordSelectedOffer(input: { productId: string; offer: SnapshotOffer; captureRunId: string }) {
    const { offer } = input;
    const marketplaceId = await this.resolveMarketplace(offer.sourceName);
    const sellerId = await this.resolveSeller(marketplaceId, offer.sourceName);
    const listingId = await this.resolveListing({
      productId: input.productId,
      marketplaceId,
      url: offer.url,
      rawTitle: offer.rawTitle,
    });
    const offerId = await this.resolveOffer(listingId, sellerId);

    const observedOn = offer.observedAt.slice(0, 10);
    await this.db
      .insert(priceObservations)
      .values({
        id: derivedId("obs", offerId, observedOn),
        offerId,
        observedAt: observedOn,
        recordedAt: new Date(),
        mrpMinor: offer.mrpMinor,
        sellingPriceMinor: offer.priceMinor!,
        shippingFeeMinor: offer.shippingFeeMinor ?? 0,
        currencyCode: offer.currency,
        /**
         * The provider does not report stock, so `inStock` is usually null.
         * Treated as buyable because it was returned as a purchasable offer,
         * and recorded as a known gap rather than asserted as observed.
         */
        isInStock: offer.inStock ?? true,
        isBuyboxWinner: false,
        parserVersion: PARSER_VERSION,
      })
      /**
       * One observation per offer per day. A second capture on the same day
       * changes nothing; a capture tomorrow appends. History is never
       * overwritten.
       */
      .onConflictDoNothing({ target: [priceObservations.offerId, priceObservations.observedAt] });

    return { listingId, offerId, marketplaceId };
  }

  /** A store named by the provider, recorded as discovered rather than curated. */
  private async resolveMarketplace(sourceName: string): Promise<string> {
    const slug = slugify(sourceName) || "unknown-store";
    const id = `mp_live_${slug}`.slice(0, 64);
    await this.db
      .insert(marketplaces)
      .values({
        id,
        name: sourceName,
        countryCode: "IN",
        defaultCurrency: "INR",
        websiteDomain: slug,
        isActive: true,
        /**
         * Unclassified, with no display order: a store learned from a
         * provider has no editorial position and must not be ranked against
         * platforms it was never compared with.
         */
        marketplaceType: "unclassified",
        isDiscovered: true,
        displayOrder: null,
        categoryAffinity: [],
      })
      .onConflictDoNothing();
    return id;
  }

  private async resolveSeller(marketplaceId: string, name: string): Promise<string> {
    const id = derivedId("slr_live", marketplaceId);
    await this.db
      .insert(sellers)
      .values({
        id,
        marketplaceId,
        externalSellerId: "storefront",
        name,
        origin: "live",
        sellerType: "marketplace_owned",
        defaultFulfilmentType: "self_ship",
      })
      .onConflictDoNothing();
    return id;
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
         * Derived from the PRODUCT as well as the store.
         *
         * `listings` carries two unique constraints — (product, marketplace)
         * and (marketplace, external_listing_id) — and keying this on the
         * store and URL alone collided on the second one as soon as a
         * different product appeared at the same store with a similar link.
         * The insert was then skipped while this method still returned the
         * id it had meant to write, and the offer that followed pointed at a
         * listing that did not exist.
         */
        externalListingId: derivedId("ext", input.productId, input.marketplaceId, input.url ?? input.rawTitle),
        listingUrl: input.url,
        rawTitle: input.rawTitle,
        origin: "live",
        /**
         * The user chose this result themselves, which is a stronger signal
         * than any automatic matcher produces.
         */
        matchStatus: "human_confirmed",
        matchConfidence: 1,
        listingStatus: "active",
      })
      .onConflictDoNothing();

    /**
     * Re-read rather than trusting the id above.
     *
     * `onConflictDoNothing` is silent about which constraint it hit, so the
     * only safe thing to return is the row that is actually there. Returning
     * an id that was never inserted is how the foreign-key failure above
     * happened in the first place.
     */
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

  private async resolveOffer(listingId: string, sellerId: string): Promise<string> {
    const id = derivedId("ofr_live", listingId, sellerId);
    await this.db
      .insert(offers)
      .values({ id, listingId, sellerId, itemCondition: "new", offerStatus: "active" })
      .onConflictDoNothing();
    return id;
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
   * What this user follows, with the latest real price for each.
   *
   * A product with no observation yet returns nulls rather than a zero — it
   * is waiting for its first capture, which is a different thing from being
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
             coalesce(pv.observation_count, 0) as "observationCount"
        from tracked_products tp
        join products p  on p.id = tp.product_id
        left join latest   lt on lt.product_id = tp.product_id
        left join previous pv on pv.product_id = tp.product_id
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
