import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import type { Db } from "../db/client.js";
import { IngestionRepository } from "./ingestion.repository.js";
import { createMarketOfferProvider } from "./index.js";
import { normalizeQuery, isUsableQuery } from "./queryKey.js";
import { ProviderError, type MarketOffer, type MarketOfferProvider } from "./types.js";

/**
 * MARKET SNAPSHOTS — one capture, many readers
 * ============================================
 *
 * The single idea this whole file exists for:
 *
 *   A successful provider call is a REUSABLE MARKET SNAPSHOT.
 *
 * A Google Shopping response for "iPhone 17 256GB" already contains Amazon,
 * Flipkart, Croma and everyone else. That one response answers the market
 * question for every screen and every user at once. Nothing about it belongs
 * to the person who happened to trigger it.
 *
 * So snapshots are keyed by the NORMALISED QUERY, never by user, and every
 * caller — search, the product page, the dashboard, the recommendation, the
 * scheduler — comes through `snapshotFor()`. Four screens opened in a row
 * cost one call; a hundred users following one phone cost one call.
 *
 * Three layers of saving, cheapest first:
 *
 *   1. FRESHNESS.  A stored snapshot inside its TTL is returned as-is. No
 *      network, no cost. Callers state how fresh they need it, because a
 *      recommendation and a background sweep do not have the same standard.
 *
 *   2. COALESCING.  Ten people opening the same product in the same second
 *      share one in-flight request. Without this, freshness alone does not
 *      help: every one of them misses the cache, because none has returned
 *      yet to populate it.
 *
 *   3. NORMALISATION.  "iphone 17 256gb" and "iPhone 17 256 GB" resolve to
 *      one key, so trivially different spellings do not each buy a call.
 *
 * What this does NOT do is decide what a result MEANS. It fetches, persists
 * and hands back offers. Matching them to a product, creating one, or writing
 * observations are separate concerns with separate failure modes.
 */

/** How fresh a caller needs the market to be. Seconds. */
export const FRESHNESS = {
  /**
   * Typing a search is an explicit request for the current market, but a
   * second identical search moments later is not. Short, not zero.
   */
  search: () => env.MARKET_DATA_SEARCH_TTL_SECONDS,
  /** Opening a product right after searching must not buy a second call. */
  productPage: () => env.MARKET_DATA_TTL_SECONDS,
  /** A price recommendation may reuse whatever the page already fetched. */
  recommendation: () => env.MARKET_DATA_TTL_SECONDS,
  /** A background sweep is never urgent; anything from today will do. */
  scheduled: () => env.MARKET_DATA_TTL_SECONDS,
  /** A deliberate "refresh prices" press, floored so it cannot be spammed. */
  userRefresh: () => env.MARKET_DATA_REFRESH_FLOOR_SECONDS,
} as const;

export type SnapshotOffer = MarketOffer & {
  /**
   * Where this offer sits in the stored response.
   *
   * Half of the reference a client hands back when it wants to track a
   * result. The other half is the run id — together they let the server
   * re-read exactly what the user was shown instead of trusting a browser's
   * account of it.
   */
  resultIndex: number;
};

export type MarketSnapshot = {
  captureRunId: string;
  rawDocumentId: string | null;
  query: string;
  normalizedQuery: string;
  provider: string;
  capturedAt: string;
  /** True when this cost nothing — served from a stored capture. */
  reused: boolean;
  ageSeconds: number;
  offers: SnapshotOffer[];
};

/**
 * A result reference the server can verify.
 *
 * `{runId, index}` alone would let anyone address any row of any capture by
 * guessing, so it is signed with the server's existing secret. Not secrecy —
 * the contents are not sensitive — but integrity: the server will only act on
 * a reference it issued.
 */
export type ResultRef = string;

export function signResultRef(captureRunId: string, resultIndex: number): ResultRef {
  const payload = `${captureRunId}:${resultIndex}`;
  const mac = createHmac("sha256", env.AUTH_SECRET).update(payload).digest("base64url").slice(0, 24);
  return `${Buffer.from(payload).toString("base64url")}.${mac}`;
}

