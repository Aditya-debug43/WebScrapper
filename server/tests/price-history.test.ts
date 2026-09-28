import "./helpers/env.js";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createMarketplaceTestApp, type Harness, type Json } from "./helpers/harness.js";
import { LADDER_COLUMNS } from "../src/lib/priceLadder.js";
import { OBSERVATION_WINDOWS, shiftDays } from "../src/lib/windows.js";

/**
 * PHASE 4 — HIST, PRICE, and price-ladder parity.
 *
 * The statistics are re-derived inside the tests from the raw observations
 * the API itself returns, then compared with the summary it computed. That
 * is deliberately not "assert the number the code produced": the test does
 * the arithmetic independently, so a change in the aggregation has to agree
 * with a change in the test before anything passes.
 */

const DOVE = "prod_dove_hair_fall";
const SPARSE = "prod_green_soul_vienna";
const GOLDEN = [DOVE, "prod_lakme_gloss_lip", "prod_boat_wave_band", "prod_cello_gripper_10", SPARSE, "prod_airpods_pro2"];

/** The dataset's latest capture. Every window is measured back from this. */
const REFERENCE = "2026-08-14";

/** Observation counts per window for the golden product, read from the database. */
const DOVE_BY_WINDOW: Record<string, number> = {
  "1d": 30,
  "2d": 60,
  "3d": 60,
  "7d": 120,
  "15d": 240,
  "1m": 480,
  "3m": 1380,
};

let h: Harness;

before(async () => {
  h = await createMarketplaceTestApp([...GOLDEN]);
});
after(async () => {
  await h.close();
});

const get = async (url: string) => {
  const res = await h.app.inject({ method: "GET", url: `/api/v1${url}` });
  return { status: res.statusCode, body: res.json() as Json };
};

async function allObservations(url: string): Promise<Json[]> {
  const out: Json[] = [];
  const separator = url.includes("?") ? "&" : "?";
  for (let page = 1; page <= 100; page++) {
    const { body } = await get(`${url}${separator}page=${page}&pageSize=100`);
    out.push(...(body["data"] as Json[]));
    if (!body["pagination"].hasNext) break;
  }
  return out;
}

/**
 * The daily series, re-derived in the test from raw observation rows.
 *
 * This is the documented rule stated independently: in-stock only, the
 * cheapest effective price per capture day. If the SQL ever computes
 * something else, these two disagree and the test fails.
 */
