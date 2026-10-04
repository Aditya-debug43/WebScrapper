import { AppError } from "../../lib/errors.js";
import { PRICE_BASIS } from "../../lib/priceLadder.js";
/** Earlier than any observation this dataset holds, so the range is unbounded below. */
const EARLIEST_DATE = "0001-01-01";
import {
  COMPETITOR_POLICY,
  type CompetitorService,
  type ExcludedCompetitor,
  type ScoredCompetitor,
} from "../analysis/competitor.service.js";
import { weightedDistribution, type AnalysisService, type Finding } from "../analysis/analysis.service.js";
import type { AnalysisRepository } from "../analysis/analysis.repository.js";
import type { MarketplaceIdentity, PricingRepository } from "./pricing.repository.js";
import { fitHedonicModel, type HedonicResult } from "./hedonic.js";
import { fitHedonicCvModel, type HedonicCvResult } from "./hedonicCv.js";

/**
 * THE PRICING RECOMMENDATION
 * ==========================
 *
 * A faithful port of `buildRecommendation` in `src/utils/pricingEngine.js`.
 * The frontend engine is validated and is the baseline; this is a
 * translation, and `tests/pricing-parity.test.ts` asserts the two agree
 * strategy for strategy, bound for bound.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not an AI that knows the right price. Every number below comes from
 * observed market data through arithmetic that can be inspected. The one
 * statistical component — the hedonic willingness-to-pay model — refuses
 * outright when its own fit is not good enough, which on this dataset is
 * most of the time.
 *
 *   DATA → MARKET ANALYSIS → COMPETITIVE CONTEXT → HISTORICAL CONTEXT
 *        → VALUE SIGNALS → CONSTRAINTS → RECOMMENDATION → EXPLANATION
 *
 * Everything Phase 5 already computes is REUSED. There is one competitive
 * set, one effective price, one median, one historical normal in this
 * system, and this service creates none of them.
 */

/** Named so their intent is auditable rather than buried as magic numbers. */
export const PRICING_POLICY = {
  /** IQR / median at or below this reads as a coherent market. */
  healthyDispersion: 0.35,
  /** How far above the product's OWN market an evidenced Premium may sit. */
  maxEvidencedPremiumOverOwn: 0.25,
  /** Used only when the product has no market of its own. */
  maxUnevidencedPremiumOverAnchor: 0.1,
  /** Confidence caps how far a strategy may travel from the anchor. */
  travel: { high: 1, "medium-high": 0.8, medium: 0.55, low: 0.35 } as Record<string, number>,
  /** Fast Sale undercuts by this much, and is floored here relative to the anchor. */
  fastUndercut: 0.985,
  fastFloorOfAnchor: 0.85,
  /** Balanced moves this share of the evidenced premium, after travel damping. */
  balancedPremiumShare: 0.6,
  anchor: { ownWeight: 0.65, normalWeight: 0.35, singleOwnWeight: 0.75, singleOwnBand: 0.1 },
  ceilingHeadroom: 1.1,
  marketFloorOfPoolMin: 0.92,
  marketFloorCapOfCeiling: 0.85,
  breakEvenMargin: 1.02,
  matchConfidenceFloor: 0.95,
  /** Above this the MRP is a display anchor rather than a guide to the market. */
  mrpInflationRatio: 2.2,
  gstOnFees: 0.18,
} as const;

/**
 * The recommendation model in force.
 *
 * Versioned from the outset so a later approach can be compared against
 * this one rather than silently replacing it. `baseline-v1` is the migrated
 * frontend engine, unchanged.
 */
export const RECOMMENDATION_MODEL_VERSION = "baseline-v1";

/**
 * The model versions a caller may ask for.
 *
 * `baseline-v1` is the migrated frontend engine, unchanged, and is the
 * DEFAULT. `hedonic-cv-v2` keeps every part of it except the attribute
 * model's fit and trust gate, which move to ridge regression validated
 * leave-one-out.
 *
 * v2 is not the default, and that is a decision rather than caution. Phase 6
 * exists to move the validated engine without changing what it computes, and
 * 77 parity assertions hold it to that. Promoting v2 also has a visible
 * consequence — the share of products receiving an evidenced attribute
 * premium falls from 58% to 30% — and while that lower number is the correct
 * one (see docs/PRICING_MODEL_RESEARCH.md; the other 28 points fail
 * cross-validation and predict worse than the competitive median), a change
 * of that size belongs to whoever owns the product, not to a migration.
 */
export const MODEL_VERSIONS = ["baseline-v1", "hedonic-cv-v2"] as const;
export type ModelVersion = (typeof MODEL_VERSIONS)[number];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * One competitor, as a caller sees it.
 *
 * Everything needed to justify the member's presence and its weight — the
 * tier and WHY it is that tier, the similarity, the data-quality notes behind
 * the evidence weight, and the variants folded into it. A client should never
 * have to ask a second endpoint to explain a row it was given here.
 */
function serialiseCompetitor(c: ScoredCompetitor) {
  return {
    productId: c.productId,
    canonicalName: c.canonicalName,
    brandId: c.brandId,
    brandName: c.brandName,
    brandTier: c.brandTier,
    tier: c.tier,
    tierReason: c.tierReason,
    priceMinor: c.currentPriceMinor,
    rating: c.rating,
    reviewCount: c.reviewCount,
    similarity: Math.round(c.similarity * 10000) / 10000,
    evidenceWeight: c.evidenceWeight,
    qualityNotes: c.quality?.notes ?? [],
    marketplaceIds: c.marketplaceIds,
    /**
     * Other variants of the same model, folded into this one slot. Two
     * storage tiers of one phone are one pricing decision, so they hold one
     * place in the set — but the ones folded away are named, because a reader
     * who sees "6 competitors" is entitled to know it was not 9.
     */
    familyAlternates: c.familyAlternates,
  };
}

/* --------------------------------------------------- psychological pricing */

/**
 * Snap granularity scales with price. A flat ₹100 grid is far too coarse at
 * the low end — it collapsed ₹1,249 to ₹1,199, enough to merge two
 * genuinely different strategies into one number.
 */
function snapGranularity(rupees: number): number {
  if (rupees < 1000) return 10;
  if (rupees < 10000) return 50;
  return 100;
}

function snapToPsychologicalPrice(minor: number): number {
  const rupees = minor / 100;
  const g = snapGranularity(rupees);
  return Math.max(Math.floor(rupees / g) * g - 1, 1) * 100;
}

/**
 * Snap to a credible ending, but never outside the hard bounds.
 *
 * Exported for tests. Mutation testing turned `while (snapped < floorMinor)`
 * into `if` and nothing failed, which was worth understanding rather than
 * papering over: every caller clamps into `[floor, ceiling]` first, and
 * snapping moves a price down by strictly less than one step, so from a
 * clamped input a single step always suffices and the loop can never iterate
 * twice. The loop is not dead — it is what makes the function correct for an
 * input that was NOT clamped — so it stays, and a test now feeds it one.
 */
export function snapWithin(minor: number, floorMinor: number, ceilingMinor: number | null): number {
  const step = snapGranularity(minor / 100) * 100;
  let snapped = snapToPsychologicalPrice(minor);
  while (snapped < floorMinor) snapped += step;
  if (ceilingMinor != null && snapped > ceilingMinor) {
    while (snapped > ceilingMinor) snapped -= step;
    // Bounds collide — sit exactly on the ceiling rather than break it.
    if (snapped < floorMinor) return Math.round(ceilingMinor);
  }
  return snapped;
}

/* ------------------------------------------------------------ statistics */

function percentileOf(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

function distribution(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0]!,
    max: s[s.length - 1]!,
    q1: percentileOf(s, 0.25),
    median: percentileOf(s, 0.5),
    q3: percentileOf(s, 0.75),
    iqr: percentileOf(s, 0.75) - percentileOf(s, 0.25),
  };
}

/* ------------------------------------------------------------------ types */

