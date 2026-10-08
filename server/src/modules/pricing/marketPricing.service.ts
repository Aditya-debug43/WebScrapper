import { AppError } from "../../lib/errors.js";
import { percentile, round } from "../../lib/series.js";
import { ProviderError } from "../../ingestion/types.js";
import { AIProviderError, type AIProvider, type PricingEvidence } from "../../ai/index.js";
import { positionOf, type CompetitorOffer, type MarketTrend } from "../market/competition.js";
import { MIN_SELLERS_FOR_MARKET, type MarketService } from "../market/market.service.js";
import {
  deterministicPrice,
  MIN_HISTORY_FOR_ENHANCEMENT,
  MIN_USABLE_SELLERS,
} from "./deterministic.js";
import type { MarketRepository } from "../market/market.repository.js";

/**
 * PRICING FROM THE COMPETITION
 * ============================
 *
 * WHAT THIS REPLACED, AND WHY IT HAD TO GO.
 *
 * The previous engine built its "market" by re-running the text search that
 * had found the product, then filtering the results. That is not a market. A
 * shopping search returns one row per CATALOGUE ID — forty rows are forty
 * different products, not forty sellers of one. So the engine was comparing a
 * product against other products that happened to match the same words, and
 * the relevance filter and price band in front of it were damage control on a
 * question that was wrong before it was asked.
 *
 * It now prices against the actual competing SELLERS of the same product:
 * merchants returned by the provider for this product's catalogue ids,
 * deduplicated by merchant id, stored with their own identity and their own
 * price series. The capture that produces them lives in `market.service.ts`;
 * this file only reads and reasons.
 *
 * EVIDENCE IS GRADED, NEVER REQUIRED:
 *
 *   COLD START        one capture. Position against the current sellers.
 *   HISTORY-ENHANCED  several captures. Position against the sellers AND
 *                     against where this product has actually traded.
 *
 * The mode follows from what exists and a product moves between them on its
 * own as the scheduler accumulates captures. Nothing is backfilled to get
 * there sooner, and nothing can be: the data provider supplies no past
 * series, so every historical figure here is one this system observed.
 *
 * WHAT IS NOT DONE HERE: inventing history, inferring a trend from one point,
 * asking a model what something costs, or treating the provider's stated
 * price range as an offer. If the evidence is too thin, this refuses and says
 * which part was missing.
 */

/**
 * The seller floor is shared with the market service rather than restated, so
 * "enough sellers to call it a market" has one definition.
 */
const _assertFloorsAgree: typeof MIN_USABLE_SELLERS = MIN_SELLERS_FOR_MARKET;
void _assertFloorsAgree;
/** How many sellers the AI is shown. The shape, not the whole list. */
const EVIDENCE_SELLER_SAMPLE = 12;

export type RecommendationMode = "cold_start" | "history_enhanced";

export type { DeterministicStructure } from "./deterministic.js";

export class MarketPricingService {
  constructor(
    private readonly repo: MarketRepository,
    private readonly market: MarketService,
    private readonly ai: AIProvider
  ) {}

