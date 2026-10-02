import "./helpers/env.js";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { createAnalysisTestApp, signIn, bearer, type Harness, type Json } from "./helpers/harness.js";
import { PRICING_POLICY, RECOMMENDATION_MODEL_VERSION, snapWithin } from "../src/modules/pricing/pricing.service.js";

/**
 * CON-01…07, STRAT-01…05, SPARSE-01…06 — the recommendation's INVARIANTS.
 *
 * `pricing-parity.test.ts` proves the backend computes the same numbers as
 * the validated frontend engine. That is agreement, not safety: both could
 * agree on a price above the legal MRP. This file asserts the properties
 * that must hold whatever the arithmetic produces — a price is never below
 * its floor, never above its ceiling, never negative, never claims evidence
 * it does not have, and a product with thin data gets a smaller claim rather
 * than a fabricated one.
 *
 * Every product here was chosen because it actually exhibits the shape the
 * test needs. The coverage level of each is asserted, so a change in the
 * data that silently turns a thin product into a strong one fails the test
 * rather than making it pass vacuously.
 */

/** Strong / adequate / insufficient coverage, and both refusal reasons. */
const GRADED = [
  "prod_dove_hair_fall",
  "prod_lakme_gloss_lip",
  "prod_boat_wave_band",
  "prod_cello_gripper_10",
  "prod_green_soul_vienna",
  "prod_green_soul_mid",
  "prod_galaxy_m14_5g_6_128_blue",
  "prod_galaxy_m14_5g_8_256_silver",
  "prod_oneplus_buds3",
  "prod_dell_inspiron15_i5_8_512",
];

/** Thin coverage — three or four comparables, no trustworthy attribute model. */
const THIN = ["prod_wakefit_sofa_3s", "prod_fire_tv_stick_4k", "prod_powermax_tda125", "prod_wakefit_study_table"];

/** Too little to compare at all. */
const INSUFFICIENT = ["prod_airpods_pro2", "prod_funskool_uno", "prod_gopro_hero12", "prod_horlicks_classic_500"];

const ALL = [...new Set([...GRADED, ...THIN, ...INSUFFICIENT])];

let h: Harness;
let token: string;
/** One request per product, reused across assertions. */
const recs = new Map<string, Json>();

before(async () => {
  h = await createAnalysisTestApp(ALL);
  ({ token } = await signIn(h, "pricing-invariants@example.com"));
  for (const id of ALL) recs.set(id, await fetchRecommendation(h, token, id));
});
after(async () => {
  await h.close();
});