export type Strategy = {
  key: "fast_sale" | "balanced" | "premium";
  label: string;
  priceMinor: number;
  /** The unconstrained value, before clamping and snapping. */
  rawPriceMinor: number;
  supported: boolean;
  /** Which one is the headline, so a client need not know the key. */
  recommended: boolean;
  bindingConstraint: { key: string; label: string; boundMinor: number } | null;
  /** Where this price would sit among the prices a buyer chooses between. */
  position: {
    rank: number;
    of: number;
    total: number;
    percentile: number;
    undercuts: number;
    sitsAbove: number;
  };
  /** What this price earns on each marketplace, net of fees and GST. */
  margins: Array<{
    marketplace: MarketplaceIdentity;
    feeRule: { referralPct: number; fixedClosingFee: number; isCategoryDefault: boolean } | null;
    breakEvenMinor: number | null;
    netMinor: number | null;
    marginMinor: number | null;
    marginPct: number | null;
  }>;
  /** Structured drivers. Prose is the interface's job. */
  drivers: Array<{ factor: string; direction: "upward" | "downward" | "neutral"; valueMinor?: number; note: string }>;
};

export type ExplanationFactor = {
  factor: string;
  direction: "upward" | "downward" | "neutral";
  impactMinor: number | null;
  evidence: Record<string, unknown>;
};

/* ---------------------------------------------------------------- service */

export class PricingService {
  constructor(
    private readonly repo: PricingRepository,
    private readonly analysisRepo: AnalysisRepository,
    private readonly competitors: CompetitorService,
    private readonly analysis: AnalysisService
  ) {}

