import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client.js";

/**
 * The commercial inputs the recommendation needs and the analysis layer does
 * not: marketplace fee rules, the seller's own cost, and the MRP observed on
 * a product's listings.
 *
 * Everything else — the competitive set, the market statistics, the history,
 * the strength index — comes from the Phase 5 services. Nothing here
 * recomputes any of it.
 */

async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

async function one<T>(db: Db, query: SQL): Promise<T | null> {
  const [row] = await rows<T>(db, query);
  return row ?? null;
}

export type FeeRuleRow = {
  marketplaceId: string;
  categoryId: string | null;
  referralPct: number;
  fixedClosingFee: number;
  isCategoryDefault: boolean;
};

export type MrpFacts = { maxMrpMinor: number | null };

export type MatchQualityRow = {
  total: number;
  withConfidence: number;
  minConfidence: number | null;
  autoMatched: number;
};

export class PricingRepository {
  constructor(private readonly db: Db) {}

  /**
   * Fee rules in force on a date, one per marketplace.
   *
   * A category-specific rule wins; otherwise the marketplace's default rate
   * card applies and is flagged, because a margin resting on a default rate
   * is weaker evidence than one resting on a confirmed one.
   *
   * `distinct on (marketplace_id)` with category-first ordering does in one
   * query what the frontend does with a find-then-fallback per marketplace.
   */
  async feeRules(categoryId: string, onDate: string): Promise<FeeRuleRow[]> {
    return rows<FeeRuleRow>(
      this.db,
      sql`
      select distinct on (f.marketplace_id)
             f.marketplace_id                    as "marketplaceId",
             f.category_id                       as "categoryId",
             f.referral_pct                      as "referralPct",
             f.fixed_closing_fee                 as "fixedClosingFee",
             (f.category_id is null)             as "isCategoryDefault"
        from fee_rules f
       where (f.category_id = ${categoryId} or f.category_id is null)
         and f.effective_from <= ${onDate}
         and (f.effective_to is null or f.effective_to >= ${onDate})
       order by f.marketplace_id,
                -- A category rule beats the default; a later rule beats an
                -- earlier one where both are somehow in force.
                (f.category_id is null) asc,
                f.effective_from desc`
    );
  }

  /** Every marketplace, so the break-even scan covers the same set the engine does. */
  async allMarketplaceIds(): Promise<string[]> {
    const found = await rows<{ id: string }>(this.db, sql`select id from marketplaces order by id`);
    return found.map((r) => r.id);
  }

  async sellerCost(productId: string): Promise<{ costPriceMinor: number } | null> {
    return one<{ costPriceMinor: number }>(
      this.db,
      sql`select cost_price_minor as "costPriceMinor"
            from seller_cost_inputs
           where product_id = ${productId}
           order by entered_at desc
           limit 1`
    );
  }

  /**
   * The highest MRP observed on this product.
   *
   * Sellers print different MRPs; the highest is the least restrictive
   * ceiling that can be defended, so it is the one enforced.
   */
  async observedMrp(productId: string): Promise<MrpFacts> {
    const row = await one<{ maxMrpMinor: number | null }>(
      this.db,
      sql`select max(po.mrp_minor)::int as "maxMrpMinor"
            from price_observations po
            join offers   o on o.id = po.offer_id
            join listings l on l.id = o.listing_id
           where l.product_id = ${productId} and po.mrp_minor is not null and po.mrp_minor > 0`
    );
    return { maxMrpMinor: row?.maxMrpMinor ?? null };
  }

  /**
   * Are the offers treated as this product's actually this product's?
   *
   * Below a 95% floor some of them may belong to a different product, and
   * the "market" being measured is then partly someone else's.
   */
  async matchQuality(productId: string): Promise<MatchQualityRow> {
    const row = await one<MatchQualityRow>(
      this.db,
      sql`select count(*)::int                                                  as "total",
                 count(l.match_confidence)::int                                 as "withConfidence",
                 min(l.match_confidence)                                        as "minConfidence",
                 count(*) filter (where l.match_status <> 'human_confirmed')::int as "autoMatched"
            from listings l
           where l.product_id = ${productId}`
    );
    return row ?? { total: 0, withConfidence: 0, minConfidence: null, autoMatched: 0 };
  }
}