  /**
   * A price for a product, argued from its competition.
   *
   * Reads stored evidence by default. A capture is bought only when there is
   * nothing stored, or when the caller explicitly asks to refresh — opening
   * this screen must not silently spend provider calls.
   */
  async recommend(productId: string, opts: { refresh?: boolean; yourPriceMinor?: number | null } = {}) {
    const product = await this.repo.productById(productId);
    if (!product) throw new AppError("NOT_FOUND", `No product with id ${productId}.`);

    /**
     * A SEEDED PRODUCT IS NOT PRICED HERE.
     *
     * It has no catalogue identity, so its competition cannot be looked up,
     * and the offers filed against it are the synthetic dataset's. Refusing
     * is the correct answer: the alternative is a confident price argued from
     * invented competitors, which is worse than no price at all.
     *
     * Checked here as well as in the market query that excludes seeded
     * listings, because the two say different things. That filter makes a
     * synthetic competitor impossible; this makes the REASON explicit instead
     * of reporting a real product with a mysteriously empty market.
     */
    if (!product.external_product_id && !product.canonical_query) {
      throw new AppError(
        "VALIDATION_FAILED",
        "This product has no live market query or catalogue identity behind it, so it cannot be priced from real evidence. Track it from a live search result first."
      );
    }

    /* ----------------------------------------- the competition, as stored */

    let captureError: string | null = null;
    let captured = false;

    /**
     * Counted on the market as the analysis will actually read it — the
     * offers of ONE condition, not every offer on file. A product with two
     * new sellers and two refurbished ones has a two-seller market for a
     * new-stock seller, and treating it as four would skip the capture that
     * might have found more real competitors.
     */
    let view = await this.market.marketFor(productId, { yourPriceMinor: opts.yourPriceMinor ?? null });

    const needsCapture = opts.refresh || (view.distribution?.sellerCount ?? 0) < MIN_USABLE_SELLERS;
    if (needsCapture) {
      try {
        await this.market.refreshProduct(productId, {
          force: Boolean(opts.refresh),
          // Behind a request too: a partial market now beats none at all.
          deadlineAt: Date.now() + 20_000,
        });
        view = await this.market.marketFor(productId, { yourPriceMinor: opts.yourPriceMinor ?? null });
        captured = true;
      } catch (cause) {
        /**
         * Recorded, not thrown. Whatever is already stored may still support
         * an answer, and refusing outright because a refresh failed would
         * throw away evidence that is merely a few hours old.
         */
        captureError =
          cause instanceof ProviderError
            ? `${cause.kind}: ${cause.message}`
            : cause instanceof AppError
              ? cause.message
              : String(cause);
      }
    }

    const dist = view.distribution;
    const struct = view.structure;

    /* -------------------------------------------------- observed history */

    const history = await this.observedHistory(productId, view.history.trend);
    const mode: RecommendationMode =
      history && history.observationCount >= MIN_HISTORY_FOR_ENHANCEMENT ? "history_enhanced" : "cold_start";

    /* ------------------------------------------------------- the refusal */

    if (!dist || !struct || dist.sellerCount < MIN_USABLE_SELLERS) {
      return {
        data: {
          productId,
          available: false,
          mode,
          reason: "insufficient_competitive_evidence",
          /** Which part was missing, rather than a bare refusal. */
          message: captureError
            ? `The competing sellers could not be read: ${captureError}`
            : `Only ${dist?.sellerCount ?? 0} competing seller(s) are known for this product; at least ${MIN_USABLE_SELLERS} are needed to position a price against a market.`,
          evidence: {
            sellerCount: dist?.sellerCount ?? 0,
            marketplaceCount: dist?.marketplaceCount ?? 0,
            catalogIdCount: view.product.catalogIdCount,
            historyObservations: history?.observationCount ?? 0,
            lastCapturedAt: view.product.lastCapturedAt ?? null,
          },
        },
      };
    }

    /* ------------------------------------------- the deterministic view */

    const deterministic = deterministicPrice(dist, struct, history);

    /* -------------------------------------------------- the AI opinion */

    const sample = [...view.sellers].sort((a, b) => a.priceMinor - b.priceMinor).slice(0, EVIDENCE_SELLER_SAMPLE);

    const evidence: PricingEvidence = {
      product: {
        name: view.product.name,
        brand: typeof view.product.specifications?.brand === "string" ? view.product.specifications.brand : null,
        category: null,
      },
      market: {
        capturedAt: this.isoOf(view.product.lastCapturedAt),
        offerCount: dist.sellerCount,
        marketplaceCount: dist.marketplaceCount,
        minMinor: dist.lowMinor,
        maxMinor: dist.highMinor,
        medianMinor: dist.medianMinor,
        offers: sample.map((o) => ({
          marketplace: o.marketplaceName,
          seller: o.sellerName,
          priceMinor: o.priceMinor,
          shippingFeeMinor: o.shippingMinor,
          mrpMinor: null,
          rating: o.rating,
          reviewCount: o.reviewCount,
          inStock: o.inStock,
        })),
      },
      competition: {
        floorMinor: struct.floorMinor,
        secondFloorMinor: struct.secondFloorMinor,
        floorGapMinor: struct.floorGapMinor,
        atFloorCount: struct.atFloorCount,
        clustering: struct.clustering,
        spreadPct: dist.spreadPct,
        inStockCount: dist.inStockCount,
      },
      history: history && history.observationCount >= 2 ? history : null,
      currency: "INR",
    };

    let ai: {
      used: boolean;
      provider: string;
      model: string;
      generatedAt: string;
      reasoning: string;
      warnings: string[];
    } | null = null;
    let aiError: string | null = null;
    let recommended = deterministic.recommendedMinor;
    let rangeMin = deterministic.rangeMinMinor;
    let rangeMax = deterministic.rangeMaxMinor;
    let confidence = deterministic.confidence;

    if (this.ai.available) {
      try {
        const verdict = await this.ai.recommend(evidence);
        recommended = verdict.recommendedPriceMinor;
        rangeMin = verdict.rangeMinMinor;
        rangeMax = verdict.rangeMaxMinor;
        confidence = verdict.confidence;
        ai = {
          used: true,
          provider: this.ai.name,
          model: this.ai.model,
          generatedAt: new Date().toISOString(),
          reasoning: verdict.reasoning,
          warnings: verdict.warnings,
        };
      } catch (cause) {
        /**
         * An AI failure never fabricates a recommendation. The deterministic
         * figure stands and is LABELLED as deterministic — presenting it as
         * an AI judgement would misrepresent how it was reached.
         */
        aiError = cause instanceof AIProviderError ? `${cause.kind}: ${cause.message}` : String(cause);
      }
    }

    /** Where the recommendation itself would land among the competition. */
    const resultingPosition = positionOf(recommended, view.sellers);

    return {
      data: {
        productId,
        available: true,
        mode,
        recommendedPriceMinor: recommended,
        rangeMinMinor: rangeMin,
        rangeMaxMinor: rangeMax,
        confidence,
        /** Which method produced the number above. Never blurred. */
        method: ai?.used ? ("ai" as const) : ("deterministic" as const),
        deterministic,
        ai,
        aiError,

        /**
         * THE COMPETITION THE NUMBER WAS ARGUED FROM, in full.
         *
         * Returned with the recommendation rather than behind a second
         * request, because a price without the market it was derived from is
         * an assertion. A seller should be able to see every competitor the
         * figure accounted for.
         */
        market: {
          sellerCount: dist.sellerCount,
          marketplaceCount: dist.marketplaceCount,
          inStockCount: dist.inStockCount,
          catalogIdCount: view.product.catalogIdCount,
          /** Which condition this price was argued for, and what was set aside. */
          condition: view.condition,
          otherConditions: view.otherConditions,
          lowMinor: dist.lowMinor,
          q1Minor: dist.p25Minor,
          medianMinor: dist.medianMinor,
          q3Minor: dist.p75Minor,
          highMinor: dist.highMinor,
          spreadPct: dist.spreadPct,
          lastCapturedAt: view.product.lastCapturedAt ?? null,
          refreshed: captured,
          structure: view.structure,
          sellers: view.sellers,
          marketplaces: view.marketplaces,
        },

        /** Where this recommendation would place the seller. */
        position: resultingPosition,
        /** Where the seller's current price places them, when they gave one. */
        yourPosition: view.position,

        history: {
          ...(history ?? { observationCount: 0 }),
          points: view.history.points,
          trend: view.history.trend,
        },

        warnings: [
          ...(ai?.warnings ?? []),
          ...(mode === "cold_start"
            ? [
                history
                  ? `Only ${history.observationCount} capture(s) so far — fewer than the ${MIN_HISTORY_FOR_ENHANCEMENT} needed before history informs the price. The current competition is doing the work.`
                  : "No price history yet. This is positioned against the current competition alone. The data provider supplies no past prices, so history begins with this system's own captures.",
              ]
            : []),
          ...(history?.comparable === false
            ? ["The number of competing sellers changed materially across the history window, so part of that movement describes coverage rather than price."]
            : []),
          ...(dist.marketplaceCount < 3
            ? [`Only ${dist.marketplaceCount} marketplace(s) are represented, so this is a narrow view of the competition.`]
            : []),
          /**
           * Said out loud, because the figure would otherwise look like it
           * accounted for sellers it deliberately excluded.
           */
          ...view.otherConditions.map(
            (group) =>
              `${group.sellerCount} ${group.condition} offer(s) were excluded from this comparison` +
              `${group.lowMinor != null ? `, from ${(group.lowMinor / 100).toFixed(2)}` : ""}` +
              `. A ${view.condition} listing does not compete with them.`
          ),
          ...(aiError ? [`The AI provider did not answer (${aiError}); this is the deterministic figure.`] : []),
          ...(captureError ? [`A refresh was attempted and failed (${captureError}); this uses the most recent stored capture.`] : []),
        ],
      },
    };
  }

