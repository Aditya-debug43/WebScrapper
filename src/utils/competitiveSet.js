import { products, getProduct } from "../data/products";
import { getListingsForProduct } from "../data/listings";
import { getOffersForListing } from "../data/offers";
import { getPriceHistoryForOffer } from "../data/priceObservations";
import { getBrand, TIER_RANK } from "../data/brands";
import { getAttributeDefinitions, getPricingRelevantAttributes } from "../data/attributeDefinitions";
import { productTypes } from "../data/categories";
import { marketplaces } from "../data/marketplaces";
import { getProductReviewMetrics } from "./productMetrics";
import { formatMinor } from "./money";

/**
 * THE COMPETITIVE EVIDENCE SET
 * ============================
 *
 * Written in response to one line of feedback: "compare your product with at
 * least 5 competitors so it will give you proper result."
 *
 * Read narrowly that is `MIN_COMPARABLES = 5`. That reading is wrong, and the
 * measurements that prompted this module say why. Before it, across 92
 * recommended products:
 *
 *   · the MEDIAN comparable count was 3, and only 17 products reached 5;
 *   · 9 of 16 product types held fewer than 7 products in total, so for those
 *     no screening rule could produce a 5th comparable — the ceiling was the
 *     dataset, not the logic;
 *   · 42 products had a "competitive pool" in which their OWN offers
 *     outnumbered the competing products (a 43" TV: 6 own offers, 3 rival
 *     products), so the market statistics were substantially the product
 *     measured against itself;
 *   · 4 products counted a variant of themselves as an independent competitor.
 *
 * Raising a constant to 5 fixes none of that. It would simply have forced
 * weaker candidates through the gate until the count read five, which is the
 * opposite of "proper result".
 *
 *
 * WHAT A COMPETITOR ACTUALLY IS
 * -----------------------------
 * The entity model already separates Product → Listing → Seller/Offer, and
 * competitive evidence has to respect that separation:
 *
 *   Offer      one seller's commercial terms. Ten sellers undercutting each
 *              other on one listing is ONE product competing, not ten.
 *   Listing    one marketplace's page for a product. The same product on three
 *              marketplaces is still one product.
 *   Product    the unit of the buyer's choice.
 *   Family     variants of one model (Galaxy M14 6/128 and 8/256). The buyer
 *              may choose between them, but they are not independent evidence
 *              about the market — same brand, same positioning, same seller
 *              ecosystem, prices set by one pricing team.
 *
 * So the unit of competitive evidence is the COMPETITIVE IDENTITY:
 * `parentProductId ?? productId`. One slot per identity, always.
 *
 *
 * COMPETITOR vs COMPARABLE
 * ------------------------
 * These answer different questions and must not be pooled as equals:
 *
 *   DIRECT COMPETITOR   Genuinely contests the same purchase. Same product
 *                       type, shares a marketplace, close on specification,
 *                       inside a tight price band. This is what "5 competitors"
 *                       means, and what the count is reported against.
 *   COMPARABLE          Not a head-to-head rival but close enough to inform
 *                       what the market pays — a wider price band or a looser
 *                       specification match. Real evidence, weighted lower.
 *   REFERENCE           Same product type, outside the comparable range.
 *                       Retained ONLY to describe the wider distribution.
 *                       Never anchors, never votes.
 *
 *
 * WHY EVIDENCE IS WEIGHTED, NOT COUNTED
 * -------------------------------------
 * The previous design made "comparable" a boolean: survive four gates and your
 * price counted exactly as much as any other. That is why the system could not
 * tell five strong comparables from five weak ones — after selection there was
 * no notion of strength left.
 *
 * Every member now carries `evidenceWeight` = relevance × data quality, and the
 * market statistics are WEIGHTED by it. Two consequences that matter:
 *
 *   · A weak fifth comparable adds a little evidence, not a full vote. The set
 *     can honestly report "5 comparables, 3.4 effective".
 *   · `effectiveComparables` — the sum of weights — not the raw count, is what
 *     drives confidence. Padding the set cannot buy confidence, which removes
 *     the incentive that a hard minimum of 5 would have created.
 *
 * The count is a target to be met honestly or missed openly, never a quota to
 * be filled.
 */

