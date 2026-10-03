import { env } from "../config/env.js";
import type { Db } from "../db/client.js";
import { IngestionRepository } from "./ingestion.repository.js";
import { matchProduct, type MatchCandidate } from "./matching.js";
import { createMarketOfferProvider } from "./index.js";
import { ProviderError, type MarketOffer, type MarketOfferProvider } from "./types.js";

/**
 * INGESTION ORCHESTRATION
 * =======================
 *
 * The only place that knows the whole sequence: check freshness, call a
 * provider, keep the raw response, match each offer to a product, write the
 * Listing → Offer → Observation chain, record what could not be used, and
 * close the capture run with an honest status.
 *
 * It holds a `MarketOfferProvider`, never a concrete provider. Nothing in
 * this file mentions SerpApi, and nothing downstream of it could tell which
 * provider the data came from except by reading the `provider` column.
 *
 * ── Two rules it will not bend ───────────────────────────────────────────
 *
 * 1. A PROVIDER FAILURE IS A FAILURE. It is never turned into an empty
 *    result. "No offers found" and "we could not look" produce very
 *    different recommendations, and conflating them would make the system
 *    confidently wrong exactly when it has no information.
 *
 * 2. AN UNMATCHED OFFER IS NOT PERSISTED AS A LISTING. It goes to
 *    `rejected_records` with the matcher's reason. `listings.product_id` is
 *    NOT NULL, so there is no way to file an offer under "probably this" —
 *    which is the schema enforcing the same judgement.
 */

/** Stamped on every row written, so a parser change is traceable afterwards. */
export const PARSER_VERSION = "market-data-v1";

export type IngestionSummary = {
  provider: string;
  query: string;
  captureRunId: string | null;
  status: "success" | "partial" | "failed" | "reused";
  /** Offers the provider returned and the adapter could normalise. */
  offersReceived: number;
  /** Offers matched to a catalogue product with sufficient confidence. */
  offersMatched: number;
  /** Observations actually written (a same-day repeat writes none). */
  observationsWritten: number;
  /** Matched to nothing, or matched too weakly. Recorded, not discarded. */
  offersUnmatched: number;
  /** Results the adapter itself could not read — no title, no price. */
  resultsSkipped: number;
  /** Stores seen that were not among the curated marketplaces. */
  discoveredMarketplaces: string[];
  /**
   * Where the data came from. `cache` means a recent capture of this query
   * was reused and no provider request was made.
   */
  source: "provider" | "cache";
  message: string;
};

/** The port's condition vocabulary to the schema's. */
function toItemCondition(condition: MarketOffer["condition"]): "new" | "renewed" | "used" {
  if (condition === "refurbished") return "renewed";
  if (condition === "used") return "used";
  return "new";
}

export class IngestionService {
  private readonly repo: IngestionRepository;
  private readonly provider: MarketOfferProvider;

  constructor(db: Db, provider: MarketOfferProvider = createMarketOfferProvider()) {
    this.repo = new IngestionRepository(db);
    this.provider = provider;
  }