  /**
   * The recommendation for one product.
   *
   * Reuses the Phase 5 analysis wholesale — one call, which itself batches
   * its loading — then adds the commercial layer and the pricing decision on
   * top. There is no second competitor computation anywhere in this method.
   */
  async recommend(productId: string, opts: { marketplaceId?: string; modelVersion?: ModelVersion } = {}) {
    const modelVersion: ModelVersion = opts.modelVersion ?? RECOMMENDATION_MODEL_VERSION;
    const target = await this.analysisRepo.findProduct(productId);
    if (!target) throw new AppError("NOT_FOUND", `No product with id ${productId}.`);

    const referenceDate = await this.analysisRepo.referenceDate(productId);
    if (!referenceDate) throw new AppError("NOT_FOUND", "No price observations have been captured.");

    // Phase 5 does the analysis; this service does not repeat any of it.
    const [analysisResult, set, attrs, mrpFacts, cost, feeRules, marketplaceIds, matchQuality, offerStates, marketplaces] =
      await Promise.all([
      /**
       * The FULL observed history, deliberately — not a window.
       *
       * The 90-day normal, the distortion reading and the history-depth
       * check are all measured against everything that has been captured,
       * which is what the baseline engine does. Passing a window here
       * computed the "90-day normal" from a 30-day slice and moved the
       * anchor with it. A window is a question about history; a
       * recommendation is not one.
       */
      this.analysis.productAnalysis(productId, {
        from: EARLIEST_DATE,
        to: referenceDate,
        marketplaceId: opts.marketplaceId,
      }),
      this.competitors.build(productId),
      this.analysisRepo.attributesFor(target.productTypeId),
      this.repo.observedMrp(productId),
      this.repo.sellerCost(productId),
      this.repo.feeRules(target.categoryId, referenceDate),
      this.repo.allMarketplaceIds(),
      this.repo.matchQuality(productId),
      /**
       * Every offer on this product, one row per offer.
       *
       * Two evidence checks are about how many sellers are actually
       * competing here and how many of their prices are currently cut by a
       * discount, and both are per-OFFER questions. The per-marketplace
       * rows cannot answer them: six marketplaces can carry twenty-nine
       * offers, and counting the marketplaces understated the competition
       * by a factor of five.
       */
      this.analysisRepo.offerStates(productId),
      // Named marketplaces, so the margin table can be labelled rather than
      // listing opaque ids. Covers marketplaces this product is not listed on,
      // which is the point: fee position everywhere is what a listing decision
      // needs.
      this.repo.marketplaces(),
    ]);

    const analysisData = analysisResult.data as Record<string, any>;
    const comps: ScoredCompetitor[] = set.members;
    const ownMarket = analysisData.ownMarket as ReturnType<typeof distribution>;
    const compStats = analysisData.competitiveStatistics as { n: number; min: number; max: number; median: number | null; q1: number | null; q3: number | null; iqr: number | null } | null;
    const strength = analysisData.strength as Record<string, any>;
    const normalMinor = analysisData.normalMinor as number | null;
    const distortion = analysisData.distortion as { state: string; ratio: number };
    const currentPriceMinor = (analysisData.currentPrice as { effectiveMinor: number } | null)?.effectiveMinor ?? null;

    /* ---- the competitive pool: own offers PLUS comparables --------------- */

    // Scoped the same way the analysis is, so "price me into Amazon" is not
    // judged on Flipkart's sellers.
    const scopedOffers = opts.marketplaceId
      ? offerStates.filter((o) => o.marketplaceId === opts.marketplaceId)
      : offerStates;
    const inStockOffers = scopedOffers.filter((o) => o.isInStock);

    const poolRows = [
      ...(ownMarket ? [{ value: ownMarket.median, weight: 1 }] : []),
      ...comps.map((c) => ({ value: c.currentPriceMinor, weight: c.evidenceWeight ?? 0 })),
    ];
    const poolStats = weightedDistribution(poolRows) ?? (compStats ? { ...compStats, effectiveN: compStats.n } : null);
    /**
     * The pool's raw prices, for ranking a candidate price within it.
     *
     * `poolStats` describes the distribution; this is the distribution itself,
     * which is what a percentile position needs. One row per competitive
     * identity — the target once at its own median, each rival once.
     */
    const poolPrices = poolRows.map((r) => r.value).sort((a, b) => a - b);

    /**
     * The cheapest in-stock offer's full price ladder.
     *
     * The interface shows how the comparison price was arrived at — MRP,
     * selling price, shipping, landed, discount, effective — for the one offer
     * the comparison actually uses. Derived here rather than client-side so
     * there is one definition of "the cheapest offer".
     */
    const cheapestOffer = inStockOffers.reduce<(typeof inStockOffers)[number] | null>(
      (best, o) => (best == null || o.universalEffectiveMinor < best.universalEffectiveMinor ? o : best),
      null
    );

    const marketplaceRows = (analysisData.marketplaceRows ?? []) as Array<Record<string, any>>;

    /**
     * What is actually competing on this product's own listings — offers and
     * sellers, not marketplaces. Already measured by the analysis layer; this
     * only shapes it for a caller.
     */
    const competition = {
      listingCount: marketplaceRows.length,
      marketplaceCount: new Set(marketplaceRows.map((r) => r.marketplaceId)).size,
      offerCount: scopedOffers.length,
      inStockOfferCount: inStockOffers.length,
      cheapestMinor: ownMarket?.min ?? null,
      medianMinor: ownMarket?.median ?? null,
      spreadMinor: ownMarket ? ownMarket.max - ownMarket.min : null,
      reviewVelocity: marketplaceRows.reduce<number | null>(
        (acc, r) => (r.reviewVelocity == null ? acc : Math.max(acc ?? 0, r.reviewVelocity as number)),
        null
      ),
    };

    /* ---- the refusal gate ----------------------------------------------- */

    const evidence = this.assessEvidence({
      comps,
      coverage: set.coverage,
      compStats,
      history: analysisData.history,
      cost,
      feeRules,
      inStockOfferCount: inStockOffers.length,
      mrpMinor: mrpFacts.maxMrpMinor,
      mrpReliability: this.mrpReliability(mrpFacts.maxMrpMinor, currentPriceMinor),
      matchQuality,
      promotionVisibility: this.promotionVisibility(inStockOffers, comps),
    });

    const base = {
      productId: target.id,
      canonicalName: target.canonicalName,
      brandId: target.brandId,
      brandName: target.brandName,
      brandTier: target.brandTier,
      priceBasis: PRICE_BASIS,
      currentPriceMinor,
      competitorCount: comps.length,
      coverage: set.coverage,
      evidence,
      /**
       * The marketplaces, on BOTH paths.
       *
       * A refusal names the platforms a screened-out candidate is sold on, and
       * without this the only way to turn those ids into names would be a
       * second request — on the response that explains why there is no price.
       */
      marketplaces,
    };

    if (!evidence.sufficient || !compStats || currentPriceMinor == null) {
      return this.refuse(base, {
        reason: currentPriceMinor == null ? "no_current_price" : "insufficient_comparables",
        analysisData,
        set,
        members: comps,
        excluded: set.excluded,
        reference: set.reference,
        diversity: set.diversity,
        method: set.method,
        modelVersion,
        referenceDate,
      });
    }

    /* ---- hard constraints ------------------------------------------------ */

    const mrpMinor = mrpFacts.maxMrpMinor;
    const mrpReliability = this.mrpReliability(mrpMinor, currentPriceMinor);

    let ceilingMinor = Math.round(poolStats!.max * PRICING_POLICY.ceilingHeadroom);
    let ceilingSource: "observed price range" | "applicable MRP" = "observed price range";
    if (mrpMinor != null && mrpMinor < ceilingMinor) {
      ceilingMinor = mrpMinor;
      ceilingSource = "applicable MRP";
    }

    const marketFloorRaw = Math.round(poolStats!.min * PRICING_POLICY.marketFloorOfPoolMin);
    const marketFloor = Math.min(marketFloorRaw, Math.round(ceilingMinor * PRICING_POLICY.marketFloorCapOfCeiling));
    const commercial = this.commercialLayer(cost, feeRules, marketplaceIds, marketplaces);
    const breakEvenFloor =
      commercial.highestBreakEvenMinor == null
        ? null
        : Math.round(commercial.highestBreakEvenMinor * PRICING_POLICY.breakEvenMargin);
    const floorMinor = breakEvenFloor ? Math.max(breakEvenFloor, marketFloor) : marketFloor;

    const hardConstraints = [
      {
        key: "mrp_ceiling",
        label: "Applicable MRP",
        kind: "ceiling" as const,
        boundMinor: mrpMinor,
        binding: ceilingSource === "applicable MRP",
        reliability: mrpReliability,
      },
      {
        key: "break_even_floor",
        label: "Break-even floor",
        kind: "floor" as const,
        boundMinor: breakEvenFloor,
        binding: breakEvenFloor != null && breakEvenFloor >= marketFloor,
      },
    ];

    /**
     * No valid price exists: every possible price is either illegal or
     * loss-making. Emitting a number here would be worse than useless.
     */
    if (ceilingMinor < floorMinor) {
      return this.refuse(base, {
        reason: "constraint_conflict",
        analysisData,
        set,
        members: comps,
        excluded: set.excluded,
        reference: set.reference,
        diversity: set.diversity,
        method: set.method,
        modelVersion,
        referenceDate,
        constraints: { hard: hardConstraints, floorMinor, ceilingMinor, ceilingSource },
      });
    }

    /* ---- the anchor ------------------------------------------------------ */

    const anchor = this.buildAnchor({ ownMarket, compStats, normalMinor });

    /* ---- willingness to pay ---------------------------------------------- */

    /**
     * Both versions receive IDENTICAL input, so a difference in their output
     * is the fitting method and nothing else.
     */
    const wtpInput = {
      target: { specifications: target.specifications, brandTier: target.brandTier },
      comps: comps.map((c) => ({
        productId: c.productId,
        currentPriceMinor: c.currentPriceMinor,
        rating: c.rating,
        brandTier: c.brandTier,
        specifications: c.specifications,
      })),
      attrs,
      targetRating: (strength?.targetRating as number | null) ?? null,
    };
    const wtp: HedonicResult | HedonicCvResult =
      modelVersion === "hedonic-cv-v2" ? fitHedonicCvModel(wtpInput) : fitHedonicModel(wtpInput);

    /**
     * A premium is claimed ONLY when the regression is trustworthy AND
     * predicts above the comparable median. Otherwise it is explicitly zero
     * — the model refuses to invent a premium it cannot evidence.
     */
    let evidencedPremiumMinor = 0;
    let premiumSupported = false;
    if (wtp.trusted && wtp.predictedMinor != null && compStats.median != null) {
      const raw = wtp.predictedMinor - compStats.median;
      // Capped at ±25% of the anchor: a good fit on a handful of points does
      // not license any number.
      evidencedPremiumMinor = Math.round(clamp(raw, -0.25 * anchor.minor, 0.25 * anchor.minor));
      premiumSupported = evidencedPremiumMinor > 0;
    }

    /* ---- strategies ------------------------------------------------------ */

    const travel = PRICING_POLICY.travel[evidence.level] ?? 0.5;

    /**
     * Fast Sale undercuts the cheapest CREDIBLE competitor. Where the
     * product has offers of its own, those sellers are the direct
     * competition — the pool minimum may belong to a much cheaper
     * substitute, and chasing it would abandon the product's own market
     * rather than compete in it.
     */
    const directCompetitorMin = ownMarket ? ownMarket.min : poolStats!.min;
    const aggressiveLimit = Math.round(anchor.minor * PRICING_POLICY.fastFloorOfAnchor);
    const rawFast = Math.max(
      Math.min(Math.round(directCompetitorMin * PRICING_POLICY.fastUndercut), anchor.minor),
      aggressiveLimit
    );

    const rawBalanced = Math.round(anchor.minor + evidencedPremiumMinor * travel * PRICING_POLICY.balancedPremiumShare);

    const premium = this.buildPremiumCeiling({ ownMarket, poolStats: poolStats!, anchorMinor: anchor.minor, evidencedPremiumMinor, premiumSupported, travel });

    const fastMinor = snapWithin(clamp(rawFast, floorMinor, ceilingMinor), floorMinor, ceilingMinor);
    const balancedFloor = Math.max(floorMinor, fastMinor);
    const balancedMinor = snapWithin(clamp(rawBalanced, balancedFloor, ceilingMinor), balancedFloor, ceilingMinor);
    const premiumMinor = snapWithin(clamp(premium.rawMinor, balancedMinor, ceilingMinor), balancedMinor, ceilingMinor);

    /**
     * A constraint bound a strategy if the UNCONSTRAINED value fell outside
     * it. Comparing the final snapped price would miss cases where snapping
     * moved the value back inside, hiding that the bound was active.
     */
    const bindingFor = (raw: number) => {
      if (raw > ceilingMinor) return { key: "ceiling", label: ceilingSource, boundMinor: ceilingMinor };
      if (raw < floorMinor) {
        return {
          key: "floor",
          label: breakEvenFloor && breakEvenFloor >= marketFloor ? "break-even floor" : "market floor",
          boundMinor: floorMinor,
        };
      }
      return null;
    };

    const strategies: Strategy[] = [
      {
        key: "fast_sale",
        label: "Fast Sale",
        priceMinor: fastMinor,
        rawPriceMinor: rawFast,
        supported: true,
        recommended: false,
        bindingConstraint: bindingFor(rawFast),
        position: this.positionOf(fastMinor, poolPrices),
        margins: this.marginsAt(fastMinor, commercial),
        drivers: [
          {
            factor: ownMarket ? "cheapest_own_offer" : "cheapest_pool_price",
            direction: "downward",
            valueMinor: directCompetitorMin,
            note: "undercuts the cheapest credible competing price",
          },
          ...(breakEvenFloor
            ? [{ factor: "break_even", direction: "upward" as const, valueMinor: breakEvenFloor, note: "held at or above break-even" }]
            : []),
        ],
      },
      {
        key: "balanced",
        label: "Balanced",
        priceMinor: balancedMinor,
        rawPriceMinor: rawBalanced,
        supported: true,
        /** The headline, so a client does not have to know which key wins. */
        recommended: true,
        bindingConstraint: bindingFor(rawBalanced),
        position: this.positionOf(balancedMinor, poolPrices),
        margins: this.marginsAt(balancedMinor, commercial),
        drivers: [
          { factor: "anchor", direction: "neutral", valueMinor: anchor.minor, note: `anchored on the ${anchor.basis}` },
          ...(evidencedPremiumMinor !== 0
            ? [
                {
                  factor: "evidenced_attribute_premium",
                  direction: (evidencedPremiumMinor > 0 ? "upward" : "downward") as "upward" | "downward",
                  valueMinor: Math.round(evidencedPremiumMinor * travel * PRICING_POLICY.balancedPremiumShare),
                  note: "moved only as far as the attribute model and the evidence level support",
                },
              ]
            : []),
        ],
      },
      {
        key: "premium",
        label: "Premium",
        priceMinor: premiumMinor,
        rawPriceMinor: premium.rawMinor,
        /**
         * `supported` is the honest half: a Premium price always exists, but
         * it only CLAIMS evidence when the attribute model earned it.
         */
        supported: premiumSupported,
        recommended: false,
        bindingConstraint: bindingFor(premium.rawMinor),
        position: this.positionOf(premiumMinor, poolPrices),
        margins: this.marginsAt(premiumMinor, commercial),
        drivers: [
          { factor: premium.basis === "own market" ? "own_market_top" : "comparable_band", direction: "upward", valueMinor: premium.baseMinor, note: `the ceiling this product's ${premium.basis} supports` },
          ...(premiumSupported
            ? [{ factor: "evidenced_attribute_premium", direction: "upward" as const, valueMinor: premium.headroomMinor, note: "extended by a trusted attribute model" }]
            : [{ factor: "no_evidenced_premium", direction: "neutral" as const, note: "the attribute model is not trusted, so no headroom is claimed above the product's own market" }]),
        ],
      },
    ];

    /* ---- zones, viability and the checks that run before anything shows --- */

    /**
     * The pool as named bands rather than raw quartiles, because "the
     * competitive band" is what a reader reasons about. One row per
     * competitive identity: this product once at its own median, each rival
     * once — never one row per own offer, which would measure the product
     * against itself.
     */
    const zones = {
      poolSize: poolPrices.length,
      ownCount: ownMarket ? 1 : 0,
      compCount: comps.length,
      grain: "one row per competitive identity — sellers, listings and variants of one product count once",
      effectiveN: poolStats!.effectiveN ?? poolPrices.length,
      floorZoneMinor: poolStats!.min,
      competitiveLowMinor: poolStats!.q1,
      competitiveMidMinor: poolStats!.median,
      competitiveHighMinor: poolStats!.q3,
      outlierAboveMinor: poolStats!.max,
      concentration: poolStats!.median ? poolStats!.iqr! / poolStats!.median : null,
    };

    const viability = this.assessViability({
      cost,
      breakEvenFloor,
      marketMidMinor: zones.competitiveMidMinor,
    });

    const sanityChecks = this.buildSanityChecks({
      strategies,
      anchor,
      zones,
      mrpMinor,
      floorMinor,
      premiumSupported,
      premiumBasis: premium.basis,
      ownMarketRef: ownMarket?.median ?? null,
      ownMarketTop: ownMarket?.max ?? null,
      distortionState: distortion.state,
      viability,
    });

    /* ---- the analysis bridge ---------------------------------------------- */

    /**
     * The analysis screen's closing argument, and the attribute model stated
     * as one of its findings. Phase 5 left both here on purpose; see
     * `buildBridge`.
     */
    const wtpFinding = this.wtpFinding(wtp, premiumSupported, evidencedPremiumMinor);
    const analysisFindings = (analysisData.findings ?? []) as Finding[];
    const bridge = this.buildBridge({
      findings: [...analysisFindings, wtpFinding],
      strategies,
      ownMedianMinor: ownMarket?.median ?? null,
      compMedianMinor: compStats.median,
      premiumSupported,
      evidenceLevel: evidence.level,
      coverage: set.coverage as unknown as Record<string, unknown>,
      constraints: { floorMinor, ceilingMinor, ceilingSource },
    });

    /* ---- explanation ------------------------------------------------------ */

    const explanation = this.buildExplanation({
      anchor,
      ownMarket,
      compStats,
      distortion,
      normalMinor,
      evidencedPremiumMinor,
      premiumSupported,
      wtp,
      evidence,
      balancedMinor,
      history: analysisData.history,
    });

    return {
      data: {
        product: {
          id: target.id,
          canonicalName: target.canonicalName,
          brand: { id: target.brandId, name: target.brandName, tier: target.brandTier },
          categoryId: target.categoryId,
          productTypeId: target.productTypeId,
        },
        status: "recommended" as const,
        constraintConflict: false,
        recommendation: { strategyKey: "balanced" as const, priceMinor: balancedMinor, basis: PRICE_BASIS.basis },
        strategies,
        anchor,
        floorMinor,
        ceilingMinor,
        ceilingSource,
        marketContext: {
          currentPriceMinor,
          /** The ladder behind the comparison price, for the cheapest offer. */
          currentPriceLayers: cheapestOffer
            ? {
                marketplaceId: cheapestOffer.marketplaceId,
                mrpMinor: cheapestOffer.mrpMinor,
                sellingPriceMinor: cheapestOffer.sellingPriceMinor,
                shippingFeeMinor: cheapestOffer.shippingFeeMinor,
                landedMinor: cheapestOffer.landedMinor,
                universalDiscountMinor: cheapestOffer.universalDiscountMinor,
                universalEffectiveMinor: cheapestOffer.universalEffectiveMinor,
                conditionalDiscountMinor: Math.min(
                  cheapestOffer.conditionalDiscountRaw ?? 0,
                  cheapestOffer.universalEffectiveMinor
                ),
                conditionalBestMinor:
                  cheapestOffer.universalEffectiveMinor -
                  Math.min(cheapestOffer.conditionalDiscountRaw ?? 0, cheapestOffer.universalEffectiveMinor),
              }
            : null,
          ownMarket,
          pool: poolStats,
          /** The pool as named bands, which is how a reader reasons about it. */
          zones,
          /** What is competing on this product's own listings. */
          competition,
          normalMinor,
          distortion,
        },
        competitorContext: {
          coverage: set.coverage,
          statistics: compStats,
          directCount: set.coverage.directCount,
          comparableCount: set.coverage.comparableCount,
          members: comps.map(serialiseCompetitor),
          /**
           * What was considered and rejected, and what sits outside the
           * comparable range. A comparable set is only as good as what it
           * refuses to include, so the refusals are part of the evidence
           * rather than an appendix to it.
           */
          excluded: set.excluded.map((c) => ({ ...serialiseCompetitor(c), reason: c.reason, exclusion: c.exclusion })),
          reference: set.reference.map(serialiseCompetitor),
          diversity: set.diversity,
          method: set.method,
        },
        /** How this product compares on the attributes the market prices. */
        strength,
        /** The seller's economics, per marketplace. */
        commercial,
        /**
         * The marketplaces, on BOTH paths, so a client can name a platform id
         * it is handed anywhere in the response without a second request.
         */
        marketplaces,
        /** Whether the market will pay what the seller needs. Kept separate. */
        viability,
        /** Run before anything is shown; a failure flags what to distrust. */
        sanityChecks,
        /**
         * The analysis screen's "therefore": the findings partitioned by the
         * direction they argue for, and where each strategy sits against the
         * product's own market and the comparable median. Phase 5 recorded
         * this as belonging to the recommendation; it does.
         */
        bridge,
        /** The attribute model as a finding, for the analysis screen's list. */
        wtpFinding,
        /**
         * The policy values a caller may need to QUOTE.
         *
         * Not for recomputing anything — the prices are already decided. A
         * client that says "capped at 25% above the own-market median" should
         * be reading that 25% from the service that applied it, not keeping a
         * second copy that can drift out of step.
         */
        policy: {
          maxEvidencedPremiumOverOwn: PRICING_POLICY.maxEvidencedPremiumOverOwn,
          maxUnevidencedPremiumOverAnchor: PRICING_POLICY.maxUnevidencedPremiumOverAnchor,
          balancedPremiumShare: PRICING_POLICY.balancedPremiumShare,
          fastUndercut: PRICING_POLICY.fastUndercut,
          healthyDispersion: PRICING_POLICY.healthyDispersion,
          comparableWeightFactor: COMPETITOR_POLICY.comparableWeightFactor,
        },
        historicalContext: analysisData.history,
        /**
         * Reported on a recommendation, not only on a refusal.
         *
         * The evidence assessment is what decided this price was worth
         * emitting at all, and how far it was allowed to travel from the
         * anchor. A caller shown a number without it cannot tell a price
         * backed by ten coherent direct rivals from one backed by three
         * scattered ones.
         */
        evidence,
        wtp: {
          status: wtp.trusted ? "trusted" : wtp.predictedMinor != null ? "available_but_untrusted" : "not_available",
          trusted: wtp.trusted,
          predictedMinor: wtp.predictedMinor,
          n: wtp.n,
          r2: wtp.r2 ?? null,
          adjR2: wtp.adjR2 ?? null,
          features: wtp.features,
          threshold: wtp.threshold ?? null,
          reason: wtp.reason,
          evidencedPremiumMinor,
          supported: premiumSupported,
          /**
           * The cross-validation figures, present only on `hedonic-cv-v2`.
           * `loocvR2` is what that version is trusted on; `inSampleR2` sits
           * beside it so the gap between what a fit looks like and what it
           * predicts is visible rather than having to be inferred.
           */
          ...(modelVersion === "hedonic-cv-v2"
            ? {
                loocvR2: (wtp as HedonicCvResult).loocvR2 ?? null,
                inSampleR2: (wtp as HedonicCvResult).inSampleR2 ?? null,
                lambda: (wtp as HedonicCvResult).lambda ?? null,
                foldCount: (wtp as HedonicCvResult).foldCount ?? null,
                cvThreshold: (wtp as HedonicCvResult).cvThreshold ?? null,
              }
            : {}),
        },
        model: {
          version: modelVersion,
          /**
           * The only statistical component. Stated explicitly so nobody
           * reads "model" as something that decided the price: it can move
           * the Balanced strategy by at most 25% of the anchor, damped by
           * the evidence level, and only when its own fit clears the gate.
           */
          statisticalComponent: modelVersion === "hedonic-cv-v2" ? "hedonic-wtp-cv" : "hedonic-wtp",
          statisticalComponentState: wtp.trusted ? "trusted" : wtp.predictedMinor != null ? "untrusted_fallback" : "unavailable_fallback",
          /**
           * How the component earns trust, named rather than implied — the
           * difference between the two versions is exactly this.
           */
          trustBasis: modelVersion === "hedonic-cv-v2" ? "out_of_sample_loocv_r2" : "in_sample_adjusted_r2",
          /** What the target variable IS. Never "optimal price". */
          predicts: "market_value_estimate_from_observed_listing_prices",
          available: [...MODEL_VERSIONS],
          default: RECOMMENDATION_MODEL_VERSION,
        },
        constraints: { hard: hardConstraints, floorMinor, ceilingMinor, ceilingSource, travel },
        premiumCeiling: premium,
        explanation,
      },
      meta: {
        productId,
        referenceDate,
        /**
         * The history this recommendation was measured against — the whole of
         * it. Reported as a range rather than as `window: null`, which is
         * technically true and tells a reader nothing.
         */
        historyScope: "full_observed_history" as const,
        range: (analysisResult.meta as Record<string, any>).range,
        priceBasis: PRICE_BASIS,
        modelVersion,
      },
    };
  }