// ---------------------------------------------------------------------------
// Policy — every threshold in one place, each with its reason
// ---------------------------------------------------------------------------

export const COMPETITOR_POLICY = {
  // The professor's five, as a TARGET: the point past which extra comparables
  // stop materially improving the estimate, not a gate that must be satisfied.
  target: 5,

  // Below this the market cannot be described at all and the engine refuses.
  // Raised from 2 to 3: two points give a median that is just their midpoint
  // and an IQR that is meaningless, so "the market" was not being measured.
  minimumForRecommendation: 3,

  // Past roughly this many, additional comparables are progressively less
  // similar and add noise rather than signal.
  maxScoring: 10,

  // How many reference points to retain purely for distribution context.
  maxReference: 6,

  direct: {
    minSimilarity: 0.55,
    priceBand: { lower: 0.6, upper: 1.7 },
    label: "Direct competitor",
  },
  comparable: {
    minSimilarity: 0.4,
    priceBand: { lower: 0.45, upper: 2.2 },
    label: "Comparable",
  },

  // Relative contribution of a comparable versus a direct competitor when the
  // two are pooled into one statistic.
  comparableWeightFactor: 0.6,

  // Similarity composition. Marketplace overlap is first-class: a product sold
  // where this one is not cannot contest the same purchase.
  weights: { specifications: 0.45, priceSegment: 0.25, brandTier: 0.15, marketplaceOverlap: 0.15 },

  outlierFence: 1.5,
  minForOutlierFence: 3,
};

// ---------------------------------------------------------------------------
// Specification similarity — numeric, boolean and categorical
// ---------------------------------------------------------------------------

const NON_COMPARABLE_TEXT = new Set(["", "-", "na", "n/a", "none", "unknown"]);

