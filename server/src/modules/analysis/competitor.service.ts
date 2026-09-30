import type { AnalysisRepository, AttributeRow, ProductRow } from "./analysis.repository.js";

/**
 * THE COMPETITIVE EVIDENCE SET
 * ============================
 *
 * A faithful port of `src/utils/competitiveSet.js`. The frontend
 * implementation is the source of truth and this is a translation of it, not
 * a second opinion — `tests/analysis-parity.test.ts` asserts the two agree
 * member for member, tier for tier, weight for weight.
 *
 * The reasoning behind every threshold lives in the original module and is
 * not repeated here. What matters for a reader of THIS file is the shape:
 *
 *   1. score every candidate of the same product type
 *   2. hard exclusions — no shared marketplace, above the applicable MRP
 *   3. tier assignment — direct / comparable / reference
 *   4. deduplicate by competitive identity (one slot per model family)
 *   5. outlier fence over the scoring tiers
 *   6. rank and cap
 *   7. evidence weight = similarity × data quality × tier factor
 *
 * The unit of competitive evidence is the COMPETITIVE IDENTITY, not the
 * product row: ten sellers undercutting each other on one listing is one
 * product competing, and two variants of one model are one pricing decision.
 */

export const TIER_RANK: Record<string, number> = { value: 0, mid: 1, premium: 2 };

/** Every threshold in one place. Mirrors COMPETITOR_POLICY on the frontend. */
export const COMPETITOR_POLICY = {
  target: 5,
  minimumForRecommendation: 3,
  maxScoring: 10,
  maxReference: 6,
  direct: { minSimilarity: 0.55, priceBand: { lower: 0.6, upper: 1.7 }, label: "Direct competitor" },
  comparable: { minSimilarity: 0.4, priceBand: { lower: 0.45, upper: 2.2 }, label: "Comparable" },
  comparableWeightFactor: 0.6,
  weights: { specifications: 0.45, priceSegment: 0.25, brandTier: 0.15, marketplaceOverlap: 0.15 },
  outlierFence: 1.5,
  minForOutlierFence: 3,
} as const;

/* ------------------------------------------------- specification similarity */

const NON_COMPARABLE_TEXT = new Set(["", "-", "na", "n/a", "none", "unknown"]);

