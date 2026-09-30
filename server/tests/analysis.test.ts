import "./helpers/env.js";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { createAnalysisTestApp, signIn, bearer, type Harness, type Json } from "./helpers/harness.js";
import { OBSERVATION_WINDOWS, shiftDays } from "../src/lib/windows.js";

/**
 * PHASE 5 — COMP-01…12 and ANALYSIS-01…12.
 *
 * Behaviour and data, not status codes. Parity against the frontend engine
 * is asserted separately in `analysis-parity.test.ts`; what these cover is
 * the API's own contract — the rules that must hold whatever the engine
 * says, and the suppression behaviour that is the point of the whole layer.
 */

const DOVE = "prod_dove_hair_fall";
const LAKME = "prod_lakme_gloss_lip";
const SPARSE = "prod_green_soul_vienna";
const SINGLE = "prod_airpods_pro2";
const PHONE = "prod_galaxy_m14_5g_6_128_blue";
const PHONE_SIBLING = "prod_galaxy_m14_5g_8_256_silver";
const REFUSAL = "prod_funskool_uno";

const GOLDEN = [DOVE, LAKME, "prod_boat_wave_band", "prod_cello_gripper_10", SPARSE, SINGLE, PHONE, PHONE_SIBLING, "prod_green_soul_mid", REFUSAL];

let h: Harness;
let token: string;

before(async () => {
  h = await createAnalysisTestApp(GOLDEN);
  ({ token } = await signIn(h, "analysis@example.com"));
});
after(async () => {
  await h.close();
});

const get = async (url: string, auth = true) => {
  const res = await h.app.inject({
    method: "GET",
    url: `/api/v1${url}`,
    ...(auth ? { headers: bearer(token) } : {}),
    remoteAddress: "10.72.0.1",
  });
  return { status: res.statusCode, body: res.json() as Json, raw: res.body };
};

async function allCompetitors(productId: string, query = ""): Promise<Json[]> {
  const out: Json[] = [];
  const sep = query ? "&" : "?";
  for (let page = 1; page <= 20; page++) {
    const { body } = await get(`/products/${productId}/competitors${query}${sep}page=${page}&pageSize=100`);
    out.push(...((body["data"] as Json[]) ?? []));
    if (!body["pagination"]?.hasNext) break;
  }
  return out;
}

const analysisOf = async (productId: string, query = "") =>
  (await get(`/products/${productId}/analysis${query}`)).body["data"] as Json;

/* =========================================================== COMPETITORS */

