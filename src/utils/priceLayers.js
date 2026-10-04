import { getActivePromotionsForOffer, PROMOTION_CLASS } from "../data/promotions";
import { getCurrentFeeRule, computeNetRealizationMinor } from "../data/feeRules";

/**
 * THE PRICE LADDER
 * ================
 *
 * "The price" is not one number. Collapsing it into one is what produced the
 * indefensible recommendation this module exists to prevent. Each rung answers
 * a different question and belongs in a different calculation:
 *
 *   mrp                 The printed maximum. A LEGAL CEILING in India, not a
 *                       discount anchor — you may not sell above it.
 *   sellingPrice        What the page displays.
 *   shippingFee         Delivery charged on top.
 *   landed              sellingPrice + shipping. What leaves the buyer's wallet
 *                       before any incentive.
 *   universalEffective  landed − universally available instant discounts.
 *                       ★ THE COMPARISON PRICE. What an ordinary buyer with no
 *                       particular card, coupon or trade-in actually pays.
 *   conditionalBest     universalEffective − conditional benefits (bank card,
 *                       coupon, exchange, membership). The best case for SOME
 *                       buyers. Displayed, never benchmarked.
 *   deferredBenefit     Cashback / wallet credit returned later. Never a price.
 *   financingBenefit    No-cost EMI interest absorbed. Never a price.
 *   netRealization      What the SELLER banks after marketplace fees and GST.
 *                       Belongs only in margin work, never in customer-facing
 *                       competitiveness.
 *
 * The rule enforced everywhere downstream: market comparison uses
 * `universalEffectiveMinor`. Benchmarking your universal price against a
 * rival's card-only price is comparing two different things.
 */

export function buildPriceLayers({ observation, offerId, categoryId, marketplaceId, costMinor = null }) {
  if (!observation) return null;
  const dateIso = observation.observedAt;

  const active = getActivePromotionsForOffer(offerId, dateIso);
  const byClass = { universal: [], conditional: [], deferred: [], financing: [] };
  for (const p of active) byClass[p.availabilityClass]?.push(p);

  const sum = (arr) => arr.reduce((s, p) => s + p.discountValueMinor, 0);

  const sellingPriceMinor = observation.sellingPriceMinor;
  const shippingFeeMinor = observation.shippingFeeMinor ?? 0;
  const mrpMinor = observation.mrpMinor ?? null;
  const landedMinor = sellingPriceMinor + shippingFeeMinor;

  const universalDiscountMinor = Math.min(sum(byClass.universal), landedMinor);
  const universalEffectiveMinor = landedMinor - universalDiscountMinor;

  const conditionalDiscountMinor = Math.min(sum(byClass.conditional), universalEffectiveMinor);
  const conditionalBestMinor = universalEffectiveMinor - conditionalDiscountMinor;

  const deferredBenefitMinor = sum(byClass.deferred);
  const financingBenefitMinor = sum(byClass.financing);

  // Seller-side economics — deliberately separate from every customer-facing rung.
  const feeRule = categoryId && marketplaceId ? getCurrentFeeRule(marketplaceId, categoryId, dateIso) : null;
  const net = feeRule
    ? computeNetRealizationMinor({ sellingPriceMinor, shippingFeeMinor, feeRule })
    : null;
  const marginMinor = net && costMinor != null ? net.netRealizationMinor - costMinor : null;

  return {
    dateIso,
    mrpMinor,
    sellingPriceMinor,
    shippingFeeMinor,
    landedMinor,
    universalDiscountMinor,
    universalEffectiveMinor,
    conditionalDiscountMinor,
    conditionalBestMinor,
    deferredBenefitMinor,
    financingBenefitMinor,
    discountFromMrpPct: mrpMinor ? (mrpMinor - universalEffectiveMinor) / mrpMinor : null,
    promotions: { ...byClass },
    feeRule,
    netRealizationMinor: net?.netRealizationMinor ?? null,
    marginMinor,
    marginPct: marginMinor != null && sellingPriceMinor ? marginMinor / sellingPriceMinor : null,
  };
}

/**
 * Re-exported from `utils/priceLadderView.js`, where it now lives.
 *
 * It is pure presentation and was moved out so a screen can render a ladder
 * without importing this module — which pulls the bundled fee table and
 * promotions in behind it. Existing callers keep working through this name.
 */
export { describeLadder } from "./priceLadderView";

export { PROMOTION_CLASS };
