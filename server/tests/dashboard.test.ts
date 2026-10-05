import "./helpers/env.js";

import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { createAnalysisTestApp, signIn, bearer, type Harness } from "./helpers/harness.js";
import { buildProfiles, pickStratified, tierOf } from "../src/modules/dashboard/defaultSet.js";
import { DashboardRepository } from "../src/modules/dashboard/dashboard.repository.js";
import type { ProductProfileRow } from "../src/modules/dashboard/dashboard.repository.js";

/**
 * THE DESK
 * ========
 *
 * The dashboard used to be three browser calls, each independently
 * recomputing the same per-product window statistics over the bundled
 * dataset. They are one server-side computation now, which is the point of
 * most of what follows: the summaries, the alerts and the portfolio totals
 * must be three views of ONE calculation, not three calculations that happen
 * to agree today.
 *
 * The other half is the refusal behaviour. At this catalogue's capture
 * cadence a one-day window holds a single observation for most products, and
 * a single observation is a price level, not a movement. A desk that printed
 * "0.0%" there would be inventing a finding, so these tests check that the
 * empty cells stay empty and say why.
 */

let h: Harness;
let token: string;

const PRODUCT = "prod_dove_hair_fall";

before(async () => {
  h = await createAnalysisTestApp([PRODUCT]);
  ({ token } = await signIn(h, "desk@example.com"));
});
after(async () => {
  await h.close();
});

