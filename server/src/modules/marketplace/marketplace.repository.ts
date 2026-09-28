import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { offsetFor } from "../../lib/pagination.js";
import { LADDER_COLUMNS, LANDED_MINOR, UNIVERSAL_EFFECTIVE_MINOR } from "../../lib/priceLadder.js";

/**
 * Marketplace data reads.
 *
 * Every query is scoped to a product, a listing, an offer or a seller. None
 * of them sweeps the observation table unfiltered — with 354,940 rows in it,
 * an endpoint that could is an endpoint that eventually will.
 *
 * Raw SQL rather than the query builder, deliberately: the price ladder is a
 * correlated aggregate and the window statistics are ordered-set aggregates,
 * and expressing those through a builder would obscure exactly the part that
 * has to be read carefully. Every value still reaches the database as a bound
 * parameter through Drizzle's tagged template — there is no concatenation of
 * client input anywhere in this file, including in ORDER BY, which is
 * resolved from a closed map.
 */

/** `db.execute` returns a driver result; the rows are what callers want. */
async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

async function one<T>(db: Db, query: SQL): Promise<T | null> {
  const [row] = await rows<T>(db, query);
  return row ?? null;
}

/* ------------------------------------------------------------------ types */

export type Page = { page: number; pageSize: number };

export type OfferFilters = Page & {
  marketplaceId?: string;
  sellerId?: string;
  inStock?: boolean;
  fulfilment?: string;
  condition?: string;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  hasPromotion?: boolean;
  sort: OfferSort;
};

export type OfferSort = "effective_price_asc" | "effective_price_desc" | "price_asc" | "price_desc" | "seller_name" | "last_observed";

export type HistoryFilters = Page & {
  marketplaceId?: string;
  sellerId?: string;
  offerId?: string;
  from: string;
  to: string;
};

/**
 * Sort keys are mapped to SQL here and nowhere else.
 *
 * A client sends a key from a closed enum; it never sends a column name and
 * never reaches an ORDER BY. Each entry ends with a tiebreaker so pagination
 * is stable — without one, two rows of equal price can swap between pages and
 * a record is silently seen twice or never.
 */
const OFFER_ORDER: Record<OfferSort, SQL> = {
  effective_price_asc: sql`current_effective_minor asc nulls last, offer_id asc`,
  effective_price_desc: sql`current_effective_minor desc nulls last, offer_id asc`,
  price_asc: sql`current_selling_minor asc nulls last, offer_id asc`,
  price_desc: sql`current_selling_minor desc nulls last, offer_id asc`,
  seller_name: sql`lower(seller_name) asc, offer_id asc`,
  last_observed: sql`last_observed_at desc nulls last, offer_id asc`,
};

export class MarketplaceRepository {
  constructor(private readonly db: Db) {}

  /* -------------------------------------------------------- reference date */

  /**
   * "Today", for this dataset.
   *
   * The most recent capture the data actually holds. Anchoring windows on a
   * wall clock would make every one of them empty, because this dataset ends
   * in the past; anchoring on a constant would break the moment it is
   * regenerated. Cached for the process lifetime — the seeded data does not
   * change under a running server.
   */
  private referenceDateCache: string | null = null;
  async referenceDate(): Promise<string | null> {
    if (this.referenceDateCache) return this.referenceDateCache;
    const row = await one<{ latest: string | null }>(
      this.db,
      sql`select max(observed_at)::text as latest from price_observations`
    );
    this.referenceDateCache = row?.latest ?? null;
    return this.referenceDateCache;
  }

  async productExists(productId: string): Promise<boolean> {
    const row = await one<{ n: number }>(
      this.db,
      sql`select count(*)::int as n from products where id = ${productId}`
    );
    return (row?.n ?? 0) > 0;
  }

  async exists(table: "marketplaces" | "sellers" | "offers" | "listings", id: string): Promise<boolean> {
    const relation = sql.identifier(table);
    const row = await one<{ n: number }>(this.db, sql`select count(*)::int as n from ${relation} where id = ${id}`);
    return (row?.n ?? 0) > 0;
  }

  async knownMarketplaceIds(): Promise<string[]> {
    const found = await rows<{ id: string }>(this.db, sql`select id from marketplaces order by id`);
    return found.map((r) => r.id);
  }

  /* ---------------------------------------------------- marketplace summary */

