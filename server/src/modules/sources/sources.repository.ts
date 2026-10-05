import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { PARSER_VERSION } from "../../ingestion/ingestion.service.js";

/**
 * PROVENANCE READS
 *
 * Where the data came from, how recently, and what could not be used. These
 * tables — `capture_runs`, `raw_documents`, `rejected_records`,
 * `field_coverage` — were written by the ingestion layer and, until now, read
 * by nothing: the Data Sources screen described a bundled array instead, which
 * meant it could report a source that had never run and miss one that had.
 */

async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

export class SourcesRepository {
  constructor(private readonly db: Db) {}

  /**
   * One row per marketplace: its latest capture, its coverage, and how well
   * its listings are matched.
   *
   * A LEFT JOIN from marketplaces, deliberately — a platform that has never
   * been captured must still appear, saying so. Dropping it would make an
   * un-run source invisible, which is the opposite of what this screen is for.
   */
  async perMarketplace() {
    return rows<{
      marketplaceId: string;
      marketplaceName: string;
      websiteDomain: string;
      marketplaceType: string;
      brandColor: string | null;
      isDiscovered: boolean;
      isActive: boolean;
      listingCount: number;
      avgMatchConfidence: number | null;
      humanConfirmed: number;
      autoMatched: number;
      lastRunId: string | null;
      lastRunStatus: string | null;
      lastRunStartedAt: string | null;
      lastRunFinishedAt: string | null;
      lastRunProvider: string | null;
      lastRunPagesAttempted: number | null;
      lastRunPagesSucceeded: number | null;
      lastRunNotes: string | null;
      lastObservedAt: string | null;
    }>(
      this.db,
      sql`
      with listing_stats as (
        select l.marketplace_id                                           as marketplace_id,
               count(*)::int                                              as listing_count,
               avg(l.match_confidence)                                    as avg_confidence,
               count(*) filter (where l.match_status = 'human_confirmed')::int as human_confirmed,
               count(*) filter (where l.match_status = 'auto_matched')::int    as auto_matched
          from listings l
         group by l.marketplace_id
      ),
      last_run as (
        select distinct on (cr.marketplace_id)
               cr.marketplace_id, cr.id, cr.run_status, cr.started_at, cr.finished_at,
               cr.provider, cr.pages_attempted, cr.pages_succeeded, cr.notes
          from capture_runs cr
         where cr.marketplace_id is not null
         order by cr.marketplace_id, cr.started_at desc
      ),
      observed as (
        select l.marketplace_id, max(po.observed_at) as last_observed
          from price_observations po
          join offers   o on o.id = po.offer_id
          join listings l on l.id = o.listing_id
         group by l.marketplace_id
      )
      select m.id                        as "marketplaceId",
             m.name                      as "marketplaceName",
             m.website_domain            as "websiteDomain",
             m.marketplace_type          as "marketplaceType",
             m.brand_color               as "brandColor",
             m.is_discovered             as "isDiscovered",
             m.is_active                 as "isActive",
             coalesce(s.listing_count, 0) as "listingCount",
             s.avg_confidence            as "avgMatchConfidence",
             coalesce(s.human_confirmed, 0) as "humanConfirmed",
             coalesce(s.auto_matched, 0)    as "autoMatched",
             r.id                        as "lastRunId",
             r.run_status                as "lastRunStatus",
             r.started_at::text          as "lastRunStartedAt",
             r.finished_at::text         as "lastRunFinishedAt",
             r.provider                  as "lastRunProvider",
             r.pages_attempted           as "lastRunPagesAttempted",
             r.pages_succeeded           as "lastRunPagesSucceeded",
             r.notes                     as "lastRunNotes",
             o.last_observed::text       as "lastObservedAt"
        from marketplaces m
        left join listing_stats s on s.marketplace_id = m.id
        left join last_run      r on r.marketplace_id = m.id
        left join observed      o on o.marketplace_id = m.id
       order by m.display_order asc nulls last, m.name asc`
    );
  }

  /** Field-level completeness per marketplace, as the ingestion layer recorded it. */
  async fieldCoverage() {
    return rows<{ marketplaceId: string; field: string; coveragePct: number }>(
      this.db,
      sql`select marketplace_id as "marketplaceId", field, coverage_pct as "coveragePct"
            from field_coverage
           order by marketplace_id, field`
    );
  }

  /**
   * The most recent capture runs, newest first.
   *
   * Includes runs with no marketplace: a provider call spans several stores, so
   * `marketplace_id` is null for those by design, and omitting them would hide
   * exactly the runs that brought in live data.
   */
  async recentRuns(limit: number) {
    return rows<{
      id: string;
      marketplaceId: string | null;
      marketplaceName: string | null;
      provider: string | null;
      sourceQuery: string | null;
      runStatus: string;
      startedAt: string;
      finishedAt: string | null;
      pagesAttempted: number | null;
      pagesSucceeded: number | null;
      parserVersion: string | null;
      notes: string | null;
      documentCount: number;
    }>(
      this.db,
      sql`select cr.id                 as "id",
                 cr.marketplace_id     as "marketplaceId",
                 m.name                as "marketplaceName",
                 cr.provider           as "provider",
                 cr.source_query       as "sourceQuery",
                 cr.run_status         as "runStatus",
                 cr.started_at::text   as "startedAt",
                 cr.finished_at::text  as "finishedAt",
                 cr.pages_attempted    as "pagesAttempted",
                 cr.pages_succeeded    as "pagesSucceeded",
                 cr.parser_version     as "parserVersion",
                 cr.notes              as "notes",
                 (select count(*)::int from raw_documents rd where rd.capture_run_id = cr.id) as "documentCount"
            from capture_runs cr
            left join marketplaces m on m.id = cr.marketplace_id
           order by cr.started_at desc
           limit ${limit}`
    );
  }

  /** What arrived and could not be used, with the document it came from. */
  async recentRejections(limit: number) {
    return rows<{
      id: string;
      targetEntity: string;
      rejectionReason: string;
      capturedAt: string | null;
      rawDocumentId: string | null;
      sourceUrl: string | null;
      provider: string | null;
    }>(
      this.db,
      sql`select rr.id                as "id",
                 rr.target_entity     as "targetEntity",
                 rr.rejection_reason  as "rejectionReason",
                 rr.captured_at::text as "capturedAt",
                 rr.raw_document_id   as "rawDocumentId",
                 rd.source_url        as "sourceUrl",
                 cr.provider          as "provider"
            from rejected_records rr
            left join raw_documents rd on rd.id = rr.raw_document_id
            left join capture_runs  cr on cr.id = rd.capture_run_id
           order by rr.captured_at desc nulls last, rr.id desc
           limit ${limit}`
    );
  }

  /** Totals, so the screen can say how much of each thing exists. */
  async totals() {
    const [row] = await rows<{
      captureRuns: number;
      rawDocuments: number;
      rejectedRecords: number;
      observations: number;
      liveObservations: number;
      providers: string[];
    }>(
      this.db,
      sql`select (select count(*)::int from capture_runs)      as "captureRuns",
                 (select count(*)::int from raw_documents)     as "rawDocuments",
                 (select count(*)::int from rejected_records)  as "rejectedRecords",
                 (select count(*)::int from price_observations) as "observations",
                 (select count(*)::int from price_observations
                   where parser_version = ${PARSER_VERSION})   as "liveObservations",
                 (select coalesce(array_agg(distinct provider), '{}')
                    from capture_runs where provider is not null) as "providers"`
    );
    return row;
  }
}
