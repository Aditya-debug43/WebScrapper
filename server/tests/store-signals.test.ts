import "./helpers/env.js";

import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import { createAnalysisTestApp, signIn, bearer, type Harness } from "./helpers/harness.js";
import { summariseFeatured, buildStoreSignals, LOCKED_SHARE } from "../src/modules/analysis/storeSignals.js";

/**
 * NON-PRICE PARAMETERS
 * ====================
 *
 * They answer "besides price, what can a seller act on?" and they used to be
 * computed in the browser over the bundled dataset — a second analytical
 * engine reading a second copy of the data, which is the arrangement the
 * recommendation and the analysis were moved server-side to end.
 *
 * Two kinds of test here. The pure ones exercise the thresholds directly,
 * because a threshold that fires at the wrong time tells a seller to do the
 * wrong thing. The endpoint ones check the composition over real seeded data.
 */

let h: Harness;
let token: string;

before(async () => {
  h = await createAnalysisTestApp(["prod_dove_hair_fall"]);
  ({ token } = await signIn(h, "signals@example.com"));
});
after(async () => {
  await h.close();
});

const analysisOf = async (productId: string, query = "") => {
  const res = await h.app.inject({
    method: "GET",
    url: `/api/v1/products/${productId}/analysis?from=0001-01-01${query}`,
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 200, res.body.slice(0, 200));
  return res.json().data.storeSignals;
};

/* ======================================================= the featured offer */

describe("the featured position is measured per listing", () => {
  /**
   * THE BUG THE PER-LISTING UNIT EXISTS FOR.
   *
   * Pooling every platform's winners into one figure turns six platforms with
   * six unchallenged winners into "the top seller holds 16.7%", which reads as
   * a wide-open contest and is the exact opposite of the truth. The default
   * position is a per-listing contest, so the listing is the unit.
   */
  test("six platforms each locked by a different seller is six locks, not an open contest", () => {
    const wins = Array.from({ length: 6 }, (_, i) => ({
      listingId: `lst_${i}`,
      marketplaceId: `mp_${i}`,
      sellerId: `seller_${i}`,
      sellerName: `Seller ${i}`,
      wins: 30,
    }));

    const summary = summariseFeatured(wins)!;
    assert.equal(summary.listingsMeasured, 6);
    assert.equal(summary.lockedCount, 6, "every listing has an unchallenged holder");
    assert.equal(summary.meanTopShare, 100);
  });

  test("a contested listing is reported as contested", () => {
    const summary = summariseFeatured([
      { listingId: "lst_a", marketplaceId: "mp_a", sellerId: "s1", sellerName: "One", wins: 6 },
      { listingId: "lst_a", marketplaceId: "mp_a", sellerId: "s2", sellerName: "Two", wins: 4 },
    ])!;

    assert.equal(summary.lockedCount, 0, `60% is below the ${LOCKED_SHARE}% lock threshold`);
    assert.equal(summary.contestedCount, 1);
    assert.equal(summary.perListing[0]!.topShare, 60);
    assert.equal(summary.perListing[0]!.distinctWinners, 2);
  });

  test("no captured featured day is null, not zero", () => {
    assert.equal(summariseFeatured([]), null);
  });
});

/* ============================================================== thresholds */

/** The smallest input that produces a well-formed signal set. */
const baseInput = () => ({
  offers: [
    {
      listingId: "lst_a",
      marketplaceId: "mp_a",
      offerId: "off_a",
      sellerId: "s1",
      sellerName: "One",
      fulfilmentType: "fba",
      isInStock: true,
      mrpMinor: 100000,
      sellingPriceMinor: 80000,
      shippingFeeMinor: 0,
      landedMinor: 80000,
      universalEffectiveMinor: 80000,
    },
  ],
  listingIds: ["lst_a"],
  ownMarketplaceIds: ["mp_a"],
  featuredWins: [],
  activePromotions: [],
  window: {
    key: "1m",
    label: "1 month",
    days: 30,
    n: 10,
    promoDays: 0,
    promoLabels: [] as string[],
    coverage: { observationRows: 10, outOfStockRows: 0, outOfStockShare: 0 },
  },
  trust: null,
  rawRating: null,
  reviewCount: null,
  velocity: null,
  competitors: [],
});

describe("a finding is only made where the data supports it", () => {
  test("no offer observed at all produces no parameters and says why", () => {
    const out = buildStoreSignals({ ...baseInput(), offers: [] });
    assert.equal(out.available, false);
    assert.deepEqual(out.parameters, []);
    assert.deepEqual(out.findings, []);
    assert.match(out.reason!, /nothing to assess beyond price/i);
  });

  test("a thin review base is flagged as not yet supporting a premium", () => {
    const out = buildStoreSignals({ ...baseInput(), rawRating: 4.8, reviewCount: 120, trust: 4.2 });
    const finding = out.findings.find((f) => f.id === "sig_thin_reviews");
    assert.ok(finding, "a 4.8 over 120 reviews, damped to 4.2, is the case this exists for");
    assert.equal(finding.direction, "aggressive");
  });

  test("a large review base that survives damping argues the other way", () => {
    const out = buildStoreSignals({ ...baseInput(), rawRating: 4.4, reviewCount: 42000, trust: 4.35 });
    const finding = out.findings.find((f) => f.id === "sig_strong_trust");
    assert.ok(finding);
    assert.equal(finding.direction, "premium");
  });

  test("the two trust findings are mutually exclusive", () => {
    const out = buildStoreSignals({ ...baseInput(), rawRating: 4.8, reviewCount: 120, trust: 4.2 });
    const ids = out.findings.map((f) => f.id);
    assert.ok(!(ids.includes("sig_thin_reviews") && ids.includes("sig_strong_trust")));
  });

  test("a demand gap under 25% is not reported", () => {
    const near = buildStoreSignals({
      ...baseInput(),
      velocity: 110,
      competitors: [{ id: "p1", name: "Rival", marketplaceIds: ["mp_a"], velocity: 100 }],
    });
    assert.equal(near.findings.find((f) => f.id === "sig_velocity"), undefined, "10% is noise");

    const far = buildStoreSignals({
      ...baseInput(),
      velocity: 200,
      competitors: [{ id: "p1", name: "Rival", marketplaceIds: ["mp_a"], velocity: 100 }],
    });
    assert.equal(far.findings.find((f) => f.id === "sig_velocity")?.direction, "premium");
  });

  test("availability is only raised once a tenth of offer-days are unbuyable", () => {
    const withFeatured = {
      ...baseInput(),
      featuredWins: [{ listingId: "lst_a", marketplaceId: "mp_a", sellerId: "s1", sellerName: "One", wins: 10 }],
    };

    const low = buildStoreSignals({
      ...withFeatured,
      window: { ...withFeatured.window, coverage: { observationRows: 100, outOfStockRows: 5, outOfStockShare: 5 } },
    });
    assert.equal(low.findings.find((f) => f.id === "sig_availability"), undefined);

    const high = buildStoreSignals({
      ...withFeatured,
      window: { ...withFeatured.window, coverage: { observationRows: 100, outOfStockRows: 20, outOfStockShare: 20 } },
    });
    assert.ok(high.findings.find((f) => f.id === "sig_availability"));
  });

  /**
   * A coverage gap needs MOST of the competitive set on a platform. One rival
   * on a niche platform is not a gap, and reporting it sends a seller
   * somewhere nobody is.
   */
  test("one rival on a platform is not a coverage gap; most of the set is", () => {
    const oneRival = buildStoreSignals({
      ...baseInput(),
      competitors: [
        { id: "p1", name: "A", marketplaceIds: ["mp_a", "mp_elsewhere"], velocity: null },
        { id: "p2", name: "B", marketplaceIds: ["mp_a"], velocity: null },
        { id: "p3", name: "C", marketplaceIds: ["mp_a"], velocity: null },
      ],
    });
    assert.equal(oneRival.findings.find((f) => f.id === "sig_reach"), undefined);

    const mostOfSet = buildStoreSignals({
      ...baseInput(),
      competitors: [
        { id: "p1", name: "A", marketplaceIds: ["mp_a", "mp_elsewhere"], velocity: null },
        { id: "p2", name: "B", marketplaceIds: ["mp_a", "mp_elsewhere"], velocity: null },
        { id: "p3", name: "C", marketplaceIds: ["mp_a"], velocity: null },
      ],
    });
    assert.ok(mostOfSet.findings.find((f) => f.id === "sig_reach"));
  });

  test("a parameter with no value states why instead of showing zero", () => {
    const out = buildStoreSignals(baseInput());
    const trust = out.parameters.find((p) => p.key === "trust")!;
    assert.equal(trust.value, null);
    assert.equal(trust.display, "—", "a missing rating is not nought stars");
    assert.ok(trust.unavailableReason);
  });
});

/* =============================================================== composed */

describe("the analysis carries the signals", () => {
  test("every parameter names the decision it informs", async () => {
    const signals = await analysisOf("prod_dove_hair_fall");
    assert.equal(signals.available, true);
    assert.equal(signals.parameters.length, 10);

    for (const p of signals.parameters) {
      assert.ok(p.decision.endsWith("?"), `${p.key} must name a decision, got "${p.decision}"`);
      assert.ok(["observed", "derived"].includes(p.basis));
      assert.ok(p.value != null || p.unavailableReason, `${p.key} has neither a value nor a reason`);
    }
  });

  test("the limits of the dataset are stated, not omitted", async () => {
    const signals = await analysisOf("prod_dove_hair_fall");
    assert.ok(signals.knownGaps.length >= 4);
    assert.ok(
      signals.knownGaps.some((g: string) => /units sold/i.test(g)),
      "the primary demand signal this dataset lacks must be named"
    );
  });

  /**
   * The horizon is separate from the analysis range on purpose: the analysis
   * is asked for the whole observed history, while availability and
   * promotional share are questions about a recent window.
   */
  test("the signal horizon is the one the request asked for", async () => {
    const month = await analysisOf("prod_dove_hair_fall", "&signalWindow=1m");
    const week = await analysisOf("prod_dove_hair_fall", "&signalWindow=7d");

    assert.equal(month.window.label, "1 month");
    assert.equal(week.window.label, "7 days");
    assert.ok(
      week.window.n <= month.window.n,
      "a seven-day horizon cannot hold more captured days than a month"
    );
  });

  test("it defaults to a month when no horizon is asked for", async () => {
    const signals = await analysisOf("prod_dove_hair_fall");
    assert.equal(signals.window.label, "1 month");
  });
});