const normalizeText = (v: unknown) =>
  String(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function tokenOverlap(a: unknown, b: unknown): number | null {
  const A = new Set(normalizeText(a).split(" ").filter(Boolean));
  const B = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (A.size === 0 || B.size === 0) return null;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / (A.size + B.size - shared);
}

export type AttributeVerdict = "match" | "partial" | "differ" | "missing";

/**
 * One attribute, compared by its declared data type.
 *
 * `missing` is never scored as zero. An absent specification is unknown, not
 * different, and scoring it as a difference penalises a product for a gap in
 * our capture rather than a gap in the product.
 */
export function compareAttribute(
  attr: AttributeRow,
  rawA: unknown,
  rawB: unknown
): { verdict: AttributeVerdict; score: number | null } {
  const present = (v: unknown) =>
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

export type SpecSimilarity = {
  score: number | null;
  compared: number;
  coverage: number;
  match: number;
  partial: number;
  differ: number;
  missing: number;
};

/**
 * Runs over the FULL attribute schema, not only the pricing-relevant subset:
 * "is this the same kind of product?" and "does this attribute move the
 * price?" are different questions. Pricing-relevant attributes weigh double.
 */
export function specSimilarity(
  target: ProductRow,
  candidate: ProductRow,
  attrs: AttributeRow[],
  pricingKeys: Set<string>
): SpecSimilarity {
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
    // redistributes the weight rather than inventing a middling score.
    score: weightTotal > 0 ? weighted / weightTotal : null,
    compared,
    coverage: attrs.length ? compared / attrs.length : 0,
    ...tally,
  };
}

export function priceProximity(a: number | null, b: number | null): number {
  if (!a || !b) return 0;
  return 1 - Math.min(Math.abs(Math.log(a / b)) / Math.log(3), 1);
}

/** One slot per model family. Variants of one model share an identity. */
export const competitiveIdentityOf = (p: { id: string; parentProductId: string | null }) =>
  p.parentProductId ?? p.id;

export function marketplaceOverlap(targetSet: Set<string>, candidateSet: Set<string>) {
  let shared = 0;
  for (const id of candidateSet) if (targetSet.has(id)) shared++;
  const union = targetSet.size + candidateSet.size - shared;
  return { shared, score: union > 0 ? shared / union : 0 };
}

/* ------------------------------------------------------------ data quality */

export type DataQuality = {
  score: number;
  observations: number;
  inStockOffers: number;
  listingCount: number;
  notes: string[];
};

/**
 * How much a candidate's PRICE can be trusted as a fact, independent of how
 * similar the product is. Signals that cannot be assessed are skipped rather
 * than scored zero, for the same reason `missing` is not `differ`.
 */
export function assessDataQuality(input: {
  listingCount: number;
  marketplaceCount: number;
  minMatchConfidence: number | null;
  observations: number;
  inStockOffers: number;
  hasRating: boolean;
}): DataQuality {
  const signals: number[] = [];
  const notes: string[] = [];

  if (input.minMatchConfidence != null) {
    const min = input.minMatchConfidence;
    signals.push(Math.max(0, Math.min(1, (min - 0.7) / 0.29)));
    if (min < 0.95) notes.push(`lowest listing match confidence ${(min * 100).toFixed(0)}%`);
  }

  signals.push(Math.min(input.observations / 90, 1));
  if (input.observations < 30) notes.push(`only ${input.observations} price observations`);

  signals.push(input.inStockOffers > 0 ? 1 : 0);
  if (input.inStockOffers === 0) notes.push("no in-stock offer");

  signals.push(input.hasRating ? 1 : 0);
  if (!input.hasRating) notes.push("no rating captured");

  signals.push(Math.min(input.marketplaceCount / 2, 1));

  const score = signals.length ? signals.reduce((s, v) => s + v, 0) / signals.length : 0.5;
  return { score, observations: input.observations, inStockOffers: input.inStockOffers, listingCount: input.listingCount, notes };
}

/* ------------------------------------------------------ review aggregation */

/**
 * Product-level review metrics, aggregated the ONE way this system aggregates
 * them: summed review count, review-count-weighted mean rating.
 *
 * Mirrors `src/utils/productMetrics.js`. A 4.8★ listing with 45 reviews must
 * not outvote a 4.1★ listing with 42,000, and taking the maximum — which an
 * earlier version of the catalogue did — let exactly that happen.
 */
export function aggregateReviews(
  snapshots: Array<{ averageRating: number | null; reviewCount: number | null }>
): { rating: number | null; reviewCount: number } {
  let weighted = 0;
  let reviewCount = 0;
  for (const s of snapshots) {
    const count = s.reviewCount ?? 0;
    if (s.averageRating != null && count > 0) {
      weighted += s.averageRating * count;
      reviewCount += count;
    }
  }
  return {
    // One decimal, because that is the precision the source marketplaces
    // publish; carrying more would imply accuracy the data lacks.
    rating: reviewCount > 0 ? Math.round((weighted / reviewCount) * 10) / 10 : null,
    reviewCount,
  };
}

/* ------------------------------------------------------------------ types */

export type CompetitorTier = "direct" | "comparable" | "reference" | "excluded";

export type ScoredCompetitor = {
  productId: string;
  canonicalName: string;
  brandId: string;
  brandName: string | null;
  brandTier: string | null;
  identity: string;
  isSameFamily: boolean;
  currentPriceMinor: number;
  hasUniversalPromo: boolean;
  rating: number | null;
  reviewCount: number;
  marketplaceIds: string[];
  sharedMarketplaces: number;
  similarity: number;
  specDetail: SpecSimilarity;
  quality: DataQuality;
  breakdown: {
    specScore: number | null;
    tierScore: number;
    priceScore: number;
    marketplaceScore: number;
  };
  tier: CompetitorTier;
  tierReason: string | null;
  evidenceWeight: number | null;
  familyAlternates: Array<{ productId: string; canonicalName: string; priceMinor: number }>;
  specifications: Record<string, unknown> | null;
};

export type ExcludedCompetitor = ScoredCompetitor & { reason: string };

export type CompetitiveSet = {
  members: ScoredCompetitor[];
  direct: ScoredCompetitor[];
  comparable: ScoredCompetitor[];
  reference: ScoredCompetitor[];
  excluded: ExcludedCompetitor[];
  coverage: Coverage;
  diversity: Diversity | null;
  method: Record<string, unknown>;
  empty?: { reason: string };
};

export type Coverage = {
  directCount: number;
  comparableCount: number;
  totalCount: number;
  effectiveComparables: number;
  target: number;
  minimum: number;
  meetsTarget: boolean;
  sufficient: boolean;
  level: "strong" | "adequate" | "thin" | "insufficient";
  shortfallReasons: Array<{ reason: string; count: number }>;
};

export type Diversity = {
  brandCount: number;
  marketplaceCount: number;
  priceSpreadPct: number | null;
  tierSpread: number;
};

/* ---------------------------------------------------------------- service */

export class CompetitorService {
  constructor(private readonly repo: AnalysisRepository) {}

  /**
   * The competitive set for one product.
   *
   * Loads everything in a fixed number of batched queries, then runs the
   * pipeline in memory. The candidate pool is bounded by the product type —
   * at most 29 products in this dataset — so the in-memory stage is trivial
   * and the database work does not scale with it.
   */
  async build(targetProductId: string): Promise<CompetitiveSet> {
    const target = await this.repo.findProduct(targetProductId);
    if (!target) return emptySet("Product not found.");
    if (!target.specifications || !target.productTypeId) {
      return emptySet("This product carries no specifications or product type, so nothing can be compared against it.");
    }

    const [attrs, candidates, mrpMinor, productTypeName] = await Promise.all([
      this.repo.attributesFor(target.productTypeId),
      this.repo.candidatesFor(target.productTypeId, target.id),
      this.repo.applicableMrp(target.id),
      this.repo.productTypeName(target.productTypeId),
    ]);

    const everyone = [target.id, ...candidates.map((c) => c.id)];
    const [prices, reviews, marketplaceRows, quality] = await Promise.all([
      this.repo.currentPrices(everyone),
      this.repo.latestReviews(everyone),
      this.repo.marketplaceSets(everyone),
      this.repo.qualitySignals(everyone),
    ]);

    const priceBy = new Map(prices.map((p) => [p.productId, p]));
    const qualityBy = new Map(quality.map((q) => [q.productId, q]));

    const reviewsBy = new Map<string, Array<{ averageRating: number | null; reviewCount: number | null }>>();
    for (const r of reviews) {
      const bucket = reviewsBy.get(r.productId) ?? [];
      bucket.push({ averageRating: r.averageRating, reviewCount: r.reviewCount });
      reviewsBy.set(r.productId, bucket);
    }

    const marketplacesBy = new Map<string, Set<string>>();
    for (const row of marketplaceRows) {
      const set = marketplacesBy.get(row.productId) ?? new Set<string>();
      set.add(row.marketplaceId);
      marketplacesBy.set(row.productId, set);
    }

    const pricingKeys = new Set(attrs.filter((a) => a.isPricingRelevant).map((a) => a.attributeKey));
    const targetPrice = priceBy.get(target.id)?.universalEffectiveMinor ?? null;
    const targetTier = TIER_RANK[target.brandTier ?? ""] ?? 1;
    const targetMarketplaces = marketplacesBy.get(target.id) ?? new Set<string>();
    const targetIdentity = competitiveIdentityOf(target);

    /* ---- 1. score every candidate ------------------------------------- */

    const scored: ScoredCompetitor[] = [];
    for (const product of candidates) {
      const price = priceBy.get(product.id);
      if (!price) continue;

      const review = aggregateReviews(reviewsBy.get(product.id) ?? []);
      const spec = specSimilarity(target, product, attrs, pricingKeys);
      const candidateMarketplaces = marketplacesBy.get(product.id) ?? new Set<string>();
      const mp = marketplaceOverlap(targetMarketplaces, candidateMarketplaces);
      const tierScore = 1 - Math.abs((TIER_RANK[product.brandTier ?? ""] ?? 1) - targetTier) / 2;
      const priceScore = priceProximity(targetPrice, price.universalEffectiveMinor);

      // A term that cannot be scored has its weight redistributed rather than
      // filled with an invented value.
      const W = COMPETITOR_POLICY.weights;
      const candidateTerms: Array<{ weight: number; score: number | null }> = [
        { weight: W.specifications, score: spec.score },
        { weight: W.priceSegment, score: priceScore },
        { weight: W.brandTier, score: tierScore },
        { weight: W.marketplaceOverlap, score: mp.score },
      ];
      const terms = candidateTerms.filter((t): t is { weight: number; score: number } => t.score != null);
      const weightSum = terms.reduce((s, t) => s + t.weight, 0);
      const similarity = weightSum > 0 ? terms.reduce((s, t) => s + t.weight * t.score, 0) / weightSum : 0;

      const q = qualityBy.get(product.id);
      const identity = competitiveIdentityOf(product);

      scored.push({
        productId: product.id,
        canonicalName: product.canonicalName,
        brandId: product.brandId,
        brandName: product.brandName,
        brandTier: product.brandTier,
        identity,
        isSameFamily: identity === targetIdentity,
        currentPriceMinor: price.universalEffectiveMinor,
        hasUniversalPromo: price.universalDiscountMinor > 0,
        rating: review.rating,
        reviewCount: review.reviewCount,
        marketplaceIds: [...candidateMarketplaces],
        sharedMarketplaces: mp.shared,
        similarity,
        specDetail: spec,
        quality: assessDataQuality({
          listingCount: q?.listingCount ?? 0,
          marketplaceCount: q?.marketplaceCount ?? 0,
          minMatchConfidence: q?.minMatchConfidence ?? null,
          observations: q?.observations ?? 0,
          inStockOffers: q?.inStockOffers ?? 0,
          hasRating: review.rating != null,
        }),
        breakdown: { specScore: spec.score, tierScore, priceScore, marketplaceScore: mp.score },
        tier: "reference",
        tierReason: null,
        evidenceWeight: null,
        familyAlternates: [],
        specifications: product.specifications,
      });
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    const candidatePool = scored.length;

    /* ---- 2. hard exclusions -------------------------------------------- */

    const excluded: ExcludedCompetitor[] = [];
    const survivors: ScoredCompetitor[] = [];
    for (const c of scored) {
      if (targetMarketplaces.size > 0 && c.sharedMarketplaces === 0) {
        excluded.push({ ...c, tier: "excluded", reason: "no marketplace in common with this product" });
        continue;
      }
      if (mrpMinor && c.currentPriceMinor > mrpMinor * 1.15) {
        excluded.push({ ...c, tier: "excluded", reason: "priced above this product's applicable MRP" });
        continue;
      }
      survivors.push(c);
    }

    /* ---- 3. tier assignment -------------------------------------------- */

    const inBand = (price: number, band: { lower: number; upper: number }) =>
      targetPrice == null || (price >= targetPrice * band.lower && price <= targetPrice * band.upper);

    const D = COMPETITOR_POLICY.direct;
    const C = COMPETITOR_POLICY.comparable;
    for (const c of survivors) {
      if (c.similarity >= D.minSimilarity && inBand(c.currentPriceMinor, D.priceBand) && !c.isSameFamily) {
        c.tier = "direct";
        c.tierReason = null;
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
            : `priced outside the ${C.priceBand.lower}×–${C.priceBand.upper}× comparable band`;
      }
    }

    /* ---- 4. deduplicate by competitive identity ------------------------ */

    const byIdentity = new Map<string, ScoredCompetitor>();
    for (const c of survivors) {
      const existing = byIdentity.get(c.identity);
      if (!existing) {
        byIdentity.set(c.identity, c);
        continue;
      }
      const [keep, drop] = existing.similarity >= c.similarity ? [existing, c] : [c, existing];
      byIdentity.set(c.identity, keep);
      keep.familyAlternates = [
        ...keep.familyAlternates,
        { productId: drop.productId, canonicalName: drop.canonicalName, priceMinor: drop.currentPriceMinor },
      ];
      excluded.push({
        ...drop,
        tier: "excluded",
        reason: `another variant of the same model (${keep.canonicalName}) is already in the set — one slot per model family`,
      });
    }
    const deduped = [...byIdentity.values()];

    /* ---- 5. outlier fence over the scoring tiers ----------------------- */

    let scoring = deduped.filter((c) => c.tier === "direct" || c.tier === "comparable");
    if (scoring.length >= COMPETITOR_POLICY.minForOutlierFence) {
      const values = scoring.map((c) => c.currentPriceMinor).sort((a, b) => a - b);
      const q = (p: number) => {
        const idx = (values.length - 1) * p;
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        return lo === hi ? values[lo]! : values[lo]! + (values[hi]! - values[lo]!) * (idx - lo);
      };
      const iqr = q(0.75) - q(0.25);
      const lo = q(0.25) - COMPETITOR_POLICY.outlierFence * iqr;
      const hi = q(0.75) + COMPETITOR_POLICY.outlierFence * iqr;
      const survived: ScoredCompetitor[] = [];
      for (const c of scoring) {
        if (c.currentPriceMinor < lo || c.currentPriceMinor > hi) {
          // Demoted, not deleted: it still describes the market's shape even
          // though it must not pull the anchor.
          c.tier = "reference";
          c.tierReason = `price is a statistical outlier within the competitive set (outside ${COMPETITOR_POLICY.outlierFence}× IQR)`;
        } else survived.push(c);
      }
      scoring = survived;
    }

    /* ---- 6. rank and cap ----------------------------------------------- */

    // Direct competitors always outrank comparables; within a tier, by
    // similarity × data quality, so a slightly less similar product we have
    // solid data on can outrank a closer one we barely know.
    const rankValue = (c: ScoredCompetitor) => (c.tier === "direct" ? 1 : 0) * 10 + c.similarity * c.quality.score;
    scoring.sort((a, b) => rankValue(b) - rankValue(a));

    for (const c of scoring.slice(COMPETITOR_POLICY.maxScoring)) {
      c.tier = "reference";
      c.tierReason = `ranked below the ${COMPETITOR_POLICY.maxScoring} closest competitors, which already describe this market`;
    }
    const members = scoring.slice(0, COMPETITOR_POLICY.maxScoring);

    /* ---- 7. evidence weight -------------------------------------------- */

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
    const effective = members.reduce((s, c) => s + (c.evidenceWeight ?? 0), 0);

    return {
      members,
      direct,
      comparable,
      reference,
      excluded,
      coverage: buildCoverage({
        direct,
        comparable,
        members,
        effective,
        candidatePool,
        excluded,
        referenceCount: deduped.filter((c) => c.tier === "reference").length,
      }),
      diversity: buildDiversity(members),
      method: {
        productTypeName: productTypeName ?? "product type",
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
}

/* ---------------------------------------------------------------- helpers */

function emptySet(reason: string): CompetitiveSet {
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
      minimum: COMPETITOR_POLICY.minimumForRecommendation,
      meetsTarget: false,
      sufficient: false,
      level: "insufficient",
      shortfallReasons: [],
    },
    diversity: null,
    method: {},
    empty: { reason },
  };
}

/**
 * Coverage: how much evidence the set actually holds, and — when it falls
 * short of the target — a real diagnosis of why.
 *
 * The frontend renders that diagnosis as a sentence. Here it is returned as
 * counted reasons, because prose is presentation and the counts are the data.
 * The interface can phrase them; nothing else should have to parse a sentence
 * to learn that four candidates shared no marketplace.
 */
function buildCoverage(input: {
  direct: ScoredCompetitor[];
  comparable: ScoredCompetitor[];
  members: ScoredCompetitor[];
  effective: number;
  candidatePool: number;
  excluded: ExcludedCompetitor[];
  referenceCount: number;
}): Coverage {
  const P = COMPETITOR_POLICY;
  const totalCount = input.members.length;
  const effectiveComparables = Math.round(input.effective * 100) / 100;
  const meetsTarget = input.direct.length >= P.target;

  let level: Coverage["level"];
  if (input.direct.length >= P.target && effectiveComparables >= P.target * 0.7) level = "strong";
  else if (totalCount >= P.target && effectiveComparables >= P.target * 0.55) level = "adequate";
  else if (totalCount >= P.minimumForRecommendation) level = "thin";
  else level = "insufficient";

  const shortfallReasons: Array<{ reason: string; count: number }> = [];
  if (!meetsTarget) {
    const counts: Record<string, number> = {};
    const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
    for (const e of input.excluded) {
      if (/no marketplace in common/.test(e.reason)) bump("no_shared_marketplace");
      else if (/same model/.test(e.reason)) bump("same_model_family");
      else if (/applicable MRP/.test(e.reason)) bump("above_mrp");
      else bump("other");
    }
    if (input.referenceCount) counts["too_far_on_price_or_spec"] = input.referenceCount;
    const demoted = input.members.length - input.direct.length;
    if (demoted > 0) counts["informs_without_contesting"] = demoted;
    if (input.candidatePool < P.target) counts["product_type_too_small"] = P.target - input.candidatePool;

    for (const [reason, count] of Object.entries(counts)) shortfallReasons.push({ reason, count });
    shortfallReasons.sort((a, b) => b.count - a.count);
  }

  return {
    directCount: input.direct.length,
    comparableCount: input.comparable.length,
    totalCount,
    effectiveComparables,
    target: P.target,
    minimum: P.minimumForRecommendation,
    meetsTarget,
    sufficient: totalCount >= P.minimumForRecommendation,
    level,
    shortfallReasons,
  };
}

/**
 * Diversity is DESCRIBED, never engineered: no candidate is admitted to
 * improve a spread. Five near-identical products are weaker evidence than
 * five across brands and price points — the first measures one seller's
 * pricing, the second measures a market.
 */
function buildDiversity(members: ScoredCompetitor[]): Diversity | null {
  if (members.length === 0) return null;
  const brands = new Set(members.map((c) => c.brandId).filter(Boolean));
  const marketplaces = new Set(members.flatMap((c) => c.marketplaceIds));
  const prices = members.map((c) => c.currentPriceMinor).sort((a, b) => a - b);
  const tiers = new Set(members.map((c) => c.brandTier ?? "unknown"));
  const low = prices[0]!;
  const high = prices[prices.length - 1]!;
  return {
    brandCount: brands.size,
    marketplaceCount: marketplaces.size,
    priceSpreadPct: low > 0 ? Math.round(((high - low) / low) * 1000) / 10 : null,
    tierSpread: tiers.size,
  };
}