export function verifyResultRef(ref: ResultRef): { captureRunId: string; resultIndex: number } | null {
  const [encoded, mac] = ref.split(".");
  if (!encoded || !mac) return null;

  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expected = createHmac("sha256", env.AUTH_SECRET).update(payload).digest("base64url").slice(0, 24);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const sep = payload.lastIndexOf(":");
  const captureRunId = payload.slice(0, sep);
  const resultIndex = Number(payload.slice(sep + 1));
  if (!captureRunId || !Number.isInteger(resultIndex) || resultIndex < 0) return null;
  return { captureRunId, resultIndex };
}

export class SnapshotService {
  private readonly repo: IngestionRepository;
  private readonly provider: MarketOfferProvider;

  /**
   * Requests currently in flight, by normalised query.
   *
   * An in-memory map is the right scope for a single-process deployment and
   * is deliberately not disguised as something more: it coalesces within one
   * process and claims nothing about a second one. Moving to several
   * processes means replacing this with a shared lock, which is why every
   * caller goes through `snapshotFor` rather than reaching for the provider.
   */
  private readonly inFlight = new Map<string, Promise<MarketSnapshot>>();

  constructor(db: Db, provider?: MarketOfferProvider) {
    this.repo = new IngestionRepository(db);
    this.provider = provider ?? createMarketOfferProvider();
  }

  /** Usage counters, so cost is measurable before it is enforced. */
  readonly usage = { providerCalls: 0, reused: 0, coalesced: 0 };

