import { AppError } from "../../lib/errors.js";
import { PRICE_BASIS } from "../../lib/priceLadder.js";
import { DEFAULT_WINDOW, resolveWindow, shiftDays, type WindowKey } from "../../lib/windows.js";
import type { AnalysisRepository, AttributeRow, OfferStateRow, ProductRow } from "./analysis.repository.js";
import {
  TIER_RANK,
  aggregateReviews,
  type CompetitiveSet,
  type CompetitorService,
  type ScoredCompetitor,
} from "./competitor.service.js";

/**
 * CROSS-MARKETPLACE ANALYSIS
 * ==========================
 *
 * A port of `src/utils/crossMarketplaceAnalysis.js`. The recommendation
 * engine decides a price; this answers the question that comes before it —
 * what actually differs between the platforms, the sellers and the competing
 * products, and which of those differences change how a price should be read.
 *
 * WHAT IS HERE AND WHAT IS NOT
 * ----------------------------
 * The frontend module is built ON TOP of `buildRecommendation` and reads its
 * output in two dozen places. Most of what it reads are analysis inputs —
 * the competitive set, the strength index, market statistics, history — and
 * those are all here. Two things are not, deliberately:
 *
 *   · the `wtp` finding, which is the hedonic willingness-to-pay MODEL
 *   · `buildBridge`, which maps the three strategy prices into the analysis
 *
 * Both are the recommendation engine itself rather than inputs to it, and
 * they belong to the next phase. Eleven of the twelve findings are produced
 * here; the twelfth is reported as a known, intentional gap rather than
 * approximated.
 *
 * Every figure carries the numbers it was computed from. A finding that
 * cannot show its evidence is not produced at all — see `buildFindings`.
 */

const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 10);

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const i = (s.length - 1) / 2;
  return s.length % 2 ? s[i]! : (s[Math.floor(i)]! + s[Math.ceil(i)]!) / 2;
}

function percentileOf(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/**
 * Quantiles over WEIGHTED observations.
 *
 * The competitive statistics are weighted by evidence weight, not counted:
 * a comparable contributing 0.4 of a vote moves the median 0.4 as far as one
 * contributing a full vote. That is the whole point of weighting — a thin
 * fifth comparable may join the set without distorting it as much as a
 * strong one would — and an unweighted median here would quietly undo it.
 */
export function weightedQuantile(pairs: Array<{ value: number; weight: number }>, q: number): number | null {
  const rows = pairs.filter((p) => p.weight > 0).sort((a, b) => a.value - b.value);
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, r) => sum + r.weight, 0);
  if (total <= 0) return null;

  const targetMass = q * total;
  let cumulative = 0;
  for (let i = 0; i < rows.length; i++) {
    const prev = cumulative;
    cumulative += rows[i]!.weight;
    if (cumulative >= targetMass) {
      // Interpolate inside the straddling observation so the result moves
      // smoothly as weights change. Rounded, because these are money values
      // in integer minor units and a fractional paisa is not a price.
      if (i === 0 || cumulative === prev) return rows[i]!.value;
      const within = (targetMass - prev) / (cumulative - prev);
      return Math.round(rows[i - 1]!.value + (rows[i]!.value - rows[i - 1]!.value) * Math.min(within, 1));
    }
  }
  return rows[rows.length - 1]!.value;
}

export function weightedDistribution(pairs: Array<{ value: number; weight: number }>) {
  const rows = pairs.filter((p) => p.weight > 0);
  if (rows.length === 0) return null;
  const values = rows.map((r) => r.value).sort((a, b) => a - b);
  const q1 = weightedQuantile(rows, 0.25);
  const q3 = weightedQuantile(rows, 0.75);
  return {
    n: rows.length,
    effectiveN: Math.round(rows.reduce((sum, r) => sum + r.weight, 0) * 100) / 100,
    min: values[0]!,
    max: values[values.length - 1]!,
    q1,
    median: weightedQuantile(rows, 0.5),
    q3,
    iqr: q3 != null && q1 != null ? q3 - q1 : null,
  };
}