  /* ------------------------------------------------------------ internals */

  /**
   * Is the printed MRP a real ceiling or a display figure?
   *
   * Measured against THIS product's current cheapest price, not against the
   * comparable median. A chair selling at ₹11,599 under a ₹19,999 MRP is
   * marked down, not mispriced; judging it against a comparable set that
   * includes cheaper chairs called a plausible MRP inflated and cost the
   * product an evidence point it had earned.
   */
  private mrpReliability(mrpMinor: number | null, currentPriceMinor: number | null) {
    if (mrpMinor == null) return { state: "unknown" as const, ratioToMarket: null };
    const ratio = currentPriceMinor ? mrpMinor / currentPriceMinor : null;
    const inflated = ratio != null && ratio > PRICING_POLICY.mrpInflationRatio;
    return { state: inflated ? ("inflated" as const) : ("reliable" as const), ratioToMarket: ratio };
  }

  /**
   * The highest break-even across the marketplaces that have a fee rule.
   *
   * Null when no cost has been entered, which is the common case — the
   * floor then falls back to the market, and the engine says so rather than
   * inventing an economics it does not have.
   */
  private breakEvenFloor(
    cost: { costPriceMinor: number } | null,
    feeRules: Array<{ marketplaceId: string; referralPct: number; fixedClosingFee: number }>,
    marketplaceIds: string[]
  ): number | null {
    const highest = this.commercialLayer(cost, feeRules, marketplaceIds, []).highestBreakEvenMinor;
    return highest == null ? null : Math.round(highest * PRICING_POLICY.breakEvenMargin);
  }