function normalizeText(v) {
  return String(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenOverlap(a, b) {
  const A = new Set(normalizeText(a).split(" ").filter(Boolean));
  const B = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (A.size === 0 || B.size === 0) return null;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / (A.size + B.size - shared);
}

/**
 * One attribute, compared according to its declared dataType. Four verdicts:
 * match / partial / differ / missing. `missing` is never scored as zero — an
 * absent specification is unknown, not different, and scoring it as a
 * difference penalises a product for a gap in our capture rather than a gap in
 * the product. It is tracked as coverage, and coverage degrades confidence.
 */
export function compareAttribute(attr, rawA, rawB) {
  const present = (v) =>
    v !== undefined && v !== null && !(typeof v === "string" && NON_COMPARABLE_TEXT.has(normalizeText(v)));
  if (!present(rawA) || !present(rawB)) return { verdict: "missing", score: null };

  if (attr.dataType === "boolean") {
    const a = rawA === true || rawA === "true";
    const b = rawB === true || rawB === "true";
    return a === b ? { verdict: "match", score: 1 } : { verdict: "differ", score: 0 };
  }

  if (attr.dataType === "integer" || attr.dataType === "decimal") {
    const a = Number(rawA);
    const b = Number(rawB);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return { verdict: "missing", score: null };
    const scale = Math.max(Math.abs(a), Math.abs(b), 1);
    const score = 1 - Math.min(Math.abs(a - b) / scale, 1);
    return { verdict: score >= 0.98 ? "match" : score > 0.15 ? "partial" : "differ", score };
  }

  const na = normalizeText(rawA);
  const nb = normalizeText(rawB);
  if (na === nb) return { verdict: "match", score: 1 };
  const overlap = tokenOverlap(rawA, rawB);
  if (overlap === null) return { verdict: "missing", score: null };
  return { verdict: overlap > 0 ? "partial" : "differ", score: overlap };
}

/**
 * Similarity runs over the FULL attribute schema, not only the pricing-relevant
 * subset: "is this the same kind of product?" and "does this attribute move the
 * price?" are different questions. Pricing-relevant attributes are weighted
 * double, because those are the ones a buyer trades off.
 */
export function specSimilarity(target, candidate, attrs, pricingKeys) {
  let weighted = 0;
  let weightTotal = 0;
  const tally = { match: 0, partial: 0, differ: 0, missing: 0 };

  for (const attr of attrs) {
    const result = compareAttribute(
      attr,
      target.specifications?.[attr.attributeKey],
      candidate.specifications?.[attr.attributeKey]
    );
    tally[result.verdict]++;
    if (result.score === null) continue;
    const w = pricingKeys.has(attr.attributeKey) ? 2 : 1;
    weighted += result.score * w;
    weightTotal += w;
  }

  const compared = tally.match + tally.partial + tally.differ;
  return {
    // null, not a made-up constant: when nothing is comparable the caller
    // redistributes the weight rather than pretending to a middling score.
    score: weightTotal > 0 ? weighted / weightTotal : null,
    compared,
    coverage: attrs.length ? compared / attrs.length : 0,
    ...tally,
  };
}

function priceProximity(a, b) {
  if (!a || !b) return 0;
  return 1 - Math.min(Math.abs(Math.log(a / b)) / Math.log(3), 1);
}

// ---------------------------------------------------------------------------
// Identity, marketplaces, data quality
// ---------------------------------------------------------------------------

/**
 * One slot per model family. Variants of the same model share a competitive
 * identity: the buyer may pick between a 128GB and a 256GB Galaxy M14, but the
 * two are not independent readings of the market — one pricing team sets both.
 */
export function competitiveIdentityOf(product) {
  return product.parentProductId ?? product.id;
}

function marketplaceSetOf(productId) {
  return new Set(getListingsForProduct(productId).map((l) => l.marketplaceId));
}

function marketplaceOverlap(targetSet, candidateSet) {
  let shared = 0;
  for (const id of candidateSet) if (targetSet.has(id)) shared++;
  const union = targetSet.size + candidateSet.size - shared;
  return { shared, score: union > 0 ? shared / union : 0 };
}

const marketplaceNames = (set) =>
  [...set].map((id) => marketplaces.find((m) => m.id === id)?.name ?? id).join(", ") || "none";

/**
 * How much a candidate's PRICE can be trusted as a fact, independent of how
 * similar the product is. A perfect match whose price we captured once, from an
 * auto-matched listing, with no review history, is weaker evidence than a
 * looser match we have watched daily for three months.
 *
 * Each signal is scored 0–1 and averaged. Signals we cannot assess are skipped
 * rather than scored zero, for the same reason `missing` is not `differ`.
 */
function assessDataQuality(productId) {
  const listings = getListingsForProduct(productId);
  const signals = [];
  const notes = [];

  // Identity confidence — are these offers certainly for this product?
  const confidences = listings.map((l) => l.matchConfidence).filter((v) => v != null);
  if (confidences.length) {
    const min = Math.min(...confidences);
    signals.push(Math.max(0, Math.min(1, (min - 0.7) / 0.29)));
    if (min < 0.95) notes.push(`lowest listing match confidence ${(min * 100).toFixed(0)}%`);
  }

  // Observation depth — how long have we watched this price?
  let observations = 0;
  let inStockOffers = 0;
  for (const l of listings) {
    for (const o of getOffersForListing(l.id)) {
      const hist = getPriceHistoryForOffer(o.id);
      observations += hist.length;
      if (hist.length && hist[hist.length - 1].isInStock) inStockOffers++;
    }
  }
  signals.push(Math.min(observations / 90, 1));
  if (observations < 30) notes.push(`only ${observations} price observations`);

  // Live availability — an unbuyable price is not a market price.
  signals.push(inStockOffers > 0 ? 1 : 0);
  if (inStockOffers === 0) notes.push("no in-stock offer");

  // Demand evidence.
  const review = getProductReviewMetrics(productId);
  signals.push(review.rating != null ? 1 : 0);
  if (review.rating == null) notes.push("no rating captured");

  // Marketplace breadth — a price seen on two platforms is corroborated.
  signals.push(Math.min(new Set(listings.map((l) => l.marketplaceId)).size / 2, 1));

  const score = signals.length ? signals.reduce((s, v) => s + v, 0) / signals.length : 0.5;
  return { score, observations, inStockOffers, listingCount: listings.length, notes };
}

// ---------------------------------------------------------------------------
// Weighted statistics
// ---------------------------------------------------------------------------

/**
 * Quantiles over weighted observations. A comparable contributing 0.4 of a vote
 * moves the median 0.4 as far as one contributing a full vote — which is the
 * whole point of weighting: a thin fifth comparable may join the set without
 * distorting it as much as a strong one would.
 */
export function weightedQuantile(pairs, q) {
  const rows = pairs.filter((p) => p.weight > 0).sort((a, b) => a.value - b.value);
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.weight, 0);
  if (total <= 0) return null;
  const targetMass = q * total;
  let cumulative = 0;
  for (let i = 0; i < rows.length; i++) {
    const prev = cumulative;
    cumulative += rows[i].weight;
    if (cumulative >= targetMass) {
      // Interpolate inside the straddling observation so the result moves
      // smoothly as weights change, rather than stepping between raw values.
      // Rounded because these are money values in integer minor units — a
      // fractional paisa is not a price.
      if (i === 0 || cumulative === prev) return rows[i].value;
      const within = (targetMass - prev) / (cumulative - prev);
      return Math.round(rows[i - 1].value + (rows[i].value - rows[i - 1].value) * Math.min(within, 1));
    }
  }
  return rows[rows.length - 1].value;
}

export function weightedDistribution(pairs) {
  const rows = pairs.filter((p) => p.weight > 0);
  if (rows.length === 0) return null;
  const values = rows.map((r) => r.value).sort((a, b) => a - b);
  const q1 = weightedQuantile(rows, 0.25);
  const q3 = weightedQuantile(rows, 0.75);
  return {
    n: rows.length,
    effectiveN: Math.round(rows.reduce((s, r) => s + r.weight, 0) * 100) / 100,
    min: values[0],
    max: values[values.length - 1],
    q1,
    median: weightedQuantile(rows, 0.5),
    q3,
    iqr: q3 - q1,
  };
}

// ---------------------------------------------------------------------------
// The competitive set
// ---------------------------------------------------------------------------

/**
 * @param targetProductId
 * @param priceOf   (productId) => { universalEffectiveMinor, layers } | null
 *                  Injected so this module stays independent of the pricing
 *                  engine that consumes it, and so the price basis is decided
 *                  in exactly one place (PRICE_BASIS).
 * @param mrpMinor  Applicable MRP, used for the reachability gate.
 */
export function buildCompetitiveSet(targetProductId, { priceOf, mrpMinor = null } = {}) {
  const target = getProduct(targetProductId);
  if (!target?.specifications || !target.productTypeId) {
    return emptySet("This product carries no specifications or product type, so nothing can be compared against it.");
  }

  const targetPrice = priceOf(targetProductId)?.universalEffectiveMinor ?? null;
  const attrs = getAttributeDefinitions(target.productTypeId);
  const pricingKeys = new Set(getPricingRelevantAttributes(target.productTypeId).map((a) => a.attributeKey));
  const targetTier = TIER_RANK[getBrand(target.brandId)?.tier] ?? 1;
  const targetMarketplaces = marketplaceSetOf(targetProductId);
  const targetIdentity = competitiveIdentityOf(target);

  const excluded = [];

  // ---- 1. Score every candidate of the same product type -------------------
  const scored = products
    .filter((p) => p.id !== target.id && p.isPurchasable && p.productTypeId === target.productTypeId && p.specifications)
    .map((product) => {
      const price = priceOf(product.id);
      if (!price) return null;

      const review = getProductReviewMetrics(product.id);
      const brand = getBrand(product.brandId);
      const spec = specSimilarity(target, product, attrs, pricingKeys);
      const candidateMarketplaces = marketplaceSetOf(product.id);
      const mp = marketplaceOverlap(targetMarketplaces, candidateMarketplaces);
      const tierScore = 1 - Math.abs((TIER_RANK[brand?.tier] ?? 1) - targetTier) / 2;
      const priceScore = priceProximity(targetPrice, price.universalEffectiveMinor);

      // A term that cannot be scored has its weight redistributed rather than
      // filled with an invented value.
      const W = COMPETITOR_POLICY.weights;
      const terms = [
        { weight: W.specifications, score: spec.score },
        { weight: W.priceSegment, score: priceScore },
        { weight: W.brandTier, score: tierScore },
        { weight: W.marketplaceOverlap, score: mp.score },
      ].filter((t) => t.score != null);
      const weightSum = terms.reduce((s, t) => s + t.weight, 0);
      const similarity = weightSum > 0 ? terms.reduce((s, t) => s + t.weight * t.score, 0) / weightSum : 0;

      const quality = assessDataQuality(product.id);
      const identity = competitiveIdentityOf(product);

      return {
        product,
        brand,
        identity,
        // Same model family as the target: informative about what an upgrade is
        // worth, but not an independent reading of the market.
        isSameFamily: identity === targetIdentity,
        currentPriceMinor: price.universalEffectiveMinor,
        hasUniversalPromo: (price.layers?.universalDiscountMinor ?? 0) > 0,
        rating: review.rating,
        reviewCount: review.reviewCount,
        marketplaceIds: [...candidateMarketplaces],
        sharedMarketplaces: mp.shared,
        similarity,
        specDetail: spec,
        quality,
        breakdown: { specScore: spec.score, tierScore, priceScore, marketplaceScore: mp.score },
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.similarity - a.similarity);

  const candidatePool = scored.length;

  // ---- 2. Hard exclusions --------------------------------------------------
  // These are not "weak evidence"; they are not evidence about this product's
  // market at all, so they never enter any tier.
  let survivors = [];
  for (const c of scored) {
    if (targetMarketplaces.size > 0 && c.sharedMarketplaces === 0) {
      excluded.push({
        ...c,
        tier: "excluded",
        reason: `sold on ${marketplaceNames(new Set(c.marketplaceIds))} — no marketplace in common with this product (${marketplaceNames(targetMarketplaces)}), so no buyer chooses between the two`,
      });
      continue;
    }
    if (mrpMinor && c.currentPriceMinor > mrpMinor * 1.15) {
      excluded.push({
        ...c,
        tier: "excluded",
        reason: `priced at ${formatMinor(c.currentPriceMinor)}, above this product's applicable MRP of ${formatMinor(mrpMinor)} — it cannot be matched on price, so it is not a usable benchmark`,
      });
      continue;
    }
    survivors.push(c);
  }

  // ---- 3. Tier assignment --------------------------------------------------
  const inBand = (price, band) =>
    targetPrice == null || (price >= targetPrice * band.lower && price <= targetPrice * band.upper);

  for (const c of survivors) {
    const D = COMPETITOR_POLICY.direct;
    const C = COMPETITOR_POLICY.comparable;
    if (c.similarity >= D.minSimilarity && inBand(c.currentPriceMinor, D.priceBand) && !c.isSameFamily) {
      c.tier = "direct";
    } else if (c.similarity >= C.minSimilarity && inBand(c.currentPriceMinor, C.priceBand)) {
      c.tier = "comparable";
      c.tierReason = c.isSameFamily
        ? "a variant of this same model — informative about what the upgrade is worth, but not an independent competitor"
        : c.similarity < D.minSimilarity
          ? `similarity ${Math.round(c.similarity * 100)}% is below the ${D.minSimilarity * 100}% needed for a direct competitor`
          : `priced outside the ${D.priceBand.lower}×–${D.priceBand.upper}× band a buyer cross-shops within`;
    } else {
      c.tier = "reference";
      c.tierReason =
        c.similarity < C.minSimilarity
          ? `similarity ${Math.round(c.similarity * 100)}% is below the ${C.minSimilarity * 100}% comparable threshold`
          : `priced at ${formatMinor(c.currentPriceMinor)}, outside the ${C.priceBand.lower}×–${C.priceBand.upper}× comparable band around ${formatMinor(targetPrice)}`;
    }
  }

  // ---- 4. Deduplicate by competitive identity ------------------------------
  // One slot per model family. Three sellers of one product, or two variants of
  // one model, must not occupy three of the five slots — that would report
  // breadth of evidence the market does not actually contain.
  const byIdentity = new Map();
  const familyDuplicates = [];
  for (const c of survivors) {
    const existing = byIdentity.get(c.identity);
    if (!existing) {
      byIdentity.set(c.identity, c);
      continue;
    }
    // Keep the closest variant; record the rest against it.
    const [keep, drop] = existing.similarity >= c.similarity ? [existing, c] : [c, existing];
    byIdentity.set(c.identity, keep);
    keep.familyAlternates = [...(keep.familyAlternates ?? []), { product: drop.product, priceMinor: drop.currentPriceMinor }];
    familyDuplicates.push({
      ...drop,
      tier: "excluded",
      reason: `another variant of the same model (${keep.product.canonicalName}) is already in the set — one slot per model family, so variants cannot each count as a separate competitor`,
    });
  }
  excluded.push(...familyDuplicates);
  const deduped = [...byIdentity.values()];

  // ---- 5. Outlier fence over the scoring tiers -----------------------------
  let scoring = deduped.filter((c) => c.tier === "direct" || c.tier === "comparable");
  if (scoring.length >= COMPETITOR_POLICY.minForOutlierFence) {
    const values = scoring.map((c) => c.currentPriceMinor).sort((a, b) => a - b);
    const q = (p) => {
      const idx = (values.length - 1) * p;
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      return lo === hi ? values[lo] : values[lo] + (values[hi] - values[lo]) * (idx - lo);
    };
    const iqr = q(0.75) - q(0.25);
    const lo = q(0.25) - COMPETITOR_POLICY.outlierFence * iqr;
    const hi = q(0.75) + COMPETITOR_POLICY.outlierFence * iqr;
    const survived = [];
    for (const c of scoring) {
      if (c.currentPriceMinor < lo || c.currentPriceMinor > hi) {
        // Demoted to reference, not deleted: it still describes the market's
        // shape even though it must not pull the anchor.
        c.tier = "reference";
        c.tierReason = `price is a statistical outlier within the competitive set (outside ${COMPETITOR_POLICY.outlierFence}× IQR)`;
      } else survived.push(c);
    }
    scoring = survived;
  }

  // ---- 6. Rank and cap -----------------------------------------------------
  // Direct competitors always rank above comparables; within a tier, by
  // similarity × data quality — so a slightly less similar product we have
  // solid data on can outrank a closer one we barely know.
  const rankValue = (c) => (c.tier === "direct" ? 1 : 0) * 10 + c.similarity * c.quality.score;
  scoring.sort((a, b) => rankValue(b) - rankValue(a));

  const overflow = scoring.slice(COMPETITOR_POLICY.maxScoring);
  for (const c of overflow) {
    c.tier = "reference";
    c.tierReason = `ranked below the ${COMPETITOR_POLICY.maxScoring} closest competitors, which already describe this market`;
  }
  const members = scoring.slice(0, COMPETITOR_POLICY.maxScoring);

  // ---- 7. Evidence weight --------------------------------------------------
  // relevance × data quality, with comparables discounted against direct
  // competitors. This is the number that stops a padded set buying confidence.
  for (const c of members) {
    const tierFactor = c.tier === "direct" ? 1 : COMPETITOR_POLICY.comparableWeightFactor;
    c.evidenceWeight = Math.round(c.similarity * c.quality.score * tierFactor * 1000) / 1000;
  }

  const direct = members.filter((c) => c.tier === "direct");
  const comparable = members.filter((c) => c.tier === "comparable");
  const reference = deduped
    .filter((c) => c.tier === "reference")
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, COMPETITOR_POLICY.maxReference);

  const effective = members.reduce((s, c) => s + c.evidenceWeight, 0);

  return {
    members,
    direct,
    comparable,
    reference,
    excluded,
    coverage: buildCoverage({ members, direct, comparable, effective, candidatePool, excluded, referenceCount: deduped.filter((c) => c.tier === "reference").length }),
    diversity: buildDiversity(members),
    method: {
      productTypeName: productTypes.find((pt) => pt.id === target.productTypeId)?.name ?? "product type",
      candidatePool,
      selected: members.length,
      excludedCount: excluded.length,
      policy: COMPETITOR_POLICY,
      targetMarketplaces: [...targetMarketplaces],
      specBasis: `all ${attrs.length} attributes in the ${target.specSchemaVersion ?? "current"} schema, with the ${pricingKeys.size} pricing-relevant ones weighted double`,
      identityRule:
        "one slot per model family — variants of the same model, and multiple sellers or marketplaces carrying one product, count once",
      marketplaceRule:
        "a competitor must share at least one marketplace with this product; overlap beyond that raises its similarity",
      comparisonBasis: "universal effective price (no card, coupon or exchange required)",
    },
  };
}

function emptySet(reason) {
  return {
    members: [],
    direct: [],
    comparable: [],
    reference: [],
    excluded: [],
    coverage: {
      directCount: 0,
      comparableCount: 0,
      totalCount: 0,
      effectiveComparables: 0,
      target: COMPETITOR_POLICY.target,
      meetsTarget: false,
      sufficient: false,
      level: "none",
      summary: reason,
      shortfall: reason,
    },
    diversity: null,
    method: null,
  };
}

/**
 * Coverage is deliberately graded rather than pass/fail. "How much competitive
 * evidence is there?" has more than two answers, and collapsing it to a boolean
 * is what let a 2-comparable recommendation look the same as an 8-comparable
 * one.
 */
function buildCoverage({ members, direct, comparable, effective, candidatePool, excluded, referenceCount = 0 }) {
  const P = COMPETITOR_POLICY;
  const totalCount = members.length;
  const effectiveComparables = Math.round(effective * 100) / 100;
  const meetsTarget = direct.length >= P.target;

  let level;
  if (direct.length >= P.target && effectiveComparables >= P.target * 0.7) level = "strong";
  else if (totalCount >= P.target && effectiveComparables >= P.target * 0.55) level = "adequate";
  else if (totalCount >= P.minimumForRecommendation) level = "thin";
  else level = "insufficient";

  // Why the target was missed — a real diagnosis, so the answer to "why only
  // three?" is never "because the database said so".
  let shortfall = null;
  if (!meetsTarget) {
    const sameTypeTotal = candidatePool + 1;
    if (sameTypeTotal - 1 < P.target) {
      shortfall = `Only ${sameTypeTotal - 1} other product${sameTypeTotal - 1 === 1 ? " of this type is" : "s of this type are"} tracked at all, so ${P.target} direct competitors do not exist in the captured market yet. Capturing more of this product type is the fix — not loosening the screening.`;
    } else {
      // Account for EVERY candidate that did not become a direct competitor, so
      // the arithmetic in this sentence closes. Reference-tier products are the
      // largest group for a flagship — same type, nowhere near the same price —
      // and omitting them left the explanation visibly short of its own total.
      const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
      const byReason = {};
      const bump = (k) => (byReason[k] = (byReason[k] || 0) + 1);
      for (const e of excluded) {
        if (/no marketplace in common/.test(e.reason)) bump("marketplace");
        else if (/same model/.test(e.reason)) bump("family");
        else if (/applicable MRP/.test(e.reason)) bump("mrp");
        else bump("other");
      }

      const parts = [];
      if (byReason.marketplace) parts.push(plural(byReason.marketplace, "is sold on no shared marketplace", "are sold on no shared marketplace"));
      if (byReason.family) parts.push(plural(byReason.family, "is another variant of this same model", "are other variants of this same model"));
      if (byReason.mrp) parts.push(plural(byReason.mrp, "is priced above this product's MRP", "are priced above this product's MRP"));
      if (byReason.other) parts.push(plural(byReason.other, "was screened out", "were screened out"));
      if (referenceCount) parts.push(plural(referenceCount, "is too far from this product on price or specification", "are too far from this product on price or specification"));
      const demoted = members.length - direct.length;
      if (demoted > 0) parts.push(plural(demoted, "informs the price without contesting the same purchase", "inform the price without contesting the same purchase"));

      shortfall = `${plural(sameTypeTotal - 1, "product", "products")} of this type ${sameTypeTotal - 1 === 1 ? "was" : "were"} evaluated and ${direct.length} qualif${direct.length === 1 ? "ies" : "y"} as a direct competitor. Of the rest, ${parts.join("; ")}. None is added to reach ${P.target}, because a padded set would report evidence that is not there.`;
    }
  }

  const summary = meetsTarget
    ? `${direct.length} direct competitors and ${comparable.length} comparable product${comparable.length === 1 ? "" : "s"}, worth ${effectiveComparables.toFixed(1)} effective comparables after weighting for relevance and data quality.`
    : `${direct.length} direct competitor${direct.length === 1 ? "" : "s"} and ${comparable.length} comparable product${comparable.length === 1 ? "" : "s"} against a target of ${P.target}, worth ${effectiveComparables.toFixed(1)} effective comparables.`;

  return {
    directCount: direct.length,
    comparableCount: comparable.length,
    totalCount,
    effectiveComparables,
    target: P.target,
    minimum: P.minimumForRecommendation,
    meetsTarget,
    sufficient: totalCount >= P.minimumForRecommendation,
    level,
    summary,
    shortfall,
  };
}

/**
 * Diversity is reported because a set of five near-identical products is weaker
 * evidence than five spread across brands, price points and platforms — the
 * first measures one seller's pricing, the second measures a market. It is
 * DESCRIBED, never engineered: no candidate is admitted to improve a spread.
 */
function buildDiversity(members) {
  if (members.length === 0) return null;
  const brands = new Set(members.map((c) => c.brand?.id).filter(Boolean));
  const tiers = new Set(members.map((c) => c.brand?.tier).filter(Boolean));
  const mps = new Set(members.flatMap((c) => c.marketplaceIds));
  const prices = members.map((c) => c.currentPriceMinor).sort((a, b) => a - b);
  const spread = prices.length > 1 && prices[0] ? (prices[prices.length - 1] - prices[0]) / prices[0] : 0;

  const notes = [];
  if (brands.size === 1) notes.push("every competitor is the same brand, so this measures one brand's pricing rather than the market's");
  if (mps.size === 1) notes.push("all competitors sit on a single marketplace, so cross-platform pricing differences are invisible");
  if (spread < 0.08 && members.length >= 3) notes.push("competitors are tightly clustered in price, which is a commoditised market rather than a thin one");

  return {
    brandCount: brands.size,
    brandTierCount: tiers.size,
    marketplaceCount: mps.size,
    marketplaceIds: [...mps],
    priceSpreadPct: Math.round(spread * 1000) / 10,
    notes,
  };
}