  /**
   * Where a product is sold, and its state on each platform.
   *
   * One row per marketplace carrying a listing. The schema's
   * `listings_product_marketplace_key` makes that at most one listing each,
   * which is what lets `sourceUrl` be a single unambiguous value rather than
   * a list.
   *
   * "Current" means the latest observation per offer — `distinct on` over the
   * offer, which uses `price_obs_offer_date_idx` directly. Prices are then
   * taken from IN-STOCK offers only: the cheapest thing you cannot buy is not
   * the price of anything.
   */
  async marketplaceSummary(productId: string) {
    return rows<MarketplaceSummaryRow>(
      this.db,
      sql`
      with listing as (
        select l.* from listings l where l.product_id = ${productId}
      ),
      latest as (
        select distinct on (po.offer_id)
               po.offer_id,
               l.marketplace_id,
               o.seller_id,
               po.observed_at,
               po.is_in_stock,
               po.shipping_fee_minor,
               po.mrp_minor,
               po.selling_price_minor,
               ${LANDED_MINOR}              as landed_minor,
               ${UNIVERSAL_EFFECTIVE_MINOR} as effective_minor
          from price_observations po
          join offers   o on o.id = po.offer_id
          join listing  l on l.id = o.listing_id
         order by po.offer_id, po.observed_at desc
      ),
      review as (
        select distinct on (rs.listing_id)
               rs.listing_id, rs.captured_at, rs.average_rating, rs.rating_count, rs.review_count
          from review_snapshots rs
          join listing l on l.id = rs.listing_id
         order by rs.listing_id, rs.captured_at desc
      )
      select
        m.id                                             as "marketplaceId",
        m.name                                           as "marketplaceName",
        m.website_domain                                 as "websiteDomain",
        m.marketplace_type                               as "marketplaceType",
        m.brand_color                                    as "brandColor",
        l.id                                             as "listingId",
        l.listing_url                                    as "sourceUrl",
        l.external_listing_id                            as "externalListingId",
        l.listing_status                                 as "listingStatus",
        l.match_status                                   as "matchStatus",
        l.match_confidence                               as "matchConfidence",
        l.last_seen_at::text                             as "lastSeenAt",
        1                                                as "listingCount",
        (select count(distinct o.seller_id)::int from offers o where o.listing_id = l.id)  as "sellerCount",
        (select count(*)::int                   from offers o where o.listing_id = l.id)  as "offerCount",
        coalesce((select count(*)::int from latest x where x.marketplace_id = m.id), 0)                       as "observedOfferCount",
        coalesce((select count(*)::int from latest x where x.marketplace_id = m.id and x.is_in_stock), 0)     as "inStockOfferCount",
        (select min(x.effective_minor)::int from latest x where x.marketplace_id = m.id and x.is_in_stock)    as "currentEffectiveMinor",
        (select min(x.landed_minor)::int    from latest x where x.marketplace_id = m.id and x.is_in_stock)    as "currentLandedMinor",
        (select min(x.selling_price_minor)::int from latest x where x.marketplace_id = m.id and x.is_in_stock) as "currentSellingMinor",
        (select min(x.shipping_fee_minor)::int  from latest x where x.marketplace_id = m.id and x.is_in_stock) as "minShippingFeeMinor",
        (select max(x.shipping_fee_minor)::int  from latest x where x.marketplace_id = m.id and x.is_in_stock) as "maxShippingFeeMinor",
        (select max(x.mrp_minor)::int       from latest x where x.marketplace_id = m.id)                      as "mrpMinor",
        (select max(x.observed_at)::text    from latest x where x.marketplace_id = m.id)                      as "lastObservedAt",
        r.average_rating                                 as "averageRating",
        r.rating_count                                   as "ratingCount",
        r.review_count                                   as "reviewCount",
        r.captured_at::text                              as "ratingCapturedAt"
      from listing l
      join marketplaces m on m.id = l.marketplace_id
      left join review r on r.listing_id = l.id
      order by lower(m.name) asc`
    );
  }

  /* --------------------------------------------------------------- listings */

