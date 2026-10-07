import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { FRESHNESS, signResultRef, type MarketSnapshot, type SnapshotService } from "../../ingestion/snapshot.service.js";
import { ProviderError } from "../../ingestion/types.js";
import { scoreResults } from "../../ingestion/relevance.js";
import type { DiscoveryRepository } from "./discovery.repository.js";

/**
 * LIVE DISCOVERY
 * ==============
 *
 * Search no longer asks the products table what exists. It asks the market.
 *
 * The old arrangement could only find what had been seeded, so a search for
 * anything else returned nothing while the provider would happily have
 * answered. Products were the INPUT to matching and never its output, which
 * meant the catalogue could not grow from real data at all.
 *
 * Now:
 *
 *   search      →  snapshot of the market  →  results, and NO product
 *   track       →  resolve what they chose →  product, listing, offer,
 *                                             observation, tracking row
 *
 * Searching deliberately creates nothing. A query is a question, not an
 * intention to keep something, and writing a product per search would fill
 * the catalogue with everything anybody ever typed.
 */

export class DiscoveryService {
  constructor(
    private readonly repo: DiscoveryRepository,
    private readonly snapshots: SnapshotService
  ) {}

  /**
   * The market for a query.
   *
   * Reuses a stored capture when one is fresh enough and coalesces concurrent
   * identical searches, so a burst of interest in one product costs one call.
   */
  async search(rawQuery: string, opts: { limit?: number; force?: boolean } = {}) {
    let snapshot: MarketSnapshot;
    try {
      snapshot = await this.snapshots.snapshotFor(rawQuery, {
        maxAgeSeconds: opts.force ? FRESHNESS.userRefresh() : FRESHNESS.search(),
        limit: opts.limit,
      });
    } catch (cause) {
      if (cause instanceof ProviderError) {
        /**
         * A provider failure is reported as one. Never an empty list — a
         * caller that cannot tell "nobody sells this" from "the lookup did
         * not happen" will eventually show the second as the first.
         */
        throw new AppError("MARKET_DATA_UNAVAILABLE", cause.message, {
          details: { provider: cause.provider, kind: cause.kind, retryable: cause.retryable },
        });
      }
      throw cause;
    }

    /**
     * Which of these the catalogue already knows.
     *
     * Only so the interface can say "you are already tracking this" — it is
     * not a filter. A result the database has never seen is exactly what
     * search exists to surface.
     */
    const known = await this.repo.resolveKnownProducts(snapshot.offers.map((o) => o.rawTitle));

    /**
     * Rank by what the user actually asked for.
     *
     * A search for "iphone 18 pro" returns two phones and thirty-eight
     * cases, every one of which contains the searched words. Shown in the
     * provider's order the page is a case catalogue. See `relevance.ts` —
     * the rule reads the shape of the response rather than any list of
     * accessory words, so it holds for laptops and shoes too, and inverts
     * by itself when somebody searches FOR a case.
     */
    const scored = scoreResults(
      snapshot.query,
      snapshot.offers.map((o) => ({ title: o.rawTitle, priceMinor: o.priceMinor, source: o.sourceName, offer: o }))
    ).sort((a, b) => b.score - a.score);

    const shown = scored.filter((r) => r.relevance !== "irrelevant");
    const setAside = scored.length - shown.length;

    return {
      data: {
        query: snapshot.query,
        capturedAt: snapshot.capturedAt,
        /** True when this cost no provider call. */
        reused: snapshot.reused,
        ageSeconds: snapshot.ageSeconds,
        provider: snapshot.provider,
        /** How many the provider returned that were not about this query at all. */
        setAside,
        results: shown.map(({ item: { offer }, relevance, reason }) => ({
          /** Signed, server-resolvable. The browser never supplies product data. */
          ref: signResultRef(snapshot.captureRunId, offer.resultIndex),
          title: offer.rawTitle,
          source: offer.sourceName,
          url: offer.url,
          priceMinor: offer.priceMinor,
          mrpMinor: offer.mrpMinor,
          shippingFeeMinor: offer.shippingFeeMinor,
          currency: offer.currency,
          rating: offer.rating,
          reviewCount: offer.reviewCount,
          inStock: offer.inStock,
          condition: offer.condition,
          deliveryNote: offer.deliveryNote,
          externalId: offer.externalId,
          thumbnailUrl: offer.thumbnailUrl,
          thumbnailUrls: offer.thumbnailUrls,
          /** Set when this already corresponds to something we hold. */
          knownProductId: known.get(offer.rawTitle) ?? null,
          /**
           * "strong" and "plausible" are the product; "accessory" is
           * something sold alongside it. Surfaced so the interface can
           * lead with the former and keep the latter out of the way,
           * rather than being silently dropped — a result set that was
           * mostly accessories is a fact about the query worth seeing.
           */
          relevance,
          relevanceReason: reason,
        })),
      },
    };
  }

  /**
   * Start following a product, from a result the user picked.
   *
   * The reference is resolved against the STORED capture rather than trusted
   * from the request body. What the browser displayed is a copy; the capture
   * is the record. Without this a client could ask to track a product at a
   * price nobody ever offered.
   */
  async track(userId: string, ref: string) {
    const resolved = await this.snapshots.resolveResult(ref);
    if (!resolved) {
      throw new AppError("NOT_FOUND", "That search result could not be resolved. Search again and retry.");
    }

    const { offer, captureRunId, query } = resolved;
    if (offer.priceMinor == null || offer.priceMinor <= 0) {
      throw new AppError("VALIDATION_FAILED", "That result carries no usable price, so there is nothing to track yet.");
    }

    const product = await this.repo.resolveOrCreateProduct({
      title: offer.rawTitle,
      searchQuery: query || offer.rawTitle,
      captureRunId,
    });

    /**
     * The first observation comes from the result they chose, immediately.
     *
     * Waiting for the scheduler would mean a user who just tracked something
     * sees an empty chart for a day, when a real current price was already in
     * hand. It is a genuine observation: captured, timestamped, provenanced.
     */
    await this.repo.recordSelectedOffer({ productId: product.id, offer, captureRunId });

    const tracking = await this.repo.startTracking({
      userId,
      productId: product.id,
      searchQuery: query || offer.rawTitle,
      sourceUrl: offer.url,
    });

    /**
     * Interest is what earns a product a place in the schedule. A product
     * with no followers and no recent views is never captured automatically.
     */
    await this.repo.noteInterest(product.id);

    return { data: { tracking, product: { id: product.id, name: product.canonicalName, created: product.created } } };
  }

  async listTracked(userId: string) {
    return { data: await this.repo.trackedFor(userId) };
  }

  async untrack(userId: string, trackingId: string) {
    const removed = await this.repo.stopTracking(userId, trackingId);
    if (!removed) throw new AppError("NOT_FOUND", "No such tracked product.");
    return { data: { id: trackingId, status: "removed" as const } };
  }

  /** Usage counters, so the cost of all this is measurable. */
  usage() {
    return {
      data: {
        ...this.snapshots.usage,
        searchTtlSeconds: FRESHNESS.search(),
        snapshotTtlSeconds: env.MARKET_DATA_TTL_SECONDS,
        refreshFloorSeconds: FRESHNESS.userRefresh(),
      },
    };
  }
}