function dailySeries(observations: Json[]): Array<{ date: string; minor: number }> {
  const byDate = new Map<string, number>();
  for (const row of observations) {
    if (!row.isInStock) continue;
    const current = byDate.get(row.observedAt as string);
    const value = row.universalEffectiveMinor as number;
    if (current === undefined || value < current) byDate.set(row.observedAt as string, value);
  }
  return [...byDate.entries()].map(([date, minor]) => ({ date, minor })).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Linear interpolation between order statistics — the project's definition. */
function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/* ============================================================== HISTORY */

describe("HIST — price history", () => {
  it("HIST-01: the endpoint returns real observations, each resolving to this product", async () => {
    const { status, body } = await get(`/products/${DOVE}/price-history?window=7d&pageSize=100`);
    assert.equal(status, 200);
    assert.equal(body["pagination"].total, DOVE_BY_WINDOW["7d"]);

    const rows = body["data"] as Json[];
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.ok(row.observationId && row.offerId && row.listingId);
      assert.ok(row.observedAt >= "2026-08-08" && row.observedAt <= REFERENCE);
      assert.equal(typeof row.sellingPriceMinor, "number");
      assert.equal(row.landedMinor, row.sellingPriceMinor + row.shippingFeeMinor);
    }
    assert.equal(body["meta"].referenceDate, REFERENCE);
  });

  for (const spec of OBSERVATION_WINDOWS) {
    it(`HIST window ${spec.key}: the range is computed, and only observations inside it are returned`, async () => {
      const { body } = await get(`/products/${DOVE}/price-history?window=${spec.key}&pageSize=100`);

      // The range is real arithmetic on the reference date, inclusive of both
      // ends — not a label attached to an unchanged query.
      const expectedFrom = shiftDays(REFERENCE, -(spec.days - 1));
      assert.equal(body["meta"].range.from, expectedFrom, `${spec.key} from`);
      assert.equal(body["meta"].range.to, REFERENCE, `${spec.key} to`);
      assert.equal(body["meta"].window.days, spec.days);
      assert.equal(body["meta"].window.label, spec.label);

      assert.equal(body["pagination"].total, DOVE_BY_WINDOW[spec.key], `${spec.key} observation count`);
      for (const row of body["data"] as Json[]) {
        assert.ok(row.observedAt >= expectedFrom && row.observedAt <= REFERENCE, `${row.observedAt} outside ${spec.key}`);
      }
    });
  }

  it("windows nest: a wider horizon can never hold fewer observations than a narrower one", async () => {
    let previous = 0;
    for (const spec of OBSERVATION_WINDOWS) {
      const { body } = await get(`/products/${DOVE}/price-history?window=${spec.key}&pageSize=1`);
      const total = body["pagination"].total as number;
      assert.ok(total >= previous, `${spec.key} (${total}) is narrower than the window before it (${previous})`);
      previous = total;
    }
  });

  it("a window is a date range, and the evidence inside it is a separate fact", async () => {
    // Dove is captured every two days, so the 3-day window happens to hold
    // exactly the same two capture days as the 2-day one. The API reports the
    // range honestly and the count honestly, and they do not have to move
    // together.
    const two = await get(`/products/${DOVE}/price-history?window=2d&pageSize=1`);
    const three = await get(`/products/${DOVE}/price-history?window=3d&pageSize=1`);
    assert.equal(two.body["meta"].range.from, "2026-08-13");
    assert.equal(three.body["meta"].range.from, "2026-08-12");
    assert.equal(two.body["pagination"].total, three.body["pagination"].total);
  });

  it("HIST-09: the marketplace filter restricts the observations to that platform", async () => {
    const everything = await get(`/products/${DOVE}/price-history?window=1m&pageSize=1`);
    const amazon = await allObservations(`/products/${DOVE}/price-history?window=1m&marketplace=mp_amazon_in`);

    assert.ok(amazon.length > 0);
    assert.ok(amazon.length < (everything.body["pagination"].total as number), "a filter must narrow the result");
    for (const row of amazon) assert.equal(row.marketplaceId, "mp_amazon_in");

    // Every marketplace's slice must add up to the whole.
    const marketplaces = ["mp_ajio", "mp_amazon_in", "mp_flipkart", "mp_meesho", "mp_myntra", "mp_nykaa"];
    let sum = 0;
    for (const marketplace of marketplaces) {
      const { body } = await get(`/products/${DOVE}/price-history?window=1m&marketplace=${marketplace}&pageSize=1`);
      sum += body["pagination"].total as number;
    }
    assert.equal(sum, everything.body["pagination"].total);
  });

  it("HIST-10: observation pagination is exact and never repeats a row", async () => {
    const { body } = await get(`/products/${DOVE}/price-history?window=7d&page=2&pageSize=25`);
    assert.equal(body["pagination"].total, 120);
    assert.equal(body["pagination"].totalPages, 5);
    assert.equal((body["data"] as Json[]).length, 25);

    const rows = await allObservations(`/products/${DOVE}/price-history?window=7d`);
    assert.equal(rows.length, 120);
    assert.equal(new Set(rows.map((r) => r.observationId)).size, 120, "an observation appeared twice");

    // Newest first, so the first page is the most recent state.
    const dates = rows.map((r) => r.observedAt as string);
    assert.deepEqual(dates, [...dates].sort().reverse());
  });

  it("HIST-11/HIST-12: min, max, median and quartiles match the observations they came from", async () => {
    const rows = await allObservations(`/products/${DOVE}/price-history?window=1m`);
    const { body } = await get(`/products/${DOVE}/price-history?window=1m&pageSize=1`);

    const series = dailySeries(rows);
    assert.equal(body["meta"].seriesPointCount, series.length);
    assert.equal(body["summary"].n, series.length);

    const values = series.map((p) => p.minor).sort((a, b) => a - b);
    const stats = body["summary"].statistics;

    assert.equal(stats.minMinor, values[0], "HIST-11 min");
    assert.equal(stats.maxMinor, values[values.length - 1], "HIST-11 max");
    assert.equal(stats.spreadMinor, values[values.length - 1]! - values[0]!);
    assert.equal(stats.medianMinor, Math.round(percentile(values, 0.5)), "HIST-12 median");
    assert.equal(stats.q1Minor, Math.round(percentile(values, 0.25)));
    assert.equal(stats.q3Minor, Math.round(percentile(values, 0.75)));

    // First and last are the endpoints of the series, so change is real.
    assert.equal(body["summary"].first.date, series[0]!.date);
    assert.equal(body["summary"].last.date, series[series.length - 1]!.date);
    assert.equal(stats.changeMinor, series[series.length - 1]!.minor - series[0]!.minor);
  });

  it("the statistics are computed on the daily series, not on raw observations", async () => {
    // A median over raw rows counts a marketplace once per offer it happens
    // to have, so a platform with six sellers outvotes one with a single
    // seller. The series rule exists to stop that, and the response says so.
    const rows = await allObservations(`/products/${DOVE}/price-history?window=1m`);
    const { body } = await get(`/products/${DOVE}/price-history?window=1m&pageSize=1`);

    assert.ok(rows.length > body["summary"].n, "there are many more observations than series points");
    assert.match(body["meta"].seriesDefinition, /cheapest in-stock effective price/i);

    const rawMedian = Math.round(
      percentile(
        rows.map((r) => r.universalEffectiveMinor as number).sort((a, b) => a - b),
        0.5
      )
    );
    assert.notEqual(
      body["summary"].statistics.medianMinor,
      rawMedian,
      "the two definitions happen to agree here, which makes this test blind — pick another product"
    );
  });

  it("HIST-13: a range with no observations says so instead of inventing a number", async () => {
    // This product's first capture is 2026-04-17.
    const { status, body } = await get(`/products/${SPARSE}/price-history?from=2026-03-17&to=2026-03-25&pageSize=10`);
    assert.equal(status, 200);
    assert.deepEqual(body["data"], []);
    assert.equal(body["pagination"].total, 0);
    assert.equal(body["summary"].n, 0);
    assert.equal(body["summary"].capability, "none");
    assert.equal(body["summary"].statistics, null, "no statistics at all, rather than zeroes");
    assert.equal(body["summary"].first, null);
    assert.match(body["summary"].withheld[0].reason, /no observations/i);
  });

  it("what a window can support is decided by its evidence, not its length", async () => {
    const cases = [
      { window: "1d", product: SPARSE },
      { window: "3m", product: DOVE },
    ];
    for (const { window, product } of cases) {
      const { body } = await get(`/products/${product}/price-history?window=${window}&pageSize=1`);
      const n = body["summary"].n as number;
      const expected = n === 0 ? "none" : n < 2 ? "snapshot" : n < 5 ? "directional" : "distributional";
      assert.equal(body["summary"].capability, expected, `${product} ${window} (n=${n})`);

      if (n > 0 && n < 5) {
        assert.equal(body["summary"].statistics.medianMinor, null, "a median needs five points");
        assert.equal(body["summary"].statistics.volatilityPct, null);
        assert.ok(body["summary"].withheld.some((w: Json) => w.metric === "median"));
      }
      if (n === 1) {
        assert.equal(body["summary"].statistics.changeMinor, null, "one point is a level, not a movement");
      }
    }
  });

  it("an explicit date range overrides the window, and is reported as the range used", async () => {
    const { body } = await get(`/products/${DOVE}/price-history?from=2026-08-01&to=2026-08-07&pageSize=100`);
    assert.equal(body["meta"].range.from, "2026-08-01");
    assert.equal(body["meta"].range.to, "2026-08-07");
    assert.equal(body["meta"].window, null, "no window is claimed when an explicit range was given");
    for (const row of body["data"] as Json[]) {
      assert.ok(row.observedAt >= "2026-08-01" && row.observedAt <= "2026-08-07");
    }

    const inverted = await get(`/products/${DOVE}/price-history?from=2026-08-07&to=2026-08-01`);
    assert.equal(inverted.status, 400);
  });

  it("offer-level history is a strict subset of the product's, for that offer only", async () => {
    const offers = (await get(`/products/${DOVE}/offers?pageSize=1`)).body["data"] as Json[];
    const offerId = offers[0]!.id as string;

    const { status, body } = await get(`/offers/${offerId}/price-history?window=1m&pageSize=100`);
    assert.equal(status, 200);
    assert.ok((body["pagination"].total as number) > 0);
    for (const row of body["data"] as Json[]) assert.equal(row.offerId, offerId);

    const product = await get(`/products/${DOVE}/price-history?window=1m&pageSize=1`);
    assert.ok((body["pagination"].total as number) < (product.body["pagination"].total as number));

    const missing = await get(`/offers/off_does_not_exist/price-history`);
    assert.equal(missing.status, 404);
  });

  it("the price summary reports current state beside several horizons at once", async () => {
    const { status, body } = await get(`/products/${DOVE}/price-summary?windows=7d&windows=1m&windows=3m`);
    assert.equal(status, 200);
    const data = body["data"] as Json;

    assert.equal((data.windows as Json[]).length, 3);
    assert.deepEqual((data.windows as Json[]).map((w) => w.window), ["7d", "1m", "3m"]);
    assert.ok(data.current.effectiveMinor > 0);
    assert.equal(data.current.basis, "universalEffective");
    assert.equal(data.current.observedAt, REFERENCE);

    for (const window of data.windows as Json[]) {
      assert.ok(window.range.from < window.range.to);
      assert.ok(window.observationCount > 0);
      if (window.currentPositionPct != null) {
        assert.ok(window.currentPositionPct >= 0 && window.currentPositionPct <= 1);
      }
    }

    // Each window's statistics must agree with the same window read through
    // the history endpoint — two routes, one computation.
    for (const window of data.windows as Json[]) {
      const history = await get(`/products/${DOVE}/price-history?window=${window.window}&pageSize=1`);
      assert.deepEqual(window.statistics, history.body["summary"].statistics, `${window.window} disagrees`);
    }
  });
});