describe("COMP — the competitive set", () => {
  it("COMP-01: candidates are restricted to purchasable products of the same product type", async () => {
    const product = (await get(`/products/${DOVE}`)).body["data"] as Json;
    const competitors = await allCompetitors(DOVE);
    assert.ok(competitors.length > 0);

    for (const c of competitors) {
      const candidate = (await get(`/products/${c.productId}`)).body["data"] as Json;
      assert.equal(candidate.productTypeId, product.productTypeId, `${c.productId} is a different product type`);
    }
  });

  it("COMP-02: the target is never its own competitor", async () => {
    for (const productId of [DOVE, LAKME, PHONE]) {
      const competitors = await allCompetitors(productId);
      assert.ok(
        !competitors.some((c) => c.productId === productId),
        `${productId} appears in its own competitive set`
      );
    }
  });

  it("COMP-03: one product competing through many sellers counts once", async () => {
    const competitors = await allCompetitors(DOVE);
    const ids = competitors.map((c) => c.productId as string);
    assert.equal(new Set(ids).size, ids.length, "a product appears twice in the set");

    // And every member carries several marketplaces without being duplicated
    // per marketplace — the grain is the product, not the listing or offer.
    const multi = competitors.filter((c) => (c.marketplaceIds as string[]).length > 1);
    assert.ok(multi.length > 0, "the fixture should contain multi-marketplace competitors");
  });

  it("COMP-03b: variants of one model occupy one slot, not one each", async () => {
    // These two are variants of the same Galaxy M14 family.
    const competitors = await allCompetitors(PHONE);
    const sibling = competitors.find((c) => c.productId === PHONE_SIBLING);

    if (sibling) {
      // If the sibling is in the set it must be flagged, never counted as an
      // independent reading of the market.
      assert.equal(sibling.isSameFamily, true, "a same-family variant must be marked");
      assert.notEqual(sibling.tier, "direct", "a variant of the same model cannot be a direct competitor");
    }

    // Whatever else is in the set, no two members share a competitive identity.
    const families = competitors.filter((c) => c.isSameFamily);
    assert.ok(families.length <= 1, "at most one same-family variant may hold a slot");
  });

  it("COMP-04/05/06: every member carries a tier, and non-direct tiers carry a reason", async () => {
    const competitors = await allCompetitors(DOVE);
    for (const c of competitors) {
      assert.ok(["direct", "comparable", "reference"].includes(c.tier as string), `${c.productId}: ${c.tier}`);
      if (c.tier !== "direct") {
        assert.ok(c.tierReason, `${c.productId} is ${c.tier} with no stated reason`);
      }
    }

    const direct = await allCompetitors(DOVE, "?tier=direct");
    for (const c of direct) assert.equal(c.tier, "direct");
    const comparable = await allCompetitors(DOVE, "?tier=comparable");
    for (const c of comparable) assert.equal(c.tier, "comparable");
    assert.equal(direct.length + comparable.length, competitors.length, "every member is direct or comparable");
  });

  it("COMP-07: similarity is bounded, and its components explain the total", async () => {
    const competitors = await allCompetitors(DOVE);
    for (const c of competitors) {
      assert.ok((c.similarity as number) >= 0 && (c.similarity as number) <= 1, `${c.productId} similarity out of range`);

      // Recompute the weighted mean from the published components. A total
      // that cannot be derived from its parts is not explainable.
      const b = c.similarityBreakdown as Json;
      const terms: Array<[number, number | null]> = [
        [0.45, b.specScore as number | null],
        [0.25, b.priceScore as number | null],
        [0.15, b.tierScore as number | null],
        [0.15, b.marketplaceScore as number | null],
      ];
      const usable = terms.filter(([, v]) => v != null) as Array<[number, number]>;
      const weightSum = usable.reduce((s, [w]) => s + w, 0);
      const expected = weightSum > 0 ? usable.reduce((s, [w, v]) => s + w * v, 0) / weightSum : 0;
      assert.ok(
        Math.abs((c.similarity as number) - Math.round(expected * 10000) / 10000) < 1e-6,
        `${c.productId}: similarity ${c.similarity} is not the weighted mean of its components (${expected})`
      );
    }
  });

  it("COMP-08: an unmeasurable attribute is not scored as a difference", async () => {
    const competitors = await allCompetitors(DOVE);
    for (const c of competitors) {
      const spec = c.specificationMatch as Json;
      const compared = (spec.match as number) + (spec.partial as number) + (spec.differ as number);
      const total = compared + (spec.missing as number);
      assert.ok(total > 0, `${c.productId}: no attributes considered at all`);
      // Coverage counts what could be compared, so a missing attribute lowers
      // coverage rather than counting as a difference.
      assert.ok(
        Math.abs((spec.coverage as number) - Math.round((compared / total) * 1000) / 1000) < 1e-6,
        `${c.productId}: coverage ${spec.coverage} does not match ${compared}/${total}`
      );
    }
  });

  it("COMP-09: marketplace overlap is real, and a competitor sharing none is excluded", async () => {
    const marketplaces = ((await get(`/products/${DOVE}/marketplaces`)).body["data"] as Json[]).map(
      (m) => (m.marketplace as Json).id as string
    );
    const competitors = await allCompetitors(DOVE);

    for (const c of competitors) {
      const shared = (c.marketplaceIds as string[]).filter((id) => marketplaces.includes(id));
      assert.equal(c.sharedMarketplaces, shared.length, `${c.productId}: shared marketplace count`);
      assert.ok(shared.length > 0, `${c.productId} shares no marketplace yet is in the set`);
    }
  });

  it("COMP-10: evidence weight is similarity × quality × tier factor", async () => {
    const competitors = await allCompetitors(DOVE);
    for (const c of competitors) {
      const factor = c.tier === "direct" ? 1 : 0.6;
      const quality = (c.dataQuality as Json).score as number;
      // Both inputs are published rounded, so compare at the coarser of the
      // two precisions rather than asserting more than is on the wire.
      const expected = (c.similarity as number) * quality * factor;
      assert.ok(
        Math.abs((c.evidenceWeight as number) - expected) < 0.002,
        `${c.productId}: evidenceWeight ${c.evidenceWeight} vs ${expected}`
      );
      assert.ok((c.evidenceWeight as number) <= (c.similarity as number) + 1e-9, "weight cannot exceed similarity");
    }
  });

  it("COMP-11: too few comparables is reported as insufficient, not padded", async () => {
    const { body } = await get(`/products/${REFUSAL}/competitors?pageSize=100`);
    const coverage = body["coverage"] as Json;

    assert.ok((coverage.totalCount as number) < 3, "this product is meant to be thin");
    assert.equal(coverage.level, "insufficient");
    assert.equal(coverage.sufficient, false);
    assert.equal(coverage.meetsTarget, false);

    // The set is not topped up to reach the target.
    assert.equal((body["data"] as Json[]).length, coverage.totalCount);

    // And the shortfall is diagnosed rather than left as "the database said so".
    assert.ok((coverage.shortfallReasons as Json[]).length > 0, "no reason given for the shortfall");
    for (const reason of coverage.shortfallReasons as Json[]) {
      assert.ok(typeof reason.reason === "string" && (reason.count as number) > 0);
    }
  });

  it("COMP-12: pagination and filtering work and agree with each other", async () => {
    const first = await get(`/products/${DOVE}/competitors?page=1&pageSize=4`);
    assert.equal((first.body["data"] as Json[]).length, 4);
    assert.equal(first.body["pagination"].hasPrevious, false);

    const all = await allCompetitors(DOVE);
    assert.equal(first.body["pagination"].total, all.length);
    assert.equal(new Set(all.map((c) => c.productId)).size, all.length, "a member appeared on two pages");

    const similar = await allCompetitors(DOVE, "?minSimilarity=0.7");
    for (const c of similar) assert.ok((c.similarity as number) >= 0.7);
    assert.ok(similar.length < all.length, "the filter should narrow the set");

    const scoped = await allCompetitors(DOVE, "?marketplace=mp_nykaa");
    for (const c of scoped) assert.ok((c.marketplaceIds as string[]).includes("mp_nykaa"));

    const rejected = await get(`/products/${DOVE}/competitors?tier=nonsense`);
    assert.equal(rejected.status, 400, "tier is an enum, not free text");
  });

  it("the same competitive set backs both endpoints", async () => {
    // Two routes, one service: /competitors and /analysis must never compute
    // a different set for the same product.
    const viaCompetitors = (await allCompetitors(DOVE)).map((c) => c.productId).sort();
    const analysis = await analysisOf(DOVE);
    const viaAnalysis = ((analysis.competitors as Json).rows as Json[]).map((r) => r.id).sort();
    assert.deepEqual(viaAnalysis, viaCompetitors);
  });
});

