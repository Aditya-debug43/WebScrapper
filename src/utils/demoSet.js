import { products, getProduct } from "../data/products";
import { getBrand } from "../data/brands";
import { getListingsForProduct } from "../data/listings";
import { getOffersForListing } from "../data/offers";
import { getPriceHistoryForOffer, getLatestObservation } from "../data/priceObservations";
import { getDepartmentId, getCategory, getProductType } from "../data/categories";
import { getProductReviewMetrics } from "./productMetrics";

/**
 * THE DEMONSTRATION SET
 * =====================
 *
 * The brief: at least ten products, chosen by method rather than by eye, and
 * spanning the evidence conditions the analytical framework is supposed to
 * cope with — not ten products that all happen to look good.
 *
 * So this is a stratified sample, not a list. Every product in the catalogue
 * is profiled on four axes that between them decide how much the system can
 * legitimately say:
 *
 *   reach       how many marketplaces carry it
 *   depth       how many observations exist, and how far apart
 *   contest     how many candidate competitors share its type and price band
 *   scale       where it sits in the catalogue's price distribution
 *
 * Products are then assigned an evidence tier from the first three, and the
 * set is filled tier by tier under diversity constraints, so the result
 * deliberately includes products the system will handle badly. A demo set
 * without a thin case proves nothing: the honest-refusal behaviour is the part
 * most worth showing.
 *
 * COST
 * ----
 * Selection deliberately avoids the recommendation engine. Running it across
 * 1,172 products to pick twelve would cost seconds of blocking work on a page
 * load. Everything here is map lookups over the data layer. The one proxy that
 * stands in for engine work — `candidateCount` — is not a guess: it applies
 * the engine's OWN first gate (same product type, price within 0.6x-1.7x),
 * which is the filter that decides whether a comparable set can exist at all.
 * The true evidence tier is still computed by the engine when a product is
 * opened; this only decides who gets shown.
 *
 * The selection is deterministic — same catalogue, same twelve products — so
 * the demo does not reshuffle between reloads.
 */

const TARGET_SIZE = 12;

/** The engine's own absolute price band for a candidate comparable. */
const BAND_LOW = 0.6;
const BAND_HIGH = 1.7;

/** Cadence thresholds mirror the generator's capture tiers (2 / 5 / 12 days). */
const DEEP_CADENCE = 3;
const STANDARD_CADENCE = 6;

const HISTORY_SPAN_DAYS = 120;

let cachedProfiles = null;
let cachedSet = null;

function currentPriceMinorCheap(productId) {
  // Cheapest in-stock latest observation, landed. Deliberately not the full
  // price ladder: this figure only has to place the product in the catalogue's
  // price distribution, and the ladder costs promotion resolution per offer.
  let best = null;
  for (const listing of getListingsForProduct(productId)) {
    for (const offer of getOffersForListing(listing.id)) {
      const obs = getLatestObservation(offer.id);
      if (!obs || !obs.isInStock) continue;
      const landed = obs.sellingPriceMinor + (obs.shippingFeeMinor ?? 0);
      if (best === null || landed < best) best = landed;
    }
  }
  return best;
}

/** Cheap structural profile of one product — no engine, no price ladder. */
function profileOf(product) {
  const listings = getListingsForProduct(product.id);
  let offerCount = 0;
  let inStockCount = 0;
  let maxPointsOnAnOffer = 0;
  let totalObservations = 0;

  for (const listing of listings) {
    for (const offer of getOffersForListing(listing.id)) {
      offerCount++;
      const hist = getPriceHistoryForOffer(offer.id);
      totalObservations += hist.length;
      if (hist.length > maxPointsOnAnOffer) maxPointsOnAnOffer = hist.length;
      const latest = hist.length ? hist[hist.length - 1] : null;
      if (latest?.isInStock) inStockCount++;
    }
  }

  // Capture cadence, inferred from how many points one offer carries over the
  // generator's fixed history span. Exact enough to tier by, and free.
  const cadenceDays = maxPointsOnAnOffer > 1 ? Math.round((HISTORY_SPAN_DAYS / (maxPointsOnAnOffer - 1)) * 10) / 10 : null;

  const metrics = getProductReviewMetrics(product.id);

  return {
    id: product.id,
    name: product.canonicalName,
    brandName: getBrand(product.brandId)?.name ?? null,
    categoryId: product.categoryId,
    categoryName: getCategory(product.categoryId)?.name ?? null,
    departmentId: getDepartmentId(product.categoryId),
    productTypeId: product.productTypeId,
    productTypeName: getProductType(product.productTypeId)?.name ?? null,
    marketplaceCount: listings.length,
    offerCount,
    inStockCount,
    observationCount: totalObservations,
    pointsPerOffer: maxPointsOnAnOffer,
    cadenceDays,
    priceMinor: currentPriceMinorCheap(product.id),
    rating: metrics?.rating ?? null,
    reviewCount: metrics?.reviewCount ?? null,
  };
}

/**
 * How many products could even be considered as comparables — the engine's
 * first gate, applied cheaply. A product with two candidates cannot reach the
 * five-competitor target no matter how good the similarity scoring is, which
 * is what makes this a sound proxy for "the engine will struggle here".
 */
