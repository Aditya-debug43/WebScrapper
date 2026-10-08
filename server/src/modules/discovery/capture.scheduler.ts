import { sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { ProviderError } from "../../ingestion/types.js";
import type { SnapshotService } from "../../ingestion/snapshot.service.js";
import type { MarketService } from "../market/market.service.js";

/**
 * ADAPTIVE CAPTURE
 * ================
 *
 * Which products are worth a provider call today, and which are not.
 *
 * The rejected design was "every tracked product once per day". It sounds
 * fair and scales badly: it spends the same on a product forty people watch
 * and one somebody tracked in March and forgot, and its cost grows with the
 * catalogue rather than with interest.
 *
 * So capture frequency follows DEMAND, on a deliberately simple and
 * deterministic ladder:
 *
 *   followers ≥ 5 or seen today     →  every  6h   keen interest
 *   followers ≥ 1                   →  every 24h   somebody is watching
 *   seen in the last week           →  every 72h   browsed, not followed
 *   none of the above               →  never       nobody is interested
 *
 * The last row is the one that matters. Most of a catalogue is cold at any
 * moment, and not calling about it is the single biggest saving available —
 * larger than caching, larger than coalescing.
 *
 * Deterministic on purpose: the interval is a pure function of recorded
 * demand, so two runs over the same data choose the same products and a test
 * can assert the choice. Tuning the ladder is editing this table; it does not
 * need a new scheduler.
 */

export type CaptureTier = { name: string; intervalHours: number };

export const CAPTURE_TIERS = {
  keen: { name: "keen", intervalHours: 6 },
  followed: { name: "followed", intervalHours: 24 },
  browsed: { name: "browsed", intervalHours: 72 },
  cold: { name: "cold", intervalHours: 0 },
} as const satisfies Record<string, CaptureTier>;

/** The ladder, as a pure function so it can be tested without a database. */
export function tierFor(input: {
  trackerCount: number;
  lastInterestAt: Date | null;
  now?: Date;
}): CaptureTier {
  const now = input.now ?? new Date();
  const hoursSinceInterest =
    input.lastInterestAt == null ? Infinity : (now.getTime() - input.lastInterestAt.getTime()) / 3_600_000;

  if (input.trackerCount >= 5 || (input.trackerCount >= 1 && hoursSinceInterest <= 24)) return CAPTURE_TIERS.keen;
  if (input.trackerCount >= 1) return CAPTURE_TIERS.followed;
  if (hoursSinceInterest <= 24 * 7) return CAPTURE_TIERS.browsed;
  return CAPTURE_TIERS.cold;
}

export type SweepResult = {
  due: number;
  captured: number;
  reused: number;
  failed: number;
  observations: number;
  /** Distinct competing sellers written across the sweep. */
  sellers: number;
  providerCalls: number;
  notes: string[];
};

export class CaptureScheduler {
  constructor(
    private readonly market: MarketService,
    private readonly snapshots: SnapshotService,
    private readonly db: Db
  ) {}

  /**
   * Products whose market is due a look.
   *
   * Only live products this system can actually re-open: one with a catalogue
   * id can have its sellers re-read directly, and one with only a query can
   * be re-identified first. A seeded row has neither and must never cost a
   * call.
   */
  async due(limit: number) {
    const rows = (await this.db.execute(sql`
      select id, canonical_name as "canonicalName", canonical_query as "canonicalQuery",
             tracker_count as "trackerCount", last_interest_at as "lastInterestAt",
             last_captured_at as "lastCapturedAt", next_capture_at as "nextCaptureAt"
        from products
       where origin = 'live'
         and (canonical_query is not null or external_product_id is not null)
         and next_capture_at is not null
         and next_capture_at <= now()
       order by tracker_count desc, next_capture_at asc
       limit ${limit}
    `)) as unknown as {
      rows: Array<{
        id: string;
        canonicalName: string;
        canonicalQuery: string;
        trackerCount: number;
        lastInterestAt: string | Date | null;
        lastCapturedAt: string | Date | null;
        nextCaptureAt: string | Date | null;
      }>;
    };

    /**
     * Timestamps arrive as STRINGS from raw SQL.
     *
     * A typed Drizzle select converts them; `db.execute` hands back whatever
     * the driver produced. Left alone, `tierFor` called `.getTime()` on a
     * string and the whole sweep threw on its first product — so the
     * conversion happens here, at the boundary, and `tierFor` goes on taking
     * real Dates.
     */
    const toDate = (v: string | Date | null) => (v == null ? null : v instanceof Date ? v : new Date(v));
    return rows.rows.map((row) => ({
      ...row,
      lastInterestAt: toDate(row.lastInterestAt),
      lastCapturedAt: toDate(row.lastCapturedAt),
      nextCaptureAt: toDate(row.nextCaptureAt),
    }));
  }

  async sweep(opts: { limit: number; maxAgeSeconds: number }): Promise<SweepResult> {
    const before = { ...this.snapshots.usage };
    const result: SweepResult = {
      due: 0,
      captured: 0,
      reused: 0,
      failed: 0,
      observations: 0,
      sellers: 0,
      providerCalls: 0,
      notes: [],
    };

    const products = await this.due(opts.limit);
    result.due = products.length;

    for (const product of products) {
      const tier = tierFor({ trackerCount: product.trackerCount, lastInterestAt: product.lastInterestAt });

      /**
       * Interest has lapsed. The product leaves the schedule rather than
       * being captured one more time — and comes back the moment somebody
       * follows or opens it, because both record interest.
       */
      if (tier.intervalHours === 0) {
        await this.db.execute(sql`update products set next_capture_at = null where id = ${product.id}`);
        result.notes.push(`${product.id}: no current interest, unscheduled`);
        continue;
      }

      try {
        /**
         * RE-OPEN THE PRODUCT'S MARKET, rather than re-running its search.
         *
         * This is the correction that matters most in this file, because the
         * previous version wrote the wrong rows into a place nothing
         * downstream could question them. It re-ran the text search, filtered
         * the results for relevance and price, and recorded whatever survived
         * as observations OF THIS PRODUCT. But a shopping search returns one
         * row per catalogue id — forty rows are forty different products. So
         * a neighbouring variant that passed both filters became a price this
         * product was "observed" at, and once written, nothing could tell it
         * apart from a real one: the observation was genuine, it was simply
         * about something else.
         *
         * Re-opening the market cannot make that mistake. The sellers come
         * back from the provider's own catalogue entry for this product, so
         * they are its sellers by the provider's definition rather than by a
         * similarity judgement of ours. The relevance and price-band filters
         * that used to guard this path are no longer needed here — they were
         * compensating for the wrong question.
         *
         * It is also cheaper per product in the common case. A product whose
         * catalogue ids are already clustered is refreshed without a search
         * call at all.
         */
        const capture = await this.market.refreshProduct(product.id);

        result.observations += capture.persisted.observationsWritten;
        result.sellers += capture.persisted.sellersWritten;
        result.providerCalls += capture.providerCalls;
        if (capture.providerCalls === 0) result.reused++;
        else result.captured++;

        await this.reschedule(product.id, tier.intervalHours, true);
        result.notes.push(
          `${product.id}: ${capture.persisted.sellersWritten} seller(s) across ` +
            `${capture.persisted.marketplacesWritten} marketplace(s) from ${capture.catalogIds.length} catalogue id(s), ` +
            `${capture.providerCalls} provider call(s), tier ${tier.name}`
        );
      } catch (cause) {
        /**
         * A failed capture writes NO observation and touches nothing already
         * stored. The failure is already recorded as a failed capture run by
         * the snapshot layer; here it only costs the product its next slot,
         * so one unreachable provider does not retry in a tight loop.
         */
        result.failed++;
        const why =
          cause instanceof ProviderError
            ? `${cause.kind}: ${cause.message}`
            : cause instanceof AppError
              ? cause.message
              : String(cause);
        await this.reschedule(product.id, tier.intervalHours, false);
        result.notes.push(`${product.id}: FAILED — ${why}`);
      }
    }

    /**
     * Both endpoints. The search half comes from the snapshot counters; the
     * product half is returned by each capture, because a sweep that reported
     * only its searches would understate what it spent several times over.
     */
    result.providerCalls += this.snapshots.usage.providerCalls - before.providerCalls;
    return result;
  }

  /**
   * `last_captured_at` moves only on success, so a run of failures does not
   * make a product look freshly captured.
   */
  private async reschedule(productId: string, intervalHours: number, succeeded: boolean) {
    await this.db.execute(sql`
      update products
         set capture_interval_hours = ${intervalHours},
             last_captured_at = ${succeeded ? sql`now()` : sql`last_captured_at`},
             next_capture_at = now() + (${intervalHours} || ' hours')::interval
       where id = ${productId}
    `);
  }

  /** Prune full response bodies past the retention window, keeping the hashes. */
  async pruneBodies(): Promise<number> {
    const result = (await this.db.execute(sql`
      update raw_documents
         set body = null
       where body is not null
         and fetched_at < now() - (${env.MARKET_DATA_BODY_RETENTION_DAYS} || ' days')::interval
    `)) as unknown as { rowCount?: number };
    return result.rowCount ?? 0;
  }
}
