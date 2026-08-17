import { products, getProduct, getVariantSiblings } from "../data/products";
import { getListingsForProduct } from "../data/listings";
import { getOffersForListing } from "../data/offers";
import { getLatestObservation, getPriceHistoryForOffer } from "../data/priceObservations";
import { getBrand, TIER_RANK } from "../data/brands";
import { getSeller, getLatestSellerRating } from "../data/sellers";
import { getCurrentFeeRule, computeBreakEvenPriceMinor } from "../data/feeRules";
import { getSellerCost } from "../data/sellerInputs";
import { getPricingRelevantAttributes } from "../data/attributeDefinitions";
import { getProductReviewMetrics } from "../utils/productMetrics";
import {
  buildCompetitiveSet,
  competitiveIdentityOf,
  weightedDistribution,
  COMPETITOR_POLICY,
} from "./competitiveSet";
import { getCategoryPath, productTypes } from "../data/categories";
import { marketplaces } from "../data/marketplaces";
import { buildPriceLayers } from "./priceLayers";
import { formatMinor } from "./money";
import { fitHedonicModel } from "./hedonicModel";

const formatPctLocal = (v) => `${(v * 100).toFixed(1)}%`;

/**
 * PRICING INTELLIGENCE ENGINE
 * ===========================
 *
 * Rebuilt from first principles after the previous version produced an
 * indefensible result: a ₹1,999-MRP power bank trading at ₹1,099–₹1,250 was
 * given a "Premium" recommendation of ₹3,399 — above its own MRP and 3× the
 * market. That was not one bad number; it exposed four structural gaps, each
 * of which is now addressed explicitly:
 *
 *   1. NO HARD CONSTRAINTS. A recommendation could exceed the applicable MRP,
 *      which is not a bold pricing strategy but an invalid one. Hard
 *      constraints now bound every strategy and are reported.
 *   2. INCOHERENT COMPARABLE SET. A product at 32% similarity and 4× the price
 *      was allowed to set the premium anchor. Comparables are now trimmed for
 *      price coherence and every exclusion is recorded with its reason.
 *   3. STATISTICS ON A DISPERSED SET. Q3 of a set spanning ₹1,099–₹4,999 is
 *      not a price signal. Dispersion now degrades evidence and narrows spread.
 *   4. DECORATIVE CONFIDENCE. "Medium" on that set was meaningless. Evidence is
 *      now scored, gates the output entirely when too weak, and scales how far
 *      strategies may travel from the market median.
 *
 * A fifth principle runs through everything: the price used for market
 * comparison is the UNIVERSAL EFFECTIVE price (see priceLayers.js) — what an
 * ordinary buyer pays with no special card, coupon or trade-in. Benchmarking a
 * universal price against a rival's conditional price is comparing two
 * different things, and the engine never does it.
 */

const TODAY = "2026-08-14";

// Tunables, named so their intent is auditable rather than buried as magic numbers.
// Everything governing WHO counts as a competitor now lives in COMPETITOR_POLICY
// (utils/competitiveSet.js), so the selection rules are stated once.
const MIN_COMPARABLES_FOR_RECOMMENDATION = COMPETITOR_POLICY.minimumForRecommendation;
const COMPETITOR_TARGET = COMPETITOR_POLICY.target;
const HEALTHY_DISPERSION = 0.35; // IQR / median at or below this reads as a coherent market

// How far above the product's OWN observed market a Premium price may sit.
// These are the numbers that make CF-1 impossible to reproduce: without a
// trusted attribute model the ceiling is the top of the product's own market,
// full stop, and even with one the result is capped.
const MAX_EVIDENCED_PREMIUM_OVER_OWN = 0.25;
const MAX_UNEVIDENCED_PREMIUM_OVER_ANCHOR = 0.1; // only used when the product has no market of its own

// ---------------------------------------------------------------------------
// Commercial state — the full ladder for one offer, at one moment
// ---------------------------------------------------------------------------

function offerCommercialState(offer, listing, product, costMinor = null) {
  const observation = getLatestObservation(offer.id);
  if (!observation) return null;
  const layers = buildPriceLayers({
    observation,
    offerId: offer.id,
    categoryId: product?.categoryId,
    marketplaceId: listing.marketplaceId,
    costMinor,
  });
  const seller = getSeller(offer.sellerId);
  return {
    offer,
    listing,
    seller,
    sellerRating: getLatestSellerRating(offer.sellerId),
    observation,
    layers,
    inStock: observation.isInStock,
    isBuyboxWinner: observation.isBuyboxWinner,
  };
}

/** Every current offer for a product, with its full price ladder. */
export function getCommercialState(productId) {
  const product = getProduct(productId);
  const cost = getSellerCost(productId);
  const rows = [];
  for (const listing of getListingsForProduct(productId)) {
    for (const offer of getOffersForListing(listing.id)) {
      const state = offerCommercialState(offer, listing, product, cost?.costPriceMinor ?? null);
      if (state) rows.push(state);
    }
  }
  return rows;
}

/**
 * The product's comparison price: cheapest IN-STOCK universal effective price.
 * Returns the whole ladder so callers can show what sits above and below it.
 */
export function getCurrentEffectivePrice(productId) {
  let best = null;
  for (const s of getCommercialState(productId)) {
    if (!s.inStock) continue;
    const value = s.layers.universalEffectiveMinor;
    if (best === null || value < best.universalEffectiveMinor) {
      best = {
        universalEffectiveMinor: value,
        landedMinor: s.layers.landedMinor,
        conditionalBestMinor: s.layers.conditionalBestMinor,
        listingId: s.listing.id,
        offerId: s.offer.id,
        marketplaceId: s.listing.marketplaceId,
        sellerId: s.offer.sellerId,
        layers: s.layers,
      };
    }
  }
  return best;
}

/**
 * THE ONE PRICE BASIS
 * ===================
 * Every price the engine compares, plots or reasons about is the UNIVERSAL
 * EFFECTIVE price. The audit found history running on LANDED price while the
 * current market ran on universal effective, so a product with a live instant
 * discount was measured against its own past on a different definition — the
 * Galaxy M14 showed a ₹11,700 "normal" against an ₹11,470 "current" purely
 * because the two numbers meant different things, and the engine then read the
 * gap as a promotional dip. Anything that produces a price series must go
 * through `observationEffectiveMinor` so that can never recur.
 */
export const PRICE_BASIS = {
  key: "universal_effective",
  label: "Effective price",
  description: "selling price + shipping − instant discounts available to every buyer",
};

/**
 * One historical observation, resolved to the comparison basis. Promotions are
 * resolved against the observation's OWN date, so a discount that ran in June
 * lowers June's point and not today's.
 *
 * categoryId/marketplaceId are deliberately omitted: they only drive the
 * seller-side fee rungs, which play no part in a customer-facing price series,
 * and resolving them per day across ~35,000 observations is pure cost.
 */
function observationEffectiveMinor(observation, offerId) {
  return buildPriceLayers({ observation, offerId }).universalEffectiveMinor;
}

export function getEffectivePriceOnDate(productId, dateIso) {
  let best = null;
  for (const listing of getListingsForProduct(productId)) {
    for (const offer of getOffersForListing(listing.id)) {
      const rows = getPriceHistoryForOffer(offer.id).filter((o) => o.observedAt <= dateIso && o.isInStock);
      if (rows.length === 0) continue;
      const effective = observationEffectiveMinor(rows[rows.length - 1], offer.id);
      if (best === null || effective < best) best = effective;
    }
  }
  return best;
}

// The series is derived from immutable observations, so it is computed once
// per product and reused. Without this, resolving promotions per observation
// would be repeated on every recommendation, chart render and audit pass.
const seriesCache = new Map();