  /**
   * Fetch and persist current offers for one query.
   *
   * `force` skips the freshness check. It exists because a seller who has
   * just changed their price has a legitimate reason to want a fresh look,
   * and the alternative — waiting out a six-hour TTL with no way to override
   * — makes the cache feel like a fault.
   */
  async ingestQuery(query: string, options: { force?: boolean; limit?: number } = {}): Promise<IngestionSummary> {
    const provider = this.provider.name;
    const trimmed = query.trim();

    const base: IngestionSummary = {
      provider,
      query: trimmed,
      captureRunId: null,
      status: "failed",
      offersReceived: 0,
      offersMatched: 0,
      observationsWritten: 0,
      offersUnmatched: 0,
      resultsSkipped: 0,
      discoveredMarketplaces: [],
      source: "provider",
      message: "",
    };

    /* ----------------------------------------------------------- freshness */

    if (!options.force) {
      const notBefore = new Date(Date.now() - env.MARKET_DATA_TTL_SECONDS * 1000);
      const recent = await this.repo.lastSuccessfulRun(provider, trimmed, notBefore);
      if (recent) {
        const ageMinutes = Math.round((Date.now() - recent.startedAt.getTime()) / 60_000);
        return {
          ...base,
          captureRunId: recent.id,
          status: "reused",
          source: "cache",
          message: `Reused the capture from ${ageMinutes} minute(s) ago; the stored observations are still within the ${Math.round(env.MARKET_DATA_TTL_SECONDS / 3600)}h freshness window. Pass force to fetch again.`,
        };
      }
    }

    /* ------------------------------------------------------- provider call */

    const captureRunId = await this.repo.openRun({ provider, query: trimmed, parserVersion: PARSER_VERSION });

    let batch;
    try {
      batch = await this.provider.search({
        query: trimmed,
        country: env.MARKET_DATA_COUNTRY,
        currency: env.MARKET_DATA_CURRENCY,
        limit: Math.min(options.limit ?? env.MARKET_DATA_MAX_RESULTS, env.MARKET_DATA_MAX_RESULTS),
      });
    } catch (cause) {
      /**
       * Recorded as a failed run and re-thrown. The run row is the durable
       * account of what happened; the exception is how the caller learns it
       * now. Neither is replaced by a fabricated empty result.
       */
      const error = cause instanceof ProviderError ? cause : null;
      const message = error
        ? `${error.kind}${error.status ? ` ${error.status}` : ""}: ${error.message}${error.retryable ? " (retryable)" : ""}`
        : `Unexpected: ${(cause as Error).message}`;
      await this.repo.closeRun(captureRunId, { runStatus: "failed", pagesSucceeded: 0, notes: message });
      throw cause;
    }

    /* ------------------------------------------------------------ persist */

    const rawDocumentId = await this.repo.recordRawDocument({
      captureRunId,
      sourceUrl: batch.requestUrl,
      body: batch.raw,
      fetchedAt: new Date(batch.fetchedAt),
    });

    // Results the adapter could not read at all — kept with their reason so
    // a provider changing its response shape is visible rather than gradual.
    for (const skip of batch.skipped) {
      await this.repo.recordRejection({
        rawDocumentId,
        targetEntity: "market_offer",
        reason: `Unreadable result: ${skip.reason}`,
      });
    }

    const candidates: MatchCandidate[] = await this.repo.loadMatchCandidates();
    const observedOn = new Date(batch.fetchedAt).toISOString().slice(0, 10);

    let matched = 0;
    let unmatched = 0;
    let written = 0;
    const discovered = new Set<string>();

    for (const offer of batch.offers) {
      const verdict = matchProduct(offer.rawTitle, candidates);

      if (verdict.status === "unmatched") {
        unmatched += 1;
        await this.repo.recordRejection({
          rawDocumentId,
          targetEntity: "listing",
          reason: `${offer.sourceName} — "${offer.rawTitle}": ${verdict.reason}`,
        });
        continue;
      }

      if (offer.priceMinor == null) {
        unmatched += 1;
        await this.repo.recordRejection({
          rawDocumentId,
          targetEntity: "price_observation",
          reason: `${offer.sourceName} — "${offer.rawTitle}": matched ${verdict.productId} but carried no usable price.`,
        });
        continue;
      }

      const marketplace = await this.repo.resolveMarketplace(offer.sourceName);
      if (marketplace.isDiscovered) discovered.add(marketplace.name);

      const sellerId = await this.repo.resolveStorefrontSeller(marketplace.id, marketplace.name);

      const listingId = await this.repo.upsertListing({
        productId: verdict.productId,
        marketplaceId: marketplace.id,
        externalListingId: offer.externalId,
        url: offer.url,
        rawTitle: offer.rawTitle,
        matchConfidence: verdict.confidence,
        observedOn,
      });

      /**
       * The provider's external id already belongs to a different product on
       * this marketplace. Recorded rather than resolved: either the match is
       * wrong or the stored listing is, and a pipeline guessing which would
       * be overwriting real data on a hunch.
       */
      if (listingId === null) {
        unmatched += 1;
        await this.repo.recordRejection({
          rawDocumentId,
          targetEntity: "listing",
          reason: `${offer.sourceName} — "${offer.rawTitle}": matched ${verdict.productId}, but external id ${offer.externalId ?? "(derived)"} is already held by another product on ${marketplace.name}.`,
        });
        continue;
      }

      const offerId = await this.repo.upsertOffer({
        listingId,
        sellerId,
        condition: toItemCondition(offer.condition),
        observedOn,
      });

      /**
       * Two columns the schema requires and the source does not always give.
       *
       * `is_in_stock` is NOT NULL. A priced result in a shopping feed is a
       * purchasable offer — that is what the feed is for — so an unstated
       * value reads as true, while an explicit out-of-stock marker is
       * honoured as false by the adapter. `shipping_fee_minor` is NOT NULL
       * DEFAULT 0, and an unstated delivery charge reads as zero.
       *
       * Both are coercions, and neither is hidden: the coverage figures
       * below count how often each field was actually stated, which is what
       * `field_coverage` exists to express. A reader comparing landed prices
       * can see how much of the shipping data was real.
       */
      const didWrite = await this.repo.recordObservation({
        offerId,
        observedOn,
        mrpMinor: offer.mrpMinor,
        sellingPriceMinor: offer.priceMinor,
        shippingFeeMinor: offer.shippingFeeMinor ?? 0,
        currencyCode: offer.currency,
        isInStock: offer.inStock ?? true,
        rawDocumentId,
        parserVersion: PARSER_VERSION,
      });

      matched += 1;
      if (didWrite) written += 1;
    }

    /* --------------------------------------------------------- close out */

    const received = batch.offers.length;
    /**
     * `partial` is not a soft failure, it is an accurate one: the provider
     * answered, some of what it sent was usable, some was not. Reporting that
     * as `success` would make the rejects table the only place the shortfall
     * appears, and nobody reads a table they have no reason to open.
     */
    const status: "success" | "partial" | "failed" =
      received === 0 ? "partial" : unmatched > 0 || batch.skipped.length > 0 ? "partial" : "success";

    const coverage = {
      shipping: received ? batch.offers.filter((o) => o.shippingFeeMinor != null).length / received : 0,
      stock: received ? batch.offers.filter((o) => o.inStock != null).length / received : 0,
      mrp: received ? batch.offers.filter((o) => o.mrpMinor != null).length / received : 0,
    };

    const notes = [
      `received ${received}`,
      `matched ${matched}`,
      `observations ${written}`,
      `unmatched ${unmatched}`,
      `unreadable ${batch.skipped.length}`,
      `coverage shipping ${(coverage.shipping * 100).toFixed(0)}% stock ${(coverage.stock * 100).toFixed(0)}% mrp ${(coverage.mrp * 100).toFixed(0)}%`,
      discovered.size ? `discovered stores: ${[...discovered].join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");

    await this.repo.closeRun(captureRunId, { runStatus: status, pagesSucceeded: 1, notes });

    return {
      ...base,
      captureRunId,
      status,
      offersReceived: received,
      offersMatched: matched,
      observationsWritten: written,
      offersUnmatched: unmatched,
      resultsSkipped: batch.skipped.length,
      discoveredMarketplaces: [...discovered],
      source: "provider",
      message: notes,
    };
  }
}
