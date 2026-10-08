/**
 * THE AI PORT
 * ===========
 *
 * Third port in this codebase, built to the same shape as the other two:
 * `createEmailAdapter()` and `createMarketOfferProvider()` both switch on one
 * environment variable and hand back an interface nothing above them can see
 * through. The pricing engine must not know, or be able to find out, which
 * provider is configured.
 *
 * WHAT THE AI IS FOR, AND WHAT IT IS NOT
 *
 * It reasons over evidence we have already gathered. It is never the source
 * of a market fact. Asking a model what an iPhone costs today would be
 * swapping a measured price for a remembered one, and the whole capture
 * pipeline exists so that we do not do that.
 *
 *   SerpApi  →  observations  →  summarised evidence  →  AI  →  judgement
 *
 * never
 *
 *   AI  →  "what does this cost?"
 *
 * Three consequences, all enforced below rather than left to convention:
 *
 *   - the adapter is given a COMPACT EVIDENCE SUMMARY, never a raw provider
 *     response. Fewer tokens, lower cost, lower latency, and no provider
 *     coupling leaking into the prompt;
 *   - output is STRUCTURED AND VALIDATED. A price recovered by reading prose
 *     is a price nobody can defend, so the contract is a typed object and
 *     anything that fails validation is discarded;
 *   - failure is EXPLICIT. Unavailable, slow, out of quota or malformed all
 *     end the same way: no recommendation. Never an invented one.
 */

/** What the model is allowed to see. Already normalised, already summarised. */
export type PricingEvidence = {
  product: {
    name: string;
    /** Null where genuinely unknown — a live product often has no taxonomy. */
    brand: string | null;
    category: string | null;
  };
  /** The market as most recently captured. */
  market: {
    capturedAt: string;
    offerCount: number;
    marketplaceCount: number;
    minMinor: number;
    maxMinor: number;
    medianMinor: number;
    /** Per-SELLER, cheapest first, trimmed — the shape, not the whole list. */
    offers: Array<{
      /** The store this seller trades on. */
      marketplace: string;
      /** The merchant. Often the same as the store, not always. */
      seller?: string | null;
      priceMinor: number;
      shippingFeeMinor: number | null;
      mrpMinor: number | null;
      rating: number | null;
      reviewCount: number | null;
      inStock?: boolean | null;
    }>;
  };

  /**
   * THE SHAPE OF THE COMPETITION, not just its summary statistics.
   *
   * Added because a median alone cannot answer the question being asked. "Six
   * sellers are within 2% of the cheapest price" and "one seller is 15% below
   * everyone else" produce the same median and call for opposite decisions —
   * in the first the floor is a defended position, in the second it is an
   * outlier worth ignoring. Without this the model was being asked to judge a
   * market it could not see the structure of.
   *
   * Null when there are too few sellers for structure to mean anything.
   */
  competition: {
    /** The cheapest price anyone is charging. */
    floorMinor: number;
    /** The next cheapest, and the gap — what it costs to take the floor. */
    secondFloorMinor: number | null;
    floorGapMinor: number | null;
    /** How many sellers sit within 2% of the floor. A crowded floor is war. */
    atFloorCount: number;
    /** 0..1 — share of sellers within 5% of the median. */
    clustering: number;
    /** (high − low) / median, as a percentage. */
    spreadPct: number;
    inStockCount: number;
  } | null;
  /**
   * Absent entirely at cold start rather than zero-filled.
   *
   * Every figure here was observed and timestamped by this system. The data
   * provider supplies no past series, so there is nothing imported and
   * nothing backfilled — which is why `observationCount` is stated: a median
   * over three captures and one over thirty are different claims.
   */
  history: {
    observationCount: number;
    firstObservedAt: string;
    lastObservedAt: string;
    medianMinor: number;
    minMinor: number;
    maxMinor: number;
    /** Percent, first to last. */
    changePct: number | null;
    volatilityPct: number | null;
    /**
     * Whether the seller population stayed stable enough across the window
     * for the change to be about price rather than about who was counted.
     */
    comparable?: boolean | null;
  } | null;
  currency: string;
};

/** What a provider must return. Anything else is rejected. */
export type AIPricingVerdict = {
  recommendedPriceMinor: number;
  rangeMinMinor: number;
  rangeMaxMinor: number;
  confidence: "low" | "medium" | "high";
  reasoning: string;
  warnings: string[];
};

export type AIProvider = {
  /** Stable identifier, recorded on every recommendation it produces. */
  readonly name: string;
  /** The configured model, recorded alongside, so results stay comparable later. */
  readonly model: string;
  /** False for the disabled adapter, so callers can skip the attempt entirely. */
  readonly available: boolean;

  /**
   * Weigh the evidence and propose a price.
   *
   * Throws `AIProviderError` for anything that went wrong. Returning null is
   * not a failure mode — a provider that cannot reach a view should say so.
   */
  recommend(evidence: PricingEvidence): Promise<AIPricingVerdict>;
};

export class AIProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly kind: "unavailable" | "timeout" | "quota" | "auth" | "malformed" | "disabled",
    readonly retryable = false
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

/**
 * Validate a provider's answer before anything downstream sees it.
 *
 * A model will occasionally return a confidently-worded number that is an
 * order of magnitude out, or a range that excludes its own recommendation.
 * Those are not opinions to be weighed; they are malformed output. The
 * caller treats a rejection exactly like an outage, which is the point:
 * neither produces a recommendation.
 */
export function validateVerdict(
  raw: unknown,
  bounds: { minMinor: number; maxMinor: number }
): AIPricingVerdict | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "not an object" };
  const v = raw as Record<string, unknown>;

  const price = Number(v.recommendedPriceMinor);
  const lo = Number(v.rangeMinMinor);
  const hi = Number(v.rangeMaxMinor);

  if (!Number.isFinite(price) || price <= 0) return { error: "recommendedPriceMinor is not a positive number" };
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { error: "range is not numeric" };
  if (lo > hi) return { error: "range is inverted" };
  if (price < lo || price > hi) return { error: "recommended price sits outside its own range" };

  if (!["low", "medium", "high"].includes(String(v.confidence))) return { error: "confidence is not a known level" };
  if (typeof v.reasoning !== "string" || v.reasoning.trim().length === 0) return { error: "reasoning is empty" };

  /**
   * A sanity corridor around the observed market.
   *
   * Not a second opinion on the price — a guard against output that has lost
   * contact with the evidence it was given. Half the cheapest offer to twice
   * the dearest is wide enough for any defensible position and narrow enough
   * to catch a misplaced decimal point.
   */
  const floor = Math.round(bounds.minMinor * 0.5);
  const ceiling = Math.round(bounds.maxMinor * 2);
  if (price < floor || price > ceiling) {
    return { error: `recommended price ${price} is outside the plausible corridor ${floor}–${ceiling}` };
  }

  return {
    recommendedPriceMinor: Math.round(price),
    rangeMinMinor: Math.round(lo),
    rangeMaxMinor: Math.round(hi),
    confidence: v.confidence as AIPricingVerdict["confidence"],
    reasoning: v.reasoning.trim().slice(0, 2000),
    warnings: Array.isArray(v.warnings) ? v.warnings.filter((w): w is string => typeof w === "string").slice(0, 10) : [],
  };
}