  async listListings(productId: string, f: Page & { marketplaceId?: string; status?: string }) {
    const clauses: SQL[] = [sql`l.product_id = ${productId}`];
    if (f.marketplaceId) clauses.push(sql`l.marketplace_id = ${f.marketplaceId}`);
    if (f.status) clauses.push(sql`l.listing_status = ${f.status}`);
    const where = sql.join(clauses, sql` and `);

    const total = await one<{ n: number }>(
      this.db,
      sql`select count(*)::int as n from listings l where ${where}`
    );

    const data = await rows<ListingRow>(
      this.db,
      sql`
      select
        l.id                        as "listingId",
        l.product_id                as "productId",
        l.marketplace_id            as "marketplaceId",
        m.name                      as "marketplaceName",
        m.website_domain            as "websiteDomain",
        l.external_listing_id       as "externalListingId",
        l.listing_url               as "sourceUrl",
        l.raw_title                 as "rawTitle",
        l.marketplace_brand_text    as "marketplaceBrandText",
        l.listing_status            as "listingStatus",
        l.match_status              as "matchStatus",
        l.match_confidence          as "matchConfidence",
        l.first_seen_at::text       as "firstSeenAt",
        l.last_seen_at::text        as "lastSeenAt",
        mc.id                       as "marketplaceCategoryId",
        mc.raw_path                 as "marketplaceCategoryPath",
        mc.external_node_id         as "marketplaceCategoryNodeId",
        mc.mapped_category_id       as "mappedCategoryId",
        (select count(*)::int from offers o where o.listing_id = l.id)                as "offerCount",
        (select count(distinct o.seller_id)::int from offers o where o.listing_id = l.id) as "sellerCount",
        (select max(po.observed_at)::text from price_observations po
           join offers o on o.id = po.offer_id where o.listing_id = l.id)             as "lastObservedAt"
      from listings l
      join marketplaces m on m.id = l.marketplace_id
      left join marketplace_categories mc on mc.id = l.marketplace_category_id
      where ${where}
      order by lower(m.name) asc, l.id asc
      limit ${f.pageSize} offset ${offsetFor(f.page, f.pageSize)}`
    );

    return { data, total: total?.n ?? 0 };
  }

  /* ---------------------------------------------------------------- sellers */

  /**
   * The sellers offering this product.
   *
   * A MARKETPLACE SELLER — a merchant observed on a platform. Nothing here
   * touches `users`; the two share no key and no table, and the select list
   * is explicit so a future column on `sellers` cannot leak by accident.
   */
  async listSellers(productId: string, f: Page & { marketplaceId?: string }) {
    const clauses: SQL[] = [sql`l.product_id = ${productId}`];
    if (f.marketplaceId) clauses.push(sql`s.marketplace_id = ${f.marketplaceId}`);
    const where = sql.join(clauses, sql` and `);

    const total = await one<{ n: number }>(
      this.db,
      sql`select count(distinct s.id)::int as n
            from sellers s
            join offers o   on o.seller_id = s.id
            join listings l on l.id = o.listing_id
           where ${where}`
    );

    const data = await rows<SellerRow>(
      this.db,
      sql`
      with relevant as (
        select s.id as seller_id, count(o.id)::int as offer_count
          from sellers s
          join offers o   on o.seller_id = s.id
          join listings l on l.id = o.listing_id
         where ${where}
         group by s.id
      ),
      rating as (
        select distinct on (srs.seller_id)
               srs.seller_id, srs.captured_at, srs.rating, srs.rating_count
          from seller_rating_snapshots srs
          join relevant r on r.seller_id = srs.seller_id
         order by srs.seller_id, srs.captured_at desc
      )
      select
        s.id                        as "sellerId",
        s.marketplace_id            as "marketplaceId",
        m.name                      as "marketplaceName",
        s.external_seller_id        as "externalSellerId",
        s.name                      as "sellerName",
        s.seller_type               as "sellerType",
        s.default_fulfilment_type   as "defaultFulfilmentType",
        s.seller_tier               as "sellerTier",
        s.seller_group_id           as "sellerGroupId",
        s.onboarded_at::text        as "onboardedAt",
        rel.offer_count             as "offerCountForProduct",
        rt.rating                   as "currentRating",
        rt.rating_count             as "currentRatingCount",
        rt.captured_at::text        as "ratingCapturedAt",
        (select count(*)::int from seller_rating_snapshots x where x.seller_id = s.id) as "ratingSnapshotCount"
      from relevant rel
      join sellers s      on s.id = rel.seller_id
      join marketplaces m on m.id = s.marketplace_id
      left join rating rt on rt.seller_id = s.id
      order by lower(s.name) asc, s.id asc
      limit ${f.pageSize} offset ${offsetFor(f.page, f.pageSize)}`
    );

    return { data, total: total?.n ?? 0 };
  }