  /**
   * The market for a query, fetching only if nothing fresh enough is stored.
   *
   * `maxAgeSeconds` is the caller's standard, not a global constant — that is
   * what lets a recommendation reuse what a search just fetched while a
   * deliberate refresh insists on something newer.
   */
  async snapshotFor(
    rawQuery: string,
    opts: { maxAgeSeconds: number; limit?: number; force?: boolean } = { maxAgeSeconds: env.MARKET_DATA_TTL_SECONDS }
  ): Promise<MarketSnapshot> {
    const query = rawQuery.trim();
    if (!isUsableQuery(query)) {
      throw new AppError("VALIDATION_FAILED", `Query too short to search: "${rawQuery}".`);
    }
    const key = normalizeQuery(query);

    if (!opts.force) {
      const stored = await this.storedSnapshot(key, opts.maxAgeSeconds);
      if (stored) {
        this.usage.reused++;
        return stored;
      }
    }

    /**
     * Join an identical request already running rather than starting a second.
     *
     * This is the case freshness cannot help with: concurrent callers all miss
     * the stored snapshot because none of them has finished writing one yet.
     */
    const running = this.inFlight.get(key);
    if (running) {
      this.usage.coalesced++;
      return running;
    }

    const work = this.capture(query, key, opts.limit).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, work);
    return work;
  }

  /** A stored capture, re-read from its persisted body. No network. */
  private async storedSnapshot(normalized: string, maxAgeSeconds: number): Promise<MarketSnapshot | null> {
    const notBefore = new Date(Date.now() - maxAgeSeconds * 1000);
    const run = await this.repo.lastSuccessfulRunByKey(this.provider.name, normalized, notBefore);
    if (!run?.body) return null;

    /**
     * Re-normalised through the PRODUCTION parser rather than from stored
     * normalised rows. A parser improved since the capture then applies to
     * old snapshots too, which is the entire reason the body is kept.
     */
    const { normaliseSerpResponse } = await import("./providers/serpapi.provider.js");
    let offers: MarketOffer[];
    try {
      const batch = normaliseSerpResponse(
        run.body,
        run.sourceQuery ?? normalized,
        run.sourceUrl ?? "",
        env.MARKET_DATA_CURRENCY,
        this.provider.name
      );
      offers = batch.offers;
    } catch {
      // A body we can no longer read is not a usable snapshot. Fetch instead
      // of serving nothing and calling it the market.
      return null;
    }

    const capturedAt = (run.finishedAt ?? run.startedAt).toISOString();
    return {
      captureRunId: run.id,
      rawDocumentId: run.rawDocumentId,
      query: run.sourceQuery ?? normalized,
      normalizedQuery: normalized,
      provider: this.provider.name,
      capturedAt,
      reused: true,
      ageSeconds: Math.round((Date.now() - new Date(capturedAt).getTime()) / 1000),
      /**
       * `observedAt` is overwritten with the ORIGINAL capture time.
       *
       * The parser stamps "now" when it runs, which is correct for a live
       * fetch and a lie for a re-read: these offers were seen when the
       * capture happened, not when somebody asked about it again. Left
       * alone, a six-hour-old snapshot would write observations dated today
       * and quietly corrupt the price history it feeds.
       */
      offers: offers.map((o, resultIndex) => ({ ...o, observedAt: capturedAt, resultIndex })),
    };
  }

  /** One real provider call, fully recorded. */
  private async capture(query: string, normalized: string, limit?: number): Promise<MarketSnapshot> {
    const captureRunId = await this.repo.openRun({
      provider: this.provider.name,
      query,
      normalizedQuery: normalized,
      parserVersion: PARSER_VERSION,
    });

    let batch;
    try {
      this.usage.providerCalls++;
      batch = await this.provider.search({
        query,
        country: env.MARKET_DATA_COUNTRY,
        currency: env.MARKET_DATA_CURRENCY,
        limit: Math.min(limit ?? env.MARKET_DATA_MAX_RESULTS, env.MARKET_DATA_MAX_RESULTS),
      });
    } catch (cause) {
      /**
       * A failed call is recorded as a failed run and re-thrown.
       *
       * No observation is written, and nothing already stored is touched. A
       * provider outage must leave yesterday's history exactly as it was.
       */
      const error = cause instanceof ProviderError ? cause : null;
      const note = error
        ? `${error.kind}${error.status ? ` ${error.status}` : ""}: ${error.message}${error.retryable ? " (retryable)" : ""}`
        : `Unexpected: ${(cause as Error).message}`;
      await this.repo.closeRun(captureRunId, { runStatus: "failed", pagesSucceeded: 0, notes: note });
      throw cause;
    }

    const rawDocumentId = await this.repo.recordRawDocument({
      captureRunId,
      sourceUrl: batch.requestUrl,
      body: batch.raw,
      fetchedAt: new Date(batch.fetchedAt),
    });

    for (const skip of batch.skipped) {
      await this.repo.recordRejection({
        rawDocumentId,
        targetEntity: "market_offer",
        reason: `Unreadable result: ${skip.reason}`,
      });
    }

    await this.repo.closeRun(captureRunId, {
      runStatus: batch.offers.length > 0 ? "success" : "partial",
      pagesSucceeded: 1,
      notes: `received ${batch.offers.length + batch.skipped.length}; readable ${batch.offers.length}; unreadable ${batch.skipped.length}`,
    });

    return {
      captureRunId,
      rawDocumentId,
      query,
      normalizedQuery: normalized,
      provider: this.provider.name,
      capturedAt: batch.fetchedAt,
      reused: false,
      ageSeconds: 0,
      offers: batch.offers.map((o, resultIndex) => ({ ...o, resultIndex })),
    };
  }

  /**
   * The exact offer a user selected, re-read from the stored capture — AND
   * the rest of that capture alongside it.
   *
   * The browser sends a signed reference, never the product data itself. What
   * it displays is a copy; this is the record. Resolving from storage is what
   * stops a client inventing a cheap price and asking for it to be tracked.
   *
   * The siblings are returned because identifying a product is only half the
   * work: the same product is published under several catalogue ids, each
   * exposing different sellers, and they can only be clustered against one
   * another from the same capture. Re-searching to find them would cost a
   * second call and could return a different set of rows.
   */
  async resolveResult(
    ref: ResultRef
  ): Promise<{ offer: SnapshotOffer; snapshotOffers: SnapshotOffer[]; captureRunId: string; query: string } | null> {
    const parsed = verifyResultRef(ref);
    if (!parsed) return null;

    const run = await this.repo.runWithBody(parsed.captureRunId);
    if (!run?.body) return null;

    const { normaliseSerpResponse } = await import("./providers/serpapi.provider.js");
    const batch = normaliseSerpResponse(
      run.body,
      run.sourceQuery ?? "",
      run.sourceUrl ?? "",
      env.MARKET_DATA_CURRENCY,
      this.provider.name
    );

    const offer = batch.offers[parsed.resultIndex];
    if (!offer) return null;
    return {
      offer: { ...offer, resultIndex: parsed.resultIndex },
      snapshotOffers: batch.offers.map((o, resultIndex) => ({ ...o, resultIndex })),
      captureRunId: parsed.captureRunId,
      query: run.sourceQuery ?? "",
    };
  }
}

/** Re-exported so callers do not import the ingestion service for one constant. */
export { PARSER_VERSION } from "./ingestion.service.js";
import { PARSER_VERSION } from "./ingestion.service.js";