/** The median of the series points at or after a cutoff date, or null. */
function medianOver(series: Array<{ date: string; minor: number }>, from: string): number | null {
  const values = series.filter((p) => p.date >= from).map((p) => p.minor);
  return values.length ? distribution(values)!.median : null;
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

/**
 * Rating alone is not comparable across products with wildly different review
 * volumes. This damps a rating toward the neutral 3.5 midpoint when the
 * sample behind it is thin: full weight only past ~10,000 reviews, so a
 * 20-review 4.7 lands well below a 20,000-review 4.5.
 */
export function trustWeightedRating(rating: number | null, reviewCount: number | null): number | null {
  if (rating == null) return null;
  const n = reviewCount ?? 0;
  const confidence = Math.min(Math.log10(Math.max(n, 1)) / 4, 1);
  return Math.round((3.5 + (rating - 3.5) * confidence) * 100) / 100;
}

/**
 * Attributes that express HOW MUCH PRODUCT YOU GET, and are therefore the
 * only ones a price can meaningfully be divided by.
 *
 * An explicit allowlist rather than "the biggest numeric spec", because that
 * heuristic produces nonsense: a phone's largest pricing-relevant numeric is
 * `battery_mah`, and nobody buys a phone by the milliamp-hour.
 */
const UNIT_BEARING_ATTRIBUTES = new Set([
  "volume_ml",
  "pack_volume_l",
  "volume_l",
  "pack_weight_kg",
  "capacity_mah",
  "capacity_gb",
  "count",
  "pieces",
  "pack_size",
]);

export function unitBasisFor(attrs: AttributeRow[], specifications: Record<string, unknown> | null) {
  const candidates = attrs.filter(
    (a) => a.isPricingRelevant && ["integer", "decimal"].includes(a.dataType) && UNIT_BEARING_ATTRIBUTES.has(a.attributeKey)
  );
  let best: { attr: AttributeRow; value: number } | null = null;
  for (const attr of candidates) {
    const value = Number(specifications?.[attr.attributeKey]);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (!best || value > best.value) best = { attr, value };
  }
  if (!best) return null;
  return { key: best.attr.attributeKey, label: best.attr.displayName, unit: best.attr.unit, value: best.value };
}

/** Spearman rank correlation. Needs at least three points to mean anything. */
function rankCorrelation(a: number[], b: number[]): number | null {
  const n = a.length;
  if (n < 3) return null;
  const rank = (arr: number[]) => {
    const idx = arr.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
    const r = new Array<number>(n);
    idx.forEach(([, i], pos) => (r[i] = pos + 1));
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const d2 = ra.reduce((s, v, i) => s + (v - rb[i]!) ** 2, 0);
  return Math.round((1 - (6 * d2) / (n * (n * n - 1))) * 100) / 100;
}

/* ------------------------------------------------------------------ types */

export type MarketplaceRow = {
  listingId: string;
  marketplaceId: string;
  marketplaceName: string;
  marketplaceType: string | null;
  brandColor: string | null;
  offerCount: number;
  inStockCount: number;
  allOutOfStock: boolean;
  headlineMinor: number | null;
  landedMinor: number | null;
  effectiveMinor: number | null;
  dearestEffectiveMinor: number | null;
  conditionalBestMinor: number | null;
  universalDiscountMinor: number;
  shippingMinor: number | null;
  paidShippingOffers: number;
  mrpMinor: number | null;
  bestSeller: string | null;
  bestSellerRating: number | null;
  bestSellerFulfilment: string | null;
  bestSellerType: string | null;
  topSellerRating: number | null;
  medianSellerRating: number | null;
  fulfilments: string[];
  platformFulfilledOffers: number;
  rating: number | null;
  reviewCount: number | null;
  trustRating: number | null;
  reviewVelocity: number | null;
  matchConfidence: number | null;
  matchStatus: string;
  promoCount: { universal: number; conditional: number; deferred: number; financing: number };
  hasUniversalPromo: boolean;
};

export type Finding = {
  id: string;
  dimension: string;
  direction: "premium" | "aggressive" | "neutral";
  headline: string;
  /** The figures behind the headline, so a client can render its own prose. */
  metrics: Record<string, unknown>;
  evidence: Array<Record<string, unknown>>;
};

/* ---------------------------------------------------------------- service */

export class AnalysisService {
  constructor(
    private readonly repo: AnalysisRepository,
    private readonly competitors: CompetitorService
  ) {}

  /**
   * A marketplace filter must name a marketplace that exists.
   *
   * The same rule the Phase 4 endpoints apply, for the same reason: silently
   * returning a filtered-to-nothing analysis hides a client's mistake, and
   * the ids are `mp_amazon_in` rather than `amazon`, so a caller that
   * guessed deserves to be told which values are real.
   */
  private async requireMarketplace(marketplaceId?: string) {
    if (!marketplaceId) return;
    const known = await this.repo.knownMarketplaceIds();
    if (!known.includes(marketplaceId)) {
      throw new AppError("VALIDATION_FAILED", `Unknown marketplace: ${marketplaceId}.`, {
        details: [{ field: "marketplace", message: `expected one of ${known.join(", ")}` }],
      });
    }
  }

  /* ------------------------------------------------------------ competitors */

  async productCompetitors(
    productId: string,
    opts: { tier?: "direct" | "comparable" | "reference"; marketplaceId?: string; minSimilarity?: number; page: number; pageSize: number }
  ) {
    const product = await this.repo.findProduct(productId);
    if (!product) throw new AppError("NOT_FOUND", `No product with id ${productId}.`);
    await this.requireMarketplace(opts.marketplaceId);

    const set = await this.competitors.build(productId);
    if (set.empty) {
      return {
        data: [],
        pagination: { page: opts.page, pageSize: opts.pageSize, total: 0, totalPages: 0, hasNext: false, hasPrevious: false },
        coverage: set.coverage,
        diversity: null,
        method: set.method,
        meta: { productId, available: false, reason: set.empty.reason, priceBasis: PRICE_BASIS },
      };
    }

    const pool: ScoredCompetitor[] =
      opts.tier === "reference" ? set.reference : opts.tier ? set.members.filter((c) => c.tier === opts.tier) : set.members;

    let filtered = pool;
    if (opts.marketplaceId) filtered = filtered.filter((c) => c.marketplaceIds.includes(opts.marketplaceId!));
    if (opts.minSimilarity != null) filtered = filtered.filter((c) => c.similarity >= opts.minSimilarity!);

    const total = filtered.length;
    const start = (opts.page - 1) * opts.pageSize;
    const page = filtered.slice(start, start + opts.pageSize);
    const totalPages = opts.pageSize > 0 ? Math.ceil(total / opts.pageSize) : 0;

    return {
      data: page.map(shapeCompetitor),
      pagination: {
        page: opts.page,
        pageSize: opts.pageSize,
        total,
        totalPages,
        hasNext: opts.page < totalPages,
        hasPrevious: opts.page > 1 && total > 0,
      },
      coverage: set.coverage,
      diversity: set.diversity,
      method: set.method,
      /** Why each excluded candidate is not evidence — counted, not narrated. */
      excluded: summariseExclusions(set.excluded),
      meta: { productId, available: true, priceBasis: PRICE_BASIS },
    };
  }

  /* -------------------------------------------------------------- analysis */

  /**
   * The whole analysis for one product, at one horizon.
   *
   * One context, built once, shared by every finding. The frontend rebuilds
   * pieces of it per finding because that is free in memory; here it would be
   * a query storm, so everything a finding could want is loaded up front.
   */
  async productAnalysis(
    productId: string,
    opts: { window?: WindowKey; from?: string; to?: string; marketplaceId?: string }
  ) {
    const target = await this.repo.findProduct(productId);
    if (!target) throw new AppError("NOT_FOUND", `No product with id ${productId}.`);
    await this.requireMarketplace(opts.marketplaceId);

    const referenceDate = await this.repo.referenceDate(productId);
    if (!referenceDate) throw new AppError("NOT_FOUND", "No price observations have been captured.");

    /**
     * An explicit range overrides the window, for questions the seven fixed
     * horizons do not cover — and so a caller can ask for the product's whole
     * observed history, which is what the frontend engine has always used.
     * The response reports the range it actually used either way.
     */
    const range = opts.from || opts.to
      ? { key: null, label: null, days: null, from: opts.from ?? "0001-01-01", to: opts.to ?? referenceDate }
      : resolveWindow(opts.window ?? DEFAULT_WINDOW, referenceDate);

    if (range.from > range.to) {
      throw new AppError("VALIDATION_FAILED", "`from` must not be later than `to`.", {
        details: [{ field: "from", message: "must be on or before `to`" }],
      });
    }

    const [attrs, listings, offerStates, promotions, reviews, velocity, series, set] = await Promise.all([
      this.repo.attributesFor(target.productTypeId),
      this.repo.listingsFor(productId),
      this.repo.offerStates(productId),
      this.repo.activePromotions(productId, referenceDate),
      this.repo.latestReviews([productId]),
      this.repo.reviewVelocity([productId]),
      this.repo.dailySeries(productId, range.from, range.to),
      this.competitors.build(productId),
    ]);

    const unitBasis = unitBasisFor(attrs, target.specifications);
    const marketplaceRows = buildMarketplaceRows({ listings, offerStates, promotions, reviews, velocity, marketplaceId: opts.marketplaceId });
    const marketplaceAnalysis = analyseMarketplaces(marketplaceRows);

    // The product's own market: every in-stock offer's effective price.
    const ownPrices = offerStates.filter((o) => o.isInStock).map((o) => o.universalEffectiveMinor);
    const ownMarket = distribution(ownPrices);
    const currentPriceMinor = ownPrices.length ? Math.min(...ownPrices) : null;

    /**
     * Weighted by evidence weight, matching the engine. An unweighted median
     * here would let a padded set move the anchor as much as a strong one.
     */
    const compStats = set.members.length
      ? weightedDistribution(set.members.map((c) => ({ value: c.currentPriceMinor, weight: c.evidenceWeight ?? 0 })))
      : null;

    const targetReview = aggregateReviews(reviews.map((r) => ({ averageRating: r.averageRating, reviewCount: r.reviewCount })));
    const strength = buildStrength(target, attrs, set.members, targetReview);

    const competitorAnalysis = set.members.length
      ? analyseCompetitors({ set, target, ownMedianMinor: ownMarket?.median ?? currentPriceMinor, unitBasis, targetReview })
      : null;

    const history = analyseHistory(series, currentPriceMinor, referenceDate);

    /**
     * The product's 90-day normal, and whether today's market is distorted
     * against it.
     *
     * A statistic, not a decision: it says the current level is promotionally
     * depressed or temporarily elevated, which changes how a historical
     * position should be READ. The recommendation that acts on it is the
     * next phase's business.
     */
    /**
     * The engine's cutoff is `TODAY − 90 days`, and the comparison is
     * `date >= cutoff` — so the window spans 91 calendar days, not 90. Using
     * -89 here matched on this dataset by luck and would have drifted the
     * moment an observation landed on the boundary.
     */
    /**
     * The engine's fallback chain in order: the 90-day median, else the
     * 60-day, else the product's own market, else the comparable median. A
     * product captured only recently has no 90-day window to speak of, and
     * falling back is better than reporting no normal at all.
     */
    const median90 = medianOver(series, shiftDays(referenceDate, -90));
    const median60 = medianOver(series, shiftDays(referenceDate, -60));
    const normalMinor = median90 ?? median60 ?? ownMarket?.median ?? compStats?.median ?? null;
    const distortionRatio = ownMarket?.median && normalMinor ? ownMarket.median / normalMinor : 1;
    const distortion =
      distortionRatio <= 0.9
        ? { state: "depressed" as const, ratio: distortionRatio }
        : distortionRatio >= 1.1
          ? { state: "elevated" as const, ratio: distortionRatio }
          : { state: "normal" as const, ratio: distortionRatio };

    /**
     * A product the competitive set cannot describe still has real
     * observations. What disappears is the interpretation that depends on
     * comparables — not the marketplace layer, and not the history.
     */
    const limited = !set.coverage.sufficient;

    const findings = buildFindings({
      marketplaceAnalysis,
      competitorAnalysis,
      history,
      unitBasis,
      strength,
      compStats,
      ownMarket,
      distortion,
      limited,
    });

    return {
      data: {
        product: {
          id: target.id,
          canonicalName: target.canonicalName,
          brandId: target.brandId,
          brandName: target.brandName,
          brandTier: target.brandTier,
          productTypeId: target.productTypeId,
          categoryId: target.categoryId,
        },
        coverage: {
          ...set.coverage,
          marketplaceCount: marketplaceRows.length,
          pricedMarketplaceCount: marketplaceAnalysis?.pricedCount ?? 0,
          observationCount: series.length,
          limited,
          /**
           * Cross-marketplace findings need more than one priced platform.
           * Saying so is more useful than rendering an analysis of one row.
           */
          crossMarketplaceSupported: (marketplaceAnalysis?.pricedCount ?? 0) >= 3,
          historySupported: series.length >= 4,
          perUnitSupported: unitBasis != null,
        },
        currentPrice: currentPriceMinor == null ? null : { effectiveMinor: currentPriceMinor, basis: PRICE_BASIS.basis },
        ownMarket,
        competitiveStatistics: compStats,
        marketplaceRows,
        marketplaceAnalysis,
        competitors: competitorAnalysis,
        competitorCoverage: set.coverage,
        strength,
        unitBasis,
        history,
        normalMinor,
        distortion,
        findings,
      },
      meta: {
        productId,
        referenceDate,
        window: range.key ? { key: range.key, label: range.label, days: range.days } : null,
        range: { from: range.from, to: range.to },
        marketplaceId: opts.marketplaceId ?? null,
        priceBasis: PRICE_BASIS,
        /**
         * Stated so nobody mistakes an intentional omission for a bug. Both
         * belong to the pricing recommendation, which is the next phase.
         */
        notMigrated: [
          { id: "wtp", reason: "The willingness-to-pay finding is the hedonic model, which is part of the pricing recommendation." },
          { id: "bridge", reason: "The strategy bridge maps recommended prices into the analysis, so it follows the recommendation engine." },
        ],
      },
    };
  }
}

/* ------------------------------------------------------- marketplace layer */

function buildMarketplaceRows(input: {
  listings: Array<{
    listingId: string;
    marketplaceId: string;
    marketplaceName: string;
    marketplaceType: string;
    brandColor: string | null;
    matchConfidence: number | null;
    matchStatus: string;
  }>;
  offerStates: OfferStateRow[];
  promotions: Array<{ offerId: string; availabilityClass: string; promotionType: string; label: string; discountValueMinor: number }>;
  reviews: Array<{ listingId: string; averageRating: number | null; reviewCount: number | null }>;
  velocity: Array<{ listingId: string; velocity: number | null }>;
  marketplaceId?: string;
}): MarketplaceRow[] {
  const byListing = new Map<string, OfferStateRow[]>();
  for (const state of input.offerStates) {
    const bucket = byListing.get(state.listingId) ?? [];
    bucket.push(state);
    byListing.set(state.listingId, bucket);
  }

  const promoByOffer = new Map<string, typeof input.promotions>();
  for (const p of input.promotions) {
    const bucket = promoByOffer.get(p.offerId) ?? [];
    bucket.push(p);
    promoByOffer.set(p.offerId, bucket);
  }

  const reviewByListing = new Map(input.reviews.map((r) => [r.listingId, r]));
  const velocityByListing = new Map(input.velocity.map((v) => [v.listingId, v.velocity]));

  const rows: MarketplaceRow[] = [];
  for (const listing of input.listings) {
    if (input.marketplaceId && listing.marketplaceId !== input.marketplaceId) continue;

    const offers = byListing.get(listing.listingId) ?? [];
    const inStock = offers.filter((o) => o.isInStock);
    const review = reviewByListing.get(listing.listingId);

    /**
     * The cheapest offer a buyer can actually take. EVERY rung shown comes
     * from THIS one offer — taking the minimum of each rung independently
     * across offers produced a ladder that did not add up, because those
     * were different sellers.
     */
    const best = inStock.reduce<OfferStateRow | null>(
      (acc, o) => (acc === null || o.universalEffectiveMinor < acc.universalEffectiveMinor ? o : acc),
      null
    );

    const promoCount = { universal: 0, conditional: 0, deferred: 0, financing: 0 };
    for (const offer of offers) {
      for (const promo of promoByOffer.get(offer.offerId) ?? []) {
        if (promo.availabilityClass in promoCount) {
          promoCount[promo.availabilityClass as keyof typeof promoCount]++;
        }
      }
    }

    const sellerRatings = offers.map((o) => o.sellerRating).filter((v): v is number => v != null);
    const fulfilments = [...new Set(offers.map((o) => o.fulfilmentType).filter(Boolean))];
    const effectives = inStock.map((o) => o.universalEffectiveMinor);

    rows.push({
      listingId: listing.listingId,
      marketplaceId: listing.marketplaceId,
      marketplaceName: listing.marketplaceName,
      marketplaceType: listing.marketplaceType,
      brandColor: listing.brandColor,
      offerCount: offers.length,
      inStockCount: inStock.length,
      allOutOfStock: offers.length > 0 && inStock.length === 0,
      headlineMinor: best?.sellingPriceMinor ?? null,
      landedMinor: best?.landedMinor ?? null,
      effectiveMinor: best?.universalEffectiveMinor ?? null,
      dearestEffectiveMinor: effectives.length ? Math.max(...effectives) : null,
      conditionalBestMinor: best
        ? best.universalEffectiveMinor - Math.min(best.conditionalDiscountRaw, best.universalEffectiveMinor)
        : null,
      universalDiscountMinor: best?.universalDiscountMinor ?? 0,
      shippingMinor: best?.shippingFeeMinor ?? null,
      paidShippingOffers: offers.filter((o) => o.shippingFeeMinor > 0).length,
      mrpMinor: best?.mrpMinor ?? null,
      bestSeller: best?.sellerName ?? null,
      bestSellerRating: best?.sellerRating ?? null,
      bestSellerFulfilment: best?.fulfilmentType ?? null,
      bestSellerType: best?.sellerType ?? null,
      topSellerRating: sellerRatings.length ? Math.max(...sellerRatings) : null,
      medianSellerRating: sellerRatings.length ? median(sellerRatings) : null,
      fulfilments,
      platformFulfilledOffers: offers.filter((o) => o.fulfilmentType && !/self_ship/.test(o.fulfilmentType)).length,
      rating: review?.averageRating ?? null,
      reviewCount: review?.reviewCount ?? null,
      trustRating: trustWeightedRating(review?.averageRating ?? null, review?.reviewCount ?? null),
      reviewVelocity: velocityByListing.get(listing.listingId) ?? null,
      matchConfidence: listing.matchConfidence,
      matchStatus: listing.matchStatus,
      promoCount,
      hasUniversalPromo: promoCount.universal > 0,
    });
  }

  return rows
    .filter((r) => r.offerCount > 0)
    .sort((a, b) => (a.effectiveMinor ?? Infinity) - (b.effectiveMinor ?? Infinity));
}

type MarketplaceAnalysis = ReturnType<typeof analyseMarketplaces>;

function analyseMarketplaces(rows: MarketplaceRow[]) {
  const priced = rows.filter((r) => r.effectiveMinor != null);
  if (priced.length === 0) return null;

  const effectives = priced.map((r) => r.effectiveMinor!);
  const cheapest = priced[0]!;
  const dearest = priced[priced.length - 1]!;
  const spreadMinor = dearest.effectiveMinor! - cheapest.effectiveMinor!;

  const withTrust = priced.filter((r) => r.trustRating != null);
  const priceTrustCorrelation =
    withTrust.length >= 3
      ? rankCorrelation(withTrust.map((r) => r.effectiveMinor!), withTrust.map((r) => r.trustRating!))
      : null;

  // Does including delivery reorder the platforms? If it does, the headline
  // price is actively misleading and the landed rung is the honest one.
  const byHeadline = [...priced].filter((r) => r.headlineMinor != null).sort((a, b) => a.headlineMinor! - b.headlineMinor!);
  const byLanded = [...priced].filter((r) => r.landedMinor != null).sort((a, b) => a.landedMinor! - b.landedMinor!);
  const shippingReordersRanking =
    byHeadline.length > 1 && byHeadline.some((r, i) => byLanded[i] && r.marketplaceId !== byLanded[i]!.marketplaceId);

  const bestTrust = withTrust.length ? withTrust.reduce((a, b) => (b.trustRating! > a.trustRating! ? b : a)) : null;
  const worstTrust = withTrust.length ? withTrust.reduce((a, b) => (b.trustRating! < a.trustRating! ? b : a)) : null;

  return {
    marketplaceCount: rows.length,
    pricedCount: priced.length,
    cheapest,
    dearest,
    spreadMinor,
    spreadPct: pct(spreadMinor / cheapest.effectiveMinor!),
    medianEffectiveMinor: median(effectives),
    bestTrust,
    worstTrust,
    priceTrustCorrelation,
    cheapestIsAlsoBestTrusted: bestTrust != null && bestTrust.marketplaceId === cheapest.marketplaceId,
    dearestIsWorstTrusted: worstTrust != null && worstTrust.marketplaceId === dearest.marketplaceId,
    shippingReordersRanking,
    platformsWithUniversalPromo: priced.filter((r) => r.hasUniversalPromo).length,
    platformsWithAnyPromo: priced.filter(
      (r) => r.promoCount.universal + r.promoCount.conditional + r.promoCount.deferred + r.promoCount.financing > 0
    ).length,
    platformsWithPaidShipping: priced.filter((r) => r.paidShippingOffers > 0).length,
    platformsWithStockGap: rows.filter((r) => r.inStockCount < r.offerCount).length,
    lowestMatchConfidence: Math.min(...rows.map((r) => r.matchConfidence ?? 1)),
  };
}

/* --------------------------------------------------------- strength index */

type Strength = ReturnType<typeof buildStrength>;

/**
 * How this product stands against its comparable set on rating, review
 * volume, specification and brand tier. An input to the recommendation
 * rather than part of it — it says what is true, not what to charge.
 */
function buildStrength(
  target: ProductRow,
  attrs: AttributeRow[],
  comps: ScoredCompetitor[],
  targetReview: { rating: number | null; reviewCount: number }
) {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const numericAttrs = attrs.filter((a) => a.isPricingRelevant && ["integer", "decimal"].includes(a.dataType));

  const compRatings = comps.map((c) => c.rating).filter((r): r is number => r != null);
  const compReviews = comps.map((c) => c.reviewCount).filter((r): r is number => r != null);
  const medianRating = compRatings.length ? distribution(compRatings)!.median : null;
  const medianReviews = compReviews.length ? distribution(compReviews)!.median : null;

  const ratingScore = clamp(
    targetReview.rating != null && medianRating != null ? (targetReview.rating - medianRating) / 0.4 : 0,
    -1,
    1
  );
  const reviewScore = clamp(
    targetReview.reviewCount && medianReviews ? Math.log10(targetReview.reviewCount / medianReviews) : 0,
    -1,
    1
  );

  const specAdvantages: Array<Record<string, unknown>> = [];
  const specDisadvantages: Array<Record<string, unknown>> = [];
  let specTies = 0;
  for (const attr of numericAttrs) {
    const mine = Number(target.specifications?.[attr.attributeKey]);
    if (!Number.isFinite(mine)) continue;
    const theirs = comps
      .map((c) => Number(c.specifications?.[attr.attributeKey]))
      .filter((v) => Number.isFinite(v));
    if (theirs.length === 0) continue;
    const compMedian = distribution(theirs)!.median;
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

  const targetTier = TIER_RANK[target.brandTier ?? ""] ?? 1;
  const compTiers = comps.map((c) => TIER_RANK[c.brandTier ?? ""] ?? 1);
  const medianTier = compTiers.length ? distribution(compTiers)!.median : targetTier;
  const tierScore = clamp(targetTier - medianTier, -1, 1);

  const components = [
    /**
     * Weights and keys as the validated engine defines them. The port had
     * `reviews` at 0.2 and `specifications` at 0.3 — both summed to 1, so the
     * index looked plausible and was wrong (0.40 against the engine's 0.44 on
     * the golden product), and the key was renamed from `specs`.
     *
     * Nothing downstream of the index sets a price, which is why 77 pricing
     * parity assertions passed over it. It surfaced the moment the screen
     * started reading the value from here instead of computing it locally —
     * the argument for making the UI consume the API rather than agree with it.
     */
    { key: "rating", label: "Customer rating", weight: 0.3, score: ratingScore },
    { key: "reviews", label: "Review volume", weight: 0.15, score: reviewScore },
    { key: "specs", label: "Specification profile", weight: 0.35, score: specScore },
    { key: "brand", label: "Brand tier", weight: 0.2, score: tierScore },
  ];
  const index = Math.round(components.reduce((s, c) => s + c.weight * c.score, 0) * 1000) / 1000;

  return {
    index,
    components,
    targetRating: targetReview.rating,
    targetReviews: targetReview.reviewCount,
    medianRating,
    medianReviews,
    specAdvantages,
    specDisadvantages,
    specTies,
    /**
     * How many pricing-relevant numeric attributes this product type declares
     * at all — the denominator the comparison was made against. Advantages
     * plus disadvantages plus ties undercounts it, because an attribute the
     * target does not carry is still one the type declares, and a caller
     * saying "measured on N attributes" means this N — every pricing-relevant
     * attribute the type declares, not only the numeric ones the comparison
     * could actually score.
     */
    pricingRelevantAttributeCount: attrs.filter((a) => a.isPricingRelevant).length,
  };
}

/* ------------------------------------------------------- competitor layer */

type CompetitorAnalysis = ReturnType<typeof analyseCompetitors>;

function analyseCompetitors(input: {
  set: CompetitiveSet;
  target: ProductRow;
  ownMedianMinor: number | null;
  unitBasis: ReturnType<typeof unitBasisFor>;
  targetReview: { rating: number | null; reviewCount: number };
}) {
  const { set, target, ownMedianMinor, unitBasis, targetReview } = input;
  const ownUnit = unitBasis && ownMedianMinor != null ? ownMedianMinor / unitBasis.value : null;
  const targetTrust = trustWeightedRating(targetReview.rating, targetReview.reviewCount);
  const targetTier = TIER_RANK[target.brandTier ?? ""] ?? 1;

  const rows = set.members.map((c) => {
    const compUnitValue = unitBasis ? Number(c.specifications?.[unitBasis.key]) : null;
    const compUnit =
      unitBasis && compUnitValue != null && Number.isFinite(compUnitValue) && compUnitValue > 0
        ? c.currentPriceMinor / compUnitValue
        : null;
    const trust = trustWeightedRating(c.rating, c.reviewCount);

    return {
      id: c.productId,
      name: c.canonicalName,
      brandName: c.brandName,
      brandTier: c.brandTier,
      brandTierDelta: (TIER_RANK[c.brandTier ?? ""] ?? 1) - targetTier,
      tier: c.tier,
      tierReason: c.tierReason,
      similarity: c.similarity,
      evidenceWeight: c.evidenceWeight,
      priceMinor: c.currentPriceMinor,
      priceGapPct: ownMedianMinor ? pct((c.currentPriceMinor - ownMedianMinor) / ownMedianMinor) : null,
      unitValue: compUnitValue != null && Number.isFinite(compUnitValue) ? compUnitValue : null,
      unitPriceMinor: compUnit,
      unitGapPct: ownUnit && compUnit ? pct((compUnit - ownUnit) / ownUnit) : null,
      // The reversal that matters: cheaper overall, dearer per unit.
      cheaperButDearerPerUnit:
        ownMedianMinor != null && ownUnit != null && compUnit != null
          ? c.currentPriceMinor < ownMedianMinor && compUnit > ownUnit
          : false,
      rating: c.rating,
      reviewCount: c.reviewCount,
      trustRating: trust,
      trustDelta: targetTrust != null && trust != null ? Math.round((trust - targetTrust) * 100) / 100 : null,
      marketplaceIds: c.marketplaceIds,
      sharedMarketplaces: c.sharedMarketplaces,
      hasUniversalPromo: c.hasUniversalPromo,
      specMatch: { match: c.specDetail.match, partial: c.specDetail.partial, differ: c.specDetail.differ },
    };
  });

  return {
    rows,
    ownUnitPriceMinor: ownUnit,
    targetTrustRating: targetTrust,
    cheaperCount: rows.filter((r) => r.priceGapPct != null && r.priceGapPct < 0).length,
    dearerCount: rows.filter((r) => r.priceGapPct != null && r.priceGapPct > 0).length,
    reversals: rows.filter((r) => r.cheaperButDearerPerUnit),
    strongerTrustCount: rows.filter((r) => r.trustDelta != null && r.trustDelta > 0).length,
  };
}

/* ---------------------------------------------------------- history layer */

type History = ReturnType<typeof analyseHistory>;

/**
 * Where today sits inside the product's own observed history.
 *
 * Needs at least four points — below that a percentile within the series is
 * arithmetic about the sampling rather than about the market.
 */
function analyseHistory(
  series: Array<{ date: string; minor: number; saleLabel: string | null }>,
  currentMinor: number | null,
  referenceDate: string
) {
  if (series.length < 4) return null;

  const values = series.map((p) => p.minor);
  const stats = distribution(values)!;
  const current = currentMinor ?? values[values.length - 1]!;

  const below = values.filter((v) => v < current).length;
  const percentile = Math.round((below / values.length) * 100);

  // Coefficient of variation: comparable across price levels in a way a
  // rupee standard deviation is not.
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  const volatility = mean ? sd / mean : null;

  const promoDays = series.filter((p) => p.saleLabel).length;
  const first = values[0]!;

  return {
    observationCount: series.length,
    firstDate: series[0]!.date,
    lastDate: series[series.length - 1]!.date,
    minMinor: stats.min,
    maxMinor: stats.max,
    medianMinor: stats.median,
    /**
     * The trailing medians, which is how a reader judges whether today's price
     * is unusual: one window can be a sale, three disagreeing is a trend.
     * Same cutoff rule as the 90-day normal — `date >= today − N`, so a window
     * spans N+1 calendar days.
     */
    median30: medianOver(series, shiftDays(referenceDate, -30)),
    median60: medianOver(series, shiftDays(referenceDate, -60)),
    median90: medianOver(series, shiftDays(referenceDate, -90)),
    currentMinor: current,
    percentile,
    volatility: volatility == null ? null : Math.round(volatility * 1000) / 10,
    volatilityBand: volatility == null ? null : volatility < 0.03 ? "stable" : volatility < 0.08 ? "moderate" : "volatile",
    promoDays,
    promoLabels: [...new Set(series.filter((p) => p.saleLabel).map((p) => p.saleLabel!))],
    trendPct: first ? pct((current - first) / first) : null,
  };
}

/* --------------------------------------------------------------- findings */

/**
 * A finding is a statement that needed at least two dimensions to reach.
 *
 * Each carries the figures behind it and a `direction` saying which pricing
 * posture it argues for. Anything a single column already says is not a
 * finding and is left to the tables.
 *
 * The honesty rule is structural: every block is guarded by the evidence it
 * needs, so a finding cannot be produced without its support. Prose is NOT
 * generated here — the metrics and evidence are returned and the interface
 * phrases them, which is what keeps a finding checkable.
 */
function buildFindings(input: {
  marketplaceAnalysis: MarketplaceAnalysis;
  competitorAnalysis: CompetitorAnalysis | null;
  history: History;
  unitBasis: ReturnType<typeof unitBasisFor>;
  strength: Strength;
  compStats: { n: number; min: number; max: number; median: number | null } | null;
  ownMarket: ReturnType<typeof distribution>;
  distortion: { state: "depressed" | "elevated" | "normal"; ratio: number };
  limited: boolean;
}): Finding[] {
  const out: Finding[] = [];

  /**
   * THE HONESTY GATE.
   *
   * Below the working minimum of comparables the market cannot be described
   * at all, and the engine refuses outright rather than emitting the subset
   * of findings that happen not to need a competitor. The observation layers
   * are still returned — they are real — but no interpretation is offered.
   *
   * Without this the backend produced four findings for a product the
   * frontend produced none for, which is exactly the fabrication this phase
   * has to avoid.
   */
  if (input.limited) return out;

  const mp = input.marketplaceAnalysis;
  const comp = input.competitorAnalysis;

  /* --- 1. Cross-marketplace price vs trust ----------------------------- */
  if (mp && mp.pricedCount >= 3) {
    if (mp.cheapestIsAlsoBestTrusted) {
      out.push({
        id: "cheapest_is_best_trusted",
        dimension: "Marketplace",
        direction: "aggressive",
        headline: `${mp.cheapest.marketplaceName} is both the cheapest and the best-rated platform`,
        metrics: {
          cheapestMarketplaceId: mp.cheapest.marketplaceId,
          cheapestEffectiveMinor: mp.cheapest.effectiveMinor,
          dearestMarketplaceId: mp.dearest.marketplaceId,
          dearestEffectiveMinor: mp.dearest.effectiveMinor,
          spreadPct: mp.spreadPct,
        },
        evidence: [
          { marketplaceId: mp.cheapest.marketplaceId, effectiveMinor: mp.cheapest.effectiveMinor, rating: mp.cheapest.rating, reviewCount: mp.cheapest.reviewCount },
          { marketplaceId: mp.dearest.marketplaceId, effectiveMinor: mp.dearest.effectiveMinor, rating: mp.dearest.rating, reviewCount: mp.dearest.reviewCount },
        ],
      });
    } else if (mp.priceTrustCorrelation != null && mp.priceTrustCorrelation > 0.5) {
      out.push({
        id: "price_tracks_trust",
        dimension: "Marketplace",
        direction: "premium",
        headline: "Dearer platforms are also the better-rated ones",
        metrics: { correlation: mp.priceTrustCorrelation, platformCount: mp.pricedCount },
        evidence: [{ measure: "spearman_price_vs_trust", value: mp.priceTrustCorrelation, n: mp.pricedCount }],
      });
    }

    if (mp.spreadPct != null && mp.spreadPct >= 5) {
      out.push({
        id: "platform_spread",
        dimension: "Marketplace",
        direction: "neutral",
        headline: `The same product spans ${mp.spreadPct}% across platforms`,
        metrics: {
          spreadPct: mp.spreadPct,
          spreadMinor: mp.spreadMinor,
          cheapestMarketplaceId: mp.cheapest.marketplaceId,
          dearestMarketplaceId: mp.dearest.marketplaceId,
          medianEffectiveMinor: mp.medianEffectiveMinor,
        },
        evidence: [
          { marketplaceId: mp.cheapest.marketplaceId, effectiveMinor: mp.cheapest.effectiveMinor },
          { marketplaceId: mp.dearest.marketplaceId, effectiveMinor: mp.dearest.effectiveMinor },
        ],
      });
    }
  }

  /* --- 2. Shipping changes the ranking --------------------------------- */
  if (mp?.shippingReordersRanking) {
    out.push({
      id: "shipping_reorders",
      dimension: "Offer",
      direction: "neutral",
      headline: "Delivery charges change which platform is actually cheapest",
      metrics: { platformsWithPaidShipping: mp.platformsWithPaidShipping, pricedCount: mp.pricedCount },
      evidence: [{ measure: "headline_vs_landed_ranking", reordered: true, platformsWithPaidShipping: mp.platformsWithPaidShipping }],
    });
  }

  /* --- 3. Per-unit reversal -------------------------------------------- */
  if (input.unitBasis && comp?.reversals.length) {
    out.push({
      id: "per_unit_reversal",
      dimension: "Competitor",
      direction: "premium",
      headline: `${comp.reversals.length} cheaper competitor${comp.reversals.length === 1 ? " is" : "s are"} dearer per ${input.unitBasis.unit ?? "unit"}`,
      metrics: {
        reversalCount: comp.reversals.length,
        unitKey: input.unitBasis.key,
        unitLabel: input.unitBasis.label,
        unit: input.unitBasis.unit,
        targetUnitValue: input.unitBasis.value,
        ownUnitPriceMinor: comp.ownUnitPriceMinor,
      },
      evidence: comp.reversals.map((r) => ({
        productId: r.id,
        priceMinor: r.priceMinor,
        unitValue: r.unitValue,
        unitPriceMinor: r.unitPriceMinor,
        priceGapPct: r.priceGapPct,
        unitGapPct: r.unitGapPct,
      })),
    });
  }

  /* --- 4. Position against the competitive median ---------------------- */
  if (input.compStats?.median != null && input.ownMarket?.median != null) {
    const gap = pct((input.ownMarket.median - input.compStats.median) / input.compStats.median);
    out.push({
      id: "vs_comp_median",
      dimension: "Competitor",
      direction: gap != null && gap > 0 ? "premium" : "aggressive",
      headline:
        gap != null && gap > 0
          ? `This product sits ${gap}% above the competitive median`
          : `This product sits ${Math.abs(gap ?? 0)}% below the competitive median`,
      metrics: {
        ownMedianMinor: input.ownMarket.median,
        compMedianMinor: input.compStats.median,
        gapPct: gap,
        compCount: input.compStats.n,
        cheaperCount: comp?.cheaperCount ?? null,
        dearerCount: comp?.dearerCount ?? null,
      },
      evidence: [
        { measure: "own_market_median", valueMinor: input.ownMarket.median, n: input.ownMarket.n },
        { measure: "competitive_median", valueMinor: input.compStats.median, n: input.compStats.n },
      ],
    });
  }

  /* --- 5. Trust strength vs the competitor set ------------------------- */
  const st = input.strength;
  if (st.targetRating != null && st.medianRating != null) {
    const delta = Math.round((st.targetRating - st.medianRating) * 100) / 100;
    /**
     * A rating advantage only argues for a premium when the review base
     * behind it is also larger. A 4.7 from 200 reviews against a 4.5 from
     * 40,000 is the weaker of the two claims, not the stronger.
     */
    const stronger = st.targetRating > st.medianRating;
    const reviewsStronger = Boolean(st.targetReviews && st.medianReviews && st.targetReviews > st.medianReviews);
    out.push({
      id: "trust_vs_comps",
      dimension: "Trust",
      direction: stronger && reviewsStronger ? "premium" : stronger ? "neutral" : "aggressive",
      headline:
        delta > 0
          ? `Rated ${delta.toFixed(1)}★ above the competitive median`
          : delta < 0
            ? `Rated ${Math.abs(delta).toFixed(1)}★ below the competitive median`
            : "Rated level with the competitive median",
      metrics: {
        targetRating: st.targetRating,
        medianRating: st.medianRating,
        ratingDelta: delta,
        targetReviews: st.targetReviews,
        medianReviews: st.medianReviews,
        strongerTrustCount: comp?.strongerTrustCount ?? null,
        reviewBaseLarger: reviewsStronger,
      },
      evidence: [
        { measure: "target_rating", rating: st.targetRating, reviewCount: st.targetReviews },
        { measure: "comp_median_rating", rating: st.medianRating, medianReviews: st.medianReviews },
      ],
    });
  }

  /* --- 6. Specification position --------------------------------------- */
  if (st.specAdvantages.length || st.specDisadvantages.length) {
    const net = st.specAdvantages.length - st.specDisadvantages.length;
    out.push({
      id: "spec_position",
      dimension: "Specification",
      direction: net > 0 ? "premium" : net < 0 ? "aggressive" : "neutral",
      headline:
        net > 0
          ? `Ahead of the competitive median on ${st.specAdvantages.length} specification${st.specAdvantages.length === 1 ? "" : "s"}`
          : net < 0
            ? `Behind the competitive median on ${st.specDisadvantages.length} specification${st.specDisadvantages.length === 1 ? "" : "s"}`
            : "Level with the competitive median on specification",
      metrics: {
        advantageCount: st.specAdvantages.length,
        disadvantageCount: st.specDisadvantages.length,
        tieCount: st.specTies,
        net,
      },
      evidence: [...st.specAdvantages.map((a) => ({ ...a, side: "advantage" })), ...st.specDisadvantages.map((d) => ({ ...d, side: "disadvantage" }))],
    });
  }

  /* --- 7. Historical position ------------------------------------------ */
  if (input.history) {
    const h = input.history;
    /**
     * Sitting HIGH in its own range means there is little historical
     * headroom, which argues for restraint; sitting LOW means the entry
     * price is soft and there is room above it. A distorted market argues
     * for neither — today's level is not the product's standing level.
     */
    const distorted = input.distortion.state !== "normal";
    out.push({
      id: "historical_position",
      dimension: "History",
      direction: distorted ? "neutral" : h.percentile > 70 ? "aggressive" : h.percentile < 30 ? "premium" : "neutral",
      headline: `Currently at the ${h.percentile}th percentile of its own observed range`,
      metrics: {
        percentile: h.percentile,
        currentMinor: h.currentMinor,
        minMinor: h.minMinor,
        maxMinor: h.maxMinor,
        medianMinor: h.medianMinor,
        observationCount: h.observationCount,
        volatility: h.volatility,
        volatilityBand: h.volatilityBand,
        trendPct: h.trendPct,
        promoDays: h.promoDays,
        distortionState: input.distortion.state,
        distortionRatio: Math.round(input.distortion.ratio * 1000) / 1000,
      },
      evidence: [
        { measure: "observed_range", minMinor: h.minMinor, maxMinor: h.maxMinor, n: h.observationCount, from: h.firstDate, to: h.lastDate },
        { measure: "promotional_days", days: h.promoDays, labels: h.promoLabels },
      ],
    });
  }

  /* --- 8. Availability -------------------------------------------------- */
  if (mp?.platformsWithStockGap) {
    out.push({
      id: "availability",
      dimension: "Availability",
      direction: "neutral",
      headline: `${mp.platformsWithStockGap} platform${mp.platformsWithStockGap === 1 ? " has" : "s have"} offers that cannot currently be bought`,
      metrics: { platformsWithStockGap: mp.platformsWithStockGap, marketplaceCount: mp.marketplaceCount },
      evidence: [{ measure: "platforms_with_stock_gap", count: mp.platformsWithStockGap }],
    });
  }

  /* --- 9. Match confidence ---------------------------------------------- */
  if (mp && mp.lowestMatchConfidence < 0.95) {
    out.push({
      id: "match_confidence",
      dimension: "Data quality",
      direction: "neutral",
      headline: `At least one listing is only ${Math.round(mp.lowestMatchConfidence * 100)}% certain to be this product`,
      metrics: { lowestMatchConfidence: mp.lowestMatchConfidence },
      evidence: [{ measure: "lowest_listing_match_confidence", value: mp.lowestMatchConfidence }],
    });
  }

  return out;
}

/* ---------------------------------------------------------------- shaping */

function shapeCompetitor(c: ScoredCompetitor) {
  return {
    productId: c.productId,
    canonicalName: c.canonicalName,
    brand: { id: c.brandId, name: c.brandName, tier: c.brandTier },
    tier: c.tier,
    tierReason: c.tierReason,
    similarity: Math.round(c.similarity * 10000) / 10000,
    evidenceWeight: c.evidenceWeight,
    currentPriceMinor: c.currentPriceMinor,
    hasUniversalPromo: c.hasUniversalPromo,
    rating: c.rating,
    reviewCount: c.reviewCount,
    marketplaceIds: c.marketplaceIds,
    sharedMarketplaces: c.sharedMarketplaces,
    /** Why the similarity is what it is, term by term. */
    similarityBreakdown: c.breakdown,
    specificationMatch: {
      match: c.specDetail.match,
      partial: c.specDetail.partial,
      differ: c.specDetail.differ,
      missing: c.specDetail.missing,
      coverage: Math.round(c.specDetail.coverage * 1000) / 1000,
    },
    dataQuality: {
      score: Math.round(c.quality.score * 1000) / 1000,
      observations: c.quality.observations,
      inStockOffers: c.quality.inStockOffers,
      listingCount: c.quality.listingCount,
      notes: c.quality.notes,
    },
    isSameFamily: c.isSameFamily,
    familyAlternates: c.familyAlternates,
  };
}

function summariseExclusions(excluded: Array<{ reason: string }>) {
  const counts: Record<string, number> = {};
  for (const e of excluded) {
    const key = /no marketplace in common/.test(e.reason)
      ? "no_shared_marketplace"
      : /same model/.test(e.reason)
        ? "same_model_family"
        : /applicable MRP/.test(e.reason)
          ? "above_mrp"
          : "other";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.entries(counts).map(([reason, count]) => ({ reason, count }));
}