  async sellerRatingHistory(sellerId: string, f: Page) {
    const total = await one<{ n: number }>(
      this.db,
      sql`select count(*)::int as n from seller_rating_snapshots where seller_id = ${sellerId}`
    );
    const data = await rows<{ capturedAt: string; rating: number | null; ratingCount: number | null }>(
      this.db,
      sql`select captured_at::text as "capturedAt", rating, rating_count as "ratingCount"
            from seller_rating_snapshots
           where seller_id = ${sellerId}
           order by captured_at desc
           limit ${f.pageSize} offset ${offsetFor(f.page, f.pageSize)}`
    );
    return { data, total: total?.n ?? 0 };
  }

  async findSeller(sellerId: string) {
    return one<{ sellerId: string; sellerName: string; marketplaceId: string; marketplaceName: string }>(
      this.db,
      sql`select s.id as "sellerId", s.name as "sellerName",
                 s.marketplace_id as "marketplaceId", m.name as "marketplaceName"
            from sellers s join marketplaces m on m.id = s.marketplace_id
           where s.id = ${sellerId}`
    );
  }

  /* ----------------------------------------------------------------- offers */

  /**
   * Offers on a product, each carrying its latest observed state.
   *
   * The price filters and the price sorts both act on the CURRENT effective
   * price, so they agree with each other and with what the client is shown.
   * Filtering on the headline price while sorting on the effective one would
   * produce a list that looks mis-sorted.
   */
  async listOffers(productId: string, f: OfferFilters) {
    const scope: SQL[] = [sql`l.product_id = ${productId}`];
    if (f.marketplaceId) scope.push(sql`l.marketplace_id = ${f.marketplaceId}`);
    if (f.sellerId) scope.push(sql`o.seller_id = ${f.sellerId}`);
    if (f.condition) scope.push(sql`o.item_condition = ${f.condition}`);
    if (f.fulfilment) scope.push(sql`s.default_fulfilment_type = ${f.fulfilment}`);
    const scopeWhere = sql.join(scope, sql` and `);

    const having: SQL[] = [];
    if (f.inStock !== undefined) having.push(sql`is_in_stock is not distinct from ${f.inStock}`);
    if (f.minPriceMinor !== undefined) having.push(sql`current_effective_minor >= ${f.minPriceMinor}`);
    if (f.maxPriceMinor !== undefined) having.push(sql`current_effective_minor <= ${f.maxPriceMinor}`);
    if (f.hasPromotion !== undefined) {
      having.push(f.hasPromotion ? sql`promotion_count > 0` : sql`promotion_count = 0`);
    }
    const outerWhere = having.length ? sql`where ${sql.join(having, sql` and `)}` : sql``;

    const base = sql`
      with candidate as (
        select o.id as offer_id, o.listing_id, o.seller_id, o.item_condition, o.offer_status,
               o.first_seen_at, l.marketplace_id, l.listing_url, l.external_listing_id,
               s.name as seller_name, s.default_fulfilment_type, s.seller_type, s.seller_tier
          from offers o
          join listings l on l.id = o.listing_id
          join sellers  s on s.id = o.seller_id
         where ${scopeWhere}
      ),
      latest as (
        select distinct on (po.offer_id)
               po.offer_id, po.observed_at, po.is_in_stock, po.is_buybox_winner,
               po.currency_code, po.sale_label, po.raw_document_id, po.parser_version,
               ${LADDER_COLUMNS}
          from price_observations po
          join candidate c on c.offer_id = po.offer_id
         order by po.offer_id, po.observed_at desc
      ),
      shaped as (
        select
          c.offer_id                        as offer_id,
          c.listing_id                      as listing_id,
          c.marketplace_id                  as marketplace_id,
          c.listing_url                     as source_url,
          c.external_listing_id             as external_listing_id,
          c.seller_id                       as seller_id,
          c.seller_name                     as seller_name,
          c.seller_type                     as seller_type,
          c.seller_tier                     as seller_tier,
          c.default_fulfilment_type         as fulfilment_type,
          c.item_condition                  as item_condition,
          c.offer_status                    as offer_status,
          c.first_seen_at::text             as first_seen_at,
          x.observed_at::text               as last_observed_at,
          x.is_in_stock                     as is_in_stock,
          x.is_buybox_winner                as is_buybox_winner,
          x.currency_code                   as currency_code,
          x.sale_label                      as sale_label,
          x.raw_document_id                 as raw_document_id,
          x."mrpMinor"                      as mrp_minor,
          x."sellingPriceMinor"             as current_selling_minor,
          x."shippingFeeMinor"              as shipping_fee_minor,
          x."landedMinor"                   as current_landed_minor,
          x."universalDiscountMinor"        as universal_discount_minor,
          x."universalEffectiveMinor"       as current_effective_minor,
          x."conditionalDiscountMinor"      as conditional_discount_minor,
          x."conditionalBestMinor"          as conditional_best_minor,
          x."deferredBenefitMinor"          as deferred_benefit_minor,
          x."financingBenefitMinor"         as financing_benefit_minor,
          (select count(*)::int from promotions pr
            where pr.offer_id = c.offer_id
              and (x.observed_at is null
                   or ((pr.valid_from is null or pr.valid_from <= x.observed_at)
                   and (pr.valid_to   is null or pr.valid_to   >= x.observed_at)))) as promotion_count
        from candidate c
        left join latest x on x.offer_id = c.offer_id
      )`;

    const total = await one<{ n: number }>(
      this.db,
      sql`${base} select count(*)::int as n from shaped ${outerWhere}`
    );

    const data = await rows<OfferRow>(
      this.db,
      sql`${base}
      select
        offer_id                    as "offerId",
        listing_id                  as "listingId",
        marketplace_id              as "marketplaceId",
        source_url                  as "sourceUrl",
        external_listing_id         as "externalListingId",
        seller_id                   as "sellerId",
        seller_name                 as "sellerName",
        seller_type                 as "sellerType",
        seller_tier                 as "sellerTier",
        fulfilment_type             as "fulfilmentType",
        item_condition              as "itemCondition",
        offer_status                as "offerStatus",
        first_seen_at               as "firstSeenAt",
        last_observed_at            as "lastObservedAt",
        is_in_stock                 as "isInStock",
        is_buybox_winner            as "isBuyboxWinner",
        currency_code               as "currencyCode",
        sale_label                  as "saleLabel",
        raw_document_id             as "rawDocumentId",
        mrp_minor                   as "mrpMinor",
        current_selling_minor       as "sellingPriceMinor",
        shipping_fee_minor          as "shippingFeeMinor",
        current_landed_minor        as "landedMinor",
        universal_discount_minor    as "universalDiscountMinor",
        current_effective_minor     as "universalEffectiveMinor",
        conditional_discount_minor  as "conditionalDiscountMinor",
        conditional_best_minor      as "conditionalBestMinor",
        deferred_benefit_minor      as "deferredBenefitMinor",
        financing_benefit_minor     as "financingBenefitMinor",
        promotion_count             as "activePromotionCount"
      from shaped
      ${outerWhere}
      order by ${OFFER_ORDER[f.sort]}
      limit ${f.pageSize} offset ${offsetFor(f.page, f.pageSize)}`
    );

    return { data, total: total?.n ?? 0 };
  }