/* ============================================================== ANALYSIS */

describe("ANALYSIS — findings and suppression", () => {
  it("ANALYSIS-01: a strong-data product produces findings, each with metrics and evidence", async () => {
    const data = await analysisOf(DOVE);
    const findings = data.findings as Json[];

    assert.ok(findings.length >= 5, `expected several findings, got ${findings.length}`);
    for (const f of findings) {
      assert.ok(f.id && f.dimension && f.headline, `${f.id}: incomplete`);
      assert.ok(["premium", "aggressive", "neutral"].includes(f.direction as string), `${f.id}: ${f.direction}`);
      assert.ok(Object.keys(f.metrics as Json).length > 0, `${f.id} carries no metrics`);
      assert.ok((f.evidence as unknown[]).length > 0, `${f.id} carries no evidence`);
    }
    assert.equal((data.coverage as Json).level, "strong");
  });

  it("ANALYSIS-02: a single-marketplace product produces no cross-marketplace finding", async () => {
    const data = await analysisOf(SINGLE);
    assert.equal((data.marketplaceRows as Json[]).length, 1);
    assert.equal((data.coverage as Json).crossMarketplaceSupported, false);

    const ids = (data.findings as Json[]).map((f) => f.id);
    for (const crossMarketplace of ["cheapest_is_best_trusted", "price_tracks_trust", "platform_spread"]) {
      assert.ok(!ids.includes(crossMarketplace), `${crossMarketplace} on a one-marketplace product`);
    }
  });

  it("ANALYSIS-03: too little history produces no historical finding", async () => {
    // A one-day window cannot hold the four points a percentile needs.
    const data = await analysisOf(SPARSE, "?window=1d");
    assert.equal(data.history, null, "history must be withheld, not approximated");
    assert.ok(
      !(data.findings as Json[]).some((f) => f.id === "historical_position"),
      "a historical finding without enough history"
    );
    assert.equal((data.coverage as Json).historySupported, false);
  });

  it("ANALYSIS-04: a product with no quantity-bearing attribute produces no per-unit finding", async () => {
    const data = await analysisOf(PHONE);
    // A phone's largest numeric spec is battery capacity, and "per mAh" is
    // not a comparison anyone makes.
    assert.equal(data.unitBasis, null);
    assert.equal((data.coverage as Json).perUnitSupported, false);
    assert.ok(!(data.findings as Json[]).some((f) => f.id === "per_unit_reversal"));
  });

  it("ANALYSIS-05: a quantity-bearing product computes per-unit prices correctly", async () => {
    const data = await analysisOf(DOVE);
    const basis = data.unitBasis as Json;
    assert.equal(basis.key, "volume_ml");
    assert.equal(basis.value, 650);

    const competitors = data.competitors as Json;
    for (const row of competitors.rows as Json[]) {
      if (row.unitValue == null) continue;
      const expected = (row.priceMinor as number) / (row.unitValue as number);
      assert.ok(
        Math.abs((row.unitPriceMinor as number) - expected) < 1e-6,
        `${row.id}: unit price ${row.unitPriceMinor} vs ${expected}`
      );
      // The reversal flag must agree with the two figures behind it.
      const own = competitors.ownUnitPriceMinor as number;
      const expectedFlag =
        (row.priceMinor as number) < ((data.ownMarket as Json).median as number) && (row.unitPriceMinor as number) > own;
      assert.equal(row.cheaperButDearerPerUnit, expectedFlag, `${row.id}: reversal flag`);
    }
  });

  it("ANALYSIS-06: the analysis and the Phase 4 endpoint agree on which promotions are active", async () => {
    /**
     * Two independent implementations of the same validity rule — the
     * analysis repository and the marketplace repository each write their
     * own `valid_from <= date <= valid_to`. Cross-checking them is what
     * makes a boundary change in either one fail, which asserting only
     * against the analysis's own output would not.
     */
    const data = await analysisOf(DOVE);
    const asOf = ((await get(`/products/${DOVE}/promotions?pageSize=1`)).body["meta"] as Json).asOf;
    assert.equal(asOf, "2026-08-14", "both sides judge activity against the dataset's capture date");

    const active: Json[] = [];
    for (let page = 1; page <= 20; page++) {
      const { body } = await get(`/products/${DOVE}/promotions?status=active&page=${page}&pageSize=100`);
      active.push(...(body["data"] as Json[]));
      if (!body["pagination"].hasNext) break;
    }

    const expected = new Map<string, Record<string, number>>();
    for (const promotion of active) {
      const bucket = expected.get(promotion.marketplaceId as string) ?? {};
      bucket[promotion.availabilityClass as string] = (bucket[promotion.availabilityClass as string] ?? 0) + 1;
      expected.set(promotion.marketplaceId as string, bucket);
    }

    let compared = 0;
    for (const row of data.marketplaceRows as Json[]) {
      const counts = row.promoCount as Record<string, number>;
      const wanted = expected.get(row.marketplaceId as string) ?? {};
      for (const cls of ["universal", "conditional", "deferred", "financing"]) {
        assert.equal(counts[cls] ?? 0, wanted[cls] ?? 0, `${row.marketplaceId}: active ${cls} promotions`);
        compared++;
      }
    }
    assert.ok(compared >= 8, "the cross-check must actually compare something");
  });

  it("ANALYSIS-06b: the validity window is inclusive at both ends", async () => {
    /**
     * Constructed, because the seeded data cannot exercise this: not one of
     * the 5,962 promotions ends on the reference date, so changing
     * `valid_to >=` to `valid_to >` is a no-op against it — a mutation test
     * proved exactly that.
     *
     * Two rows, one ending ON the reference date and one the day before.
     * The first must count as active and the second must not. Nothing is
     * fabricated about the analysis; a boundary the dataset happens not to
     * contain is given one.
     */
    const REFERENCE = "2026-08-14";
    const offer = ((await get(`/products/${DOVE}/offers?pageSize=1`)).body["data"] as Json[])[0]!;
    const offerId = offer.id as string;

    const before = (await analysisOf(DOVE)).marketplaceRows as Json[];
    const baseline =
      (before.find((r) => r.marketplaceId === offer.marketplaceId)!.promoCount as Record<string, number>).universal ?? 0;

    const insert = (id: string, validTo: string) =>
      h.db.execute(sql`
        insert into promotions (id, offer_id, promotion_type, availability_class, label,
                                discount_value_minor, valid_from, valid_to)
        values (${id}, ${offerId}, 'instant_discount', 'universal', ${`boundary probe ${validTo}`},
                100, '2026-08-01', ${validTo})`);

    try {
      await insert("promo_boundary_on", REFERENCE);
      const onBoundary = (await analysisOf(DOVE)).marketplaceRows as Json[];
      const counted = (onBoundary.find((r) => r.marketplaceId === offer.marketplaceId)!.promoCount as Record<string, number>)
        .universal;
      assert.equal(counted, baseline + 1, "a promotion ending ON the reference date is still active");

      await insert("promo_boundary_before", shiftDays(REFERENCE, -1));
      const expired = (await analysisOf(DOVE)).marketplaceRows as Json[];
      const stillCounted = (expired.find((r) => r.marketplaceId === offer.marketplaceId)!.promoCount as Record<string, number>)
        .universal;
      assert.equal(stillCounted, baseline + 1, "a promotion that ended yesterday is not active");
    } finally {
      await h.db.execute(sql`delete from promotions where id in ('promo_boundary_on', 'promo_boundary_before')`);
    }

    const after = (await analysisOf(DOVE)).marketplaceRows as Json[];
    assert.equal(
      (after.find((r) => r.marketplaceId === offer.marketplaceId)!.promoCount as Record<string, number>).universal,
      baseline,
      "the fixture must be left as it was found"
    );
  });

  it("promotions enter the price only through the universal class", async () => {
    const data = await analysisOf(DOVE);
    const rows = data.marketplaceRows as Json[];

    for (const row of rows) {
      if (row.effectiveMinor == null) continue;
      // A platform with no universal promotion cannot show a discount.
      if (!row.hasUniversalPromo) {
        assert.equal(row.universalDiscountMinor, 0, `${row.marketplaceId} discounted without a universal promotion`);
        assert.equal(row.effectiveMinor, row.landedMinor, `${row.marketplaceId}`);
      }
      // Conditional benefits are reported but never raise the price.
      if (row.conditionalBestMinor != null) {
        assert.ok((row.conditionalBestMinor as number) <= (row.effectiveMinor as number), `${row.marketplaceId}`);
      }
    }
  });

  it("ANALYSIS-07: every price figure is the effective price, and the ladder adds up", async () => {
    const data = await analysisOf(DOVE);
    for (const row of data.marketplaceRows as Json[]) {
      if (row.effectiveMinor == null) continue;
      assert.equal(
        row.landedMinor,
        (row.headlineMinor as number) + (row.shippingMinor as number),
        `${row.marketplaceId}: landed`
      );
      assert.equal(
        row.effectiveMinor,
        (row.landedMinor as number) - (row.universalDiscountMinor as number),
        `${row.marketplaceId}: effective`
      );
    }

    const shipping = (data.findings as Json[]).find((f) => f.id === "shipping_reorders");
    if (shipping) {
      // The finding exists only when delivery genuinely reorders the ranking.
      assert.ok((data.marketplaceAnalysis as Json).shippingReordersRanking);
    }
  });

  it("ANALYSIS-08: the trust figure damps a rating by its review base", async () => {
    const data = await analysisOf(DOVE);
    for (const row of data.marketplaceRows as Json[]) {
      if (row.rating == null) continue;
      const confidence = Math.min(Math.log10(Math.max((row.reviewCount as number) ?? 0, 1)) / 4, 1);
      const expected = Math.round((3.5 + ((row.rating as number) - 3.5) * confidence) * 100) / 100;
      assert.equal(row.trustRating, expected, `${row.marketplaceId}: trust-weighted rating`);
      // A thin review base pulls the rating toward the 3.5 midpoint.
      if ((row.reviewCount as number) < 10000 && (row.rating as number) > 3.5) {
        assert.ok((row.trustRating as number) < (row.rating as number));
      }
    }
  });

  it("ANALYSIS-09/10: every window resolves to a real range and scopes the history", async () => {
    const referenceDate = "2026-08-14";
    let previous = -1;

    for (const spec of OBSERVATION_WINDOWS) {
      const { status, body } = await get(`/products/${DOVE}/analysis?window=${spec.key}`);
      assert.equal(status, 200, spec.key);

      const meta = body["meta"] as Json;
      assert.equal((meta.window as Json).key, spec.key);
      assert.equal((meta.window as Json).days, spec.days);
      assert.equal((meta.range as Json).from, shiftDays(referenceDate, -(spec.days - 1)), `${spec.key} from`);
      assert.equal((meta.range as Json).to, referenceDate, `${spec.key} to`);

      // A wider horizon can never hold fewer observations.
      const observed = ((body["data"] as Json).coverage as Json).observationCount as number;
      assert.ok(observed >= previous, `${spec.key} holds fewer observations than the window before it`);
      previous = observed;

      // Where a history is produced, it lies inside the window.
      const history = (body["data"] as Json).history as Json | null;
      if (history) {
        assert.ok((history.firstDate as string) >= (meta.range as Json).from, `${spec.key} history starts too early`);
        assert.ok((history.lastDate as string) <= (meta.range as Json).to, `${spec.key} history ends too late`);
      }
    }
  });

  it("ANALYSIS-11: an insufficient-evidence product produces no findings at all", async () => {
    for (const productId of [SINGLE, REFUSAL]) {
      const data = await analysisOf(productId);
      assert.equal((data.coverage as Json).level, "insufficient", productId);
      assert.equal((data.coverage as Json).limited, true, productId);
      assert.deepEqual(data.findings, [], `${productId} invented findings without evidence`);

      // The observation layers are still real and still returned — what
      // disappears is the interpretation.
      assert.ok((data.marketplaceRows as Json[]).length > 0, `${productId} should still report its marketplaces`);
    }
  });

  it("ANALYSIS-12: finding evidence points at records that exist", async () => {
    const data = await analysisOf(DOVE);
    const marketplaceIds = new Set((data.marketplaceRows as Json[]).map((r) => r.marketplaceId as string));
    const competitorIds = new Set(((data.competitors as Json).rows as Json[]).map((r) => r.id as string));

    for (const finding of data.findings as Json[]) {
      for (const item of finding.evidence as Json[]) {
        if (item.marketplaceId) {
          assert.ok(marketplaceIds.has(item.marketplaceId as string), `${finding.id}: unknown marketplace`);
        }
        if (item.productId) {
          assert.ok(competitorIds.has(item.productId as string), `${finding.id}: unknown competitor`);
        }
      }
    }

    // And the headline figures are the ones in the tables, not separate.
    const spread = (data.findings as Json[]).find((f) => f.id === "platform_spread");
    if (spread) {
      const mp = data.marketplaceAnalysis as Json;
      assert.equal((spread.metrics as Json).spreadMinor, mp.spreadMinor);
      assert.equal((spread.metrics as Json).cheapestMarketplaceId, (mp.cheapest as Json).marketplaceId);
    }
  });

  it("the response states what it did not migrate, rather than leaving a silent gap", async () => {
    const { body } = await get(`/products/${DOVE}/analysis`);
    const notMigrated = ((body["meta"] as Json).notMigrated as Json[]).map((n) => n.id);
    assert.deepEqual([...notMigrated].sort(), ["bridge", "wtp"]);
    for (const entry of (body["meta"] as Json).notMigrated as Json[]) {
      assert.ok(typeof entry.reason === "string" && (entry.reason as string).length > 20, `${entry.id} needs a reason`);
    }
  });

  it("an explicit range overrides the window and is reported as the range used", async () => {
    const { body } = await get(`/products/${DOVE}/analysis?from=2026-06-01&to=2026-07-31`);
    const meta = body["meta"] as Json;
    assert.equal(meta.window, null, "no window is claimed when a range was given");
    assert.equal((meta.range as Json).from, "2026-06-01");
    assert.equal((meta.range as Json).to, "2026-07-31");

    const inverted = await get(`/products/${DOVE}/analysis?from=2026-07-31&to=2026-06-01`);
    assert.equal(inverted.status, 400);
  });
});

/* ============================================================== SECURITY */

describe("analysis is protected, and exposes nothing it should not", () => {
  it("both endpoints require authentication", async () => {
    for (const url of [`/products/${DOVE}/analysis`, `/products/${DOVE}/competitors`]) {
      const { status, body } = await get(url, false);
      assert.equal(status, 401, url);
      assert.equal(body["error"].code, "UNAUTHENTICATED");
    }
  });

  it("no authentication or internal field reaches an analysis response", async () => {
    const { raw } = await get(`/products/${DOVE}/analysis`);
    for (const leak of ["passwordHash", "password_hash", "argon2", "tokenHash", "otp", "AUTH_SECRET", "sessionId"]) {
      assert.ok(!raw.includes(leak), `the analysis payload contains "${leak}"`);
    }
  });

  it("an unknown product is a 404, and a malformed window a 400", async () => {
    assert.equal((await get(`/products/nope/analysis`)).status, 404);
    assert.equal((await get(`/products/nope/competitors`)).status, 404);
    assert.equal((await get(`/products/${DOVE}/analysis?window=99d`)).status, 400);
    assert.equal((await get(`/products/${DOVE}/analysis?marketplace=amazon`)).status, 400);
  });
});
