import type { SourcesRepository } from "./sources.repository.js";

/**
 * DATA SOURCES
 *
 * The screen that says whether the rest of the app can be trusted, so it is
 * the one screen that must not be furnished from a bundled array. Until now it
 * was: the frontend listed six marketplaces and described captures that the
 * database had no record of, which meant it could not report a source that had
 * never run, and could not show one that had arrived from a provider.
 *
 * Everything here is read from what the ingestion layer actually wrote.
 */

/** A capture is called stale once it is older than this. */
const STALE_AFTER_HOURS = 48;

export type SourcesOverview = Awaited<ReturnType<SourcesService["overview"]>>;

export class SourcesService {
  constructor(private readonly repo: SourcesRepository) {}

  async overview(options: { runLimit: number; rejectionLimit: number }) {
    const [marketplaceRows, coverageRows, recentRuns, recentRejections, totals] = await Promise.all([
      this.repo.perMarketplace(),
      this.repo.fieldCoverage(),
      this.repo.recentRuns(options.runLimit),
      this.repo.recentRejections(options.rejectionLimit),
      this.repo.totals(),
    ]);

    const coverageByMarketplace = new Map<string, { field: string; coveragePct: number }[]>();
    for (const row of coverageRows) {
      const list = coverageByMarketplace.get(row.marketplaceId) ?? [];
      list.push({ field: row.field, coveragePct: row.coveragePct });
      coverageByMarketplace.set(row.marketplaceId, list);
    }

    /**
     * Freshness is measured against the newest capture in the system, not the
     * wall clock.
     *
     * The same anchoring rule the price views use: a dataset loaded last month
     * is not "all sources are two weeks stale", it is a dataset whose captures
     * ended when they ended. Comparing to now would paint every source red on
     * a fixture database and say nothing about the sources.
     */
    const newestCapture = marketplaceRows
      .map((m) => m.lastRunFinishedAt ?? m.lastRunStartedAt)
      .filter((d): d is string => d != null)
      .sort()
      .at(-1);

    const perMarketplace = marketplaceRows.map((m) => {
      const lastCapture = m.lastRunFinishedAt ?? m.lastRunStartedAt;
      return {
        marketplace: {
          id: m.marketplaceId,
          name: m.marketplaceName,
          websiteDomain: m.websiteDomain,
          marketplaceType: m.marketplaceType,
          brandColor: m.brandColor,
          isDiscovered: m.isDiscovered,
          isActive: m.isActive,
        },
        /**
         * Null where this platform has never been the subject of a run.
         *
         * A discovered store is the normal case: its rows arrived inside
         * another platform's provider response, so there is no run addressed
         * to it. The screen says "never captured directly" rather than
         * inventing a run, and `lastObservedAt` still shows its data is real.
         */
        latestRun:
          m.lastRunId == null
            ? null
            : {
                id: m.lastRunId,
                runStatus: m.lastRunStatus,
                startedAt: m.lastRunStartedAt,
                finishedAt: m.lastRunFinishedAt,
                provider: m.lastRunProvider,
                pagesAttempted: m.lastRunPagesAttempted,
                pagesSucceeded: m.lastRunPagesSucceeded,
                notes: m.lastRunNotes,
              },
        coverage: coverageByMarketplace.get(m.marketplaceId) ?? [],
        listingCount: m.listingCount,
        /**
         * Null, not zero, when nothing is matched.
         *
         * An average over no listings is undefined. Reporting 0% would say
         * "every match here is wrong", which is a far stronger and quite
         * different claim than "there is nothing to assess".
         */
        avgMatchConfidence: m.avgMatchConfidence == null ? null : round(m.avgMatchConfidence, 4),
        humanConfirmed: m.humanConfirmed,
        autoMatched: m.autoMatched,
        lastObservedAt: m.lastObservedAt,
        isStale:
          lastCapture == null || newestCapture == null
            ? null
            : hoursBetween(lastCapture, newestCapture) > STALE_AFTER_HOURS,
      };
    });

    return {
      data: {
        perMarketplace,
        recentRuns,
        recentRejections,
        totals: {
          ...totals,
          marketplaces: marketplaceRows.length,
          /** How many of the listed platforms have ever actually been captured. */
          marketplacesCaptured: marketplaceRows.filter((m) => m.lastRunId != null).length,
          marketplacesDiscovered: marketplaceRows.filter((m) => m.isDiscovered).length,
          newestCapture: newestCapture ?? null,
          staleAfterHours: STALE_AFTER_HOURS,
        },
      },
    };
  }
}

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

const hoursBetween = (earlier: string, later: string) =>
  (new Date(later).getTime() - new Date(earlier).getTime()) / 3_600_000;