async function fetchRecommendation(harness: Harness, bearerToken: string, productId: string) {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/products/${productId}/recommendation`,
    headers: bearer(bearerToken),
    remoteAddress: "10.90.0.1",
  });
  assert.equal(res.statusCode, 200, `${productId}: ${res.body.slice(0, 300)}`);
  return (res.json() as Json)["data"] as Json;
}

const rec = (id: string) => {
  const found = recs.get(id);
  assert.ok(found, `${id}: not fetched`);
  return found;
};
const recommended = () => ALL.filter((id) => rec(id).status === "recommended");
const strategiesOf = (id: string) => (rec(id).strategies ?? []) as Array<Json>;
const strategy = (id: string, key: string) => {
  const found = strategiesOf(id).find((s) => s.key === key);
  assert.ok(found, `${id}: no ${key} strategy`);
  return found;
};
const coverageOf = (id: string) => (rec(id).competitorContext as Json).coverage as Json;

/* ============================================================= CON-01…07 */

describe("CON — the hard constraints hold, whatever the arithmetic wants", () => {
  it("CON-01: no strategy price ever exceeds the applicable MRP", () => {
    let checked = 0;
    for (const id of recommended()) {
      const mrp = ((rec(id).constraints as Json).hard as Array<Json>).find((c) => c.key === "mrp_ceiling");
      assert.ok(mrp, `${id}: no MRP constraint reported`);
      if (mrp.boundMinor == null) continue;
      checked += 1;
      for (const s of strategiesOf(id)) {
        assert.ok(
          (s.priceMinor as number) <= (mrp.boundMinor as number),
          `${id}: ${s.key} at ${s.priceMinor} exceeds the MRP ceiling of ${mrp.boundMinor} — selling above printed MRP is illegal, not merely aggressive`
        );
      }
    }
    // An MRP was observed on every product in this dataset; if that ever
    // stops being true the test must not quietly check nothing.
    assert.ok(checked >= 8, `only ${checked} products carried an MRP — too few to prove the ceiling holds`);
  });

  it("CON-02: no strategy price is ever below the floor", () => {
    for (const id of recommended()) {
      const floor = rec(id).floorMinor as number;
      assert.ok(Number.isInteger(floor) && floor > 0, `${id}: floor ${floor} is not a positive integer`);
      for (const s of strategiesOf(id)) {
        assert.ok(
          (s.priceMinor as number) >= floor,
          `${id}: ${s.key} at ${s.priceMinor} is below the floor of ${floor}`
        );
      }
    }
  });

  it("CON-03: no strategy price is ever above the ceiling", () => {
    for (const id of recommended()) {
      const ceiling = rec(id).ceilingMinor as number;
      assert.ok(Number.isInteger(ceiling) && ceiling > 0, `${id}: ceiling ${ceiling} is not a positive integer`);
      assert.ok(ceiling >= (rec(id).floorMinor as number), `${id}: ceiling below floor was not refused`);
      for (const s of strategiesOf(id)) {
        assert.ok(
          (s.priceMinor as number) <= ceiling,
          `${id}: ${s.key} at ${s.priceMinor} is above the ceiling of ${ceiling}`
        );
      }
    }
  });

  it("CON-05: psychological snapping never moves a price outside the bounds", () => {
    /**
     * Snapping rounds down to a credible ending, which can push a price
     * below its floor. The implementation steps back up when that happens,
     * and this proves it: every strategy price sits inside the bounds AND is
     * either a snapped ending or exactly on a bound.
     */
    let snappedCount = 0;
    for (const id of recommended()) {
      const floor = rec(id).floorMinor as number;
      const ceiling = rec(id).ceilingMinor as number;
      for (const s of strategiesOf(id)) {
        const price = s.priceMinor as number;
        assert.ok(price >= floor && price <= ceiling, `${id}: ${s.key} ${price} outside [${floor}, ${ceiling}]`);
        const rupees = price / 100;
        // The grid coarsens with price (₹10 / ₹50 / ₹100) and one rupee is
        // taken off, so a snapped price always ends in 9 — but only the
        // coarsest grid ends in 99. Asserting 99 would have failed ₹509.
        const endsCredibly = Number.isInteger(rupees) && rupees % 10 === 9;
        const onBound = price === floor || price === ceiling;
        assert.ok(
          endsCredibly || onBound,
          `${id}: ${s.key} at ${price} is neither a credible ending nor sitting on a bound`
        );
        if (endsCredibly && !onBound) snappedCount += 1;
      }
    }
    assert.ok(snappedCount > 0, "no price was actually snapped — the test proved nothing");
  });

  it("CON-05: snapping steps back inside the floor however far below the price starts", () => {
    /**
     * Mutation M11 turned the step-up loop into a single `if` and nothing
     * failed. The reason is worth recording: every caller clamps into
     * `[floor, ceiling]` first, and snapping moves a price down by strictly
     * less than one step, so from a clamped input one step always suffices
     * and the loop cannot iterate twice.
     *
     * The loop is what makes the function correct for an input that was NOT
     * clamped, so this feeds it one — a price hundreds of steps below its
     * floor. With `if` in place of `while` it returns ₹10.09 against a ₹50
     * floor.
     */
    const farBelow = snapWithin(1000, 500000, 900000);
    assert.ok(farBelow >= 500000, `snapping returned ${farBelow}, below the floor of 500000`);
    assert.ok(farBelow <= 900000, `snapping returned ${farBelow}, above the ceiling of 900000`);

    // The ordinary clamped case still lands on a credible ending.
    const normal = snapWithin(61234, 50000, 90000);
    assert.equal(normal % 100, 0, "a price came back with stray paise");
    assert.equal((normal / 100) % 10, 9, `${normal} is not a credible ending`);

    // Colliding bounds sit exactly on the ceiling rather than break it.
    const collided = snapWithin(70000, 69990, 70010);
    assert.ok(collided >= 69990 && collided <= 70010, `${collided} escaped a two-rupee band`);
  });

  it("CON-06: no price, bound or premium figure is ever negative", () => {
    for (const id of ALL) {
      const r = rec(id);
      const numbers: Array<[string, unknown]> = [
        ["floorMinor", r.floorMinor],
        ["ceilingMinor", r.ceilingMinor],
        ["anchor", (r.anchor as Json | null)?.minor],
        ["recommendation", (r.recommendation as Json | null)?.priceMinor],
        ["currentPrice", (r.marketContext as Json | null)?.currentPriceMinor],
        ["premium cap", (r.premiumCeiling as Json | null)?.capMinor],
        ["premium headroom", (r.premiumCeiling as Json | null)?.headroomMinor],
        ["wtp prediction", (r.wtp as Json | null)?.predictedMinor],
        ...strategiesOf(id).flatMap((s) => [
          [`${s.key} price`, s.priceMinor] as [string, unknown],
          [`${s.key} raw price`, s.rawPriceMinor] as [string, unknown],
        ]),
      ];
      for (const [label, value] of numbers) {
        if (value == null) continue;
        assert.ok(
          typeof value === "number" && Number.isFinite(value) && value >= 0,
          `${id}: ${label} is ${value} — a negative or non-finite price is never a valid answer`
        );
      }
    }
  });
});

/**
 * CON-04 and CON-07 mutate the data, so they get their own applications — a
 * poisoned row must not leak into the invariant suite above.
 */
describe("CON-04 — a floor above the ceiling refuses instead of emitting a price", () => {
  it("CON-04: an impossible cost produces a refusal, not a loss-making price", async () => {
    const product = "prod_oneplus_buds3";
    const own = await createAnalysisTestApp([product]);
    try {
      const { token: t } = await signIn(own, "con04@example.com");
      const before = await fetchRecommendation(own, t, product);
      assert.equal(before.status, "recommended", "CON-04 needs a product that normally gets a price");

      /**
       * A cost far above the MRP. Every legal price is now loss-making, so
       * the break-even floor rises above the ceiling and no valid price
       * exists. Entered as a NEW cost row rather than an edit, because the
       * service reads the most recent entry.
       */
      const absurdCostMinor = (before.ceilingMinor as number) * 50;
      await own.db.execute(sql`
        insert into seller_cost_inputs (product_id, cost_price_minor, entered_at, note)
        values (${product}, ${absurdCostMinor}, '2026-09-01', 'CON-04 impossible cost')`);

      const after = await fetchRecommendation(own, t, product);
      assert.notEqual(after.status, "recommended", `CON-04 emitted ${JSON.stringify(after.recommendation)}`);
      assert.equal(after.constraintConflict, true, `CON-04: the conflict was not reported (status ${after.status})`);
      assert.ok(after.recommendation == null, "CON-04: a price came back anyway");
      assert.ok(
        after.strategies == null || (after.strategies as Array<Json>).length === 0,
        "CON-04: strategies were still offered when no valid price exists"
      );
      const stated = JSON.stringify(after);
      assert.match(stated, /constraint_conflict/, "CON-04: the refusal does not name the conflict");
    } finally {
      await own.close();
    }
  });
});

describe("CON-07 — impossible discount data cannot produce an impossible price", () => {
  it("CON-07: a discount larger than the price clamps at zero and never goes negative", async () => {
    const product = "prod_lakme_gloss_lip";
    const own = await createAnalysisTestApp([product]);
    try {
      const { token: t } = await signIn(own, "con07@example.com");

      /**
       * A universal discount ten times the highest MRP ever observed on this
       * product, applied to every one of its offers with no validity bounds.
       * Nothing in the dataset looks like this; a scraper bug or a unit
       * mix-up (rupees read as paise) does.
       */
      await own.db.execute(sql`
        insert into promotions (id, offer_id, promotion_type, availability_class, label, discount_value_minor, valid_from, valid_to)
        select 'promo_con07_' || o.id, o.id, 'instant_discount', 'universal', 'CON-07 impossible discount',
               (select max(po.mrp_minor) * 10
                  from price_observations po
                  join offers o2   on o2.id = po.offer_id
                  join listings l2 on l2.id = o2.listing_id
                 where l2.product_id = ${product}),
               null, null
          from offers o
          join listings l on l.id = o.listing_id
         where l.product_id = ${product}`);

      const after = await fetchRecommendation(own, t, product);

      // The ladder clamps the discount to the landed price, so the effective
      // price bottoms out at zero rather than going negative.
      const current = (after.marketContext as Json | null)?.currentPriceMinor;
      if (current != null) assert.equal(current, 0, `CON-07: effective price went to ${current}, not the clamped 0`);

      for (const s of (after.strategies ?? []) as Array<Json>) {
        assert.ok(
          (s.priceMinor as number) >= 0,
          `CON-07: ${s.key} came out at ${s.priceMinor} from impossible discount data`
        );
        assert.ok(
          (s.priceMinor as number) >= (after.floorMinor as number),
          `CON-07: ${s.key} at ${s.priceMinor} fell through the floor of ${after.floorMinor}`
        );
      }
      // Whatever it decides, it must decide something valid.
      assert.ok(
        ["recommended", "insufficient_evidence", "no_valid_price"].includes(after.status as string),
        `CON-07: unexpected status ${after.status}`
      );
    } finally {
      await own.close();
    }
  });
});

/* ============================================================ STRAT-01…05 */

describe("STRAT — the three strategies are real, ordered and evidence-bounded", () => {
  it("STRAT-01: Fast Sale is produced, undercuts the anchor and stays legal", () => {
    for (const id of recommended()) {
      const fast = strategy(id, "fast_sale");
      const anchor = (rec(id).anchor as Json).minor as number;
      assert.equal(typeof fast.priceMinor, "number");
      assert.ok(
        (fast.priceMinor as number) <= anchor,
        `${id}: Fast Sale at ${fast.priceMinor} is above the anchor of ${anchor} — it is meant to undercut`
      );
      assert.ok(
        (fast.priceMinor as number) >= Math.round(anchor * PRICING_POLICY.fastFloorOfAnchor) - 1 ||
          fast.bindingConstraint != null,
        `${id}: Fast Sale at ${fast.priceMinor} fell more than ${
          (1 - PRICING_POLICY.fastFloorOfAnchor) * 100
        }% below the anchor of ${anchor} with no constraint explaining it`
      );
    }
  });

  it("STRAT-02: Balanced is produced and is the headline recommendation", () => {
    for (const id of recommended()) {
      const balanced = strategy(id, "balanced");
      const headline = rec(id).recommendation as Json;
      assert.equal(headline.strategyKey, "balanced", `${id}: the headline is not the Balanced strategy`);
      assert.equal(headline.priceMinor, balanced.priceMinor, `${id}: the headline price is not the Balanced price`);
      assert.ok(
        (balanced.priceMinor as number) >= (strategy(id, "fast_sale").priceMinor as number),
        `${id}: Balanced is below Fast Sale`
      );
    }
  });

  it("STRAT-03: Premium is produced and never undercuts Balanced", () => {
    for (const id of recommended()) {
      const premium = strategy(id, "premium");
      assert.ok(
        (premium.priceMinor as number) >= (strategy(id, "balanced").priceMinor as number),
        `${id}: Premium at ${premium.priceMinor} is below Balanced`
      );
    }
  });

  it("STRAT-04: how far a strategy may travel is set by the evidence level", () => {
    const seen = new Set<string>();
    for (const id of recommended()) {
      const level = (rec(id).evidence as Json).level as string;
      const travel = (rec(id).constraints as Json).travel as number;
      assert.equal(
        travel,
        PRICING_POLICY.travel[level],
        `${id}: evidence is ${level} but travel is ${travel}, not ${PRICING_POLICY.travel[level]}`
      );
      seen.add(level);
    }
    /**
     * Asserting the mapping on one level would pass even if every product
     * scored the same. Several distinct levels must actually appear, and the
     * damping must be monotone in confidence.
     */
    assert.ok(seen.size >= 3, `only ${[...seen].join(", ")} appeared — too few levels to prove travel responds`);
    assert.ok(
      PRICING_POLICY.travel.low < PRICING_POLICY.travel.medium &&
        PRICING_POLICY.travel.medium < PRICING_POLICY.travel["medium-high"] &&
        PRICING_POLICY.travel["medium-high"] <= PRICING_POLICY.travel.high,
      "travel is not monotone in the evidence level"
    );
  });

  it("STRAT-05: Premium claims no headroom when the attribute model is untrusted", () => {
    let untrusted = 0;
    let trusted = 0;
    for (const id of recommended()) {
      const wtp = rec(id).wtp as Json;
      const premium = rec(id).premiumCeiling as Json;
      if (wtp.trusted) {
        trusted += 1;
        continue;
      }
      untrusted += 1;
      assert.equal(
        premium.headroomMinor,
        0,
        `${id}: the attribute model is ${wtp.status} yet Premium claims ${premium.headroomMinor} of evidenced headroom`
      );
      assert.equal(wtp.evidencedPremiumMinor, 0, `${id}: an untrusted model still produced an evidenced premium`);
      assert.equal(wtp.supported, false, `${id}: an untrusted model reported itself as supported`);
      const drivers = (strategy(id, "premium").drivers ?? []) as Array<Json>;
      assert.ok(
        drivers.some((d) => d.factor === "no_evidenced_premium"),
        `${id}: the Premium strategy does not say its premium is unevidenced`
      );
      const attribute = ((rec(id).explanation as Array<Json>) ?? []).find((fac) => fac.factor === "attribute_value");
      assert.ok(attribute, `${id}: no attribute factor in the explanation`);
      assert.equal(attribute.direction, "neutral", `${id}: an untrusted model still pushed the price somewhere`);
    }
    assert.ok(untrusted > 0 && trusted > 0, `need both trusted and untrusted models present (${trusted}/${untrusted})`);
  });
});

/* =========================================================== SPARSE-01…06 */

describe("SPARSE — less data produces a smaller claim, never a fabricated one", () => {
  it("SPARSE-01: a strong-coverage product produces a full recommendation", () => {
    const strong = recommended().filter((id) => coverageOf(id).level === "strong");
    assert.ok(strong.length >= 5, `only ${strong.length} strong-coverage products — the grade is not represented`);
    for (const id of strong) {
      assert.equal(strategiesOf(id).length, 3, `${id}: not all three strategies were offered`);
      assert.ok(((rec(id).anchor as Json).minor as number) > 0, `${id}: no anchor`);
      assert.ok(
        ((rec(id).evidence as Json).checks as Array<Json>).length >= 10,
        `${id}: evidence was not fully assessed`
      );
    }
  });

  it("SPARSE-02: an adequate-coverage product is recommended but held back", () => {
    const adequate = recommended().filter((id) => coverageOf(id).level === "adequate");
    assert.ok(adequate.length >= 1, "no adequate-coverage product in the set");
    for (const id of adequate) {
      const travel = (rec(id).constraints as Json).travel as number;
      assert.ok(
        travel < PRICING_POLICY.travel.high,
        `${id}: adequate coverage was allowed the full travel of a high-confidence product`
      );
      assert.equal(
        (rec(id).evidence as Json).coverageCap,
        "medium-high",
        `${id}: adequate coverage did not cap confidence at medium-high`
      );
    }
  });

  it("SPARSE-03: a thin-coverage product drops the signals it cannot support", () => {
    const thin = THIN.filter((id) => coverageOf(id).level === "thin");
    assert.equal(thin.length, THIN.length, `expected all of ${THIN.join(", ")} to be thin`);
    for (const id of thin) {
      const r = rec(id);
      assert.equal(r.status, "recommended", `${id}: a thin product should still be priced, with a smaller claim`);

      // The attribute model needs five comparables; a thin set has three or
      // four, so it must refuse rather than fit a model to noise.
      const wtp = r.wtp as Json;
      assert.equal(wtp.trusted, false, `${id}: an attribute model was trusted on thin coverage`);
      assert.equal(wtp.predictedMinor, null, `${id}: a WTP prediction was produced from a thin set`);
      assert.equal(wtp.evidencedPremiumMinor, 0, `${id}: a premium was evidenced from a thin set`);
      assert.match(String(wtp.reason), /\S/, `${id}: the model refused without saying why`);

      // And the confidence cap follows the coverage, not the check score.
      assert.equal((r.evidence as Json).coverageCap, "medium", `${id}: thin coverage did not cap confidence at medium`);
      assert.equal(
        (r.premiumCeiling as Json).headroomMinor,
        0,
        `${id}: Premium claimed headroom with no trustworthy model behind it`
      );
    }
  });

  it("SPARSE-04: an insufficient product refuses and says what is missing", () => {
    for (const id of INSUFFICIENT) {
      const r = rec(id);
      assert.equal(r.status, "insufficient_evidence", `${id}: a price was emitted on insufficient evidence`);
      assert.ok(r.recommendation == null, `${id}: a refusal still carried a price`);
      assert.ok(
        r.strategies == null || (r.strategies as Array<Json>).length === 0,
        `${id}: a refusal still offered strategies`
      );
      assert.equal((r.evidence as Json).sufficient, false, `${id}: refused while reporting sufficient evidence`);
      const shortfall = (coverageOf(id).shortfallReasons ?? []) as string[];
      assert.ok(shortfall.length > 0, `${id}: refused without naming a single shortfall`);
    }
  });

  it("SPARSE-05: a single-marketplace product does not invent marketplace evidence", () => {
    /**
     * `prod_airpods_pro2` has almost nothing comparable in this dataset. The
     * recommendation must not present that as a market: no competitive
     * distribution built over one or two points, and a refusal that is about
     * exactly this.
     */
    const r = rec("prod_airpods_pro2");
    assert.equal(r.status, "insufficient_evidence");
    const coverage = coverageOf("prod_airpods_pro2");
    assert.ok((coverage.totalCount as number) <= 2, `airpods: ${coverage.totalCount} comparables is not a sparse case`);
    assert.equal((r.competitorContext as Json).statistics, null, "airpods: competitive statistics were invented");
    /**
     * The shortfall is structured, and it names the marketplace problem
     * specifically: candidates were discarded for sharing no marketplace
     * with this product. That is the honest reason a single-marketplace
     * product cannot be priced against a market, and it is reported as a
     * reason with a count rather than as prose.
     */
    const shortfall = (coverage.shortfallReasons ?? []) as Array<Json>;
    const noSharedMarketplace = shortfall.find((r) => r.reason === "no_shared_marketplace");
    assert.ok(
      noSharedMarketplace,
      `airpods: the shortfall does not mention the missing marketplace overlap: ${JSON.stringify(shortfall)}`
    );
    assert.ok(
      (noSharedMarketplace.count as number) > 0,
      "airpods: the marketplace shortfall was reported with a count of zero"
    );
  });

  it("SPARSE-06: no meaningful competitors means no competitor evidence is fabricated", () => {
    for (const id of INSUFFICIENT) {
      const r = rec(id);
      const context = r.competitorContext as Json;
      const members = (context.members ?? []) as Array<Json>;
      assert.ok(members.length < 3, `${id}: ${members.length} members on a product that refused for lack of them`);
      // No statistics, and no premium ceiling or attribute model built on an
      // unusable pool.
      assert.equal(context.statistics, null, `${id}: competitive statistics over an unusable set`);
      assert.equal(r.premiumCeiling ?? null, null, `${id}: a premium ceiling was built with no comparables`);
      assert.equal(r.wtp ?? null, null, `${id}: an attribute model was reported with no comparables`);
      // Every member that IS reported carries its own evidence weight, so a
      // caller can see how little it is worth.
      for (const m of members) {
        assert.equal(typeof m.similarity, "number", `${id}: a member without a similarity score`);
        assert.equal(typeof m.evidenceWeight, "number", `${id}: a member without an evidence weight`);
      }
    }
  });

  it("every recommendation carries the model version that produced it", () => {
    for (const id of recommended()) {
      assert.equal(
        (rec(id).model as Json).version,
        RECOMMENDATION_MODEL_VERSION,
        `${id}: wrong or missing model version`
      );
    }
  });
});