  /**
   * Observed history — only what this system really captured.
   *
   * Built from the per-product market aggregate rather than from individual
   * offers. That is the correction that matters: a median taken across all
   * offers on a day moves when a seller joins or leaves, so a chart drawn
   * from it showed movements no price ever made. The aggregate records the
   * seller count behind each point, so a move can be checked against it.
   *
   * Returns null for a product with nothing recorded. Not a zeroed object: a
   * zero-filled history reads as "we looked and the price was nothing".
   */
  private async observedHistory(productId: string, movement: MarketTrend | null) {
    const points = await this.repo.marketTrendPoints(productId);
    if (points.length === 0) return null;

    const values = points.map((p) => p.medianMinor).sort((a, b) => a - b);
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;

    return {
      observationCount: points.length,
      firstObservedAt: first.capturedOn,
      lastObservedAt: last.capturedOn,
      medianMinor: Math.round(percentile(values, 0.5)),
      minMinor: values[0]!,
      maxMinor: values[values.length - 1]!,
      // A single point carries a level, not a movement.
      changePct: movement?.changePct ?? null,
      // A coefficient of variation over three points describes the sampling.
      volatilityPct:
        points.length >= MIN_HISTORY_FOR_ENHANCEMENT && mean !== 0 ? round((Math.sqrt(variance) / mean) * 100, 2) : null,
      /** Whether the seller population was stable enough to compare across. */
      comparable: movement?.comparable ?? null,
    };
  }

  private isoOf(value: string | Date | null | undefined): string {
    if (!value) return new Date().toISOString();
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}

/** Re-exported for callers that only need the seller shape. */
export type { CompetitorOffer };
