import { sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { env } from "../../config/env.js";
import { ProviderError } from "../../ingestion/types.js";
import type { SnapshotService } from "../../ingestion/snapshot.service.js";
import type { DiscoveryRepository } from "./discovery.repository.js";
import { bandAroundAnchor, provisionalAnchor } from "../../lib/marketBand.js";
import { productMatches } from "../../ingestion/relevance.js";

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
  providerCalls: number;
  notes: string[];
};

export class CaptureScheduler {
  constructor(
    private readonly repo: DiscoveryRepository,
    private readonly snapshots: SnapshotService,
    private readonly db: Db
  ) {}

  /**
   * Products whose market is due a look.
   *
   * Only live products with a query to re-run: a seeded row has no live query
   * behind it and must never cost a call.
   */
  async due(limit: number) {
    const rows = (await this.db.execute(sql`
      select id, canonical_name as "canonicalName", canonical_query as "canonicalQuery",
             tracker_count as "trackerCount", last_interest_at as "lastInterestAt",
             last_captured_at as "lastCapturedAt", next_capture_at as "nextCaptureAt"
        from products
       where origin = 'live'
         and canonical_query is not null
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
        const snapshot = await this.snapshots.snapshotFor(product.canonicalQuery, {
          maxAgeSeconds: opts.maxAgeSeconds,
        });

        /**
         * Every offer that is describing THIS product — not just the
         * cheapest, and not everything the search returned.
         *
         * One capture already contains Amazon, Flipkart and the rest, so
         * recording them all is free, and it is what makes marketplace
         * comparison and a real market median possible later. But a shopping
         * search also returns the cases and skins sold alongside, and writing
         * those as observations would corrupt this product's price history
         * permanently — a phone whose recorded history says it once cost
         * ₹958. The band is anchored on what the product has actually been
         * observed at; see `lib/marketBand.ts`.
         */
        const priced = snapshot.offers.filter((o) => o.priceMinor != null && o.priceMinor > 0);

        /**
         * The same identity rule search and pricing use. A case price written
         * into a phone's history corrupts it permanently — the observation is
         * real, so nothing downstream can tell it was the wrong product.
         */
        const relevant = productMatches(
          product.canonicalQuery,
          priced.map((o) => ({ title: o.rawTitle, priceMinor: o.priceMinor, source: o.sourceName, offer: o }))
        ).map((r) => r.offer);

        const anchor =
          (await this.lastObservedPrice(product.id)) ?? provisionalAnchor(relevant.map((o) => o.priceMinor!));

        const inBand = anchor
          ? bandAroundAnchor(relevant, (o) => o.priceMinor, anchor).kept
          : relevant;

        let written = 0;
        for (const offer of inBand) {
          await this.repo.recordSelectedOffer({
            productId: product.id,
            offer,
            captureRunId: snapshot.captureRunId,
          });
          written++;
        }
        const skipped = priced.length - inBand.length;

        result.observations += written;
        if (snapshot.reused) result.reused++;
        else result.captured++;

        await this.reschedule(product.id, tier.intervalHours, true);
        result.notes.push(
          `${product.id}: ${snapshot.reused ? "reused" : "captured"} ${written} offer(s)` +
            `${skipped > 0 ? `, ${skipped} outside the product band` : ""}, tier ${tier.name}`
        );
      } catch (cause) {
        /**
         * A failed capture writes NO observation and touches nothing already
         * stored. The failure is already recorded as a failed capture run by
         * the snapshot layer; here it only costs the product its next slot,
         * so one unreachable provider does not retry in a tight loop.
         */
        result.failed++;
        const why = cause instanceof ProviderError ? `${cause.kind}: ${cause.message}` : String(cause);
        await this.reschedule(product.id, tier.intervalHours, false);
        result.notes.push(`${product.id}: FAILED — ${why}`);
      }
    }

    result.providerCalls = this.snapshots.usage.providerCalls - before.providerCalls;
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

  /** The newest price this product was really observed at — the band anchor. */
  private async lastObservedPrice(productId: string): Promise<number | null> {
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