/* ======================================================== EFFECTIVE PRICE */

describe("PRICE — headline, shipping and the effective price", () => {
  it("PRICE-01/02: the headline price and the effective price are distinct, and shipping is what separates them", async () => {
    const rows = await allObservations(`/products/${DOVE}/price-history?window=1m`);

    const withShipping = rows.filter((r) => (r.shippingFeeMinor as number) > 0);
    assert.ok(withShipping.length > 0, "the dataset must contain paid delivery for this to mean anything");
    for (const row of withShipping) {
      assert.ok(
        (row.landedMinor as number) > (row.sellingPriceMinor as number),
        "landed must exceed the headline price when delivery is charged"
      );
    }

    const withDiscount = rows.filter((r) => (r.universalDiscountMinor as number) > 0);
    assert.ok(withDiscount.length > 0, "and it must contain universal discounts");
    for (const row of withDiscount) {
      assert.ok((row.universalEffectiveMinor as number) < (row.landedMinor as number));
    }
  });

  it("PRICE-03: every rung is internally consistent on every observation", async () => {
    const rows = await allObservations(`/products/${DOVE}/price-history?window=1m`);
    assert.ok(rows.length >= 400);
    for (const r of rows) {
      assert.equal(r.landedMinor, (r.sellingPriceMinor as number) + (r.shippingFeeMinor as number));
      assert.equal(r.universalEffectiveMinor, (r.landedMinor as number) - (r.universalDiscountMinor as number));
      assert.equal(r.conditionalBestMinor, (r.universalEffectiveMinor as number) - (r.conditionalDiscountMinor as number));
    }
  });

  it("PRICE-04: no rung can go negative, whatever the discount", async () => {
    const rows = await allObservations(`/products/${DOVE}/price-history?window=3m`);
    for (const r of rows) {
      assert.ok((r.sellingPriceMinor as number) >= 0, "selling price");
      assert.ok((r.shippingFeeMinor as number) >= 0, "shipping");
      assert.ok((r.landedMinor as number) >= 0, "landed");
      assert.ok((r.universalEffectiveMinor as number) >= 0, "effective");
      assert.ok((r.conditionalBestMinor as number) >= 0, "conditional best");
      // The clamp is what guarantees it: a discount can never exceed the
      // price it is taken off.
      assert.ok((r.universalDiscountMinor as number) <= (r.landedMinor as number));
      assert.ok((r.conditionalDiscountMinor as number) <= (r.universalEffectiveMinor as number));
    }
  });

  it("PRICE-05: nothing is sold above its MRP, and delivery is the only thing that can carry a total past it", async () => {
    const rows = await allObservations(`/products/${DOVE}/price-history?window=3m`);
    const priced = rows.filter((r) => r.mrpMinor != null);
    assert.ok(priced.length > 0);

    for (const r of priced) {
      // MRP is a legal ceiling on the ITEM price. It does not govern
      // delivery, so `landed` may legitimately sit above it — but the
      // headline price never may.
      assert.ok(
        (r.sellingPriceMinor as number) <= (r.mrpMinor as number),
        `${r.observationId}: sold at ${r.sellingPriceMinor} above an MRP of ${r.mrpMinor}`
      );
    }

    const overMrp = priced.filter((r) => (r.landedMinor as number) > (r.mrpMinor as number));
    for (const r of overMrp) {
      assert.ok((r.shippingFeeMinor as number) > 0, `${r.observationId}: landed above MRP with no delivery charge`);
    }
  });
});

