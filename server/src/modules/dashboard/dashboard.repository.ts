import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { UNIVERSAL_EFFECTIVE_MINOR } from "../../lib/priceLadder.js";

/**
 * DESK READS
 *
 * The dashboard asks two different questions and they need different queries:
 * "what is on the desk" (a structural profile of the whole catalogue, used to
 * choose a default set) and "what did those products do" (a price series per
 * product over one horizon).
 */

async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

async function one<T>(db: Db, query: SQL): Promise<T | null> {
  const [row] = await rows<T>(db, query);
  return row ?? null;
}

const inList = (column: SQL, values: string[]): SQL =>
  sql`${column} in (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;

export type ProductProfileRow = {
  id: string;
  name: string;
  brandName: string | null;
  categoryId: string;
  categoryName: string | null;
  departmentId: string | null;
  productTypeId: string;
  productTypeName: string | null;
  marketplaceCount: number;
  offerCount: number;
  observationCount: number;
  pointsPerOffer: number;
  priceMinor: number | null;
};

export class DashboardRepository {
  constructor(private readonly db: Db) {}

  /**
   * A cheap structural profile of every product that has an offer and a
   * price.
   *
   * Deliberately NOT the price ladder and deliberately NOT the recommendation
   * engine. This figure only has to place a product in the catalogue's price
   * distribution and say how deeply it has been observed; running the ladder
   * across the whole catalogue to choose twelve products would cost seconds
   * of work to answer a question that does not need that precision.
   *
   * `pointsPerOffer` is the deepest single offer rather than an average,
   * because capture cadence is a property of a crawl schedule and the most
   * completely captured offer is the one that reveals it.
   */
  async productProfiles(): Promise<ProductProfileRow[]> {
    return rows<ProductProfileRow>(
      this.db,
      sql`
      with listing_agg as (
        select l.product_id,
               count(distinct l.id)::int as marketplace_count,
               count(o.id)::int          as offer_count
          from listings l
          left join offers o on o.listing_id = l.id
         group by l.product_id
      ),
      points as (
        select l.product_id, po.offer_id, count(*)::int as n
          from price_observations po
          join offers   o on o.id = po.offer_id
          join listings l on l.id = o.listing_id
         group by l.product_id, po.offer_id
      ),
      depth as (
        select product_id, max(n)::int as max_points, sum(n)::int as total_obs
          from points group by product_id
      ),
      latest as (
        select distinct on (po.offer_id)
               po.offer_id, l.product_id, po.is_in_stock,
               (po.selling_price_minor + coalesce(po.shipping_fee_minor, 0)) as landed
          from price_observations po
          join offers   o on o.id = po.offer_id
          join listings l on l.id = o.listing_id
         order by po.offer_id, po.observed_at desc
      ),
      cheapest as (
        select product_id, min(landed)::int as price_minor
          from latest where is_in_stock group by product_id
      )
      select p.id                            as "id",
             p.canonical_name                as "name",
             b.name                          as "brandName",
             p.category_id                   as "categoryId",
             c.name                          as "categoryName",
             /*
              * The department is the ROOT of the slug path, resolved back to
              * a category id. The path is "beauty-personal-care/hair-care/
              * shampoo", so its first segment is the department's own path,
              * and a root row carries exactly that as its whole path.
              *
              * A root is identified by having no parent, which is the
              * schema's own definition of one. It is NOT level = 0: levels
              * in this taxonomy start at 1, and matching on zero silently
              * resolved every department to null — which collapsed the
              * stratified desk to two products, because the "at most two per
              * department" cap then applied to a single null bucket.
              */
             d.id                            as "departmentId",
             p.product_type_id               as "productTypeId",
             pt.name                         as "productTypeName",
             coalesce(la.marketplace_count, 0) as "marketplaceCount",
             coalesce(la.offer_count, 0)       as "offerCount",
             coalesce(dp.total_obs, 0)         as "observationCount",
             coalesce(dp.max_points, 0)        as "pointsPerOffer",
             ch.price_minor                  as "priceMinor"
        from products p
        join      listing_agg la on la.product_id = p.id
        join      cheapest    ch on ch.product_id = p.id
        left join depth       dp on dp.product_id = p.id
        left join brands      b  on b.id = p.brand_id
        left join categories  c  on c.id = p.category_id
        left join categories  d  on d.parent_id is null and d.path = split_part(c.path, '/', 1)
        left join product_types pt on pt.id = p.product_type_id
       where la.offer_count > 0
       order by p.id asc`
    );
  }

  /**
   * The daily cheapest universal-effective price for several products at
   * once.
   *
   * The same basis and the same in-stock filter as the per-product series the
   * analysis uses — a price for a day on which nothing was buyable is not a
   * price. Batched because the desk reads a dozen products and twelve round
   * trips to answer one page is twelve times the latency for no benefit.
   */
  async dailySeriesForProducts(productIds: string[], from: string, to: string) {
    if (productIds.length === 0) return [];
    return rows<{ productId: string; date: string; minor: number }>(
      this.db,
      sql`
      with priced as (
        select l.product_id, po.observed_at as d, ${UNIVERSAL_EFFECTIVE_MINOR} as eff
          from price_observations po
          join offers   o on o.id = po.offer_id
          join listings l on l.id = o.listing_id
         where ${inList(sql`l.product_id`, productIds)}
           and po.is_in_stock
           and po.observed_at >= ${from}
           and po.observed_at <= ${to}
      )
      select product_id as "productId", d::text as "date", min(eff)::int as "minor"
        from priced
       group by product_id, d
       order by product_id, d asc`
    );
  }

  /** How many platforms carry each of these products. */
  async marketplaceCounts(productIds: string[]) {
    if (productIds.length === 0) return [];
    return rows<{ productId: string; marketplaceCount: number }>(
      this.db,
      sql`select l.product_id as "productId", count(distinct l.marketplace_id)::int as "marketplaceCount"
            from listings l
           where ${inList(sql`l.product_id`, productIds)}
           group by l.product_id`
    );
  }

  /** The distinct platforms the tracked set reaches, and how many exist. */
  async marketplaceCoverage(productIds: string[]) {
    const row = await one<{ covered: number; total: number }>(
      this.db,
      sql`select ${
        productIds.length === 0
          ? sql`0`
          : sql`(select count(distinct l.marketplace_id)::int from listings l
                  where ${inList(sql`l.product_id`, productIds)})`
      } as "covered",
             (select count(*)::int from marketplaces) as "total"`
    );
    return row ?? { covered: 0, total: 0 };
  }

  /**
   * The newest capture among the products ON THE DESK.
   *
   * Not the global maximum. The rule established with the price views is that
   * a view is anchored on the last capture of the thing it is about, and this
   * view is about the tracked set — anchoring on a product nobody is watching
   * would open every window on a day the desk has no evidence for.
   *
   * It is one anchor for the whole set rather than one per product, because
   * the desk compares products across a shared horizon and per-product
   * anchors would make those columns incomparable.
   */
  async referenceDate(productIds: string[]): Promise<string | null> {
    if (productIds.length === 0) return null;
    const row = await one<{ latest: string | null }>(
      this.db,
      sql`select max(po.observed_at)::text as latest
            from price_observations po
            join offers   o on o.id = po.offer_id
            join listings l on l.id = o.listing_id
           where ${inList(sql`l.product_id`, productIds)}`
    );
    return row?.latest ?? null;
  }

  /** The products a signed-in user has explicitly put on their desk. */
  async trackedFor(userId: string): Promise<string[]> {
    const found = await rows<{ productId: string }>(
      this.db,
      sql`select tp.product_id as "productId"
            from tracked_products tp
            join products p on p.id = tp.product_id
           where tp.user_id = ${userId}
           order by tp.tracked_at asc`
    );
    return found.map((r) => r.productId);
  }

  /** Which of these ids actually exist — an unknown id is reported, not dropped silently. */
  async existingProductIds(productIds: string[]): Promise<string[]> {
    if (productIds.length === 0) return [];
    const found = await rows<{ id: string }>(
      this.db,
      sql`select id from products where ${inList(sql`id`, productIds)}`
    );
    return found.map((r) => r.id);
  }
}