  /* ------------------------------------------------------- price history */

  private historyScope(productId: string | null, f: HistoryFilters): SQL {
    const clauses: SQL[] = [sql`po.observed_at >= ${f.from}`, sql`po.observed_at <= ${f.to}`];
    if (productId) clauses.push(sql`l.product_id = ${productId}`);
    if (f.marketplaceId) clauses.push(sql`l.marketplace_id = ${f.marketplaceId}`);
    if (f.sellerId) clauses.push(sql`o.seller_id = ${f.sellerId}`);
    if (f.offerId) clauses.push(sql`po.offer_id = ${f.offerId}`);
    return sql.join(clauses, sql` and `);
  }

  /** Raw observations in a range, newest first. Paginated — never the lot. */
  async observations(productId: string | null, f: HistoryFilters) {
    const where = this.historyScope(productId, f);

    const total = await one<{ n: number }>(
      this.db,
      sql`select count(*)::int as n
            from price_observations po
            join offers   o on o.id = po.offer_id
            join listings l on l.id = o.listing_id
           where ${where}`
    );

    const data = await rows<ObservationRow>(
      this.db,
      sql`
      select
        po.id                       as "observationId",
        po.offer_id                 as "offerId",
        o.seller_id                 as "sellerId",
        s.name                      as "sellerName",
        l.id                        as "listingId",
        l.marketplace_id            as "marketplaceId",
        po.observed_at::text        as "observedAt",
        po.recorded_at              as "recordedAt",
        po.is_in_stock              as "isInStock",
        po.is_buybox_winner         as "isBuyboxWinner",
        po.currency_code            as "currencyCode",
        po.sale_label               as "saleLabel",
        po.raw_document_id          as "rawDocumentId",
        ${LADDER_COLUMNS}
      from price_observations po
      join offers   o on o.id = po.offer_id
      join sellers  s on s.id = o.seller_id
      join listings l on l.id = o.listing_id
      where ${where}
      order by po.observed_at desc, po.offer_id asc
      limit ${f.pageSize} offset ${offsetFor(f.page, f.pageSize)}`
    );

    return { data, total: total?.n ?? 0 };
  }