/* ========================================================= LADDER PARITY */

describe("the backend ladder and the frontend engine are one definition", () => {
  it("every rung matches src/utils/priceLayers.js, on real observations", async () => {
    const fixturePath = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "price-ladder-parity.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as {
      caseCount: number;
      casesWithUniversalDiscount: number;
      casesWithConditionalDiscount: number;
      cases: Array<{ observationId: string; offerId: string; expected: Record<string, number | null> }>;
    };

    // A parity check over undiscounted offers would pass against a ladder
    // that ignored promotions entirely, so the fixture has to exercise both.
    assert.ok(fixture.cases.length >= 100, "the fixture is too thin to be worth having");
    assert.ok(fixture.casesWithUniversalDiscount >= 10, "not enough universal-discount cases");
    assert.ok(fixture.casesWithConditionalDiscount >= 10, "not enough conditional-discount cases");

    const ids = fixture.cases.map((c) => c.observationId);
    const result = (await h.db.execute(
      sql`select po.id as "observationId", ${LADDER_COLUMNS}
            from price_observations po
           where po.id in (${sql.join(ids.map((v) => sql`${v}`), sql`, `)})`
    )) as unknown as { rows: Array<Record<string, number | null | string>> };

    const actual = new Map(result.rows.map((r) => [r["observationId"] as string, r]));
    assert.equal(actual.size, fixture.cases.length, "some fixture observations are missing from the database");

    const rungs = [
      "mrpMinor",
      "sellingPriceMinor",
      "shippingFeeMinor",
      "landedMinor",
      "universalDiscountMinor",
      "universalEffectiveMinor",
      "conditionalDiscountMinor",
      "conditionalBestMinor",
      "deferredBenefitMinor",
      "financingBenefitMinor",
    ] as const;

    const mismatches: string[] = [];
    for (const testCase of fixture.cases) {
      const row = actual.get(testCase.observationId)!;
      for (const rung of rungs) {
        const expected = testCase.expected[rung] ?? null;
        const got = row[rung] ?? null;
        if (expected !== got) {
          mismatches.push(`${testCase.observationId}.${rung}: engine ${expected}, database ${got}`);
        }
      }
    }

    assert.deepEqual(
      mismatches.slice(0, 10),
      [],
      `${mismatches.length} of ${fixture.cases.length * rungs.length} rung comparisons disagree. ` +
        `The SQL ladder and src/utils/priceLayers.js must produce the same number — there is only one effective price.`
    );
  });
});