  /**
   * The seller's economics, per marketplace.
   *
   * One break-even price per marketplace that has a fee rule — the price at
   * which revenue net of referral, fixed fee and GST on both exactly covers
   * cost. The floor takes the highest of them (a price must clear break-even
   * wherever it is sold) with a 2% working margin; this layer is also what the
   * interface needs to show WHERE the economics bind.
   *
   * Marketplaces with no captured fee rule are reported with `feeRule: null`
   * rather than dropped, so a missing rate is visible instead of looking like
   * a marketplace that does not exist.
   */
  private commercialLayer(
    cost: { costPriceMinor: number } | null,
    feeRules: Array<{ marketplaceId: string; referralPct: number; fixedClosingFee: number; isCategoryDefault?: boolean }>,
    marketplaceIds: string[],
    marketplaces: MarketplaceIdentity[]
  ) {
    const byMarketplace = new Map(feeRules.map((f) => [f.marketplaceId, f]));
    const byId = new Map(marketplaces.map((m) => [m.id, m]));

    const perMarketplace = marketplaceIds.map((id) => {
      const rule = byMarketplace.get(id) ?? null;
      let breakEvenMinor: number | null = null;
      if (cost && rule) {
        const referralFrac = rule.referralPct / 100;
        const fixedFeeMinor = rule.fixedClosingFee * 100;
        const numerator = cost.costPriceMinor + fixedFeeMinor * (1 + PRICING_POLICY.gstOnFees);
        const denominator = 1 - referralFrac * (1 + PRICING_POLICY.gstOnFees);
        breakEvenMinor = Math.round(numerator / denominator);
      }
      return {
        marketplace: byId.get(id) ?? { id, name: id, marketplaceType: null, brandColor: null },
        feeRule: rule
          ? {
              referralPct: rule.referralPct,
              fixedClosingFee: rule.fixedClosingFee,
              isCategoryDefault: rule.isCategoryDefault ?? false,
            }
          : null,
        breakEvenMinor,
      };
    });

    const floors = perMarketplace.map((m) => m.breakEvenMinor).filter((v): v is number => v != null);
    return {
      cost,
      perMarketplace,
      highestBreakEvenMinor: floors.length ? Math.max(...floors) : null,
      usesDefaultFeeRule: perMarketplace.some((m) => m.feeRule?.isCategoryDefault),
    };
  }

  /**
   * The margin a given price leaves on each marketplace.
   *
   * Price minus referral, minus the fixed closing fee, minus 18% GST charged
   * on both of those, minus what the seller paid. Null where no cost has been
   * entered or no fee rule is captured — an unknown margin is reported as
   * unknown rather than as zero.
   */
  private marginsAt(priceMinor: number, commercial: ReturnType<PricingService["commercialLayer"]>) {
    return commercial.perMarketplace.map((m) => {
      if (!commercial.cost || !m.feeRule) return { ...m, netMinor: null, marginMinor: null, marginPct: null };
      const referral = Math.round(priceMinor * (m.feeRule.referralPct / 100));
      const fixed = m.feeRule.fixedClosingFee * 100;
      const gst = Math.round((referral + fixed) * PRICING_POLICY.gstOnFees);
      const netMinor = priceMinor - referral - fixed - gst;
      const marginMinor = netMinor - commercial.cost.costPriceMinor;
      return { ...m, netMinor, marginMinor, marginPct: marginMinor / priceMinor };
    });
  }

