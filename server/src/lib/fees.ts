import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

/**
 * MARKETPLACE FEES, IN ONE PLACE
 * ==============================
 *
 * What a seller actually banks after a platform takes its cut. Two screens ask
 * for it — the marketplace comparison and the pricing recommendation's margin —
 * and they used to ask two different modules, which is how the two answers
 * drifted apart.
 *
 * ── A DIVERGENCE THAT IS REAL AND IS NOT RESOLVED HERE ───────────────────
 * The browser's comparison table and the backend's margin calculation do not
 * agree, and never have:
 *
 *   comparison table   fees = referral + fixed + SHIPPING, then GST on all three
 *   recommendation     fees = referral + fixed,            then GST on those two
 *
 * On a free-delivery offer they agree exactly. On a paid-delivery one they do
 * not, and the comparison reports the lower figure.
 *
 * Both are defensible — whether the seller bears the shipping depends on the
 * fulfilment programme — and deciding between them is a pricing-policy
 * question, not a migration one. So this exposes BOTH, named for what they
 * compute, and the caller states which it means. Quietly unifying them would
 * change numbers on a screen under the guise of moving where data comes from.
 */

/** GST charged on marketplace fees, not on the item. */
export const GST_ON_FEES = 0.18;

export type FeeRule = {
  marketplaceId: string;
  categoryId: string | null;
  referralPct: number;
  fixedClosingFee: number;
  /** True when no category-specific rule exists and the default card applies. */
  isCategoryDefault: boolean;
};

/**
 * The fee rule in force per marketplace for one category, on one date.
 *
 * A category-specific rule beats the marketplace's default rate card, and the
 * default is flagged when it applies — a margin resting on a default rate is
 * weaker evidence than one resting on a confirmed rate, and the UI says so.
 *
 * `distinct on (marketplace_id)` with category-first ordering does in one
 * query what a find-then-fallback does per marketplace.
 */
export async function feeRulesForCategory(db: Db, categoryId: string, onDate: string): Promise<FeeRule[]> {
  const result = (await db.execute(sql`
    select distinct on (f.marketplace_id)
           f.marketplace_id        as "marketplaceId",
           f.category_id           as "categoryId",
           f.referral_pct          as "referralPct",
           f.fixed_closing_fee     as "fixedClosingFee",
           (f.category_id is null) as "isCategoryDefault"
      from fee_rules f
     where (f.category_id = ${categoryId} or f.category_id is null)
       and f.effective_from <= ${onDate}
       and (f.effective_to is null or f.effective_to >= ${onDate})
     order by f.marketplace_id,
              -- A category rule beats the default; a later rule beats an
              -- earlier one where both are somehow in force.
              (f.category_id is null) asc,
              f.effective_from desc`)) as unknown as { rows: FeeRule[] };
  return result.rows;
}

export type NetRealisation = {
  referralFeeMinor: number;
  fixedFeeMinor: number;
  shippingFeeMinor: number;
  gstMinor: number;
  totalFeesMinor: number;
  netRealisationMinor: number;
};

/**
 * Net realisation as the MARKETPLACE COMPARISON screen defines it.
 *
 * Shipping is treated as a cost the seller bears and is included in the fee
 * base, so GST applies to it too. This is the figure that screen has always
 * shown; see the divergence note at the top of this file before changing it.
 *
 * Null when no fee rule is captured for the platform — an unknown margin is
 * reported as unknown, never as the full selling price.
 */
export function netRealisationWithShipping(input: {
  sellingPriceMinor: number;
  shippingFeeMinor?: number;
  feeRule: FeeRule | null;
}): NetRealisation | null {
  const { sellingPriceMinor, shippingFeeMinor = 0, feeRule } = input;
  if (!feeRule) return null;

  const referralFeeMinor = Math.round(sellingPriceMinor * (feeRule.referralPct / 100));
  // `fixed_closing_fee` is stored in major units; every other money column on
  // this path is minor. Mixing them silently under-reports fees by 100x.
  const fixedFeeMinor = feeRule.fixedClosingFee * 100;
  const feesBeforeGstMinor = referralFeeMinor + fixedFeeMinor + shippingFeeMinor;
  const gstMinor = Math.round(feesBeforeGstMinor * GST_ON_FEES);

  return {
    referralFeeMinor,
    fixedFeeMinor,
    shippingFeeMinor,
    gstMinor,
    totalFeesMinor: feesBeforeGstMinor + gstMinor,
    netRealisationMinor: sellingPriceMinor - feesBeforeGstMinor - gstMinor,
  };
}