  /**
   * The daily series a statistic is computed over.
   *
   * IN-STOCK observations only, reduced to the CHEAPEST effective price per
   * day. This matches `getProductPriceSeries` in the frontend engine exactly,
   * and the match matters: a median taken over raw observations counts a
   * marketplace once per offer it happens to have, so a platform with six
   * sellers would outvote one with a single seller and the "median price of
   * this product" would drift toward whoever lists it most.
   */
  async dailySeries(productId: string | null, f: Omit<HistoryFilters, "page" | "pageSize">) {
    const where = this.historyScope(productId, { ...f, page: 1, pageSize: 1 });
    return rows<{ date: string; minor: number; landedMinor: number }>(
      this.db,
      sql`
      with priced as (
        select po.observed_at as d,
               ${UNIVERSAL_EFFECTIVE_MINOR} as effective_minor,
               ${LANDED_MINOR}              as landed_minor
          from price_observations po
          join offers   o on o.id = po.offer_id
          join listings l on l.id = o.listing_id
         where ${where} and po.is_in_stock
      )
      select d::text as date,
             min(effective_minor)::int as minor,
             min(landed_minor)::int    as "landedMinor"
        from priced
       group by d
       order by d asc`
    );
  }

  /* ---------------------------------------------------------------- reviews */

  async reviewSnapshots(productId: string, f: Page & { marketplaceId?: string }) {
    const clauses: SQL[] = [sql`l.product_id = ${productId}`];
    if (f.marketplaceId) clauses.push(sql`l.marketplace_id = ${f.marketplaceId}`);
    const where = sql.join(clauses, sql` and `);

    const total = await one<{ n: number }>(
      this.db,
      sql`select count(*)::int as n
            from review_snapshots rs join listings l on l.id = rs.listing_id
           where ${where}`
    );

    const data = await rows<ReviewRow>(
      this.db,
      sql`
      select
        rs.id                   as "snapshotId",
        rs.listing_id           as "listingId",
        l.marketplace_id        as "marketplaceId",
        m.name                  as "marketplaceName",
        rs.captured_at::text    as "capturedAt",
        rs.average_rating       as "averageRating",
        rs.rating_count         as "ratingCount",
        rs.review_count         as "reviewCount",
        rs.rating_distribution  as "ratingDistribution"
      from review_snapshots rs
      join listings l     on l.id = rs.listing_id
      join marketplaces m on m.id = l.marketplace_id
      where ${where}
      order by rs.captured_at desc, rs.listing_id asc
      limit ${f.pageSize} offset ${offsetFor(f.page, f.pageSize)}`
    );

    return { data, total: total?.n ?? 0 };
  }