  /**
   * The willingness-to-pay finding, and the bridge from findings to prices.
   *
   * Phase 5 moved the cross-marketplace analysis to the backend and
   * deliberately left these two behind, recording the reason in
   * `meta.notMigrated`: both are the recommendation engine's, and the
   * recommendation engine did not exist server-side yet. It does now, so they
   * come home here rather than being rebuilt in a browser.
   *
   * The bridge is the analysis screen's closing argument — "these findings,
   * therefore these prices". It partitions the findings by the direction they
   * argue for and states where each strategy sits against the two markets.
   * No new business logic: the findings are the analysis service's, the
   * prices are already decided, and the percentages are ratios between
   * numbers in this same response.
   */
  private buildBridge(input: {
    findings: Finding[];
    strategies: Strategy[];
    ownMedianMinor: number | null;
    compMedianMinor: number | null;
    premiumSupported: boolean;
    evidenceLevel: string;
    coverage: Record<string, unknown>;
    constraints: { floorMinor: number; ceilingMinor: number; ceilingSource: string };
  }) {
    const ratio = (price: number, reference: number | null) =>
      reference == null || reference === 0 ? null : Math.round(((price - reference) / reference) * 1000) / 10;

    return {
      forPremium: input.findings.filter((f) => f.direction === "premium"),
      forAggressive: input.findings.filter((f) => f.direction === "aggressive"),
      neutral: input.findings.filter((f) => f.direction === "neutral"),
      /**
       * The verdict is a FLAG, not a sentence — the interface phrases it.
       * `premiumEvidenced` is the whole claim the bridge makes.
       */
      premiumEvidenced: input.premiumSupported,
      strategies: input.strategies.map((s) => ({
        key: s.key,
        label: s.label,
        priceMinor: s.priceMinor,
        supported: s.supported,
        boundBy: s.bindingConstraint?.label ?? null,
        vsOwnMarketPct: ratio(s.priceMinor, input.ownMedianMinor),
        vsCompMedianPct: ratio(s.priceMinor, input.compMedianMinor),
      })),
      floorMinor: input.constraints.floorMinor,
      ceilingMinor: input.constraints.ceilingMinor,
      ceilingSource: input.constraints.ceilingSource,
      confidence: input.evidenceLevel,
      coverage: input.coverage,
    };
  }

  /**
   * The attribute model as a FINDING, in the same shape the analysis uses.
   *
   * The analysis screen lists this alongside the nine the analysis service
   * produces; it lives here because it is the hedonic model's verdict and the
   * hedonic model is the recommendation's.
   */
  private wtpFinding(
    wtp: HedonicResult | HedonicCvResult,
    supported: boolean,
    evidencedPremiumMinor: number
  ): Finding {
    return {
      id: "wtp",
      dimension: "Willingness to pay",
      direction: supported ? "premium" : "aggressive",
      headline: supported
        ? "The market measurably pays for this product's attributes"
        : "No measurable attribute premium in this market",
      metrics: {
        trusted: wtp.trusted,
        supported,
        n: wtp.n,
        adjR2: wtp.adjR2 ?? null,
        loocvR2: (wtp as HedonicCvResult).loocvR2 ?? null,
        predictedMinor: wtp.predictedMinor,
        evidencedPremiumMinor,
        reason: wtp.reason,
      },
      evidence: wtp.trusted
        ? [
            { kind: "fit", n: wtp.n, adjR2: wtp.adjR2 ?? null, loocvR2: (wtp as HedonicCvResult).loocvR2 ?? null },
            ...wtp.features.map((f) => ({
              kind: "feature" as const,
              label: f.label,
              targetValue: f.targetValue,
              compMean: f.compMean,
              unit: f.unit,
            })),
          ]
        : [{ kind: "abstained", reason: wtp.reason }],
    };
  }

  /**
   * Whether the market will pay what the seller needs — kept SEPARATE from the
   * recommendation.
   *
   * The market does not care what a product cost. When the middle of the
   * competitive market sits below break-even, that conflict is reported rather
   * than silently clamped away by lifting the price to a level the market will
   * not pay. A seller in that position needs to know the lever is cost, not
   * price.
   */
  private assessViability(input: {
    cost: { costPriceMinor: number } | null;
    breakEvenFloor: number | null;
    marketMidMinor: number | null;
  }) {
    if (!input.cost || input.breakEvenFloor == null || input.marketMidMinor == null) {
      return { known: false, conflict: false, breakEvenMinor: null, marketMidMinor: input.marketMidMinor ?? null };
    }
    return {
      known: true,
      conflict: input.marketMidMinor < input.breakEvenFloor,
      breakEvenMinor: input.breakEvenFloor,
      marketMidMinor: input.marketMidMinor,
    };
  }

  /**
   * The checks that run before a number is shown.
   *
   * A failed check does not hide the price — it says which part of the
   * reasoning to distrust, which is more useful than refusing outright and far
   * more useful than showing a clean-looking number. The CF-1 invariant is
   * here: no strategy may sit materially above the product's own observed
   * market without a trusted attribute model saying it should.
   */
  private buildSanityChecks(input: {
    strategies: Strategy[];
    anchor: { minor: number; basis: string };
    zones: { competitiveMidMinor: number | null };
    mrpMinor: number | null;
    floorMinor: number;
    premiumSupported: boolean;
    premiumBasis: string;
    ownMarketRef: number | null;
    ownMarketTop: number | null;
    distortionState: string;
    viability: { known: boolean; conflict: boolean };
  }) {
    const checks: Array<{ key: string; label: string; passed: boolean; metrics: Record<string, unknown> }> = [];
    const add = (key: string, label: string, passed: boolean, metrics: Record<string, unknown>) =>
      checks.push({ key, label, passed, metrics });

    const anchorRef = input.anchor.minor || input.zones.competitiveMidMinor || 0;
    for (const s of input.strategies) {
      const deviation = anchorRef ? (s.priceMinor - anchorRef) / anchorRef : 0;
      if (Math.abs(deviation) > 0.35) {
        add(`deviation_${s.key}`, `${s.label} distance from market anchor`, false, {
          deviation,
          anchorMinor: anchorRef,
          anchorBasis: input.anchor.basis,
          threshold: 0.35,
        });
      }
    }

    add(
      "mrp",
      "No strategy exceeds MRP",
      input.strategies.every((s) => input.mrpMinor == null || s.priceMinor <= input.mrpMinor),
      { mrpMinor: input.mrpMinor }
    );
    add("floor", "No strategy below the hard floor", input.strategies.every((s) => s.priceMinor >= input.floorMinor), {
      floorMinor: input.floorMinor,
    });
    add(
      "ordered",
      "Strategies increase in price",
      input.strategies[0]!.priceMinor <= input.strategies[1]!.priceMinor &&
        input.strategies[1]!.priceMinor <= input.strategies[2]!.priceMinor,
      { order: input.strategies.map((s) => s.priceMinor) }
    );
    add("premium_evidence", "Premium is evidence-backed", input.premiumSupported, {
      supported: input.premiumSupported,
      basis: input.premiumBasis,
    });

    if (input.ownMarketRef) {
      /**
       * Without evidence the limit is the TOP of the product's own observed
       * range (or the anchor, which for a single-offer product may sit slightly
       * above it): pricing at the dearest price the product already achieves is
       * not a premium. With evidence it widens to +25% over the own median. The
       * 2% tolerance absorbs psychological snapping, which can round a
       * compliant price up by one grid step.
       */
      const limitMinor = input.premiumSupported
        ? Math.round(input.ownMarketRef * (1 + PRICING_POLICY.maxEvidencedPremiumOverOwn))
        : Math.max(input.ownMarketTop ?? 0, input.anchor.minor);
      const dearest = Math.max(...input.strategies.map((s) => s.priceMinor));
      add("premium_vs_own_market", "No strategy outruns the product's own market", dearest <= Math.round(limitMinor * 1.02), {
        dearestMinor: dearest,
        limitMinor,
        ownMedianMinor: input.ownMarketRef,
        overOwnMedianPct: (dearest - input.ownMarketRef) / input.ownMarketRef,
        evidenced: input.premiumSupported,
        // The share that set the limit, so a caller quoting "+25%" is quoting
        // the policy rather than a constant it keeps its own copy of.
        capPct: PRICING_POLICY.maxEvidencedPremiumOverOwn,
        tolerance: 0.02,
      });
    }

    add("market_distortion", "Market is not promotionally distorted", input.distortionState === "normal", {
      state: input.distortionState,
    });
    add("viability", "Market price is commercially viable", !input.viability.conflict, {
      known: input.viability.known,
      conflict: input.viability.conflict,
    });

    return checks;
  }