const desk = async (query = "") => {
  const res = await h.app.inject({
    method: "GET",
    url: `/api/v1/dashboard${query}`,
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 200, res.body.slice(0, 300));
  return res.json().data;
};

/* ================================================== one calculation, three views */

describe("the summaries, alerts and totals are one calculation", () => {
  test("the directional count equals the products that actually carry a change", async () => {
    const data = await desk(`?products=${PRODUCT}&window=3m`);
    const withChange = data.tracked.filter((t: any) => t.changePct != null);

    assert.equal(data.portfolio.directionalCount, withChange.length);
    assert.equal(data.portfolio.trackedCount, data.tracked.length);
  });

  test("every alert traces back to a tracked product and its own numbers", async () => {
    const data = await desk(`?products=${PRODUCT}&window=3m`);

    // Otherwise the loop below asserts nothing and passes for the wrong
    // reason. This product falls ~9% over three months, which is well past
    // the threshold.
    assert.ok(data.alerts.length > 0, "this fixture must actually raise an alert");

    for (const alert of data.alerts) {
      const row = data.tracked.find((t: any) => t.product.id === alert.productId);
      assert.ok(row, `alert ${alert.id} names a product that is not on the desk`);
      assert.equal(alert.changePct, row.changePct, "an alert must not restate a different number");
      assert.equal(alert.observationCount, row.observationCount);
      assert.ok(
        alert.message.includes(`${row.observationCount} observations`),
        "the sentence must state the evidence it rests on"
      );
    }
  });

  test("the capability counts partition the desk", async () => {
    const data = await desk(`?products=${PRODUCT}&window=3m`);
    const { directionalCount, snapshotCount, emptyCount, trackedCount } = data.portfolio;

    // directional here means "carries a change", which covers the
    // distributional products too; the three named buckets cannot exceed the
    // whole desk.
    assert.ok(directionalCount + snapshotCount + emptyCount <= trackedCount);
    assert.equal(snapshotCount, data.tracked.filter((t: any) => t.capability === "snapshot").length);
    assert.equal(emptyCount, data.tracked.filter((t: any) => t.capability === "none").length);
  });

  /**
   * The threshold is a real boundary, exercised in both directions against
   * real observations: this product moves 0.2% over a week and 9% over three
   * months, so one window must stay silent and the other must not.
   */
  test("a move below the threshold raises nothing; one above raises exactly one", async () => {
    const week = await desk(`?products=${PRODUCT}&window=7d`);
    const quarter = await desk(`?products=${PRODUCT}&window=3m`);

    assert.ok(Math.abs(week.tracked[0].changePct) < week.portfolio.alertThresholdPct);
    assert.deepEqual(week.alerts, [], "a fifth of a percent is not news");

    assert.ok(Math.abs(quarter.tracked[0].changePct) >= quarter.portfolio.alertThresholdPct);
    assert.equal(quarter.alerts.length, 1);
    assert.equal(quarter.alerts[0].type, "price_drop", "the move was downward");
    assert.equal(quarter.alerts[0].severity, "serious");
  });
});

/* ============================================================ honest refusal */

describe("a window that cannot carry a movement does not report one", () => {
  /**
   * THE BUG THE CAPABILITY LADDER EXISTS FOR.
   *
   * A one-day window holds a single observation for most products here.
   * A change of zero would be a claim the data cannot support.
   */
  test("a snapshot window reports no change, and says why", async () => {
    const data = await desk(`?products=${PRODUCT}&window=1d`);
    const row = data.tracked[0];

    assert.equal(row.capability, "snapshot");
    assert.equal(row.changePct, null, "one observation is a level, not a movement");
    assert.equal(row.changeMinor, null);
    assert.ok(
      row.withheld.some((w: any) => /one observation/i.test(w.reason)),
      "the gap must be explained rather than left blank"
    );
  });

  test("a product with no direction raises no alert", async () => {
    const data = await desk(`?products=${PRODUCT}&window=1d`);
    assert.deepEqual(data.alerts, [], "firing on a window with no movement would be a fabricated finding");
  });

  test("an average over nothing is null, not zero", async () => {
    const data = await desk(`?products=${PRODUCT}&window=1d`);
    assert.equal(data.portfolio.directionalCount, 0);
    assert.equal(data.portfolio.avgChangePct, null);
  });

  test("a longer window carries at least as much evidence as a shorter one", async () => {
    const short = await desk(`?products=${PRODUCT}&window=7d`);
    const long = await desk(`?products=${PRODUCT}&window=3m`);

    assert.ok(long.tracked[0].observationCount >= short.tracked[0].observationCount);
  });
});

/* ================================================================== anchoring */

describe("the desk is anchored on its own evidence", () => {
  /**
   * The rule established with the price views: a view is anchored on the last
   * capture of the thing it is about. The desk is about the tracked set, so
   * anchoring on a product nobody is watching would open every window on a
   * day the desk has no evidence for.
   */
  test("as-of is the newest capture among the tracked products", async () => {
    const data = await desk(`?products=${PRODUCT}&window=3m`);

    const expected = (await h.db.execute(
      sql`select max(po.observed_at)::text as latest
            from price_observations po
            join offers   o on o.id = po.offer_id
            join listings l on l.id = o.listing_id
           where l.product_id = ${PRODUCT}`
    )) as unknown as { rows: { latest: string }[] };

    assert.equal(data.asOf, expected.rows[0]!.latest);
    assert.equal(data.window.to, data.asOf, "the window ends on the anchor");
  });

  test("the window is inclusive of both ends", async () => {
    const data = await desk(`?products=${PRODUCT}&window=7d`);
    const from = Date.parse(`${data.window.from}T00:00:00Z`);
    const to = Date.parse(`${data.window.to}T00:00:00Z`);

    assert.equal((to - from) / 86_400_000, 6, "a 7-day window spans 6 days of difference");
  });
});

/* ============================================================== the tracked set */

describe("which products are on the desk", () => {
  test("an explicit request is honoured and reported as such", async () => {
    const data = await desk(`?products=${PRODUCT}`);
    assert.equal(data.source, "requested");
    assert.deepEqual(data.tracked.map((t: any) => t.product.id), [PRODUCT]);
  });

  /**
   * A desk that silently shrinks is a desk that lies about what it is
   * watching, so an id that does not resolve is named rather than dropped.
   */
  test("an unknown id is named, not silently dropped", async () => {
    const data = await desk(`?products=${PRODUCT},prod_does_not_exist`);
    assert.deepEqual(data.unknownIds, ["prod_does_not_exist"]);
    assert.equal(data.tracked.length, 1);
  });

  test("a request for nothing that exists is a 404, not an empty desk", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/api/v1/dashboard?products=prod_nope",
      headers: bearer(token),
    });
    assert.equal(res.statusCode, 404);
  });

  test("a user who has tracked nothing gets the stratified default", async () => {
    const data = await desk();
    assert.equal(data.source, "default");
    assert.ok(data.tracked.length > 0, "the desk must not open empty");
  });

  test("the desk is not readable without a session", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/v1/dashboard" });
    assert.equal(res.statusCode, 401);
  });
});

/* ========================================================== the default set */

/**
 * The stratification is pure, so it is tested on constructed profiles rather
 * than on the catalogue. The question is whether the method holds — not
 * whether this dataset happens to produce a pleasing answer.
 */
/**
 * THE BUG THESE EXIST FOR.
 *
 * The stratification tests below construct their own profiles and set a
 * department on each, so they cannot see whether the repository actually
 * resolves one. It did not: the department join matched on `level = 0` while
 * this taxonomy numbers levels from 1, so every product came back with a null
 * department — and the "at most two products per department" cap then applied
 * to one null bucket, silently collapsing a twelve-product desk to two.
 *
 * Nothing failed. The desk simply got smaller.
 */