  /** Latest review snapshot per marketplace — the product's current standing. */
  async currentRatings(productId: string) {
    return rows<{
      marketplaceId: string;
      marketplaceName: string;
      listingId: string;
      capturedAt: string;
      averageRating: number | null;
      ratingCount: number | null;
      reviewCount: number | null;
      snapshotCount: number;
    }>(
      this.db,
      sql`
      with latest as (
        select distinct on (rs.listing_id)
               rs.listing_id, rs.captured_at, rs.average_rating, rs.rating_count, rs.review_count
          from review_snapshots rs
          join listings l on l.id = rs.listing_id
         where l.product_id = ${productId}
         order by rs.listing_id, rs.captured_at desc
      )
      select
        l.marketplace_id      as "marketplaceId",
        m.name                as "marketplaceName",
        x.listing_id          as "listingId",
        x.captured_at::text   as "capturedAt",
        x.average_rating      as "averageRating",
        x.rating_count        as "ratingCount",
        x.review_count        as "reviewCount",
        (select count(*)::int from review_snapshots r where r.listing_id = x.listing_id) as "snapshotCount"
      from latest x
      join listings l     on l.id = x.listing_id
      join marketplaces m on m.id = l.marketplace_id
      order by lower(m.name) asc`
    );
  }

  /* ------------------------------------------------------------- promotions */

  /**
   * Promotions attached to this product's offers.
   *
   * `availability_class` is read, never recomputed — it is materialised in
   * the database precisely because it decides whether a discount may enter a
   * price comparison, and that rule belongs in one place.
   *
   * `asOf` decides `isActive`. It defaults to the dataset's reference date
   * rather than the wall clock, because every promotion in this dataset
   * expired relative to a real calendar and the honest question is "active
   * when this data was captured".
   */
  async promotions(
    productId: string,
    f: Page & { marketplaceId?: string; offerId?: string; availabilityClass?: string; status?: "active" | "expired" | "all"; asOf: string }
  ) {
    const clauses: SQL[] = [sql`l.product_id = ${productId}`];
    if (f.marketplaceId) clauses.push(sql`l.marketplace_id = ${f.marketplaceId}`);
    if (f.offerId) clauses.push(sql`pr.offer_id = ${f.offerId}`);
    if (f.availabilityClass) clauses.push(sql`pr.availability_class = ${f.availabilityClass}`);

    const activeExpr = sql`((pr.valid_from is null or pr.valid_from <= ${f.asOf})
                        and (pr.valid_to   is null or pr.valid_to   >= ${f.asOf}))`;
    if (f.status === "active") clauses.push(activeExpr);
    if (f.status === "expired") clauses.push(sql`not ${activeExpr}`);

    const where = sql.join(clauses, sql` and `);

    const total = await one<{ n: number }>(
      this.db,
      sql`select count(*)::int as n
            from promotions pr
            join offers   o on o.id = pr.offer_id
            join listings l on l.id = o.listing_id
           where ${where}`
    );

    const data = await rows<PromotionRow>(
      this.db,
      sql`
      select
        pr.id                     as "promotionId",
        pr.offer_id               as "offerId",
        o.seller_id               as "sellerId",
        s.name                    as "sellerName",
        l.marketplace_id          as "marketplaceId",
        pr.promotion_type         as "promotionType",
        pr.availability_class     as "availabilityClass",
        pr.label                  as "label",
        pr.eligibility            as "eligibility",
        pr.discount_value_minor   as "discountValueMinor",
        pr.terms                  as "terms",
        pr.valid_from::text       as "validFrom",
        pr.valid_to::text         as "validTo",
        ${activeExpr}             as "isActive"
      from promotions pr
      join offers   o on o.id = pr.offer_id
      join sellers  s on s.id = o.seller_id
      join listings l on l.id = o.listing_id
      where ${where}
      order by pr.availability_class asc, pr.discount_value_minor desc, pr.id asc
      limit ${f.pageSize} offset ${offsetFor(f.page, f.pageSize)}`
    );

    return { data, total: total?.n ?? 0 };
  }

  /* ---------------------------------------------------------- offer lookup */

  async findOffer(offerId: string) {
    return one<{
      offerId: string;
      listingId: string;
      productId: string;
      marketplaceId: string;
      sellerId: string;
      sellerName: string;
      sourceUrl: string | null;
    }>(
      this.db,
      sql`select o.id as "offerId", o.listing_id as "listingId", l.product_id as "productId",
                 l.marketplace_id as "marketplaceId", o.seller_id as "sellerId",
                 s.name as "sellerName", l.listing_url as "sourceUrl"
            from offers o
            join listings l on l.id = o.listing_id
            join sellers  s on s.id = o.seller_id
           where o.id = ${offerId}`
    );
  }
}

/* ------------------------------------------------------------- row shapes */