  /**
   * Where a price would sit among the prices a buyer could choose between.
   *
   * The candidate price is inserted into the pool before ranking, so the
   * percentile describes its position in the market it would join rather than
   * in a market it is absent from.
   */
  private positionOf(priceMinor: number, poolPrices: number[]) {
    const all = [...poolPrices, priceMinor].sort((a, b) => a - b);
    const rank = all.indexOf(priceMinor) + 1;
    return {
      rank,
      of: all.length,
      total: poolPrices.length,
      percentile: all.length > 1 ? (rank - 1) / (all.length - 1) : 0,
      undercuts: poolPrices.filter((p) => p > priceMinor).length,
      sitsAbove: poolPrices.filter((p) => p < priceMinor).length,
    };
  }

  /**
   * The product's OWN in-stock offers are the strongest evidence of what it
   * commands. Comparables are substitutes — useful for positioning, but not
   * what this product sells for. Own market leads; comparables are the
   * fallback only when the product has no market of its own.
   */
  private buildAnchor(input: {
    ownMarket: ReturnType<typeof distribution>;
    compStats: { median: number | null };
    normalMinor: number | null;
  }) {
    const { ownMarket, compStats, normalMinor } = input;
    const A = PRICING_POLICY.anchor;

    if (ownMarket && ownMarket.n >= 2) {
      const normal = normalMinor ?? ownMarket.median;
      return {
        minor: Math.round(A.ownWeight * ownMarket.median + A.normalWeight * normal),
        basis: "own market" as const,
        ownMedianMinor: ownMarket.median,
        normalMinor: normal,
      };
    }
    if (ownMarket && ownMarket.n === 1) {
      // One real offer is thin evidence, but it is evidence about THIS
      // product, whereas the comparable median is evidence about others. A
      // 50/50 blend let substitutes drag the anchor a long way from the
      // price the product is actually listed at.
      const compMedian = compStats.median ?? ownMarket.median;
      const blended = Math.round(A.singleOwnWeight * ownMarket.median + (1 - A.singleOwnWeight) * compMedian);
      return {
        minor: clamp(
          blended,
          Math.round(ownMarket.median * (1 - A.singleOwnBand)),
          Math.round(ownMarket.median * (1 + A.singleOwnBand))
        ),
        basis: "single own offer + comparables" as const,
        ownMedianMinor: ownMarket.median,
        normalMinor: normalMinor ?? null,
      };
    }
    return {
      minor: compStats.median ?? 0,
      basis: "comparable market" as const,
      ownMedianMinor: null,
      normalMinor: normalMinor ?? null,
    };
  }

  /**
   * Premium is bounded by the product's OWN market, not by what rivals cost.
   *
   * Q3 of a pool containing dearer substitutes describes what OTHER products
   * cost; it is not evidence that THIS product can be sold there. Without a
   * trusted attribute model the ceiling is the dearest price this exact
   * product actually achieves — inside its own observed range by
   * construction, so it can never "exceed the market".
   */
  private buildPremiumCeiling(input: {
    ownMarket: ReturnType<typeof distribution>;
    poolStats: { q3: number | null; max: number };
    anchorMinor: number;
    evidencedPremiumMinor: number;
    premiumSupported: boolean;
    travel: number;
  }) {
    const { ownMarket, poolStats, anchorMinor, evidencedPremiumMinor, premiumSupported, travel } = input;
    const poolQ3 = poolStats.q3 ?? poolStats.max;

    const floorBasis = ownMarket
      ? { minor: Math.max(ownMarket.max, anchorMinor), basis: "own market" as const }
      : {
          minor: Math.min(
            Math.max(poolQ3, anchorMinor),
            Math.round(anchorMinor * (1 + PRICING_POLICY.maxUnevidencedPremiumOverAnchor))
          ),
          basis: "comparable band" as const,
        };

    const headroomMinor = premiumSupported ? Math.round(evidencedPremiumMinor * travel) : 0;
    let rawMinor = floorBasis.minor + headroomMinor;

    // A hard cap relative to the product's own market, with or without
    // evidence. Evidence buys a wider band, never an unbounded one.
    let capMinor: number | null = null;
    if (ownMarket) {
      capMinor = Math.round(
        ownMarket.median * (1 + (premiumSupported ? PRICING_POLICY.maxEvidencedPremiumOverOwn : 0))
      );
      // Without evidence the cap is the top of the own range, which may sit
      // above the median — the cap must not pull the price BELOW its basis.
      if (!premiumSupported) capMinor = Math.max(capMinor, floorBasis.minor);
      rawMinor = Math.min(rawMinor, capMinor);
    }

    return {
      basis: floorBasis.basis,
      baseMinor: floorBasis.minor,
      headroomMinor,
      capMinor,
      rawMinor,
      ownMarketRefMinor: ownMarket?.median ?? null,
      poolQ3Minor: poolQ3,
      /** Recorded so an audit can assert the invariant directly. */
      poolQ3Suppressed: ownMarket != null && poolQ3 > floorBasis.minor,
    };
  }

  /**
   * Ten weighted checks, and a level that competitive coverage CAPS rather
   * than merely influences. A product compared against three rivals cannot
   * reach "high" however clean the rest of its data is, which is why
   * padding the set cannot buy a better label.
   */
  private assessEvidence(input: {
    comps: ScoredCompetitor[];
    coverage: { directCount: number; comparableCount: number; effectiveComparables: number; level: string };
    compStats: { median: number | null; iqr: number | null } | null;
    history: { observationCount: number } | null;
    cost: { costPriceMinor: number } | null;
    feeRules: Array<{ isCategoryDefault: boolean }>;
    inStockOfferCount: number;
    mrpMinor: number | null;
    mrpReliability: { state: string };
    matchQuality: { total: number; withConfidence: number; minConfidence: number | null; autoMatched: number };
    promotionVisibility: { total: number; promoDriven: number; share: number };
  }) {
    const checks: Array<{ key: string; label: string; ok: boolean; weight: number; detail: Record<string, unknown> }> = [];
    const push = (key: string, label: string, ok: boolean, detail: Record<string, unknown>, weight = 1) =>
      checks.push({ key, label, ok, weight, detail });

    const n = input.comps.length;
    const target = COMPETITOR_POLICY.target;

    push(
      "competitor_breadth",
      "Competitive breadth",
      input.coverage.directCount >= target,
      { directCount: input.coverage.directCount, target, comparableCount: input.coverage.comparableCount },
      2
    );
    push(
      "evidence_depth",
      "Weighted evidence",
      input.coverage.effectiveComparables >= target * 0.7,
      { effectiveComparables: input.coverage.effectiveComparables, required: target * 0.7, from: n },
      2
    );

    const dispersion =
      input.compStats && input.compStats.median && input.compStats.iqr != null
        ? input.compStats.iqr / input.compStats.median
        : null;
    push(
      "coherence",
      "Comparable-set coherence",
      dispersion != null && dispersion <= PRICING_POLICY.healthyDispersion,
      { dispersion, threshold: PRICING_POLICY.healthyDispersion },
      2
    );

    push("history", "Price history depth", (input.history?.observationCount ?? 0) >= 30, {
      observationCount: input.history?.observationCount ?? 0,
      required: 30,
    });
    push("competition", "Competitor coverage", input.inStockOfferCount >= 2, {
      inStockOfferCount: input.inStockOfferCount,
      required: 2,
    });
    push("cost", "Seller cost", !!input.cost, { entered: !!input.cost });
    push("fees", "Marketplace fee rates", !input.feeRules.some((f) => f.isCategoryDefault), {
      usesDefaultRate: input.feeRules.some((f) => f.isCategoryDefault),
    });
    push("mrp", "Applicable MRP", input.mrpMinor != null && input.mrpReliability.state === "reliable", {
      mrpMinor: input.mrpMinor,
      reliability: input.mrpReliability.state,
    });

    const mq = input.matchQuality;
    push(
      "match_quality",
      "Listing match quality",
      mq.withConfidence > 0 && (mq.minConfidence ?? 0) >= PRICING_POLICY.matchConfidenceFloor,
      { minConfidence: mq.minConfidence, autoMatched: mq.autoMatched, total: mq.total, floor: PRICING_POLICY.matchConfidenceFloor }
    );

    const pv = input.promotionVisibility;
    push("promotion_visibility", "Promotion-free comparison", pv.total > 0 && pv.share <= 0.34, {
      promoDriven: pv.promoDriven,
      total: pv.total,
      share: Math.round(pv.share * 1000) / 1000,
    });

    const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
    const score = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0) / totalWeight;

