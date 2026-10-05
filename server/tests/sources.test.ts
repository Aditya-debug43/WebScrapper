import "./helpers/env.js";

import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { createTestApp, signIn, bearer, type Harness } from "./helpers/harness.js";

/**
 * DATA SOURCES
 * ============
 *
 * The screen that says whether the rest of the app can be trusted. It used to
 * be furnished from a bundled six-item array, which made two failures
 * structurally impossible to see: a platform that had never been captured
 * still looked captured, and a platform the system had actually learned about
 * from a provider did not appear at all.
 *
 * So the assertions here are mostly about ABSENCE being reported — a null run,
 * a null confidence, a store with no editorial position. The happy path was
 * never the part that was broken.
 *
 * Provenance rows are inserted here rather than seeded, because the seed
 * dataset carries none and an exact assertion needs a known input.
 */

let h: Harness;
let token: string;

/** Two of the curated marketplaces, chosen from the seeded set at setup. */
let captured: string;
let neverCaptured: string;

before(async () => {
  h = await createTestApp({ seedCatalogue: true });
  ({ token } = await signIn(h, "sources@example.com"));

  const existing = (await h.db.execute(
    sql`select id from marketplaces order by display_order asc nulls last, name asc`
  )) as unknown as { rows: { id: string }[] };
  captured = existing.rows[0]!.id;
  neverCaptured = existing.rows[1]!.id;

  /**
   * A store learned from a provider, before anything it carries has been
   * matched to a product.
   *
   * This is the real shape of a discovered marketplace at the moment it
   * arrives, and the seeded catalogue has no example of it: every curated
   * platform already has listings. Without one, the "no listings" branch
   * below has nothing to assert against.
   */
  await h.db.execute(sql`
    insert into marketplaces
      (id, name, country_code, default_currency, website_domain, is_active,
       brand_color, marketplace_type, display_order, is_discovered, category_affinity)
    values
      ('mp_discovered', 'Croma', 'IN', 'INR', 'croma.com', true,
       null, 'unclassified', null, true, '[]'::jsonb)
  `);

  await h.db.execute(sql`
    insert into capture_runs
      (id, marketplace_id, provider, source_query, started_at, finished_at,
       run_status, parser_version, pages_attempted, pages_succeeded, notes)
    values
      ('run_old', ${captured}, 'scraper', null,
       '2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z', 'success', 'v0', 10, 10, null),
      ('run_new', ${captured}, 'scraper', null,
       '2026-02-01T00:00:00Z', '2026-02-01T00:10:00Z', 'partial', 'v1', 10, 7, 'two pages timed out'),
      -- A provider run spans several stores, so it names none of them.
      ('run_provider', null, 'serpapi', 'dove shampoo',
       '2026-02-02T00:00:00Z', '2026-02-02T00:01:00Z', 'success', 'market-data-v1', 1, 1, null)
  `);

  await h.db.execute(sql`
    insert into raw_documents (id, capture_run_id, source_url, http_status, fetched_at)
    values ('doc_a', 'run_provider', 'https://example.test/search?q=dove', 200, '2026-02-02T00:00:30Z')
  `);

  await h.db.execute(sql`
    insert into rejected_records (id, raw_document_id, target_entity, rejection_reason, captured_at)
    values ('rej_a', 'doc_a', 'offer', 'price missing from result', '2026-02-02T00:00:40Z')
  `);

  await h.db.execute(sql`
    insert into field_coverage (marketplace_id, field, coverage_pct)
    values (${captured}, 'selling_price', 99.5), (${captured}, 'mrp', 72.25)
  `);
});

after(async () => {
  await h.close();
});