describe("the catalogue profile resolves what it claims to", () => {
  test("every profiled product is attributed to a department", async () => {
    const repo = new DashboardRepository(h.db);
    const rows = await repo.productProfiles();

    assert.ok(rows.length > 0, "the fixture must profile something");
    const orphaned = rows.filter((r) => r.departmentId == null);
    assert.deepEqual(
      orphaned.map((r) => r.id),
      [],
      "a null department is indistinguishable from every other null department, and the per-department cap then caps the whole desk"
    );
  });

  test("a profile carries the names the desk renders", async () => {
    const repo = new DashboardRepository(h.db);
    const [row] = await repo.productProfiles();

    assert.ok(row!.name, "the product name is rendered as the row heading");
    assert.ok(row!.categoryName, "the category is rendered beside the brand");
    assert.ok(row!.marketplaceCount > 0);
    assert.ok(row!.priceMinor! > 0);
  });
});

describe("the default desk is chosen by method", () => {
  const profile = (over: Partial<ProductProfileRow> & { id: string }): ProductProfileRow => ({
    name: over.id,
    brandName: null,
    categoryId: "cat",
    categoryName: null,
    departmentId: "dept_a",
    productTypeId: "type_a",
    productTypeName: null,
    marketplaceCount: 4,
    offerCount: 4,
    observationCount: 60,
    pointsPerOffer: 61,
    priceMinor: 100000,
    ...over,
  });

  test("a product with too few comparables is a refusal case, by rule", () => {
    assert.equal(tierOf({ candidateCount: 1, marketplaceCount: 6, cadenceDays: 2 }), "refused");
    assert.equal(tierOf({ candidateCount: 3, marketplaceCount: 6, cadenceDays: 2 }), "thin");
    assert.equal(tierOf({ candidateCount: 8, marketplaceCount: 4, cadenceDays: 2 }), "strong");
    assert.equal(tierOf({ candidateCount: 5, marketplaceCount: 2, cadenceDays: 5 }), "moderate");
  });

  test("a single observed point yields no cadence, which cannot be strong", () => {
    const [p] = buildProfiles([profile({ id: "p1", pointsPerOffer: 1 })]);
    assert.equal(p!.cadenceDays, null);
    assert.notEqual(p!.expectedTier, "strong", "unknown cadence must not be read as a deep one");
  });

  /**
   * THE CONSTRAINT THE DEPARTMENT CAP EXISTS FOR.
   *
   * Without it the strong tier fills entirely with one department — an honest
   * reflection of the catalogue, and a desk that cannot show the framework is
   * not tuned to one kind of product.
   */
  test("no more than two products come from any one department", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      profile({
        id: `p${String(i).padStart(2, "0")}`,
        departmentId: `dept_${i % 3}`,
        productTypeId: `type_${i % 3}`,
        priceMinor: 100000 + i * 1000,
      })
    );

    const chosen = pickStratified(buildProfiles(rows));
    const perDept = new Map<string | null, number>();
    for (const p of chosen) perDept.set(p.departmentId, (perDept.get(p.departmentId) ?? 0) + 1);

    for (const [dept, count] of perDept) {
      assert.ok(count <= 2, `${dept} contributed ${count} products`);
    }
  });

  test("the selection is deterministic", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      profile({ id: `p${i}`, departmentId: `dept_${i % 6}`, priceMinor: 50000 + i * 7000 })
    );

    const first = pickStratified(buildProfiles(rows)).map((p) => p.id);
    const second = pickStratified(buildProfiles([...rows].reverse())).map((p) => p.id);

    assert.deepEqual(first, second, "the desk must not reshuffle between reloads");
  });

  test("a product with no price is not profiled at all", () => {
    const built = buildProfiles([
      profile({ id: "priced" }),
      profile({ id: "unpriced", priceMinor: null }),
      profile({ id: "offerless", offerCount: 0 }),
    ]);

    assert.deepEqual(built.map((p) => p.id), ["priced"]);
  });

  test("comparables are counted only within a product type and price band", () => {
    const built = buildProfiles([
      profile({ id: "a", productTypeId: "t1", priceMinor: 100000 }),
      profile({ id: "b", productTypeId: "t1", priceMinor: 120000 }),
      // Outside the 0.6x-1.7x band, so not a candidate for `a`.
      profile({ id: "c", productTypeId: "t1", priceMinor: 900000 }),
      // Same price, different type, so not a candidate either.
      profile({ id: "d", productTypeId: "t2", priceMinor: 100000 }),
    ]);

    assert.equal(built.find((p) => p.id === "a")!.candidateCount, 1);
    assert.equal(built.find((p) => p.id === "d")!.candidateCount, 0);
  });
});