function attachCandidateCounts(profiles) {
  const byType = new Map();
  for (const p of profiles) {
    if (!p.productTypeId || p.priceMinor == null) continue;
    if (!byType.has(p.productTypeId)) byType.set(p.productTypeId, []);
    byType.get(p.productTypeId).push(p);
  }
  for (const [, group] of byType) {
    group.sort((a, b) => a.priceMinor - b.priceMinor);
    for (const p of group) {
      const lo = p.priceMinor * BAND_LOW;
      const hi = p.priceMinor * BAND_HIGH;
      let n = 0;
      for (const q of group) {
        if (q.id === p.id) continue;
        if (q.priceMinor >= lo && q.priceMinor <= hi) n++;
      }
      p.candidateCount = n;
      p.typePopulation = group.length;
    }
  }
  for (const p of profiles) {
    if (p.candidateCount === undefined) {
      p.candidateCount = 0;
      p.typePopulation = 0;
    }
  }
}

/**
 * The evidence tier this product is EXPECTED to land in. The engine has the
 * final word when the product is opened — this is a structural read used to
 * make sure the demo set spans the range rather than clustering at the top.
 */
function tierOf(p) {
  const deepHistory = p.cadenceDays != null && p.cadenceDays <= DEEP_CADENCE;
  const okHistory = p.cadenceDays != null && p.cadenceDays <= STANDARD_CADENCE;

  // Below two candidates the engine cannot reach the two-comparable minimum
  // however good the similarity scoring is, so this is where refusal lives.
  // It gets its own stratum because a demonstration set with no refusal in it
  // hides the behaviour most worth showing.
  if (p.candidateCount < 2) return "refused";
  if (p.candidateCount < 4 || p.marketplaceCount < 1) return "thin";
  if (p.marketplaceCount >= 4 && deepHistory && p.candidateCount >= 8) return "strong";
  if (p.marketplaceCount >= 2 && okHistory && p.candidateCount >= 5) return "moderate";
  return "thin";
}

export function buildProfiles() {
  if (cachedProfiles) return cachedProfiles;
  const profiles = products.map(profileOf).filter((p) => p.offerCount > 0 && p.priceMinor != null);
  attachCandidateCounts(profiles);
  for (const p of profiles) p.expectedTier = tierOf(p);
  cachedProfiles = profiles;
  return profiles;
}

/**
 * Fill the set tier by tier, preferring within a tier whatever adds most that
 * is not already represented — a new department, a new product type, a new
 * price decade.
 *
 * The per-department cap is a HARD constraint rather than a scoring nudge.
 * Without it the strong tier filled entirely with beauty products, which is an
 * honest reflection of the catalogue (FMCG carries the review volume that buys
 * the deepest capture cadence) but makes a poor demonstration: four shampoos
 * cannot show that the framework is not tuned to one kind of product. Where a
 * tier cannot be filled under the cap, the shortfall is carried and topped up
 * from the other tiers at the end rather than quietly dropped.
 */
const MAX_PER_DEPARTMENT = 2;

function pickStratified(profiles, quota) {
  const chosen = [];
  const deptCount = new Map();
  const usedTypes = new Set();
  const usedDecades = new Set();

  const priceDecade = (minor) => Math.floor(Math.log10(Math.max(minor / 100, 1)));
  const taken = new Set();

  const bestFrom = (pool) => {
    let best = null;
    let bestScore = -Infinity;
    for (const p of pool) {
      if (taken.has(p.id)) continue;
      if ((deptCount.get(p.departmentId) ?? 0) >= MAX_PER_DEPARTMENT) continue;
      let score = 0;
      if (!deptCount.has(p.departmentId)) score += 100;
      if (!usedTypes.has(p.productTypeId)) score += 40;
      if (!usedDecades.has(priceDecade(p.priceMinor))) score += 25;
      score += Math.min(p.marketplaceCount, 6) * 2;
      score += Math.min(p.candidateCount, 12);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  };

  const commit = (p) => {
    chosen.push(p);
    taken.add(p.id);
    deptCount.set(p.departmentId, (deptCount.get(p.departmentId) ?? 0) + 1);
    usedTypes.add(p.productTypeId);
    usedDecades.add(priceDecade(p.priceMinor));
  };

  const sorted = (tier) =>
    profiles.filter((p) => p.expectedTier === tier).sort((a, b) => (a.id < b.id ? -1 : 1));

  let shortfall = 0;
  for (const [tier, count] of Object.entries(quota)) {
    const pool = sorted(tier);
    for (let i = 0; i < count; i++) {
      const best = bestFrom(pool);
      if (!best) {
        shortfall += count - i;
        break;
      }
      commit(best);
    }
  }

  // Top-up pass: fill any shortfall from the whole catalogue, still capped.
  const everything = profiles.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  while (shortfall > 0) {
    const best = bestFrom(everything);
    if (!best) break;
    commit(best);
    shortfall--;
  }

  return chosen;
}

/**
 * The demonstration set: twelve products spanning strong, moderate and thin
 * evidence, across as many departments, product types and price decades as
 * the quota allows.
 */
export function selectDemoSet() {
  if (cachedSet) return cachedSet;
  const profiles = buildProfiles();
  // Weighted toward the middle because that is where most of a real catalogue
  // lives, with thin and refusal cases over-represented relative to their
  // frequency because they are the ones that test the honesty of the system.
  const picked = pickStratified(profiles, { strong: 3, moderate: 4, thin: 3, refused: 2 });
  cachedSet = picked.slice(0, TARGET_SIZE);
  return cachedSet;
}

export function demoSetIds() {
  return selectDemoSet().map((p) => p.id);
}

/** Profile for one product, whether or not it is in the demo set. */
export function profileFor(productId) {
  const all = buildProfiles();
  return all.find((p) => p.id === productId) ?? (getProduct(productId) ? profileOf(getProduct(productId)) : null);
}