export type MarketplaceSummaryRow = {
  marketplaceId: string;
  marketplaceName: string;
  websiteDomain: string;
  marketplaceType: string;
  brandColor: string | null;
  listingId: string;
  sourceUrl: string | null;
  externalListingId: string;
  listingStatus: string;
  matchStatus: string;
  matchConfidence: number | null;
  lastSeenAt: string | null;
  listingCount: number;
  sellerCount: number;
  offerCount: number;
  observedOfferCount: number;
  inStockOfferCount: number;
  currentEffectiveMinor: number | null;
  currentLandedMinor: number | null;
  currentSellingMinor: number | null;
  minShippingFeeMinor: number | null;
  maxShippingFeeMinor: number | null;
  mrpMinor: number | null;
  lastObservedAt: string | null;
  averageRating: number | null;
  ratingCount: number | null;
  reviewCount: number | null;
  ratingCapturedAt: string | null;
};

export type ListingRow = {
  listingId: string;
  productId: string;
  marketplaceId: string;
  marketplaceName: string;
  websiteDomain: string;
  externalListingId: string;
  sourceUrl: string | null;
  rawTitle: string | null;
  marketplaceBrandText: string | null;
  listingStatus: string;
  matchStatus: string;
  matchConfidence: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  marketplaceCategoryId: string | null;
  marketplaceCategoryPath: string | null;
  marketplaceCategoryNodeId: string | null;
  mappedCategoryId: string | null;
  offerCount: number;
  sellerCount: number;
  lastObservedAt: string | null;
};

export type SellerRow = {
  sellerId: string;
  marketplaceId: string;
  marketplaceName: string;
  externalSellerId: string;
  sellerName: string;
  sellerType: string;
  defaultFulfilmentType: string;
  sellerTier: string | null;
  sellerGroupId: string | null;
  onboardedAt: string | null;
  offerCountForProduct: number;
  currentRating: number | null;
  currentRatingCount: number | null;
  ratingCapturedAt: string | null;
  ratingSnapshotCount: number;
};

export type OfferRow = {
  offerId: string;
  listingId: string;
  marketplaceId: string;
  sourceUrl: string | null;
  externalListingId: string;
  sellerId: string;
  sellerName: string;
  sellerType: string;
  sellerTier: string | null;
  fulfilmentType: string;
  itemCondition: string;
  offerStatus: string;
  firstSeenAt: string | null;
  lastObservedAt: string | null;
  isInStock: boolean | null;
  isBuyboxWinner: boolean | null;
  currencyCode: string | null;
  saleLabel: string | null;
  rawDocumentId: string | null;
  mrpMinor: number | null;
  sellingPriceMinor: number | null;
  shippingFeeMinor: number | null;
  landedMinor: number | null;
  universalDiscountMinor: number | null;
  universalEffectiveMinor: number | null;
  conditionalDiscountMinor: number | null;
  conditionalBestMinor: number | null;
  deferredBenefitMinor: number | null;
  financingBenefitMinor: number | null;
  activePromotionCount: number;
};

export type ObservationRow = {
  observationId: string;
  offerId: string;
  sellerId: string;
  sellerName: string;
  listingId: string;
  marketplaceId: string;
  observedAt: string;
  recordedAt: string;
  isInStock: boolean;
  isBuyboxWinner: boolean;
  currencyCode: string;
  saleLabel: string | null;
  rawDocumentId: string | null;
  mrpMinor: number | null;
  sellingPriceMinor: number;
  shippingFeeMinor: number;
  landedMinor: number;
  universalDiscountMinor: number;
  universalEffectiveMinor: number;
  conditionalDiscountMinor: number;
  conditionalBestMinor: number;
  deferredBenefitMinor: number;
  financingBenefitMinor: number;
};

export type ReviewRow = {
  snapshotId: string;
  listingId: string;
  marketplaceId: string;
  marketplaceName: string;
  capturedAt: string;
  averageRating: number | null;
  ratingCount: number | null;
  reviewCount: number | null;
  ratingDistribution: Record<string, number> | null;
};

export type PromotionRow = {
  promotionId: string;
  offerId: string;
  sellerId: string;
  sellerName: string;
  marketplaceId: string;
  promotionType: string;
  availabilityClass: string;
  label: string;
  eligibility: string | null;
  discountValueMinor: number;
  terms: Record<string, unknown> | null;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
};