const overview = async (query = "") => {
  const res = await h.app.inject({
    method: "GET",
    url: `/api/v1/sources${query}`,
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 200, res.body.slice(0, 300));
  return res.json().data;
};

/* ======================================================== what is reported */

describe("every known marketplace is reported, captured or not", () => {
  test("a platform that has never been captured still appears, with a null run", async () => {
    const data = await overview();
    const row = data.perMarketplace.find((m: any) => m.marketplace.id === neverCaptured);

    assert.ok(row, "a marketplace with no capture run must not vanish from the list");
    assert.equal(row.latestRun, null, "and must not be given a run it never had");
  });

  test("the latest run is the latest one, not merely a run", async () => {
    const data = await overview();
    const row = data.perMarketplace.find((m: any) => m.marketplace.id === captured);

    assert.equal(row.latestRun.id, "run_new");
    assert.equal(row.latestRun.runStatus, "partial");
    assert.equal(row.latestRun.pagesSucceeded, 7);
    assert.equal(row.latestRun.notes, "two pages timed out");
  });

  test("field coverage is attached to the marketplace it was measured on", async () => {
    const data = await overview();
    const row = data.perMarketplace.find((m: any) => m.marketplace.id === captured);
    const fields = Object.fromEntries(row.coverage.map((c: any) => [c.field, c.coveragePct]));

    assert.deepEqual(fields, { selling_price: 99.5, mrp: 72.25 });

    const other = data.perMarketplace.find((m: any) => m.marketplace.id === neverCaptured);
    assert.deepEqual(other.coverage, [], "coverage is not shared between platforms");
  });

  /**
   * A run that names no marketplace is the normal case for a provider: one
   * Google Shopping response carries several stores at once. Filtering those
   * out would hide exactly the runs that brought in live data.
   */
  test("a provider run that names no marketplace is still listed", async () => {
    const data = await overview();
    const run = data.recentRuns.find((r: any) => r.id === "run_provider");

    assert.ok(run, "a run with a null marketplace must still be reported");
    assert.equal(run.marketplaceId, null);
    assert.equal(run.marketplaceName, null);
    assert.equal(run.provider, "serpapi");
    assert.equal(run.sourceQuery, "dove shampoo");
    assert.equal(run.documentCount, 1);
  });

  test("runs are newest first", async () => {
    const data = await overview();
    const ids = data.recentRuns.map((r: any) => r.id);
    assert.deepEqual(ids.slice(0, 3), ["run_provider", "run_new", "run_old"]);
  });

  test("a quarantined record carries the document it came from", async () => {
    const data = await overview();
    const rejection = data.recentRejections.find((r: any) => r.id === "rej_a");

    assert.equal(rejection.targetEntity, "offer");
    assert.equal(rejection.rejectionReason, "price missing from result");
    assert.equal(rejection.sourceUrl, "https://example.test/search?q=dove");
    assert.equal(rejection.provider, "serpapi", "traced back through the document to its run");
  });
});

/* ============================================================== honest nulls */

describe("absent evidence is reported as absent", () => {
  /**
   * THE BUG THIS EXISTS FOR.
   *
   * An average over no listings is undefined. Returning 0 would say "every
   * match on this platform is wrong", which is a far stronger claim — and a
   * different one — than "there is nothing here to assess".
   */
  test("match confidence over no matched listings is null, not zero", async () => {
    const data = await overview();
    const empty = data.perMarketplace.filter((m: any) => m.listingCount === 0);

    assert.ok(empty.length > 0, "the seeded catalogue must contain an unlisted platform to test this");
    for (const row of empty) {
      assert.equal(row.avgMatchConfidence, null, `${row.marketplace.id} reported a confidence with no listings`);
    }
  });

  test("a marketplace with listings reports a confidence between 0 and 1", async () => {
    const data = await overview();
    const withListings = data.perMarketplace.filter((m: any) => m.listingCount > 0);

    assert.ok(withListings.length > 0);
    for (const row of withListings) {
      assert.ok(
        row.avgMatchConfidence === null ||
          (row.avgMatchConfidence >= 0 && row.avgMatchConfidence <= 1),
        `${row.marketplace.id} reported ${row.avgMatchConfidence}`
      );
    }
  });

  /**
   * Freshness is measured against the newest capture in the system, not the
   * wall clock. A fixture whose captures ended in February is not "everything
   * is stale"; it is a dataset that ends when it ends.
   */
  test("staleness is relative to the newest capture, not to now", async () => {
    const data = await overview();
    const row = data.perMarketplace.find((m: any) => m.marketplace.id === captured);

    assert.equal(row.isStale, false, "the most recently captured platform is never the stale one");
    assert.equal(
      data.totals.newestCapture.slice(0, 10),
      "2026-02-01",
      "the anchor is the newest run that names a marketplace"
    );
  });

  test("a platform never captured has no staleness to report", async () => {
    const data = await overview();
    const row = data.perMarketplace.find((m: any) => m.marketplace.id === neverCaptured);
    assert.equal(row.isStale, null, "never captured is not the same as fresh, nor as stale");
  });
});

/* ==================================================================== totals */

describe("the totals describe the system, not a bundled list", () => {
  test("it counts how many listed platforms have actually been captured", async () => {
    const data = await overview();
    assert.equal(data.totals.marketplaces, data.perMarketplace.length);
    assert.equal(data.totals.marketplacesCaptured, 1, "only one marketplace has a run of its own");
    assert.ok(data.totals.marketplaces > data.totals.marketplacesCaptured);
  });

  /**
   * A discovered store has no editorial position, so it has no display order
   * and must not be ranked against platforms it was never compared with. It
   * sorts after the curated set.
   */
  test("a discovered store is listed, marked as discovered, and sorts last", async () => {
    const data = await overview();
    const ids = data.perMarketplace.map((m: any) => m.marketplace.id);

    assert.ok(ids.includes("mp_discovered"), "a store learned from a provider must appear");
    assert.equal(ids.at(-1), "mp_discovered");
    assert.equal(data.totals.marketplacesDiscovered, 1);

    const row = data.perMarketplace.find((m: any) => m.marketplace.id === "mp_discovered");
    assert.equal(row.marketplace.isDiscovered, true);
    assert.equal(row.marketplace.marketplaceType, "unclassified");
  });

  test("it names the providers in use rather than assuming one", async () => {
    const data = await overview();
    assert.deepEqual([...data.totals.providers].sort(), ["scraper", "serpapi"]);
  });

  test("it counts documents and quarantined rows", async () => {
    const data = await overview();
    assert.equal(data.totals.captureRuns, 3);
    assert.equal(data.totals.rawDocuments, 1);
    assert.equal(data.totals.rejectedRecords, 1);
  });
});

/* =================================================================== bounds */

describe("the endpoint is bounded", () => {
  test("the run list respects its limit", async () => {
    const data = await overview("?runLimit=2");
    assert.equal(data.recentRuns.length, 2);
    assert.equal(data.recentRuns[0].id, "run_provider", "still newest first");
  });

  test("an unknown parameter is refused rather than ignored", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/api/v1/sources?limit=5",
      headers: bearer(token),
    });
    assert.equal(res.statusCode, 400);
  });

  test("a limit beyond the ceiling is refused", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/api/v1/sources?runLimit=5000",
      headers: bearer(token),
    });
    assert.equal(res.statusCode, 400);
  });

  /**
   * These rows name the providers in use, the queries sent to them and the
   * URLs they returned — a description of how this system acquires its data.
   */
  test("it is not readable without a session", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/v1/sources" });
    assert.equal(res.statusCode, 401);
  });
});