export function getProductPriceSeries(productId) {
  const hit = seriesCache.get(productId);
  if (hit !== undefined) return hit;

  const byDate = new Map();
  for (const listing of getListingsForProduct(productId)) {
    for (const offer of getOffersForListing(listing.id)) {
      for (const obs of getPriceHistoryForOffer(offer.id)) {
        if (!obs.isInStock) continue;
        const effective = observationEffectiveMinor(obs, offer.id);
        const existing = byDate.get(obs.observedAt);
        if (existing === undefined || effective < existing.minor) {
          byDate.set(obs.observedAt, {
            minor: effective,
            landedMinor: obs.sellingPriceMinor + obs.shippingFeeMinor,
            saleLabel: obs.saleLabel,
          });
        }
      }
    }
  }
  const series = [...byDate.entries()]
    .map(([date, v]) => ({ date, minor: v.minor, landedMinor: v.landedMinor, saleLabel: v.saleLabel, basis: PRICE_BASIS.key }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  seriesCache.set(productId, series);
  return series;
}

// ---------------------------------------------------------------------------
// Applicable MRP — a hard ceiling, plus an honest read on whether it means much
// ---------------------------------------------------------------------------

function resolveApplicableMrp(productId, marketMedianMinor) {
  const mrps = getCommercialState(productId)
    .map((s) => s.layers.mrpMinor)
    .filter((v) => v != null && v > 0);
  if (mrps.length === 0) {
    return { mrpMinor: null, reliability: "unknown", note: "No MRP observed on any listing for this product." };
  }
  // Sellers can print different MRPs; the highest observed is the least
  // restrictive ceiling we can defend, so it is the one we enforce.
  const mrpMinor = Math.max(...mrps);
  const ratio = marketMedianMinor ? mrpMinor / marketMedianMinor : null;
  const inflated = ratio != null && ratio > 2.2;
  return {
    mrpMinor,
    reliability: inflated ? "inflated" : "reliable",
    ratioToMarket: ratio,
    note: inflated
      ? `MRP is ${ratio.toFixed(1)}× the going market price, which is typical of a headline MRP set for display. It still caps what may legally be charged, but it is not evidence that the market will bear a higher price.`
      : null,
  };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function computeDistributionStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    q1: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    q3: percentile(sorted, 0.75),
    iqr: percentile(sorted, 0.75) - percentile(sorted, 0.25),
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Snap granularity scales with price. A flat ₹100 grid is far too coarse at
 * the low end — it collapsed ₹1,249 to ₹1,199, which was enough to merge two
 * genuinely different strategies into one number.
 */
function snapGranularity(rupees) {
  if (rupees < 1000) return 10;
  if (rupees < 10000) return 50;
  return 100;
}

function snapToPsychologicalPrice(minor) {
  const rupees = minor / 100;
  const g = snapGranularity(rupees);
  return Math.max(Math.floor(rupees / g) * g - 1, 1) * 100;
}

/** Snap to a credible ending, but never outside the hard bounds it was clamped into. */
function snapWithin(minor, floorMinor, ceilingMinor) {
  const step = snapGranularity(minor / 100) * 100;
  let snapped = snapToPsychologicalPrice(minor);
  while (snapped < floorMinor) snapped += step;
  if (ceilingMinor != null && snapped > ceilingMinor) {
    // Step down to the nearest credible point that respects the ceiling.
    while (snapped > ceilingMinor) snapped -= step;
    if (snapped < floorMinor) return Math.round(ceilingMinor); // bounds collide — sit exactly on the ceiling
  }
  return snapped;
}

// ---------------------------------------------------------------------------
// Competitive evidence set
// ---------------------------------------------------------------------------

/**
 * Comparable selection, similarity scoring, identity de-duplication and
 * evidence weighting all live in utils/competitiveSet.js. That subsystem grew
 * large enough to reason about on its own terms — what counts as a competitor,
 * what merely informs price, and how much each is worth as evidence — and the
 * engine reads better consuming a competitive set than computing one inline.
 *
 * This wrapper keeps the price basis in exactly one place: competitiveSet never
 * decides which rung of the price ladder to compare on, it is handed one.
 */
export function buildComparableSet(targetProductId, { mrpMinor = null } = {}) {
  return buildCompetitiveSet(targetProductId, { priceOf: getCurrentEffectivePrice, mrpMinor });
}

// ---------------------------------------------------------------------------
// Product strength
// ---------------------------------------------------------------------------

function buildStrength(target, comps) {
  const attrs = getPricingRelevantAttributes(target.productTypeId);
  const numericAttrs = attrs.filter((a) => ["integer", "decimal"].includes(a.dataType));
  // Same shared aggregation the catalogue and the comparable set use, so the
  // rating this reasoning is built on is the rating the user can see.
  const targetReview = getProductReviewMetrics(target.id);
  const targetRating = targetReview.rating;
  const targetReviews = targetReview.reviewCount;

  const compRatings = comps.map((c) => c.rating).filter((r) => r != null);
  const compReviews = comps.map((c) => c.reviewCount).filter((r) => r != null);
  const medianRating = compRatings.length ? computeDistributionStats(compRatings).median : null;
  const medianReviews = compReviews.length ? computeDistributionStats(compReviews).median : null;

  const ratingScore = clamp(targetRating != null && medianRating != null ? (targetRating - medianRating) / 0.4 : 0, -1, 1);
  const reviewScore = clamp(targetReviews && medianReviews ? Math.log10(targetReviews / medianReviews) : 0, -1, 1);

  const specAdvantages = [];
  const specDisadvantages = [];
  let specTies = 0;
  for (const attr of numericAttrs) {
    const mine = Number(target.specifications?.[attr.attributeKey]);
    if (!Number.isFinite(mine)) continue;
    const theirs = comps.map((c) => Number(c.product.specifications?.[attr.attributeKey])).filter(Number.isFinite);
    if (theirs.length === 0) continue;
    const compMedian = computeDistributionStats(theirs).median;
    if (compMedian === mine) {
      specTies++;
      continue;
    }
    const better = attr.higherIsBetter === false ? mine < compMedian : mine > compMedian;
    const entry = {
      key: attr.attributeKey,
      label: attr.displayName,
      unit: attr.unit,
      mine,
      compMedian: Math.round(compMedian * 100) / 100,
      higherIsBetter: attr.higherIsBetter !== false,
    };
    (better ? specAdvantages : specDisadvantages).push(entry);
  }
  const specTotal = specAdvantages.length + specDisadvantages.length;
  const specScore = specTotal === 0 ? 0 : (specAdvantages.length - specDisadvantages.length) / specTotal;

  const targetTier = TIER_RANK[getBrand(target.brandId)?.tier] ?? 1;
  const compTiers = comps.map((c) => TIER_RANK[c.brand?.tier] ?? 1);
  const medianTier = compTiers.length ? computeDistributionStats(compTiers).median : targetTier;
  const tierScore = clamp(targetTier - medianTier, -1, 1);

  const components = [
    { key: "rating", label: "Customer rating", weight: 0.3, score: ratingScore, detail: targetRating != null && medianRating != null ? `${targetRating.toFixed(1)}★ vs comp-set median ${medianRating.toFixed(1)}★ — ${targetReview.basis}` : "no rating captured" },
    { key: "reviews", label: "Review volume", weight: 0.15, score: reviewScore, detail: targetReviews && medianReviews ? `${targetReviews.toLocaleString("en-IN")} vs median ${Math.round(medianReviews).toLocaleString("en-IN")}` : "no review counts captured" },
    { key: "specs", label: "Specification profile", weight: 0.35, score: specScore, detail: specTotal === 0 ? (specTies > 0 ? `matches the comp median on all ${specTies} pricing-relevant specs` : "no comparable numeric specs") : `${specAdvantages.length} ahead, ${specDisadvantages.length} behind${specTies ? `, ${specTies} tied` : ""}` },
    { key: "brand", label: "Brand tier", weight: 0.2, score: tierScore, detail: `${getBrand(target.brandId)?.tier ?? "—"} vs comp-set median tier ${["value", "mid", "premium"][Math.round(medianTier)] ?? "—"}` },
  ];

  return {
    index: Math.round(components.reduce((s, c) => s + c.weight * c.score, 0) * 1000) / 1000,
    components,
    specAdvantages,
    specDisadvantages,
    targetRating,
    targetReviews,
    targetRatingBasis: targetReview.basis,
    medianRating,
    medianReviews,
  };
}

// ---------------------------------------------------------------------------
// Capture quality — how much the compared prices can be trusted as prices
// ---------------------------------------------------------------------------

/**
 * Two things can make a set of correctly-computed prices still misleading:
 *
 *   MATCH QUALITY — if a listing is only auto-matched to this product, some of
 *   the "offers for this product" may be offers for something else. The data
 *   model has carried `matchStatus` and `matchConfidence` since the beginning;
 *   the engine simply never read them.
 *
 *   PROMOTION VISIBILITY — a price pulled down by a live universal discount is
 *   a real price today and a temporary one tomorrow. When most of the compared
 *   prices are promotion-driven, the "market" being measured is a sale, and the
 *   recommendation should be held to lower confidence rather than presented as
 *   a reading of the standing market.
 */
function assessMatchQuality(productId) {
  const rows = getListingsForProduct(productId);
  if (rows.length === 0) return { known: false, minConfidence: null, autoMatched: 0, total: 0 };
  const confidences = rows.map((l) => l.matchConfidence).filter((v) => v != null);
  return {
    known: confidences.length > 0,
    minConfidence: confidences.length ? Math.min(...confidences) : null,
    autoMatched: rows.filter((l) => l.matchStatus !== "human_confirmed").length,
    total: rows.length,
  };
}

function assessPromotionVisibility(competition, comps) {
  const own = competition.offers.filter((o) => o.inStock);
  const ownPromo = own.filter((o) => o.hasUniversalPromo).length;
  const compPromo = comps.filter((c) => c.hasUniversalPromo).length;
  const total = own.length + comps.length;
  return {
    total,
    promoDriven: ownPromo + compPromo,
    ownPromoDriven: ownPromo,
    compPromoDriven: compPromo,
    share: total > 0 ? (ownPromo + compPromo) / total : 0,
  };
}

// ---------------------------------------------------------------------------
// History / competition
// ---------------------------------------------------------------------------

function buildHistory(productId) {
  const series = getProductPriceSeries(productId);
  if (series.length === 0) return null;
  const values = series.map((p) => p.minor);
  const cutoff = (days) => {
    const d = new Date(TODAY);
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const windowMedian = (days) => {
    const from = cutoff(days);
    const w = series.filter((p) => p.date >= from).map((p) => p.minor);
    return w.length ? computeDistributionStats(w).median : null;
  };
  const current = series[series.length - 1].minor;
  const first = series[0].minor;
  return {
    observationCount: series.length,
    firstDate: series[0].date,
    lastDate: series[series.length - 1].date,
    currentMinor: current,
    minMinor: Math.min(...values),
    maxMinor: Math.max(...values),
    median30: windowMedian(30),
    median60: windowMedian(60),
    median90: windowMedian(90),
    trendPct: first ? (current - first) / first : 0,
    vsHistoricLowPct: Math.min(...values) ? (current - Math.min(...values)) / Math.min(...values) : 0,
    promoDays: series.filter((p) => p.saleLabel).length,
    promoLabels: [...new Set(series.filter((p) => p.saleLabel).map((p) => p.saleLabel))],
    series,
  };
}

function buildCompetition(productId) {
  const state = getCommercialState(productId);
  const inStock = state.filter((s) => s.inStock);
  const prices = inStock.map((s) => s.layers.universalEffectiveMinor);
  const stats = prices.length ? computeDistributionStats(prices) : null;
  const listings = getListingsForProduct(productId);
  return {
    offerCount: state.length,
    inStockOfferCount: inStock.length,
    listingCount: listings.length,
    marketplaceCount: new Set(listings.map((l) => l.marketplaceId)).size,
    cheapestMinor: stats?.min ?? null,
    medianMinor: stats?.median ?? null,
    spreadMinor: stats ? stats.max - stats.min : null,
    reviewVelocity: getProductReviewMetrics(productId).reviewVelocity,
    offers: state
      .map((s) => ({
        sellerName: s.seller?.name ?? "—",
        sellerType: s.seller?.sellerType ?? null,
        sellerRating: s.sellerRating?.rating ?? null,
        fulfilment: s.seller?.defaultFulfilmentType ?? null,
        marketplaceId: s.listing.marketplaceId,
        universalEffectiveMinor: s.layers.universalEffectiveMinor,
        conditionalBestMinor: s.layers.conditionalBestMinor,
        hasUniversalPromo: s.layers.universalDiscountMinor > 0,
        inStock: s.inStock,
        isBuyboxWinner: s.isBuyboxWinner,
      }))
      .sort((a, b) => a.universalEffectiveMinor - b.universalEffectiveMinor),
  };
}

function buildCommercial(target) {
  const cost = getSellerCost(target.id);
  const perMarketplace = marketplaces.map((mp) => {
    const feeRule = getCurrentFeeRule(mp.id, target.categoryId);
    const breakEvenMinor =
      cost && feeRule ? computeBreakEvenPriceMinor({ costMinor: cost.costPriceMinor, shippingFeeMinor: 0, feeRule }) : null;
    return { marketplace: mp, feeRule, breakEvenMinor };
  });
  const floors = perMarketplace.map((m) => m.breakEvenMinor).filter((v) => v != null);
  return {
    cost,
    perMarketplace,
    highestBreakEvenMinor: floors.length ? Math.max(...floors) : null,
    usesDefaultFeeRule: perMarketplace.some((m) => m.feeRule?.isCategoryDefault),
  };
}

function marginsAt(priceMinor, commercial) {
  return commercial.perMarketplace.map((m) => {
    if (!commercial.cost || !m.feeRule) return { ...m, marginMinor: null, marginPct: null };
    const referral = Math.round(priceMinor * (m.feeRule.referralPct / 100));
    const fixed = m.feeRule.fixedClosingFee * 100;
    const gst = Math.round((referral + fixed) * 0.18);
    const net = priceMinor - referral - fixed - gst;
    const marginMinor = net - commercial.cost.costPriceMinor;
    return { ...m, netMinor: net, marginMinor, marginPct: marginMinor / priceMinor };
  });
}

// ---------------------------------------------------------------------------
// Evidence sufficiency — gates the whole output
// ---------------------------------------------------------------------------

function assessEvidence({ comps, coverage, diversity, stats, history, commercial, competition, mrp, matchQuality, promotionVisibility }) {
  const checks = [];
  const push = (key, label, ok, detail, weight = 1) => checks.push({ key, label, ok, detail, weight });

  const n = comps.length;

  // Competitive breadth — the professor's "at least 5", read as a target and
  // graded rather than enforced. Note the check is on DIRECT competitors: a set
  // padded out with loose comparables does not satisfy it.
  push(
    "competitor_breadth",
    "Competitive breadth",
    coverage.directCount >= COMPETITOR_TARGET,
    coverage.directCount >= COMPETITOR_TARGET
      ? `${coverage.directCount} direct competitors compared, meeting the ${COMPETITOR_TARGET}-competitor target`
      : `${coverage.directCount} direct competitor${coverage.directCount === 1 ? "" : "s"} against a target of ${COMPETITOR_TARGET}${coverage.comparableCount ? `, plus ${coverage.comparableCount} weaker comparable${coverage.comparableCount === 1 ? "" : "s"}` : ""}`,
    2
  );

  // Breadth is a count; this is its worth. Five near-duplicates with thin data
  // score far below five well-observed rivals, so the two checks cannot both be
  // satisfied by padding.
  push(
    "evidence_depth",
    "Weighted evidence",
    coverage.effectiveComparables >= COMPETITOR_TARGET * 0.7,
    `${coverage.effectiveComparables.toFixed(1)} effective comparables from ${n} product${n === 1 ? "" : "s"}, after weighting each by relevance and data quality`,
    2
  );

  const dispersion = stats && stats.median ? stats.iqr / stats.median : null;
  push(
    "coherence",
    "Comparable-set coherence",
    dispersion != null && dispersion <= HEALTHY_DISPERSION,
    dispersion != null ? `interquartile spread is ${(dispersion * 100).toFixed(0)}% of the median` : "not measurable",
    2
  );

  push("history", "Price history depth", (history?.observationCount ?? 0) >= 30, history ? `${history.observationCount} daily observations` : "no history captured");
  push("competition", "Competitor coverage", (competition?.inStockOfferCount ?? 0) >= 2, `${competition?.inStockOfferCount ?? 0} in-stock offer(s) observed`);
  push("cost", "Seller cost", !!commercial.cost, commercial.cost ? "entered by seller" : "not entered — margin and break-even unavailable");
  push("fees", "Marketplace fee rates", !commercial.usesDefaultFeeRule, commercial.usesDefaultFeeRule ? "using marketplace default rates, not confirmed category rates" : "category-specific rates available");
  push("mrp", "Applicable MRP", mrp.mrpMinor != null && mrp.reliability === "reliable", mrp.mrpMinor == null ? "no MRP observed" : mrp.reliability === "inflated" ? "MRP appears inflated relative to market" : "MRP observed and plausible");

  // Are the offers we are treating as this product's actually this product's?
  // Every listing must be either human-confirmed, or auto-matched at 95%+.
  // Below that, some of the offers being treated as this product's may belong
  // to a different product, and the "market" is partly someone else's.
  const mq = matchQuality ?? { known: false };
  const MATCH_CONFIDENCE_FLOOR = 0.95;
  push(
    "match_quality",
    "Listing match quality",
    mq.known === true && mq.minConfidence >= MATCH_CONFIDENCE_FLOOR,
    !mq.known
      ? "no match confidence recorded on this product's listings"
      : mq.minConfidence < MATCH_CONFIDENCE_FLOOR
        ? `${mq.autoMatched} of ${mq.total} listing${mq.total === 1 ? "" : "s"} auto-matched, lowest confidence ${(mq.minConfidence * 100).toFixed(0)}% — below the ${MATCH_CONFIDENCE_FLOOR * 100}% needed to treat every offer as certainly this product's`
        : `all ${mq.total} listing${mq.total === 1 ? "" : "s"} matched at ${(mq.minConfidence * 100).toFixed(0)}%+ confidence (${mq.autoMatched} auto-matched)`
  );

  // Are we measuring the standing market, or a sale?
  const pv = promotionVisibility ?? { total: 0, share: 0, promoDriven: 0 };
  push(
    "promotion_visibility",
    "Promotion-free comparison",
    pv.total > 0 && pv.share <= 0.34,
    pv.total === 0
      ? "no prices available to check"
      : pv.promoDriven === 0
        ? `none of the ${pv.total} compared prices is currently cut by an instant discount`
        : `${pv.promoDriven} of ${pv.total} compared prices (${Math.round(pv.share * 100)}%) are currently cut by a live instant discount, so the observed market is partly a sale`
  );

  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const score = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0) / totalWeight;

  // Confidence is capped by competitive coverage, not merely influenced by it.
  // A product compared against three rivals cannot reach "high" however clean
  // the rest of its data is — the cap is the honest statement that the market
  // has not been observed widely enough, and it is the reason padding the set
  // cannot buy a better label.
  const coverageCap = { strong: "high", adequate: "medium-high", thin: "medium", insufficient: "low" }[coverage.level] ?? "low";
  const ORDER = ["low", "medium", "medium-high", "high"];

  let level = "low";
  if (score >= 0.8) level = "high";
  else if (score >= 0.6) level = "medium-high";
  else if (score >= 0.4) level = "medium";
  if (ORDER.indexOf(level) > ORDER.indexOf(coverageCap)) level = coverageCap;

  return {
    level,
    score: Math.round(score * 100) / 100,
    checks,
    coverageCap,
    cappedByCoverage: ORDER.indexOf(coverageCap) < ORDER.indexOf(score >= 0.8 ? "high" : score >= 0.6 ? "medium-high" : score >= 0.4 ? "medium" : "low"),
    sufficient: n >= MIN_COMPARABLES_FOR_RECOMMENDATION,
    dispersion,
  };
}

// ---------------------------------------------------------------------------
// The recommendation
// ---------------------------------------------------------------------------

/**
 * Where a candidate price sits among the competing prices.
 * `percentile` runs 0 = cheapest to 1 = dearest, which is the direction a
 * reader expects — the previous formula was inverted and reported the cheapest
 * possible price as the 100th percentile.
 */
function positionOf(priceMinor, competingPrices) {
  const all = [...competingPrices, priceMinor].sort((a, b) => a - b);
  const rank = all.indexOf(priceMinor) + 1;
  return {
    rank,
    of: all.length,
    total: competingPrices.length,
    percentile: all.length > 1 ? (rank - 1) / (all.length - 1) : 0,
    undercuts: competingPrices.filter((p) => p > priceMinor).length, // competitors this price beats
    sitsAbove: competingPrices.filter((p) => p < priceMinor).length, // competitors already cheaper
  };
}

export function buildRecommendation(targetProductId) {
  const target = getProduct(targetProductId);
  if (!target) return { insufficientData: true, reason: "Product not found." };

  const brand = getBrand(target.brandId);
  const currentPrice = getCurrentEffectivePrice(targetProductId);
  const competition = buildCompetition(targetProductId);
  const commercial = buildCommercial(target);
  const history = buildHistory(targetProductId);

  // MRP is resolved BEFORE the comparable set, because it is an input to it:
  // a product priced beyond this product's legal ceiling cannot serve as a
  // benchmark for it.
  const mrp = resolveApplicableMrp(targetProductId, currentPrice?.universalEffectiveMinor ?? null);
  const competitiveSet = buildComparableSet(targetProductId, { mrpMinor: mrp.mrpMinor });
  const { members: comps, excluded, method, coverage, diversity } = competitiveSet;
  const compPrices = comps.map((c) => c.currentPriceMinor);
  // Comparable statistics are WEIGHTED by evidence: a loosely-matched product we
  // barely have data on moves the median less than a close, well-observed rival.
  // This is what makes a fifth comparable worth adding honestly rather than
  // worth adding to reach five.
  const stats = comps.length
    ? weightedDistribution(comps.map((c) => ({ value: c.currentPriceMinor, weight: c.evidenceWeight })))
    : null;
  const matchQuality = assessMatchQuality(targetProductId);
  const promotionVisibility = assessPromotionVisibility(competition, comps);
  const evidence = assessEvidence({
    comps,
    coverage,
    diversity,
    stats,
    history,
    commercial,
    competition,
    mrp,
    matchQuality,
    promotionVisibility,
  });

  const base = {
    target,
    brand,
    categoryPath: getCategoryPath(target.categoryId),
    productType: productTypes.find((pt) => pt.id === target.productTypeId) ?? null,
    currentPriceMinor: currentPrice?.universalEffectiveMinor ?? null,
    currentPriceLayers: currentPrice?.layers ?? null,
    currentPriceMarketplaceId: currentPrice?.marketplaceId ?? null,
    comps,
    excludedComps: excluded,
    compMethod: method,
    competitiveSet,
    coverage,
    diversity,
    stats,
    competition,
    commercial,
    history,
    mrp,
    evidence,
    matchQuality,
    promotionVisibility,
    priceBasis: PRICE_BASIS,
    variantSiblings: getVariantSiblings(targetProductId).map((sib) => ({
      product: sib,
      priceMinor: getCurrentEffectivePrice(sib.id)?.universalEffectiveMinor ?? null,
    })),
  };

  // ---- the gate: refuse rather than invent ----
  if (!evidence.sufficient || !stats || !currentPrice) {
    return {
      ...base,
      insufficientData: true,
      insufficientEvidence: true,
      reason: !currentPrice
        ? "This product has no in-stock offer, so there is no current price to reason from."
        : `Only ${comps.length} comparable product${comps.length === 1 ? "" : "s"} could be established for this product, against a target of ${COMPETITOR_TARGET} and a working minimum of ${MIN_COMPARABLES_FOR_RECOMMENDATION}. Below that the market cannot be described: a median is just the midpoint of two numbers and the spread is meaningless. Padding the set with weaker candidates would produce a number, not evidence.`,
      whatWouldHelp: [
        coverage.shortfall,
        "Capture more products of the same type, on the marketplaces this product is sold on",
        excluded.length ? `${excluded.length} candidate${excluded.length === 1 ? " was" : "s were"} screened out — see the exclusion list for why` : null,
        !commercial.cost ? "Enter a seller cost so break-even and margin can bound the range" : null,
      ].filter(Boolean),
      strategies: [],
    };
  }

  const strength = buildStrength(target, comps);

  // =========================================================================
  // TWO POOLS, TWO GRAINS — kept deliberately separate
  // =========================================================================
  // These answer different questions and must not be merged, which is exactly
  // the bug the competitor review found:
  //
  //   OWN MARKET (offer grain)  What THIS product sells for. Every in-stock
  //                             offer is a real price a buyer can pay today, so
  //                             all of them count. Anchoring and the Premium
  //                             ceiling read this, unchanged.
  //
  //   COMPETITIVE POOL          What the MARKET charges. One row per competitive
  //   (product grain)           identity — this product once, each rival product
  //                             once. Q1/median/Q3 describe the products a buyer
  //                             chooses between.
  //
  // Previously both were poured into one array, mixing one-row-per-own-OFFER
  // with one-row-per-rival-PRODUCT. On 42 of 92 products the target's own offers
  // outnumbered the rivals — a 43" TV had 6 own offers against 3 rival products,
  // so two thirds of "the market" was the product measured against itself, and
  // every zone derived from it was pulled toward its own price.
  const ownPrices = competition.offers.filter((o) => o.inStock).map((o) => o.universalEffectiveMinor);
  const ownStats = ownPrices.length ? computeDistributionStats(ownPrices) : null;

  // The target enters the competitive pool ONCE, represented by its own median
  // — the price its sellers converge on — and at full weight, because it is the
  // one product whose market we have measured directly.
  const poolRows = [];
  if (ownStats) {
    poolRows.push({ value: ownStats.median, weight: 1, identity: competitiveIdentityOf(target), isTarget: true });
  }
  for (const c of comps) {
    poolRows.push({ value: c.currentPriceMinor, weight: c.evidenceWeight, identity: c.identity, isTarget: false });
  }
  const poolStats = weightedDistribution(poolRows) ?? computeDistributionStats(compPrices);
  const pool = poolRows.map((r) => r.value).sort((a, b) => a - b);

  const zones = {
    poolSize: pool.length,
    ownCount: ownStats ? 1 : 0,
    compCount: comps.length,
    grain: "one row per competitive identity — sellers, listings and variants of one product count once",
    effectiveN: poolStats.effectiveN ?? pool.length,
    floorZoneMinor: poolStats.min,
    competitiveLowMinor: poolStats.q1,
    competitiveMidMinor: poolStats.median,
    competitiveHighMinor: poolStats.q3,
    outlierAboveMinor: poolStats.max,
    concentration: poolStats.median ? poolStats.iqr / poolStats.median : null,
  };

  // ---- HARD CONSTRAINTS: a recommendation may never violate these ----
  const hardConstraints = [];

  let ceilingMinor = Math.round(poolStats.max * 1.1);
  let ceilingSource = "observed price range";
  if (mrp.mrpMinor != null && mrp.mrpMinor < ceilingMinor) {
    ceilingMinor = mrp.mrpMinor;
    ceilingSource = "applicable MRP";
  }
  hardConstraints.push({
    key: "mrp_ceiling",
    label: "Applicable MRP",
    kind: "ceiling",
    boundMinor: mrp.mrpMinor,
    binding: ceilingSource === "applicable MRP",
    rationale:
      mrp.mrpMinor != null
        ? `A product may not be sold above its printed MRP of ${formatMinor(mrp.mrpMinor)}. This is a legal ceiling, not a pricing preference.${mrp.reliability === "inflated" ? " Note the MRP looks inflated relative to the market, so it is a weak guide to what buyers will pay even though it still caps the price." : ""}`
        : "No MRP was observed for this product, so no MRP ceiling could be applied.",
  });

  // The market floor is a SOFT preference ("don't undercut the market pointlessly"),
  // not a hard bound. Only break-even is genuinely hard — a price can be below
  // the market and still be perfectly valid, but a loss-making one is not.
  // The soft floor is additionally capped beneath the ceiling so the two can
  // never invert.
  // Floor comes from the cheapest price in the POOL — including this product's
  // own offers — never from comparables alone.
  const marketFloorRaw = Math.round(poolStats.min * 0.92);
  const marketFloor = Math.min(marketFloorRaw, Math.round(ceilingMinor * 0.85));
  const breakEvenFloor = commercial.highestBreakEvenMinor ? Math.round(commercial.highestBreakEvenMinor * 1.02) : null;
  const floorMinor = breakEvenFloor ? Math.max(breakEvenFloor, marketFloor) : marketFloor;
  hardConstraints.push({
    key: "break_even_floor",
    label: "Break-even floor",
    kind: "floor",
    boundMinor: breakEvenFloor,
    binding: breakEvenFloor != null && breakEvenFloor >= marketFloor,
    rationale: breakEvenFloor
      ? `Below ${formatMinor(breakEvenFloor)} the product loses money once marketplace fees and GST are deducted, so no strategy may go there.`
      : "No seller cost entered, so no break-even floor could be computed — the floor falls back to the market.",
  });

  // ---- SOFT CONSTRAINTS: preferences that shape, not bound ----
  const softConstraints = [
    { key: "competitiveness", label: "Stay credible against the cheapest comparable", detail: `cheapest comparable is ${formatMinor(stats.min)}` },
    { key: "evidence_spread", label: "Travel from the median only as far as evidence supports", detail: `evidence level: ${evidence.level}` },
    { key: "strength", label: "Move with demonstrated product strength", detail: `strength index ${strength.index >= 0 ? "+" : ""}${strength.index.toFixed(2)}` },
  ];

  // ---- constraint conflict: no valid price exists ----
  // If the hard ceiling sits below the hard floor, every possible price is
  // either illegal or loss-making. Emitting a number here would be worse than
  // useless, so the engine reports the conflict instead.
  if (ceilingMinor < floorMinor) {
    return {
      ...base,
      strength: buildStrength(target, comps),
      insufficientData: true,
      constraintConflict: true,
      constraints: { hard: hardConstraints, soft: softConstraints, floorMinor, ceilingMinor, ceilingSource },
      reason:
        breakEvenFloor && mrp.mrpMinor != null && mrp.mrpMinor < breakEvenFloor
          ? `No valid price exists. Break-even is ${formatMinor(breakEvenFloor)} but the applicable MRP caps the price at ${formatMinor(mrp.mrpMinor)} — this product cannot be sold profitably on these marketplaces at its current cost and fee structure.`
          : `No valid price exists: the ceiling (${formatMinor(ceilingMinor)}, set by ${ceilingSource}) sits below the floor (${formatMinor(floorMinor)}).`,
      whatWouldHelp: [
        "Reduce procurement cost, or negotiate a lower fee tier, to bring break-even under the MRP",
        "Verify the captured MRP — an incorrectly parsed MRP would produce this conflict spuriously",
      ],
      strategies: [],
    };
  }

  const fmtPct = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

  // =========================================================================
  // MARKET ANCHOR
  // =========================================================================
  // The product's OWN in-stock offers are the strongest available evidence of
  // what this exact product commands. Comparable products are substitutes —
  // useful for positioning and for estimating what attributes are worth, but
  // they are NOT what this product sells for. The previous engine anchored
  // solely on comparables and so recommended +23% above a product's own four
  // observed offers. Own market is primary; comparables are the fallback only
  // when the product has no market of its own (a new listing).
  // Reconcile "what it sells for now" against "what it normally sells for",
  // so a temporary promotion does not permanently reset the anchor.
  const normalMinor = history?.median90 ?? history?.median60 ?? ownStats?.median ?? stats.median;
  const distortionRatio = ownStats && normalMinor ? ownStats.median / normalMinor : 1;
  const distortion =
    distortionRatio <= 0.9
      ? { state: "depressed", ratio: distortionRatio, note: `The product's current market (${formatMinor(ownStats.median)}) sits ${formatPctLocal(1 - distortionRatio)} below its 90-day normal of ${formatMinor(normalMinor)} — the market looks promotionally depressed, so the recommendation leans toward the normal level rather than chasing the dip.` }
      : distortionRatio >= 1.1
        ? { state: "elevated", ratio: distortionRatio, note: `The current market (${formatMinor(ownStats.median)}) sits ${formatPctLocal(distortionRatio - 1)} above its 90-day normal of ${formatMinor(normalMinor)} — treat the present level as temporarily elevated.` }
        : { state: "normal", ratio: distortionRatio, note: null };

  let anchorMinor;
  let anchorBasis;
  let anchorDetail;
  if (ownStats && ownStats.n >= 2) {
    // Blend current market with its own normal level; current dominates but
    // does not fully override history.
    anchorMinor = Math.round(0.65 * ownStats.median + 0.35 * normalMinor);
    anchorBasis = "own market";
    anchorDetail = `${ownStats.n} in-stock offers for this exact product spanning ${formatMinor(ownStats.min)}–${formatMinor(ownStats.max)} (median ${formatMinor(ownStats.median)}), reconciled with its 90-day normal of ${formatMinor(normalMinor)}.`;
  } else if (ownStats && ownStats.n === 1) {
    // One real offer is thin evidence, but it is still evidence about THIS
    // product, whereas the comparable median is evidence about other products.
    // A 50/50 blend let substitutes drag the anchor a long way from the price
    // the product is actually listed at — the HP 15s sells at ₹31,990 and was
    // anchored at ₹35,730. The own offer now leads, and the blend may not
    // travel more than 10% from it in either direction.
    const blended = Math.round(0.75 * ownStats.median + 0.25 * stats.median);
    anchorMinor = clamp(blended, Math.round(ownStats.median * 0.9), Math.round(ownStats.median * 1.1));
    anchorBasis = "single own offer + comparables";
    const pulled = anchorMinor !== blended;
    anchorDetail = `Only one in-stock offer for this product (${formatMinor(ownStats.median)}). It leads the anchor at 75%, with the comparable median of ${formatMinor(stats.median)} contributing the rest${pulled ? `, held within 10% of the product's own listed price` : ""}.`;
  } else {
    anchorMinor = stats.median;
    anchorBasis = "comparable market";
    anchorDetail = `No in-stock offer for this product, so the comparable median of ${formatMinor(stats.median)} is the only available anchor.`;
  }

  // =========================================================================
  // WILLINGNESS TO PAY — measured, not assumed
  // =========================================================================
  const wtp = fitHedonicModel({
    target,
    comps,
    targetRating: strength.targetRating,
    targetBrandTier: getBrand(target.brandId)?.tier,
  });

  // A premium is only claimed when the regression is trustworthy AND predicts
  // above the comparable median. Otherwise it is explicitly zero — the model
  // refuses to invent a premium it cannot evidence.
  let evidencedPremiumMinor = 0;
  let premiumSupported = false;
  let premiumVerdict;
  if (wtp.trusted && wtp.predictedMinor != null) {
    const raw = wtp.predictedMinor - stats.median;
    // Cap the claim at ±25% of the anchor: even a good fit on a handful of
    // points should not move the price further than that.
    evidencedPremiumMinor = Math.round(clamp(raw, -0.25 * anchorMinor, 0.25 * anchorMinor));
    premiumSupported = evidencedPremiumMinor > 0;
    premiumVerdict = premiumSupported
      ? `The attribute model fits well (adjusted R² ${wtp.adjR2}) and values this product's attribute profile at ${formatMinor(wtp.predictedMinor)}, ${formatMinor(evidencedPremiumMinor)} above the comparable median — that premium is evidenced, not assumed.`
      : `The attribute model fits well (adjusted R² ${wtp.adjR2}) but values this product at ${formatMinor(wtp.predictedMinor)}, at or below the comparable median. The market does not pay more for this product's attribute profile.`;
  } else {
    premiumVerdict = wtp.reason;
  }

  // =========================================================================
  // STRATEGIES — positions within the evidenced market, not offsets on a stat
  // =========================================================================
  const travel = { high: 1, "medium-high": 0.8, medium: 0.55, low: 0.35 }[evidence.level] ?? 0.5;

  // Fast Sale: undercut the cheapest CREDIBLE competitor. When the product has
  // its own offers, those sellers are the direct competition — the pool
  // minimum may belong to a much cheaper substitute (a ₹630 earbud in a pool
  // containing a ₹2,300 one), and chasing it would abandon the product's own
  // market rather than compete in it. Also floored relative to the anchor so
  // "aggressive" never becomes "unmoored".
  const directCompetitorMin = ownStats ? ownStats.min : zones.floorZoneMinor;
  const aggressiveLimit = Math.round(anchorMinor * 0.85);
  const rawFast = Math.max(Math.min(Math.round(directCompetitorMin * 0.985), anchorMinor), aggressiveLimit);

  // Balanced: the anchor itself, nudged only by evidenced willingness-to-pay.
  const rawBalanced = Math.round(anchorMinor + evidencedPremiumMinor * travel * 0.6);

  // =========================================================================
  // PREMIUM — bounded by the product's OWN market, not by what rivals cost
  // =========================================================================
  // This is the fix for the defect the audit found. The previous rule was
  //
  //     premiumCeiling = max(pool Q3, anchor)
  //
  // and the "not evidenced" guard only stopped the price being pushed BEYOND
  // pool Q3 — it never stopped it REACHING it. Q3 of a pool containing dearer
  // substitutes therefore created a premium on its own: 25 of 89 products sat
  // more than 15% above their own market median, 20 of them with no evidence
  // whatsoever. A Puma running shoe selling at ₹2,558 across four offers was
  // recommended ₹3,349 because other running shoes cost more.
  //
  // Q3 of the pool describes what OTHER products cost. It is not evidence that
  // THIS product can be sold there. The rule is now:
  //
  //   1. With a market of its own, the unevidenced ceiling is the dearest price
  //      this exact product actually achieves today — inside its own observed
  //      range by construction, so it can never "exceed the market".
  //   2. An evidenced premium (a trusted attribute model, damped by evidence
  //      level) may extend above that, and only then.
  //   3. Even evidenced, the result is capped at +25% over the product's own
  //      median. A good fit on a handful of points does not license any number.
  //   4. With no market of its own, pool Q3 is the only signal available — but
  //      it is then capped at +10% over the anchor, which is where the
  //      unevidenced headroom used to be unbounded.
  const ownMarketRef = ownStats?.median ?? null;
  const ownMarketTop = ownStats?.max ?? null;

  const premiumFloorBasis = ownStats
    ? { minor: Math.max(ownMarketTop, anchorMinor), basis: "own market" }
    : {
        minor: Math.min(Math.max(zones.competitiveHighMinor, anchorMinor), Math.round(anchorMinor * (1 + MAX_UNEVIDENCED_PREMIUM_OVER_ANCHOR))),
        basis: "comparable band",
      };

  const premiumHeadroomMinor = premiumSupported ? Math.round(evidencedPremiumMinor * travel) : 0;
  let rawPremium = premiumFloorBasis.minor + premiumHeadroomMinor;

  // Hard cap relative to the product's own market. Applies with or without
  // evidence; evidence buys a wider band, never an unbounded one.
  let premiumCapMinor = null;
  if (ownMarketRef) {
    premiumCapMinor = Math.round(ownMarketRef * (1 + (premiumSupported ? MAX_EVIDENCED_PREMIUM_OVER_OWN : 0)));
    // Without evidence the cap is the top of the own range, which may sit above
    // the median — the cap must not pull the price BELOW its own basis.
    if (!premiumSupported) premiumCapMinor = Math.max(premiumCapMinor, premiumFloorBasis.minor);
    rawPremium = Math.min(rawPremium, premiumCapMinor);
  }

  const premiumCeiling = {
    basis: premiumFloorBasis.basis,
    baseMinor: premiumFloorBasis.minor,
    headroomMinor: premiumHeadroomMinor,
    capMinor: premiumCapMinor,
    ownMarketRefMinor: ownMarketRef,
    poolQ3Minor: zones.competitiveHighMinor,
    // Recorded so the audit can assert the invariant directly rather than
    // inferring it from the final price.
    poolQ3Suppressed: ownStats != null && zones.competitiveHighMinor > premiumFloorBasis.minor,
  };

  const fastMinor = snapWithin(clamp(rawFast, floorMinor, ceilingMinor), floorMinor, ceilingMinor);
  const balancedMinor = snapWithin(clamp(rawBalanced, Math.max(floorMinor, fastMinor), ceilingMinor), Math.max(floorMinor, fastMinor), ceilingMinor);
  const premiumMinor = snapWithin(clamp(rawPremium, balancedMinor, ceilingMinor), balancedMinor, ceilingMinor);

  // A constraint bound a strategy if the UNCONSTRAINED calculation fell outside
  // it — comparing the final snapped price instead misses cases where snapping
  // moved the value back inside the bound, hiding that the bound was active.
  const bindingFor = (raw) => {
    if (raw > ceilingMinor) return { key: "ceiling", label: ceilingSource, boundMinor: ceilingMinor };
    if (raw < floorMinor)
      return { key: "floor", label: breakEvenFloor && breakEvenFloor >= marketFloor ? "break-even floor" : "market floor", boundMinor: floorMinor };
    return null;
  };

  const strategies = [
    {
      key: "fast_sale",
      label: "Fast Sale",
      tagline: "Win on price",
      priceMinor: fastMinor,
      anchor: "a 1.5% undercut of the cheapest price in the competitive pool",
      objective: "Maximise sales velocity and win the featured position",
      bestWhen: [
        "Sales velocity matters more than unit margin",
        "You are entering the category with no review base yet",
        "A cheaper rival is taking the featured position",
      ],
      rationale: [
        ownStats
          ? `The cheapest seller of this exact product is at ${formatMinor(ownStats.min)}; this sits just under them, without chasing cheaper substitutes out of the product's own market.`
          : `The cheapest price in the competitive pool is ${formatMinor(zones.floorZoneMinor)}; this sits just under it.`,
        breakEvenFloor
          ? `Held at or above the break-even floor of ${formatMinor(breakEvenFloor)}, so it competes without losing money.`
          : `No cost was entered, so this is bounded by the market rather than by your economics — enter a cost to make it margin-safe.`,
      ],
      bindingConstraint: bindingFor(rawFast),
      position: positionOf(fastMinor, pool),
      margins: marginsAt(fastMinor, commercial),
    },
    {
      key: "balanced",
      label: "Balanced",
      tagline: "Match the market, adjusted for strength",
      recommended: true,
      priceMinor: balancedMinor,
      anchor: `the ${anchorBasis} anchor of ${formatMinor(anchorMinor)}${evidencedPremiumMinor !== 0 ? `, adjusted by the evidenced attribute premium` : ", with no attribute premium claimed"}`,
      objective: "Best trade-off between competitiveness and margin",
      bestWhen: [
        "You want a defensible everyday price",
        "You are pricing in line with what this product actually commands",
        "You are not trying to buy share or harvest margin",
      ],
      rationale: [
        anchorDetail,
        evidencedPremiumMinor !== 0
          ? `The attribute model supports ${formatMinor(evidencedPremiumMinor)} of difference against comparables; ${Math.round(travel * 60)}% of it is applied, damped by ${evidence.level} evidence.`
          : `No attribute premium is applied: ${premiumVerdict}`,
        distortion.note ?? `The current market is within 10% of its 90-day normal, so the anchor is taken at face value.`,
      ],
      bindingConstraint: bindingFor(rawBalanced),
      position: positionOf(balancedMinor, pool),
      margins: marginsAt(balancedMinor, commercial),
    },
    {
      key: "premium",
      label: "Premium",
      tagline: "Maximise margin",
      priceMinor: premiumMinor,
      // A premium position is a claim about the market, not about the product.
      // It is only "supported" when the attribute model actually evidences it.
      supported: premiumSupported,
      anchor: premiumSupported
        ? `the top of this product's ${premiumCeiling.basis} (${formatMinor(premiumCeiling.baseMinor)}), extended by the evidenced attribute premium`
        : `the top of this product's ${premiumCeiling.basis} (${formatMinor(premiumCeiling.baseMinor)}) — no evidenced premium to extend it with`,
      objective: "Maximise margin per unit where the market demonstrably pays for it",
      warning: premiumSupported
        ? null
        : `Premium positioning is not supported by the available evidence. ${premiumVerdict} This price therefore sits at the top of ${ownStats ? "this product's own observed selling range" : "the observed competitive band"} rather than above it.`,
      bestWhen: premiumSupported
        ? [
            "The evidenced attribute premium holds and competition stays thin",
            "Rivals are out of stock or slow to react",
            "Margin per unit matters more than volume",
          ]
        : [
            "Competition on your listing thins out or rivals go out of stock",
            "You are testing the ceiling of the current band, not setting a standing price",
            "You accept slower velocity for a small margin gain",
          ],
      rationale: [
        ownStats
          ? `Anchored to the dearest price this exact product currently achieves (${formatMinor(ownMarketTop)}) across ${ownStats.n} in-stock offer${ownStats.n === 1 ? "" : "s"} — not to what rival products cost.`
          : `This product has no in-stock offer of its own, so the top of the comparable band (${formatMinor(zones.competitiveHighMinor)}) is the only available reference, capped at ${Math.round(MAX_UNEVIDENCED_PREMIUM_OVER_ANCHOR * 100)}% above the anchor.`,
        premiumCeiling.poolQ3Suppressed
          ? `The 75th percentile of the wider pool is ${formatMinor(zones.competitiveHighMinor)}, above that. It is deliberately NOT used as the ceiling: dearer substitutes describe what other products cost, not what this one can be sold for.`
          : null,
        premiumVerdict,
        premiumSupported && premiumCapMinor != null && rawPremium >= premiumCapMinor
          ? `Capped at ${Math.round(MAX_EVIDENCED_PREMIUM_OVER_OWN * 100)}% above this product's own market median of ${formatMinor(ownMarketRef)} — the evidenced premium is real but bounded.`
          : null,
      ].filter(Boolean),
      bindingConstraint: bindingFor(rawPremium),
      position: positionOf(premiumMinor, pool),
      margins: marginsAt(premiumMinor, commercial),
    },
  ];

  const distinct = new Set(strategies.map((s) => s.priceMinor)).size;
  const collapsed =
    distinct < 3
      ? `Constraints have collapsed ${3 - distinct + 1} strategies onto the same price. The gap between the floor (${formatMinor(floorMinor)}) and ceiling (${formatMinor(ceilingMinor)}) is too narrow for meaningfully different positions.`
      : null;

  // =========================================================================
  // SELLER VIABILITY — kept separate from the market recommendation
  // =========================================================================
  // The market does not care what the product cost. If the market-clearing
  // price is below break-even, that conflict must be SHOWN, not silently
  // clamped away by lifting the price to a level the market will not pay.
  let viability = { known: false, conflict: false, note: "No seller cost entered, so viability against the market cannot be assessed. Prices shown are market-based only." };
  if (commercial.cost && breakEvenFloor) {
    const marketMid = zones.competitiveMidMinor;
    const conflict = marketMid < breakEvenFloor;
    viability = {
      known: true,
      conflict,
      breakEvenMinor: breakEvenFloor,
      marketMidMinor: marketMid,
      note: conflict
        ? `The middle of the competitive market (${formatMinor(marketMid)}) is BELOW your break-even of ${formatMinor(breakEvenFloor)}. Prices here are held up to stay viable, which means they sit above where the market is actually clearing — expect slower velocity, and treat cost reduction as the real lever.`
        : `Break-even (${formatMinor(breakEvenFloor)}) sits below the middle of the competitive market (${formatMinor(marketMid)}), so market-competitive pricing is also viable.`,
    };
  }

  // =========================================================================
  // SANITY CHECKS — run before anything is displayed
  // =========================================================================
  const sanityChecks = [];
  const addCheck = (key, label, passed, detail) => sanityChecks.push({ key, label, passed, detail });

  const anchorRef = anchorMinor || zones.competitiveMidMinor;
  for (const s of strategies) {
    const deviation = anchorRef ? (s.priceMinor - anchorRef) / anchorRef : 0;
    if (Math.abs(deviation) > 0.35) {
      addCheck(
        `deviation_${s.key}`,
        `${s.label} distance from market anchor`,
        false,
        `${fmtPct(deviation)} from the ${anchorBasis} anchor of ${formatMinor(anchorRef)} — unusually far; verify the comparable set before acting on it.`
      );
    }
  }
  addCheck("mrp", "No strategy exceeds MRP", strategies.every((s) => mrp.mrpMinor == null || s.priceMinor <= mrp.mrpMinor), mrp.mrpMinor != null ? `ceiling ${formatMinor(mrp.mrpMinor)}` : "no MRP observed");
  addCheck("floor", "No strategy below the hard floor", strategies.every((s) => s.priceMinor >= floorMinor), `floor ${formatMinor(floorMinor)}`);
  addCheck("ordered", "Strategies increase in price", strategies[0].priceMinor <= strategies[1].priceMinor && strategies[1].priceMinor <= strategies[2].priceMinor, "Fast ≤ Balanced ≤ Premium");
  addCheck("premium_evidence", "Premium is evidence-backed", premiumSupported, premiumSupported ? "attribute model supports a premium" : `no evidenced premium — Premium held at the top of the ${premiumCeiling.basis}`);

  // The CF-1 invariant, asserted rather than assumed: no strategy may sit
  // materially above this product's own observed market without a trusted
  // attribute model saying it should. If this ever fails, the recommendation
  // is wrong and says so on its own face.
  if (ownMarketRef) {
    // Without evidence the limit is the TOP of the product's own observed range
    // (or the anchor, which for a single-offer product may sit slightly above
    // it) — pricing at the dearest price the product already achieves is not a
    // premium. With evidence the limit widens to +25% over the own median.
    // A 2% tolerance absorbs psychological-ending snapping, which can round a
    // compliant price up by one grid step.
    const limitMinor = premiumSupported
      ? Math.round(ownMarketRef * (1 + MAX_EVIDENCED_PREMIUM_OVER_OWN))
      : Math.max(ownMarketTop, anchorMinor);
    const dearest = Math.max(...strategies.map((s) => s.priceMinor));
    addCheck(
      "premium_vs_own_market",
      "No strategy outruns the product's own market",
      dearest <= Math.round(limitMinor * 1.02),
      premiumSupported
        ? `dearest strategy ${formatMinor(dearest)} against an evidenced limit of ${formatMinor(limitMinor)} (+${Math.round(MAX_EVIDENCED_PREMIUM_OVER_OWN * 100)}% over the own-market median of ${formatMinor(ownMarketRef)}); ${fmtPct((dearest - ownMarketRef) / ownMarketRef)} from that median`
        : `dearest strategy ${formatMinor(dearest)} against a limit of ${formatMinor(limitMinor)} — the top of this product's own observed range, because no attribute premium is evidenced; ${fmtPct((dearest - ownMarketRef) / ownMarketRef)} from the own-market median`
    );
  }
  addCheck("market_distortion", "Market is not promotionally distorted", distortion.state === "normal", distortion.state === "normal" ? "current market within 10% of its 90-day normal" : `market currently ${distortion.state}`);
  addCheck("viability", "Market price is commercially viable", !viability.conflict, viability.known ? (viability.conflict ? "market mid is below break-even" : "break-even sits below market mid") : "seller cost unknown");

  // ---- defensibility ----
  const lowerReasons = [];
  if (breakEvenFloor && breakEvenFloor >= marketFloor) {
    lowerReasons.push(`Below ${formatMinor(breakEvenFloor)} the product is loss-making after marketplace fees and GST.`);
  }
  lowerReasons.push(
    `The cheapest price in the competitive pool is ${formatMinor(zones.floorZoneMinor)}; going materially under it gives away margin the market is not demanding.`
  );
  if (history && history.minMinor < stats.min) {
    lowerReasons.push(`This product has traded as low as ${formatMinor(history.minMinor)}, but inside promotional windows rather than as a standing price.`);
  }

  const upperReasons = [];
  if (ceilingSource === "applicable MRP") {
    upperReasons.push(`${formatMinor(mrp.mrpMinor)} is the applicable MRP — the product cannot legally be sold above it, whatever the market statistics suggest.`);
  } else {
    upperReasons.push(`The dearest comparable is ${formatMinor(stats.max)}; above that you leave the observed distribution entirely.`);
  }
  if (!premiumSupported) {
    upperReasons.push(`No evidenced willingness to pay a premium: ${premiumVerdict}`);
  }
  if (ownStats && ownStats.n >= 2) {
    upperReasons.push(
      `This exact product is already selling at ${formatMinor(ownStats.min)}–${formatMinor(ownStats.max)} across ${ownStats.n} in-stock offers. Pricing far above its own observed market is the single hardest position to defend.`
    );
  }
  if (evidence.level === "low" || evidence.level === "medium") {
    upperReasons.push(`Evidence is ${evidence.level}, so the engine deliberately limits how far above the median it will recommend.`);
  }
  if (competition.inStockOfferCount > 2) {
    upperReasons.push(`${competition.inStockOfferCount} in-stock offers already compete here — a high price is easily undercut.`);
  }

  return {
    ...base,
    strength,
    strategies,
    collapsed,
    anchor: { minor: anchorMinor, basis: anchorBasis, detail: anchorDetail },
    ownMarket: ownStats ? { ...ownStats, offers: competition.offers.filter((o) => o.inStock) } : null,
    normalMinor,
    distortion,
    wtp: { ...wtp, evidencedPremiumMinor, supported: premiumSupported, verdict: premiumVerdict },
    premiumCeiling,
    zones,
    viability,
    sanityChecks,
    constraints: { hard: hardConstraints, soft: softConstraints, floorMinor, ceilingMinor, ceilingSource, travel },
    bounds: { floorMinor, ceilingMinor, ceilingSource, lowerReasons, upperReasons },
    confidence: { level: evidence.level, reasons: evidence.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`) },
    insufficientData: false,
  };
}
