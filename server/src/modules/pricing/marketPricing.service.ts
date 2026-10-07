import { sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { AppError } from "../../lib/errors.js";
import { percentile, round } from "../../lib/series.js";
import { FRESHNESS, type MarketSnapshot, type SnapshotService } from "../../ingestion/snapshot.service.js";
import { ProviderError } from "../../ingestion/types.js";
import { AIProviderError, type AIProvider, type PricingEvidence } from "../../ai/index.js";
import { bandAroundAnchor, provisionalAnchor } from "../../lib/marketBand.js";
import { productMatches } from "../../ingestion/relevance.js";

/**
 * PRICING FROM REAL MARKET EVIDENCE
 * =================================
 *
 * The old engine needed competitors drawn from a populated catalogue and a
 * price history to position against. A product tracked ten minutes ago has
 * neither, and refusing on that basis would mean the first recommendation
 * arrives a month after the first capture.
 *
 * But "no history" is not the same as "no evidence". A single capture
 * already contains the thing a price has to be argued against: what every
 * marketplace is charging right now. That is enough for a defensible first
 * answer, and it is real.
 *
 * So evidence is graded rather than required:
 *
 *   COLD START        one capture. Position against the current market.
 *   HISTORY-ENHANCED  captures over time. Position against the market AND
 *                     against where this product has actually traded.
 *
 * The mode is never chosen; it follows from what exists, and a product moves
 * from one to the other on its own as the scheduler accumulates observations.
 * Nothing is backfilled to get there sooner.
 *
 * WHAT IS NOT DONE HERE: inventing history, inferring a trend from one point,
 * or asking a model what something costs. If the current market is also too
 * thin, this refuses and says which part of the evidence was missing.
 */

/** Below this many usable offers, the current market is not a market. */
const MIN_USABLE_OFFERS = 3;
/** Below this many observations, history describes the sampling, not the product. */
const MIN_HISTORY_FOR_ENHANCEMENT = 5;
/** How many per-store rows the AI is shown. The shape, not the whole list. */
const EVIDENCE_OFFER_SAMPLE = 12;

export type RecommendationMode = "cold_start" | "history_enhanced";

export class MarketPricingService {
  constructor(
    private readonly db: Db,
    private readonly snapshots: SnapshotService,
    private readonly ai: AIProvider
  ) {}

  /**
   * A price for a tracked product.
   *
   * Reuses whatever snapshot is already fresh — opening the recommendation
   * right after a search must not buy a second provider call, which is the
   * common path and the one most worth not paying for.
   */
  async recommend(productId: string, opts: { refresh?: boolean } = {}) {
    const product = await this.product(productId);
    if (!product) throw new AppError("NOT_FOUND", `No product with id ${productId}.`);

    if (!product.canonicalQuery) {
      /**
       * A seeded product has no live query behind it, so there is no honest
       * way to price it from current evidence. Refusing is correct: the
       * alternative is pricing from synthetic comparables.
       */
      throw new AppError(
        "VALIDATION_FAILED",
        "This product has no live market query, so it cannot be priced from real evidence. Track it from a live search result first."
      );
    }

    /* ------------------------------------------------- current market */

    let snapshot: MarketSnapshot | null = null;
    let marketError: string | null = null;
    try {
      snapshot = await this.snapshots.snapshotFor(product.canonicalQuery, {
        maxAgeSeconds: opts.refresh ? FRESHNESS.userRefresh() : FRESHNESS.recommendation(),
      });
    } catch (cause) {
      // Recorded, not thrown: stored history may still support an answer.
      marketError = cause instanceof ProviderError ? `${cause.kind}: ${cause.message}` : String(cause);
    }

    const priced = (snapshot?.offers ?? []).filter((o) => o.priceMinor != null && o.priceMinor > 0);

    /**
     * Keep the offers that are describing THIS product.
     *
     * THE SAME RULE THE SEARCH RESULTS ARE RANKED BY. That matters more than
     * it sounds: when identity was decided one way for display and another
     * for pricing, a product could be shown as a phone and priced as a case.
     * `relevance.ts` is now the single definition, so the offers a user sees
     * under a product are the offers its price is argued from.
     *
     * Two layers, in order:
     *
     *   RELEVANCE  semantic — does this title describe the product, or
     *              something sold beside it? Self-calibrating, no accessory
     *              word list, works for any category.
     *
     *   PRICE BAND numeric — a last guard against something that reads like
     *              the product but is priced like a different class of
     *              object, anchored on a price really observed for it.
     *
     * Either alone has a blind spot. Relevance cannot see a mispriced
     * duplicate listing; the band cannot see a premium accessory that costs
     * as much as the product. Together they are the identity rule.
     */
    const relevant = productMatches(product.canonicalQuery, priced.map((o) => ({
      title: o.rawTitle,
      priceMinor: o.priceMinor,
      source: o.sourceName,
      offer: o,
    }))).map((r) => r.offer);

    const anchorMinor =
      (await this.latestObservedPrice(productId)) ?? provisionalAnchor(relevant.map((o) => o.priceMinor!));
    const banded = anchorMinor
      ? bandAroundAnchor(relevant, (o) => o.priceMinor, anchorMinor)
      : { kept: relevant, excluded: [], anchorMinor: 0, loMinor: 0, hiMinor: 0 };

    const usable = banded.kept;
    /** Everything the identity rule rejected, by either layer. */
    const rejected = priced.length - usable.length;
    const prices = usable.map((o) => o.priceMinor!).sort((a, b) => a - b);
    const marketplaces = new Set(usable.map((o) => o.sourceName));

    /* ------------------------------------------------- observed history */

    const history = await this.history(productId);
    const mode: RecommendationMode =
      history && history.observationCount >= MIN_HISTORY_FOR_ENHANCEMENT ? "history_enhanced" : "cold_start";

    /* ------------------------------------------------------ the refusal */

    if (prices.length < MIN_USABLE_OFFERS) {
      return {
        data: {
          productId,
          available: false,
          mode,
          reason: "insufficient_market_evidence",
          /** Which part was missing, rather than a bare refusal. */
          message: marketError
            ? `The market could not be read: ${marketError}`
            : `Only ${prices.length} usable offer(s) were found; at least ${MIN_USABLE_OFFERS} are needed to position a price.`,
          evidence: {
            usableOffers: prices.length,
            excludedAsDifferentProduct: rejected,
            marketplaces: marketplaces.size,
            historyObservations: history?.observationCount ?? 0,
            capturedAt: snapshot?.capturedAt ?? null,
          },
        },
      };
    }

    const market = {
      capturedAt: snapshot!.capturedAt,
      reused: snapshot!.reused,
      offerCount: prices.length,
      marketplaceCount: marketplaces.size,
      minMinor: prices[0]!,
      maxMinor: prices[prices.length - 1]!,
      medianMinor: Math.round(percentile(prices, 0.5)),
      q1Minor: Math.round(percentile(prices, 0.25)),
      q3Minor: Math.round(percentile(prices, 0.75)),
      /**
       * How many offers shared the name but not the price range — cases,
       * skins, bundles. Reported rather than silently dropped, because a
       * large number here means the search query is too broad.
       */
      excludedAsDifferentProduct: rejected,
      anchorMinor: banded.anchorMinor,
    };

    /* ------------------------------------------- the deterministic view */

    const deterministic = this.deterministic(market, history);

    /* -------------------------------------------------- the AI opinion */

    const evidence: PricingEvidence = {
      product: { name: product.canonicalName, brand: product.brandName, category: product.categoryName },
      market: {
        capturedAt: market.capturedAt,
        offerCount: market.offerCount,
        marketplaceCount: market.marketplaceCount,
        minMinor: market.minMinor,
        maxMinor: market.maxMinor,
        medianMinor: market.medianMinor,
        // Cheapest first and trimmed: the AI needs the shape of the market,
        // not forty near-identical rows, and tokens are the cost here.
        offers: usable
          .slice()
          .sort((a, b) => a.priceMinor! - b.priceMinor!)
          .slice(0, EVIDENCE_OFFER_SAMPLE)
          .map((o) => ({
            marketplace: o.sourceName,
            priceMinor: o.priceMinor!,
            shippingFeeMinor: o.shippingFeeMinor,
            mrpMinor: o.mrpMinor,
            rating: o.rating,
            reviewCount: o.reviewCount,
          })),
      },
      history: history && history.observationCount >= 2 ? history : null,
      currency: usable[0]?.currency ?? "INR",
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
        market,
        history,
        warnings: [
          ...(ai?.warnings ?? []),
          ...(mode === "cold_start"
            ? [
                history
                  ? `Only ${history.observationCount} observation(s) so far — fewer than the ${MIN_HISTORY_FOR_ENHANCEMENT} needed before history informs the price. The current market is doing the work.`
                  : "No price history yet. This is positioned against the current market alone.",
              ]
            : []),
          ...(aiError ? [`The AI provider did not answer (${aiError}); this is the deterministic figure.`] : []),
          ...(snapshot!.reused
            ? [`Market last captured ${new Date(market.capturedAt).toISOString()}; reused rather than re-fetched.`]
            : []),
        ],
      },
    };
  }

  /**
   * The statistical position, with no model involved.
   *
   * Deliberately simple and explicable: the median is the market's centre of
   * gravity, and a small undercut is the defensible opening position when
   * nothing is known about brand strength. It exists to be a floor under the
   * answer — if the AI is unavailable or wrong, there is still something
   * defensible, and it can be shown next to the AI's view for comparison.
   */
  private deterministic(
    market: { medianMinor: number; q1Minor: number; q3Minor: number; minMinor: number; maxMinor: number; offerCount: number; marketplaceCount: number },
    history: Awaited<ReturnType<MarketPricingService["history"]>>
  ) {
    // Just under the median: competitive without starting a race to the floor.
    let target = Math.round(market.medianMinor * 0.98);

    const factors: string[] = [
      `Market median ${(market.medianMinor / 100).toFixed(2)} across ${market.offerCount} offer(s) on ${market.marketplaceCount} marketplace(s).`,
      "Positioned 2% under the median — competitive without undercutting the floor.",
    ];

    if (history && history.observationCount >= MIN_HISTORY_FOR_ENHANCEMENT) {
      /**
       * With real history, the current market is weighed against where this
       * product has actually traded — 70/30 toward the present, because the
       * market now is what a buyer sees and history is context for it.
       */
      target = Math.round(target * 0.7 + history.medianMinor * 0.3);
      factors.push(
        `Blended with an observed median of ${(history.medianMinor / 100).toFixed(2)} over ${history.observationCount} observation(s).`
      );
    }

    // Never below the cheapest real offer: the floor is a fact, not a target.
    const floor = market.minMinor;
    if (target < floor) {
      target = floor;
      factors.push("Raised to the cheapest observed offer — recommending below the market floor would not be defensible.");
    }

    /**
     * Confidence follows the breadth of the evidence, not the tidiness of
     * the answer. A narrow spread across two stores is not strong evidence.
     */
    const confidence: "low" | "medium" | "high" =
      market.marketplaceCount >= 4 && (history?.observationCount ?? 0) >= MIN_HISTORY_FOR_ENHANCEMENT
        ? "high"
        : market.marketplaceCount >= 3
          ? "medium"
          : "low";

    return {
      recommendedMinor: target,
      rangeMinMinor: Math.min(market.q1Minor, target),
      rangeMaxMinor: Math.max(market.q3Minor, target),
      confidence,
      factors,
    };
  }

  /**
   * The most recent price this product was really observed at.
   *
   * The anchor the competitive band is drawn around. It exists because the
   * user chose a specific offer when they started tracking, so there is
   * always at least one — and a real observation is a far better anchor than
   * anything inferred from a contaminated search result.
   */
  private async latestObservedPrice(productId: string): Promise<number | null> {
    const rows = (await this.db.execute(sql`
      select po.selling_price_minor as "minor"
        from price_observations po
        join offers   o on o.id = po.offer_id
        join listings l on l.id = o.listing_id
       where l.product_id = ${productId}
       order by po.observed_at desc, po.recorded_at desc
       limit 1
    `)) as unknown as { rows: Array<{ minor: number }> };
    return rows.rows[0]?.minor ?? null;
  }

  private async product(productId: string) {
    const rows = (await this.db.execute(sql`
      select p.id, p.canonical_name as "canonicalName", p.canonical_query as "canonicalQuery",
             p.origin as "origin", b.name as "brandName", c.name as "categoryName"
        from products p
        left join brands b     on b.id = p.brand_id
        left join categories c on c.id = p.category_id
       where p.id = ${productId}
       limit 1
    `)) as unknown as {
      rows: Array<{
        id: string;
        canonicalName: string;
        canonicalQuery: string | null;
        origin: string;
        brandName: string | null;
        categoryName: string | null;
      }>;
    };
    return rows.rows[0] ?? null;
  }

  /**
   * Observed history — only what was really captured.
   *
   * Returns null for a product with nothing recorded. Not a zeroed object: a
   * zero-filled history reads as "we looked and the price was nothing",
   * which is a different and false claim.
   */
  private async history(productId: string) {
    const rows = (await this.db.execute(sql`
      select po.observed_at::text as "date",
             min(po.selling_price_minor + coalesce(po.shipping_fee_minor, 0))::int as "minor"
        from price_observations po
        join offers   o on o.id = po.offer_id
        join listings l on l.id = o.listing_id
       where l.product_id = ${productId}
       group by po.observed_at
       order by po.observed_at asc
    `)) as unknown as { rows: Array<{ date: string; minor: number }> };

    const series = rows.rows;
    if (series.length === 0) return null;

    const values = series.map((p) => p.minor).sort((a, b) => a - b);
    const first = series[0]!;
    const last = series[series.length - 1]!;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;

    return {
      observationCount: series.length,
      firstObservedAt: first.date,
      lastObservedAt: last.date,
      medianMinor: Math.round(percentile(values, 0.5)),
      minMinor: values[0]!,
      maxMinor: values[values.length - 1]!,
      // A single point carries a level, not a movement.
      changePct: series.length >= 2 && first.minor !== 0 ? round(((last.minor - first.minor) / first.minor) * 100, 2) : null,
      // A coefficient of variation over three points describes the sampling.
      volatilityPct: series.length >= MIN_HISTORY_FOR_ENHANCEMENT && mean !== 0 ? round((Math.sqrt(variance) / mean) * 100, 2) : null,
    };
  }
}
