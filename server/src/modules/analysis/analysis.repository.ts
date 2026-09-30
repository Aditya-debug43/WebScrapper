import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { LANDED_MINOR, UNIVERSAL_EFFECTIVE_MINOR } from "../../lib/priceLadder.js";

/**
 * Data loading for the analysis engine.
 *
 * Every loader here is BATCHED over a set of product ids. The frontend engine
 * walks Product → Listing → Offer → Observation in nested loops, which is free
 * in memory and catastrophic over a database: the largest product type holds
 * 29 candidates, and a naive port would issue four queries per candidate on
 * every analysis request.
 *
 * So the whole analysis context loads in a fixed number of queries — eight —
 * regardless of how many candidates a product type contains. Nothing here
 * scales with the candidate count, and nothing reads the observation table
 * unbounded.
 */

async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

async function one<T>(db: Db, query: SQL): Promise<T | null> {
  const [row] = await rows<T>(db, query);
  return row ?? null;
}

/** `in (…)` over a list, or a guaranteed-false predicate when it is empty. */
function inList(column: SQL, values: string[]): SQL {
  if (values.length === 0) return sql`false`;
  return sql`${column} in (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
}

/* ------------------------------------------------------------------ types */

export type ProductRow = {
  id: string;
  parentProductId: string | null;
  isPurchasable: boolean;
  brandId: string;
  categoryId: string;
  productTypeId: string;
  canonicalName: string;
  modelName: string | null;
  specifications: Record<string, unknown> | null;
  specSchemaVersion: string | null;
  brandName: string | null;
  brandTier: string | null;
};

export type AttributeRow = {
  attributeKey: string;
  displayName: string;
  dataType: "integer" | "decimal" | "boolean" | "text";
  unit: string | null;
  isPricingRelevant: boolean;
  higherIsBetter: boolean | null;
};

/** The cheapest in-stock effective price, with the whole ladder behind it. */
export type CurrentPriceRow = {
  productId: string;
  listingId: string;
  offerId: string;
  marketplaceId: string;
  sellerId: string;
  observedAt: string;
  mrpMinor: number | null;
  sellingPriceMinor: number;
  shippingFeeMinor: number;
  landedMinor: number;
  universalDiscountMinor: number;
  universalEffectiveMinor: number;
  conditionalBestMinor: number;
};

export type ReviewMetricRow = {
  productId: string;
  listingId: string;
  marketplaceId: string;
  averageRating: number | null;
  reviewCount: number | null;
  capturedAt: string;
};

export type QualitySignalRow = {
  productId: string;
  listingCount: number;
  marketplaceCount: number;
  minMatchConfidence: number | null;
  observations: number;
  inStockOffers: number;
};

export class AnalysisRepository {
  constructor(private readonly db: Db) {}

  /* ------------------------------------------------------------ products */

  async findProduct(productId: string): Promise<ProductRow | null> {
    return one<ProductRow>(
      this.db,
      sql`select p.id, p.parent_product_id as "parentProductId", p.is_purchasable as "isPurchasable",
                 p.brand_id as "brandId", p.category_id as "categoryId", p.product_type_id as "productTypeId",
                 p.canonical_name as "canonicalName", p.model_name as "modelName",
                 p.specifications, p.spec_schema_version as "specSchemaVersion",
                 b.name as "brandName", b.tier as "brandTier"
            from products p
            left join brands b on b.id = p.brand_id
           where p.id = ${productId}`
    );
  }

  /**
   * Every candidate of the same product type.
   *
   * The same filter the frontend applies: purchasable, has specifications,
   * same product type, not the target itself. Bounded by the product type —
   * at most 29 rows in this dataset.
   */
  async candidatesFor(productTypeId: string, excludeProductId: string): Promise<ProductRow[]> {
    return rows<ProductRow>(
      this.db,
      sql`select p.id, p.parent_product_id as "parentProductId", p.is_purchasable as "isPurchasable",
                 p.brand_id as "brandId", p.category_id as "categoryId", p.product_type_id as "productTypeId",
                 p.canonical_name as "canonicalName", p.model_name as "modelName",
                 p.specifications, p.spec_schema_version as "specSchemaVersion",
                 b.name as "brandName", b.tier as "brandTier"
            from products p
            left join brands b on b.id = p.brand_id
           where p.product_type_id = ${productTypeId}
             and p.id <> ${excludeProductId}
             and p.is_purchasable
             and p.specifications is not null
           order by p.id`
    );
  }

  async attributesFor(productTypeId: string): Promise<AttributeRow[]> {
    return rows<AttributeRow>(
      this.db,
      sql`select attribute_key as "attributeKey", display_name as "displayName",
                 data_type as "dataType", unit,
                 is_pricing_relevant as "isPricingRelevant", higher_is_better as "higherIsBetter"
            from attribute_definitions
           where product_type_id = ${productTypeId}
           order by attribute_key`
    );
  }

  async productTypeName(productTypeId: string): Promise<string | null> {
    const row = await one<{ name: string }>(
      this.db,
      sql`select name from product_types where id = ${productTypeId}`
    );
    return row?.name ?? null;
  }

  /* -------------------------------------------------------------- prices */

  /**
   * The cheapest IN-STOCK effective price per product, for a whole batch.
   *
   * Two `distinct on` passes: the latest observation per offer, then the
   * cheapest of those per product. That reproduces `getCurrentEffectivePrice`
   * exactly — "cheapest in-stock universal effective price, and the whole
   * ladder from THAT one offer" — rather than taking the minimum of each rung
   * independently, which would produce a ladder that does not add up.
   */
  async currentPrices(productIds: string[]): Promise<CurrentPriceRow[]> {
    if (productIds.length === 0) return [];
    return rows<CurrentPriceRow>(
      this.db,
      sql`
      with scope as (
        select l.id as listing_id, l.product_id, l.marketplace_id, o.id as offer_id, o.seller_id
          from listings l
          join offers o on o.listing_id = l.id
         where ${inList(sql`l.product_id`, productIds)}
      ),
      latest as (
        select distinct on (po.offer_id)
               po.offer_id, s.product_id, s.listing_id, s.marketplace_id, s.seller_id,
               po.observed_at, po.is_in_stock, po.mrp_minor,
               po.selling_price_minor, po.shipping_fee_minor,
               ${LANDED_MINOR}              as landed_minor,
               ${UNIVERSAL_EFFECTIVE_MINOR} as effective_minor,
               (${UNIVERSAL_EFFECTIVE_MINOR} - least(
                  (select coalesce(sum(pr.discount_value_minor), 0)::int
                     from promotions pr
                    where pr.offer_id = po.offer_id
                      and pr.availability_class = 'conditional'
                      and (pr.valid_from is null or pr.valid_from <= po.observed_at)
                      and (pr.valid_to   is null or pr.valid_to   >= po.observed_at)),
                  ${UNIVERSAL_EFFECTIVE_MINOR})) as conditional_best_minor
          from price_observations po
          join scope s on s.offer_id = po.offer_id
         order by po.offer_id, po.observed_at desc
      )
      select distinct on (x.product_id)
             x.product_id            as "productId",
             x.listing_id            as "listingId",
             x.offer_id              as "offerId",
             x.marketplace_id        as "marketplaceId",
             x.seller_id             as "sellerId",
             x.observed_at::text     as "observedAt",
             x.mrp_minor             as "mrpMinor",
             x.selling_price_minor   as "sellingPriceMinor",
             x.shipping_fee_minor    as "shippingFeeMinor",
             x.landed_minor          as "landedMinor",
             (x.landed_minor - x.effective_minor) as "universalDiscountMinor",
             x.effective_minor       as "universalEffectiveMinor",
             x.conditional_best_minor as "conditionalBestMinor"
        from latest x
       where x.is_in_stock
       order by x.product_id, x.effective_minor asc, x.offer_id asc`
    );
  }

  /**
   * The highest MRP observed on a product — the least restrictive ceiling
   * that can be defended, which is the rule `resolveApplicableMrp` applies.
   */
  async applicableMrp(productId: string): Promise<number | null> {
    const row = await one<{ mrp: number | null }>(
      this.db,
      sql`select max(po.mrp_minor)::int as mrp
            from price_observations po
            join offers o   on o.id = po.offer_id
            join listings l on l.id = o.listing_id
           where l.product_id = ${productId} and po.mrp_minor is not null and po.mrp_minor > 0`
    );
    return row?.mrp ?? null;
  }

  /* -------------------------------------------------------------- reviews */

  /** The latest review snapshot per listing, for a whole batch of products. */
  async latestReviews(productIds: string[]): Promise<ReviewMetricRow[]> {
    if (productIds.length === 0) return [];
    return rows<ReviewMetricRow>(
      this.db,
      sql`
      with scope as (
        select l.id, l.product_id, l.marketplace_id
          from listings l
         where ${inList(sql`l.product_id`, productIds)}
      )
      select distinct on (rs.listing_id)
             s.product_id          as "productId",
             rs.listing_id         as "listingId",
             s.marketplace_id      as "marketplaceId",
             rs.average_rating     as "averageRating",
             rs.review_count       as "reviewCount",
             rs.captured_at::text  as "capturedAt"
        from review_snapshots rs
        join scope s on s.id = rs.listing_id
       order by rs.listing_id, rs.captured_at desc`
    );
  }

  /**
   * Review velocity: the change in review count per day between the two most
   * recent snapshots on a listing. The project's demand proxy, in the absence
   * of sales data.
   */
  async reviewVelocity(productIds: string[]): Promise<Array<{ listingId: string; velocity: number | null }>> {
    if (productIds.length === 0) return [];
    return rows<{ listingId: string; velocity: number | null }>(
      this.db,
      sql`
      with scope as (select l.id from listings l where ${inList(sql`l.product_id`, productIds)}),
      ranked as (
        select rs.listing_id, rs.captured_at, rs.review_count,
               row_number() over (partition by rs.listing_id order by rs.captured_at desc) as rn
          from review_snapshots rs
          join scope s on s.id = rs.listing_id
      )
      select a.listing_id as "listingId",
             case when b.captured_at is null or a.captured_at = b.captured_at then null
                  else (a.review_count - b.review_count)::float
                       / greatest((a.captured_at - b.captured_at), 1)
             end as velocity
        from ranked a
        left join ranked b on b.listing_id = a.listing_id and b.rn = 2
       where a.rn = 1`
    );
  }

  /* ------------------------------------------------------- marketplace sets */

  async marketplaceSets(productIds: string[]): Promise<Array<{ productId: string; marketplaceId: string }>> {
    if (productIds.length === 0) return [];
    return rows<{ productId: string; marketplaceId: string }>(
      this.db,
      sql`select product_id as "productId", marketplace_id as "marketplaceId"
            from listings
           where ${inList(sql`product_id`, productIds)}
           order by product_id, marketplace_id`
    );
  }

  /* ------------------------------------------------------- quality signals */

  /**
   * Everything `assessDataQuality` needs, for a whole batch, in one query.
   *
   * The frontend walks every offer's full price history to count observations
   * and test the last one for stock. Counting in SQL is the same number
   * without moving a single observation row across the wire.
   */
  async qualitySignals(productIds: string[]): Promise<QualitySignalRow[]> {
    if (productIds.length === 0) return [];
    return rows<QualitySignalRow>(
      this.db,
      sql`
      with scope as (
        select l.id as listing_id, l.product_id, l.marketplace_id, l.match_confidence
          from listings l
         where ${inList(sql`l.product_id`, productIds)}
      ),
      offer_state as (
        select distinct on (o.id)
               o.id as offer_id, s.product_id, po.is_in_stock
          from offers o
          join scope s on s.listing_id = o.listing_id
          left join price_observations po on po.offer_id = o.id
         order by o.id, po.observed_at desc
      ),
      obs as (
        select s.product_id, count(po.id)::int as n
          from scope s
          join offers o on o.listing_id = s.listing_id
          join price_observations po on po.offer_id = o.id
         group by s.product_id
      )
      select s.product_id                                    as "productId",
             count(distinct s.listing_id)::int               as "listingCount",
             count(distinct s.marketplace_id)::int           as "marketplaceCount",
             min(s.match_confidence)                         as "minMatchConfidence",
             coalesce(max(o.n), 0)::int                      as "observations",
             coalesce(max(st.in_stock), 0)::int              as "inStockOffers"
        from scope s
        left join obs o on o.product_id = s.product_id
        left join (
          select product_id, count(*) filter (where is_in_stock)::int as in_stock
            from offer_state group by product_id
        ) st on st.product_id = s.product_id
       group by s.product_id`
    );
  }

  /* ----------------------------------------------------- the target's graph */

  /**
   * Every offer on the target product with its latest observed state — the
   * rows `buildMarketplaceRows` needs, in one query rather than a nested walk.
   */
  async offerStates(productId: string) {
    return rows<OfferStateRow>(
      this.db,
      sql`
      with scope as (
        select l.id as listing_id, l.product_id, l.marketplace_id, l.match_confidence, l.match_status,
               o.id as offer_id, o.seller_id
          from listings l
          join offers o on o.listing_id = l.id
         where l.product_id = ${productId}
      )
      select distinct on (po.offer_id)
             s.listing_id                as "listingId",
             s.marketplace_id            as "marketplaceId",
             s.offer_id                  as "offerId",
             s.seller_id                 as "sellerId",
             sel.name                    as "sellerName",
             sel.seller_type             as "sellerType",
             sel.default_fulfilment_type as "fulfilmentType",
             po.observed_at::text        as "observedAt",
             po.is_in_stock              as "isInStock",
             po.mrp_minor                as "mrpMinor",
             po.selling_price_minor      as "sellingPriceMinor",
             po.shipping_fee_minor       as "shippingFeeMinor",
             ${LANDED_MINOR}             as "landedMinor",
             ${UNIVERSAL_EFFECTIVE_MINOR} as "universalEffectiveMinor",
             (${LANDED_MINOR} - ${UNIVERSAL_EFFECTIVE_MINOR}) as "universalDiscountMinor",
             (select coalesce(sum(pr.discount_value_minor), 0)::int
                from promotions pr
               where pr.offer_id = po.offer_id and pr.availability_class = 'conditional'
                 and (pr.valid_from is null or pr.valid_from <= po.observed_at)
                 and (pr.valid_to   is null or pr.valid_to   >= po.observed_at)) as "conditionalDiscountRaw",
             (select srs.rating from seller_rating_snapshots srs
               where srs.seller_id = s.seller_id order by srs.captured_at desc limit 1) as "sellerRating"
        from price_observations po
        join scope s   on s.offer_id = po.offer_id
        join sellers sel on sel.id = s.seller_id
       order by po.offer_id, po.observed_at desc`
    );
  }

  /** Active promotions on the target's offers, as at a date. */
  async activePromotions(productId: string, asOf: string) {
    return rows<{
      offerId: string;
      availabilityClass: string;
      promotionType: string;
      label: string;
      discountValueMinor: number;
    }>(
      this.db,
      sql`select pr.offer_id as "offerId", pr.availability_class as "availabilityClass",
                 pr.promotion_type as "promotionType", pr.label, pr.discount_value_minor as "discountValueMinor"
            from promotions pr
            join offers o   on o.id = pr.offer_id
            join listings l on l.id = o.listing_id
           where l.product_id = ${productId}
             and (pr.valid_from is null or pr.valid_from <= ${asOf})
             and (pr.valid_to   is null or pr.valid_to   >= ${asOf})
           order by pr.offer_id, pr.availability_class`
    );
  }

  async listingsFor(productId: string) {
    return rows<{
      listingId: string;
      marketplaceId: string;
      marketplaceName: string;
      marketplaceType: string;
      brandColor: string | null;
      matchConfidence: number | null;
      matchStatus: string;
    }>(
      this.db,
      sql`select l.id as "listingId", l.marketplace_id as "marketplaceId",
                 m.name as "marketplaceName", m.marketplace_type as "marketplaceType",
                 m.brand_color as "brandColor",
                 l.match_confidence as "matchConfidence", l.match_status as "matchStatus"
            from listings l
            join marketplaces m on m.id = l.marketplace_id
           where l.product_id = ${productId}
           order by l.id`
    );
  }

  /**
   * The daily price series — one point per capture day, cheapest in-stock
   * effective price. The same definition as `getProductPriceSeries` and the
   * Phase 4 history endpoint; there is only one series rule in this system.
   */
  async dailySeries(productId: string, from: string | null, to: string | null) {
    const bounds: SQL[] = [sql`l.product_id = ${productId}`, sql`po.is_in_stock`];
    if (from) bounds.push(sql`po.observed_at >= ${from}`);
    if (to) bounds.push(sql`po.observed_at <= ${to}`);

    return rows<{ date: string; minor: number; saleLabel: string | null }>(
      this.db,
      sql`
      with priced as (
        select po.observed_at as d, po.offer_id, ${UNIVERSAL_EFFECTIVE_MINOR} as eff, po.sale_label
          from price_observations po
          join offers   o on o.id = po.offer_id
          join listings l on l.id = o.listing_id
         where ${sql.join(bounds, sql` and `)}
      ),
      best as (
        select d, min(eff)::int as minor from priced group by d
      )
      select b.d::text as date, b.minor,
             /*
              * The label belongs to the CHEAPEST offer that day, labelled or
              * not. Preferring a labelled row among ties reported promotional
              * days the engine does not see — the cheapest offer carried no
              * sale label, while a dearer one tied on price did.
              */
             (select p.sale_label from priced p
               where p.d = b.d and p.eff = b.minor
               order by p.offer_id asc limit 1) as "saleLabel"
        from best b
       order by b.d asc`
    );
  }

  async knownMarketplaceIds(): Promise<string[]> {
    const found = await rows<{ id: string }>(this.db, sql`select id from marketplaces order by id`);
    return found.map((r) => r.id);
  }

  async referenceDate(): Promise<string | null> {
    const row = await one<{ latest: string | null }>(
      this.db,
      sql`select max(observed_at)::text as latest from price_observations`
    );
    return row?.latest ?? null;
  }
}

export type OfferStateRow = {
  listingId: string;
  marketplaceId: string;
  offerId: string;
  sellerId: string;
  sellerName: string;
  sellerType: string;
  fulfilmentType: string;
  observedAt: string;
  isInStock: boolean;
  mrpMinor: number | null;
  sellingPriceMinor: number;
  shippingFeeMinor: number;
  landedMinor: number;
  universalEffectiveMinor: number;
  universalDiscountMinor: number;
  conditionalDiscountRaw: number;
  sellerRating: number | null;
};