    const coverageCap =
      ({ strong: "high", adequate: "medium-high", thin: "medium", insufficient: "low" } as Record<string, string>)[
        input.coverage.level
      ] ?? "low";
    const ORDER = ["low", "medium", "medium-high", "high"];

    let level = "low";
    if (score >= 0.8) level = "high";
    else if (score >= 0.6) level = "medium-high";
    else if (score >= 0.4) level = "medium";
    const uncapped = level;
    if (ORDER.indexOf(level) > ORDER.indexOf(coverageCap)) level = coverageCap;

    return {
      level,
      score: Math.round(score * 100) / 100,
      checks,
      coverageCap,
      cappedByCoverage: ORDER.indexOf(coverageCap) < ORDER.indexOf(uncapped),
      sufficient: n >= COMPETITOR_POLICY.minimumForRecommendation,
      dispersion,
    };
  }

  /**
   * What share of the prices being compared is currently cut by a live
   * universal discount — one in-stock OFFER at a time, plus one price per
   * comparable. A "market" measured mostly off promotional prices is a sale,
   * and the evidence level is held down accordingly.
   */
  private promotionVisibility(inStockOffers: Array<{ universalDiscountMinor: number }>, comps: ScoredCompetitor[]) {
    const ownPromo = inStockOffers.filter((o) => o.universalDiscountMinor > 0).length;
    const compPromo = comps.filter((c) => c.hasUniversalPromo).length;
    const total = inStockOffers.length + comps.length;
    return {
      total,
      promoDriven: ownPromo + compPromo,
      ownPromoDriven: ownPromo,
      compPromoDriven: compPromo,
      share: total > 0 ? (ownPromo + compPromo) / total : 0,
    };
  }

  /**
   * Structured factors, never prose. The interface turns these into
   * sentences; a sentence cannot be checked against the data and a factor
   * can.
   */
  private buildExplanation(input: {
    anchor: { minor: number; basis: string };
    ownMarket: ReturnType<typeof distribution>;
    compStats: { median: number | null };
    distortion: { state: string; ratio: number };
    normalMinor: number | null;
    evidencedPremiumMinor: number;
    premiumSupported: boolean;
    wtp: HedonicResult;
    evidence: { level: string; score: number };
    balancedMinor: number;
    history: { percentile: number } | null;
  }): ExplanationFactor[] {
    const out: ExplanationFactor[] = [];

    if (input.ownMarket && input.compStats.median != null) {
      const gap = input.ownMarket.median - input.compStats.median;
      out.push({
        factor: "competitive_position",
        direction: gap > 0 ? "upward" : gap < 0 ? "downward" : "neutral",
        impactMinor: gap,
        evidence: { ownMedianMinor: input.ownMarket.median, compMedianMinor: input.compStats.median, n: input.ownMarket.n },
      });
    }

    if (input.normalMinor != null && input.ownMarket) {
      out.push({
        factor: "historical_position",
        direction: input.distortion.state === "depressed" ? "upward" : input.distortion.state === "elevated" ? "downward" : "neutral",
        impactMinor: input.anchor.minor - input.ownMarket.median,
        evidence: {
          normalMinor: input.normalMinor,
          distortion: input.distortion.state,
          ratio: Math.round(input.distortion.ratio * 1000) / 1000,
          percentile: input.history?.percentile ?? null,
        },
      });
    }

    out.push({
      factor: "attribute_value",
      direction: input.premiumSupported ? "upward" : "neutral",
      impactMinor: input.evidencedPremiumMinor,
      evidence: {
        modelTrusted: input.wtp.trusted,
        adjR2: input.wtp.adjR2 ?? null,
        n: input.wtp.n,
        predictedMinor: input.wtp.predictedMinor,
        /**
         * The model measures ASSOCIATION between attributes and observed
         * price across comparables. It does not establish that an attribute
         * causes a price, and nothing downstream may say that it does.
         */
        interpretation: "association_not_causation",
      },
    });

    out.push({
      factor: "evidence_level",
      direction: "neutral",
      impactMinor: null,
      evidence: { level: input.evidence.level, score: input.evidence.score, travel: PRICING_POLICY.travel[input.evidence.level] ?? 0.5 },
    });

    return out;
  }

  /**
   * Refusal. No price, and a structured account of what was missing.
   *
   * The observation layers are still returned, because they are real; what
   * disappears is the number. Inventing one to satisfy a UI is the failure
   * this whole design exists to prevent.
   */
  private refuse(
    base: Record<string, unknown>,
    input: {
      reason: "insufficient_comparables" | "no_current_price" | "constraint_conflict";
      analysisData: Record<string, any>;
      set: { coverage: Record<string, unknown> };
      members: ScoredCompetitor[];
      excluded: ExcludedCompetitor[];
      reference: ScoredCompetitor[];
      diversity: unknown;
      method: unknown;
      modelVersion: ModelVersion;
      referenceDate: string;
      constraints?: Record<string, unknown>;
    }
  ) {
    const missing: Array<{ key: string; detail: Record<string, unknown> }> = [];
    const coverage = input.set.coverage as Record<string, any>;

    if (input.reason === "insufficient_comparables") {
      missing.push({
        key: "competitor_coverage",
        detail: {
          totalCount: coverage.totalCount,
          minimum: COMPETITOR_POLICY.minimumForRecommendation,
          shortfallReasons: coverage.shortfallReasons,
        },
      });
    }
    if (input.reason === "no_current_price") {
      missing.push({ key: "current_price", detail: { inStockOffers: 0 } });
    }
    if (input.reason === "constraint_conflict") {
      missing.push({ key: "valid_price_range", detail: input.constraints ?? {} });
    }

    const history = input.analysisData.history as { observationCount: number } | null;
    return {
      data: {
        ...base,
        status: "insufficient_evidence" as const,
        reason: input.reason,
        /**
         * Two refusals that are not the same thing.
         *
         * "Not enough comparables" means the evidence is too thin to price
         * against. "No valid price exists" means the evidence was fine and
         * every legal price is loss-making — a seller needs to know it is
         * their cost, not the data, that blocks the sale. The engine flags
         * both as insufficient data and distinguishes them with this
         * boolean, so the same distinction is kept here.
         */
        constraintConflict: input.reason === "constraint_conflict",
        recommendation: null,
        strategies: [],
        missing,
        marketCoverage: {
          marketplaceCount: (input.analysisData.marketplaceRows ?? []).length,
          historyObservations: history?.observationCount ?? 0,
          competitorCount: coverage.totalCount,
        },
        /**
         * The same shape a recommendation carries, so a caller reads one
         * response format either way — but with `statistics: null`.
         *
         * A median over one or two comparables is arithmetic, not a market,
         * and this set was just judged unusable. Publishing a distribution
         * over it under the heading "statistics" would hand back as evidence
         * the very thing the refusal says is missing. The members stay
         * visible, each with its similarity and evidence weight, so it is
         * clear exactly how little was found.
         */
        competitorContext: {
          coverage,
          statistics: null,
          directCount: coverage.directCount,
          comparableCount: coverage.comparableCount,
          members: input.members.map(serialiseCompetitor),
          /**
           * The same shape a recommendation carries. A refusal is the case
           * where "what was screened out, and why" matters MOST — it is the
           * difference between "nothing comparable exists" and "plenty exists
           * but none of it shares a marketplace with you".
           */
          excluded: input.excluded.map((c) => ({ ...serialiseCompetitor(c), reason: c.reason, exclusion: c.exclusion })),
          reference: input.reference.map(serialiseCompetitor),
          diversity: input.diversity,
          method: input.method,
        },
        ...(input.constraints ? { constraints: input.constraints } : {}),
      },
      meta: {
        referenceDate: input.referenceDate,
        priceBasis: PRICE_BASIS,
        // The version that was ASKED for, even though it never got to run —
        // a refusal must not look like it came from a different model.
        modelVersion: input.modelVersion,
      },
    };
  }
}
