import { sql, type SQL } from "drizzle-orm";

/**
 * THE PRICE LADDER, IN SQL
 * ========================
 *
 * There is exactly ONE definition of "effective price" in this product, and
 * it lives in `src/utils/priceLayers.js` on the frontend. This file is that
 * same definition expressed in SQL so the database can answer historical
 * questions without shipping 355,000 rows to JavaScript. It is a translation,
 * not a second opinion, and `tests/price-ladder-parity.test.ts` asserts the
 * two agree row for row on real data.
 *
 *   mrp                 the printed maximum — a legal ceiling, not an anchor
 *   sellingPrice        what the page displays
 *   shippingFee         delivery charged on top
 *   landed              sellingPrice + shipping
 *   universalEffective  landed − discounts EVERY buyer gets automatically
 *                       ★ the comparison price, and the only one
 *   conditionalBest     universalEffective − card / coupon / exchange benefits
 *                       real for some buyers, never comparable across sellers
 *
 * Two rules carried over exactly:
 *
 *   · A promotion is active on a date when `valid_from <= date <= valid_to`,
 *     inclusive, treating a null bound as open.
 *   · A discount is clamped so it can never take a price below zero. The
 *     dataset does not currently contain a discount large enough to need it,
 *     which is precisely why it must be in the query rather than assumed —
 *     see PRICE-04.
 *
 * Deferred (cashback) and financing (no-cost EMI) benefits are deliberately
 * absent from every rung. Money returned later, or interest someone else
 * absorbs, is not a price.
 */

/**
 * Sum of active promotions of one availability class for an observation.
 *
 * `po` is the price-observation alias in the surrounding query. A LATERAL
 * join per class keeps the arithmetic readable and lets the planner use
 * `promotions_offer_idx` for the lookup.
 */
function promotionTotal(availabilityClass: "universal" | "conditional" | "deferred" | "financing"): SQL {
  return sql`
    (select coalesce(sum(pr.discount_value_minor), 0)::int
       from promotions pr
      where pr.offer_id = po.offer_id
        and pr.availability_class = ${availabilityClass}
        and (pr.valid_from is null or pr.valid_from <= po.observed_at)
        and (pr.valid_to   is null or pr.valid_to   >= po.observed_at))`;
}

/** `sellingPrice + shipping`, for an observation aliased `po`. */
export const LANDED_MINOR: SQL = sql`(po.selling_price_minor + po.shipping_fee_minor)`;

/**
 * The universal discount, clamped to the landed price so the effective price
 * has a hard floor of zero.
 */
export const UNIVERSAL_DISCOUNT_MINOR: SQL = sql`least(${promotionTotal("universal")}, ${LANDED_MINOR})`;

/** ★ The comparison price. Everything that ranks or compares uses this. */
export const UNIVERSAL_EFFECTIVE_MINOR: SQL = sql`(${LANDED_MINOR} - ${UNIVERSAL_DISCOUNT_MINOR})`;

export const CONDITIONAL_DISCOUNT_MINOR: SQL = sql`least(${promotionTotal("conditional")}, ${UNIVERSAL_EFFECTIVE_MINOR})`;

export const CONDITIONAL_BEST_MINOR: SQL = sql`(${UNIVERSAL_EFFECTIVE_MINOR} - ${CONDITIONAL_DISCOUNT_MINOR})`;

export const DEFERRED_BENEFIT_MINOR: SQL = promotionTotal("deferred");
export const FINANCING_BENEFIT_MINOR: SQL = promotionTotal("financing");

/**
 * Every rung, as select-list columns, for a query whose observation alias is
 * `po`. Written once so no caller can quietly compute a rung differently.
 */
export const LADDER_COLUMNS: SQL = sql`
  po.mrp_minor                              as "mrpMinor",
  po.selling_price_minor                    as "sellingPriceMinor",
  po.shipping_fee_minor                     as "shippingFeeMinor",
  ${LANDED_MINOR}                           as "landedMinor",
  ${UNIVERSAL_DISCOUNT_MINOR}               as "universalDiscountMinor",
  ${UNIVERSAL_EFFECTIVE_MINOR}              as "universalEffectiveMinor",
  ${CONDITIONAL_DISCOUNT_MINOR}             as "conditionalDiscountMinor",
  ${CONDITIONAL_BEST_MINOR}                 as "conditionalBestMinor",
  ${DEFERRED_BENEFIT_MINOR}                 as "deferredBenefitMinor",
  ${FINANCING_BENEFIT_MINOR}                as "financingBenefitMinor"`;

/** The shape `LADDER_COLUMNS` produces. */
export type PriceLadder = {
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

/**
 * The basis every comparison in this system is made on, stated in the
 * response so a client never has to guess which rung it received.
 */
export const PRICE_BASIS = {
  basis: "universalEffective",
  description:
    "Landed price (item + delivery) minus only the discounts every buyer receives automatically. Card, coupon, exchange and membership benefits are reported separately and never enter a comparison.",
} as const;
