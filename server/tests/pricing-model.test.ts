import "./helpers/env.js";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { createAnalysisTestApp, signIn, bearer, type Harness, type Json } from "./helpers/harness.js";
import { MODEL_VERSIONS, PRICING_POLICY, RECOMMENDATION_MODEL_VERSION } from "../src/modules/pricing/pricing.service.js";
import { HEDONIC_CV_THRESHOLDS, fitHedonicCvModel, scoreLambdaGrid, selectLambda } from "../src/modules/pricing/hedonicCv.js";

/**
 * ML-01…10 — the statistical component, `hedonic-cv-v2`.
 *
 * The enhancement Phase 6's research justified is not a bigger model. It is
 * the same features and the same target as the baseline, fitted with ridge
 * regression and trusted on OUT-OF-SAMPLE error instead of in-sample fit,
 * because measurement showed 47% of the baseline's trusted fits predict worse
 * than copying the competitive median. See docs/PRICING_MODEL_RESEARCH.md.
 *
 * These tests hold it to the properties that make it worth having: it is
 * deterministic, it never sees the price it predicts, it is judged on held-out
 * folds, it falls back rather than guessing, it cannot move a price outside
 * its approved bounds, and it says what it is.
 */

const PRODUCTS = [
  "prod_dove_hair_fall",
  "prod_lakme_gloss_lip",
  "prod_cello_gripper_10",
  "prod_green_soul_mid",
  "prod_green_soul_vienna",
  "prod_galaxy_m14_5g_6_128_blue",
  "prod_galaxy_m14_5g_8_256_silver",
  "prod_oneplus_buds3",
  "prod_dell_inspiron15_i5_8_512",
  "prod_boat_wave_band",
  "prod_wakefit_sofa_3s",
  "prod_funskool_uno",
];

let h: Harness;
let token: string;
const v1 = new Map<string, Json>();
const v2 = new Map<string, Json>();

before(async () => {
  h = await createAnalysisTestApp(PRODUCTS);
  ({ token } = await signIn(h, "pricing-model@example.com"));
  for (const id of PRODUCTS) {
    v1.set(id, await recommendation(id, "baseline-v1"));
    v2.set(id, await recommendation(id, "hedonic-cv-v2"));
  }
});
after(async () => {
  await h.close();
});

async function raw(productId: string, model?: string) {
  const query = model ? `?model=${encodeURIComponent(model)}` : "";
  return h.app.inject({
    method: "GET",
    url: `/api/v1/products/${productId}/recommendation${query}`,
    headers: bearer(token),
    remoteAddress: "10.95.0.1",
  });
}

async function recommendation(productId: string, model?: string) {
  const res = await raw(productId, model);
  assert.equal(res.statusCode, 200, `${productId} (${model}): ${res.body.slice(0, 300)}`);
  const body = res.json() as Json;
  return { ...(body["data"] as Json), __meta: body["meta"] } as Json;
}

const wtpOf = (r: Json) => r.wtp as Json | null;
const recommended = (map: Map<string, Json>) => PRODUCTS.filter((id) => map.get(id)!.status === "recommended");

/* ------------------------------------------------------------------ ML-01/02 */

describe("ML-01/02 — the pipeline is reproducible and the features deterministic", () => {
  it("ML-01: the same request returns byte-identical output", async () => {
    for (const id of ["prod_dove_hair_fall", "prod_galaxy_m14_5g_6_128_blue", "prod_oneplus_buds3"]) {
      const first = await recommendation(id, "hedonic-cv-v2");
      const second = await recommendation(id, "hedonic-cv-v2");
      assert.deepEqual(second, first, `${id}: two identical requests produced different recommendations`);
    }
  });

  it("ML-01: the fit function itself is pure — same input, same output", () => {
    /**
     * Driven directly rather than through HTTP, so a stable response cannot be
     * mistaken for a stable model: no caching, no shared state, nothing that
     * could make a non-deterministic fit look reproducible.
     */
    const comps = [
      { productId: "a", currentPriceMinor: 100000, rating: 4.1, brandTier: "mid", specifications: { weight_g: 100 } },
      { productId: "b", currentPriceMinor: 140000, rating: 4.3, brandTier: "premium", specifications: { weight_g: 140 } },
      { productId: "c", currentPriceMinor: 90000, rating: 3.9, brandTier: "value", specifications: { weight_g: 90 } },
      { productId: "d", currentPriceMinor: 120000, rating: 4.2, brandTier: "mid", specifications: { weight_g: 120 } },
      { productId: "e", currentPriceMinor: 160000, rating: 4.5, brandTier: "premium", specifications: { weight_g: 165 } },
      { productId: "f", currentPriceMinor: 80000, rating: 3.7, brandTier: "value", specifications: { weight_g: 82 } },
    ];
    const attrs = [
      {
        attributeKey: "weight_g",
        displayName: "Weight",
        unit: "g",
        dataType: "integer" as const,
        isPricingRelevant: true,
        productTypeId: "t",
      },
    ];
    const input = {
      target: { specifications: { weight_g: 130 }, brandTier: "mid" },
      comps,
      attrs: attrs as never,
      targetRating: 4.25,
    };
    const a = fitHedonicCvModel(input);
    const b = fitHedonicCvModel(input);
    assert.deepEqual(b, a, "the fit is not deterministic");
    assert.ok(a.foldCount === comps.length, `every fold must be scored: ${a.foldCount} of ${comps.length}`);
    assert.ok(typeof a.loocvR2 === "number", "no cross-validated R² was produced");
  });

  it("ML-02: both versions select the SAME features, so only the fit differs", () => {
    for (const id of recommended(v1)) {
      const a = wtpOf(v1.get(id)!);
      const b = wtpOf(v2.get(id)!);
      if (!a || !b) continue;
      assert.deepEqual(
        (b.features as Json[]).map((f) => f.key),
        (a.features as Json[]).map((f) => f.key),
        `${id}: the two versions fitted different features, so any difference between them is not the fitting method`
      );
      assert.equal(b.n, a.n, `${id}: the two versions used different sample sizes`);
    }
  });
});

/* --------------------------------------------------------------------- ML-03 */

describe("ML-03 — no leakage: the model never sees the price it predicts", () => {
  it("ML-03: the fit takes no price for the target it is predicting", () => {
    /**
     * The structural proof, and the strongest one available: the function's
     * input carries the target's specifications, brand tier and rating, and no
     * price for it. There is no channel through which the answer could reach
     * the fit. Varying an attribute moves the prediction; nothing about the
     * target's own price can, because nothing about it is passed.
     */
    const comps = [
      { productId: "a", currentPriceMinor: 100000, rating: 4.1, brandTier: "mid", specifications: { weight_g: 100 } },
      { productId: "b", currentPriceMinor: 140000, rating: 4.3, brandTier: "premium", specifications: { weight_g: 140 } },
      { productId: "c", currentPriceMinor: 90000, rating: 3.9, brandTier: "value", specifications: { weight_g: 90 } },
      { productId: "d", currentPriceMinor: 120000, rating: 4.2, brandTier: "mid", specifications: { weight_g: 120 } },
      { productId: "e", currentPriceMinor: 160000, rating: 4.5, brandTier: "premium", specifications: { weight_g: 165 } },
      { productId: "f", currentPriceMinor: 80000, rating: 3.7, brandTier: "value", specifications: { weight_g: 82 } },
    ];
    const attrs = [
      {
        attributeKey: "weight_g",
        displayName: "Weight",
        unit: "g",
        dataType: "integer" as const,
        isPricingRelevant: true,
        productTypeId: "t",
      },
    ] as never;

    const light = fitHedonicCvModel({
      target: { specifications: { weight_g: 85 }, brandTier: "mid" },
      comps,
      attrs,
      targetRating: 4.25,
    });
    const heavy = fitHedonicCvModel({
      target: { specifications: { weight_g: 160 }, brandTier: "mid" },
      comps,
      attrs,
      targetRating: 4.25,
    });

    assert.notEqual(light.predictedMinor, heavy.predictedMinor, "the prediction does not respond to attributes at all");
    // Same comparables, so the fitted relationship is identical and only the
    // point it is evaluated at differs.
    assert.equal(light.loocvR2, heavy.loocvR2, "the fitted relationship changed when only the target changed");
    assert.equal(light.lambda, heavy.lambda, "the selected penalty changed when only the target changed");
  });

  it("ML-03: with the comparable set held fixed, the target's own price cannot move the prediction", async () => {
    const product = "prod_lakme_gloss_lip";
    const own = await createAnalysisTestApp([product]);
    try {
      const { token: t } = await signIn(own, "ml03@example.com");
      const ask = async () => {
        const res = await own.app.inject({
          method: "GET",
          url: `/api/v1/products/${product}/recommendation?model=hedonic-cv-v2`,
          headers: bearer(t),
          remoteAddress: "10.95.0.2",
        });
        assert.equal(res.statusCode, 200, res.body.slice(0, 200));
        return (res.json() as Json)["data"] as Json;
      };

      const before = await ask();
      const beforeWtp = wtpOf(before)!;
      assert.ok(beforeWtp.predictedMinor != null, "ML-03 needs a product the model will answer for");

      /**
       * Double every price this product is offered at, then check what moved.
       *
       * The fit itself is never handed the target's price (proven above), but
       * the target's price does reach it INDIRECTLY: Phase 5 admits a direct
       * competitor only inside the 0.6×–1.7× band a buyer cross-shops within,
       * and that band is measured around the target. Moving the target's price
       * therefore moves which products are comparable at all.
       *
       * That is a deliberate product decision, not an accident, but it does
       * mean the prediction is not wholly independent of the target's price.
       * The invariant worth holding is the precise one: the prediction may
       * change ONLY if the comparable set changed. If the same comparables
       * come back, the same number must come back with them.
       */
      await own.db.execute(sql`
        update price_observations set selling_price_minor = selling_price_minor * 2
         where offer_id in (select o.id from offers o join listings l on l.id = o.listing_id
                             where l.product_id = ${product})`);

      const after = await ask();
      const afterWtp = wtpOf(after)!;

      // The mutation must have taken effect, or everything below is vacuous.
      assert.notEqual(
        (after.marketContext as Json).currentPriceMinor,
        (before.marketContext as Json).currentPriceMinor,
        "ML-03: the price mutation had no effect, so the leakage check proved nothing"
      );

      const members = (r: Json) =>
        ((r.competitorContext as Json).members as Json[]).map((m) => m.productId as string).sort();
      const sameSet = JSON.stringify(members(after)) === JSON.stringify(members(before));

      if (sameSet) {
        assert.equal(
          afterWtp.predictedMinor,
          beforeWtp.predictedMinor,
          "ML-03: the prediction moved although the comparable set did not — the fit is reading the target's own price"
        );
        assert.equal(afterWtp.loocvR2, beforeWtp.loocvR2, "ML-03: the fit moved with the target's price");
      } else {
        /**
         * The set changed, so a different prediction is expected and correct.
         * What must still hold is that the change is attributable: the model
         * reports the sample it actually used, and the set it was given.
         */
        assert.equal(
          afterWtp.n,
          ((after.competitorContext as Json).members as Json[]).length,
          "ML-03: the model reports a sample size that does not match the set it was given"
        );
        assert.notEqual(
          members(after).join(),
          members(before).join(),
          "ML-03: the set was reported as changed but is identical"
        );
      }
    } finally {
      await own.close();
    }
  });

  it("ML-03: only registry attributes, brand tier and rating can ever be features", () => {
    /**
     * A price model fed the competitive median would be predicting its own
     * input. The feature space is therefore closed by construction, and this
     * asserts the closure holds for every product in the set.
     */
    const allowedSynthetic = new Set(["__tier", "__rating"]);
    const banned = [
      "currentPrice", "competitiveMedian", "compMedian", "normalMinor", "median",
      "spread", "iqr", "anchor", "price", "priceMinor", "effectiveMinor",
    ];
    for (const id of recommended(v2)) {
      const wtp = wtpOf(v2.get(id)!);
      if (!wtp) continue;
      for (const f of wtp.features as Json[]) {
        const key = f.key as string;
        if (allowedSynthetic.has(key)) continue;
        assert.ok(
          !banned.includes(key),
          `${id}: "${key}" is a price-derived feature — predicting price from price is not a model`
        );
      }
    }
  });
});

/* ------------------------------------------------------------------ ML-04/05 */

describe("ML-04/05 — validation is held out, and its metrics are published", () => {
  it("ML-04: every fold is scored, and the trust decision uses the held-out figure", () => {
    let scored = 0;
    for (const id of recommended(v2)) {
      const wtp = wtpOf(v2.get(id)!);
      if (!wtp || wtp.loocvR2 == null) continue;
      scored += 1;
      assert.equal(
        wtp.foldCount,
        wtp.n,
        `${id}: ${wtp.foldCount} folds scored against ${wtp.n} comparables — a cross-validation that skips folds is not one`
      );
      const threshold = (wtp.cvThreshold as Json).minLoocvR2 as number;
      const expected = (wtp.loocvR2 as number) >= threshold && (wtp.predictedMinor as number | null) != null;
      assert.equal(
        wtp.trusted,
        expected,
        `${id}: trusted=${wtp.trusted} but loocvR2=${wtp.loocvR2} against a threshold of ${threshold}`
      );
    }
    assert.ok(scored >= 5, `only ${scored} products were cross-validated — too few to prove anything`);
  });

  it("ML-04: an in-sample fit that fails validation is refused", () => {
    /**
     * The whole reason v2 exists. Across the catalogue 226 of the baseline's
     * 477 trusted fits fail cross-validation; at least one must appear here,
     * or this test set does not exercise the difference and the suite would be
     * green for the wrong reason.
     */
    const overfitted = recommended(v1).filter((id) => {
      const a = wtpOf(v1.get(id)!);
      const b = wtpOf(v2.get(id)!);
      return a?.trusted === true && b?.trusted === false;
    });
    assert.ok(
      overfitted.length >= 1,
      "no product in this set shows an in-sample fit failing cross-validation — the versions cannot be distinguished here"
    );
    for (const id of overfitted) {
      const b = wtpOf(v2.get(id)!)!;
      assert.ok(
        (b.loocvR2 as number) < (b.cvThreshold as Json).minLoocvR2,
        `${id}: refused without its held-out R² being below the threshold`
      );
      // And it must then claim nothing, not merely report a lower number.
      assert.equal(b.evidencedPremiumMinor, 0, `${id}: an unvalidated fit still produced a premium`);
      assert.equal(b.supported, false, `${id}: an unvalidated fit reported itself as supported`);
    }
  });

  it("ML-04: the held-out figure is never flattered by the in-sample one", () => {
    for (const id of recommended(v2)) {
      const wtp = wtpOf(v2.get(id)!);
      if (!wtp || wtp.loocvR2 == null || wtp.inSampleR2 == null) continue;
      assert.ok(
        (wtp.loocvR2 as number) <= (wtp.inSampleR2 as number) + 1e-9,
        `${id}: held-out R² ${wtp.loocvR2} exceeds in-sample ${wtp.inSampleR2}, which cannot happen if the folds are genuinely held out`
      );
    }
  });

  it("ML-05: the evaluation metrics are reported, not merely computed", () => {
    for (const id of recommended(v2)) {
      const wtp = wtpOf(v2.get(id)!);
      if (!wtp) continue;
      for (const field of ["loocvR2", "inSampleR2", "lambda", "foldCount", "cvThreshold"]) {
        assert.ok(field in wtp, `${id}: v2 response is missing ${field}`);
      }
      if (wtp.lambda != null) {
        assert.ok(
          HEDONIC_CV_THRESHOLDS.LAMBDA_GRID.includes(wtp.lambda as number),
          `${id}: penalty ${wtp.lambda} is not one the grid offers`
        );
      }
      assert.match(String(wtp.reason), /\S/, `${id}: no stated reason for the verdict`);
    }
  });

  it("ML-05: the baseline does NOT report cross-validation figures it never computed", () => {
    for (const id of recommended(v1)) {
      const wtp = wtpOf(v1.get(id)!);
      if (!wtp) continue;
      assert.ok(!("loocvR2" in wtp), `${id}: baseline-v1 reported a held-out R² it never measured`);
      assert.ok(!("lambda" in wtp), `${id}: baseline-v1 reported a ridge penalty it never selected`);
    }
  });
});

/* ------------------------------------------------------------------ ML-06/07 */

describe("ML-06/07 — fallback is automatic, and influence is bounded", () => {
  it("ML-06: an untrusted model falls back to the market rather than blocking the price", () => {
    let fellBack = 0;
    for (const id of recommended(v2)) {
      const r = v2.get(id)!;
      const wtp = wtpOf(r)!;
      if (wtp.trusted) continue;
      fellBack += 1;
      // A price still comes back — from the anchor and the constraints.
      assert.ok((r.recommendation as Json).priceMinor > 0, `${id}: no price when the model was untrusted`);
      assert.equal(wtp.evidencedPremiumMinor, 0, `${id}: an untrusted model still moved the price`);
      assert.equal((r.premiumCeiling as Json).headroomMinor, 0, `${id}: untrusted model still bought Premium headroom`);
      assert.equal(
        (r.model as Json).statisticalComponentState,
        wtp.predictedMinor != null ? "untrusted_fallback" : "unavailable_fallback",
        `${id}: the fallback state is not stated`
      );
    }
    assert.ok(fellBack >= 1, "no untrusted model in the set — the fallback path was never exercised");
  });

  it("ML-07: a trusted model moves the price only inside the approved bounds", () => {
    let influenced = 0;
    for (const id of recommended(v2)) {
      const r = v2.get(id)!;
      const wtp = wtpOf(r)!;
      if (!wtp.trusted) continue;
      influenced += 1;

      const anchor = (r.anchor as Json).minor as number;
      const premium = Math.abs(wtp.evidencedPremiumMinor as number);
      assert.ok(
        premium <= Math.round(PRICING_POLICY.maxEvidencedPremiumOverOwn * anchor) + 1,
        `${id}: the model claimed ${premium} against a cap of ${PRICING_POLICY.maxEvidencedPremiumOverOwn} × ${anchor}`
      );

      // And the hard bounds still hold, model or no model.
      for (const s of r.strategies as Json[]) {
        assert.ok(
          (s.priceMinor as number) >= (r.floorMinor as number) && (s.priceMinor as number) <= (r.ceilingMinor as number),
          `${id}: ${s.key} at ${s.priceMinor} escaped [${r.floorMinor}, ${r.ceilingMinor}] under model influence`
        );
      }

      // Travel damping applies to the model's contribution too.
      const travel = (r.constraints as Json).travel as number;
      assert.equal(travel, PRICING_POLICY.travel[(r.evidence as Json).level as string], `${id}: travel was not applied`);
    }
    assert.ok(influenced >= 1, "no trusted model in the set — the influence path was never exercised");
  });
});

/* ------------------------------------------------------------------ ML-08/09 */

describe("ML-08/09 — the version is stated and the explanation matches the model", () => {
  it("ML-08: every response names the version that produced it", async () => {
    for (const id of PRODUCTS) {
      for (const [version, map] of [["baseline-v1", v1], ["hedonic-cv-v2", v2]] as const) {
        const r = map.get(id)!;
        assert.equal((r.__meta as Json).modelVersion, version, `${id}: meta does not name ${version}`);
        if (r.status === "recommended") {
          assert.equal((r.model as Json).version, version, `${id}: the model block does not name ${version}`);
          assert.deepEqual((r.model as Json).available, [...MODEL_VERSIONS], `${id}: the version list is wrong`);
          assert.equal((r.model as Json).default, RECOMMENDATION_MODEL_VERSION, `${id}: the default is misreported`);
        }
      }
    }
  });

  it("ML-08: omitting the parameter uses the baseline, and an unknown version is refused", async () => {
    const implicit = await recommendation("prod_dove_hair_fall");
    assert.equal(
      (implicit.__meta as Json).modelVersion,
      RECOMMENDATION_MODEL_VERSION,
      "the default is not the baseline"
    );

    const bogus = await raw("prod_dove_hair_fall", "gpt-guesses-a-price");
    assert.equal(bogus.statusCode, 400, "an unknown model version was accepted");
    // Silently serving v1 to a caller who asked for something else is worse
    // than an error, because the numbers would look like the other model's.
    assert.ok(!bogus.body.includes("recommendation"), "a rejected version still returned a price");
  });

  it("ML-09: the explanation reports the same fit the model reported", () => {
    for (const [version, map] of [["baseline-v1", v1], ["hedonic-cv-v2", v2]] as const) {
      for (const id of recommended(map)) {
        const r = map.get(id)!;
        const wtp = wtpOf(r)!;
        const factor = (r.explanation as Json[]).find((f) => f.factor === "attribute_value");
        assert.ok(factor, `${id} (${version}): no attribute factor in the explanation`);
        const evidence = factor.evidence as Json;

        assert.equal(evidence.modelTrusted, wtp.trusted, `${id} (${version}): the factor disagrees on trust`);
        assert.equal(evidence.n, wtp.n, `${id} (${version}): the factor disagrees on sample size`);
        assert.equal(
          evidence.predictedMinor,
          wtp.predictedMinor,
          `${id} (${version}): the factor disagrees on the prediction`
        );
        assert.equal(factor.impactMinor, wtp.evidencedPremiumMinor, `${id} (${version}): the factor disagrees on impact`);
        assert.equal(
          factor.direction,
          wtp.supported ? "upward" : "neutral",
          `${id} (${version}): the factor's direction does not follow the model's own verdict`
        );

        /**
         * The model observes that the market prices certain attributes higher.
         * It does not establish that those attributes CAUSE the price, and the
         * response has to say so — a reader who takes association for
         * causation will justify a price the data does not support.
         */
        assert.equal(
          evidence.interpretation,
          "association_not_causation",
          `${id} (${version}): the explanation does not qualify the relationship as association`
        );
      }
    }
  });
});

/* --------------------------------------------------------------------- ML-10 */

describe("ML-10 — nothing unavailable is used, and nothing absent is claimed", () => {
  it("ML-10: the response never claims sales, demand, conversion or elasticity", () => {
    /**
     * This dataset contains no quantity sold at any price, so nothing
     * downstream may name one. The check is on the serialised response
     * because a fabricated field is as harmful in a nested explanation as in
     * a headline.
     */
    const forbidden = [
      "unitsSold", "units_sold", "salesVolume", "conversionRate", "conversion_rate",
      "elasticity", "demandCurve", "demand_curve", "optimalPrice", "optimal_price",
      "willingnessToPayActual", "revenueForecast",
    ];
    for (const [version, map] of [["baseline-v1", v1], ["hedonic-cv-v2", v2]] as const) {
      for (const id of PRODUCTS) {
        const serialised = JSON.stringify(map.get(id));
        for (const field of forbidden) {
          assert.ok(
            !serialised.includes(field),
            `${id} (${version}): the response contains "${field}", which this dataset cannot support`
          );
        }
      }
    }
  });

  it("ML-10: the model states what it predicts, and it is not an optimal price", () => {
    for (const id of recommended(v2)) {
      const model = v2.get(id)!.model as Json;
      assert.equal(
        model.predicts,
        "market_value_estimate_from_observed_listing_prices",
        `${id}: the model does not state what its target variable is`
      );
      assert.equal(model.trustBasis, "out_of_sample_loocv_r2", `${id}: v2 does not state its trust basis`);
      assert.equal((v1.get(id)!.model as Json).trustBasis, "in_sample_adjusted_r2", `${id}: v1 misstates its basis`);
    }
  });

  it("ML-10: a product with too few comparables is refused, not fitted", () => {
    for (const id of PRODUCTS) {
      const r = v2.get(id)!;
      const wtp = wtpOf(r);
      if (!wtp) continue;
      if ((wtp.n as number) >= HEDONIC_CV_THRESHOLDS.MIN_OBSERVATIONS) continue;
      assert.equal(wtp.trusted, false, `${id}: fitted on ${wtp.n} comparables`);
      assert.equal(wtp.predictedMinor, null, `${id}: predicted from ${wtp.n} comparables`);
      assert.match(
        String(wtp.reason),
        new RegExp(String(HEDONIC_CV_THRESHOLDS.MIN_OBSERVATIONS)),
        `${id}: the refusal does not state the minimum it needed`
      );
    }
  });
});

/* ====================================================== mutation coverage */

describe("the rules mutation testing found unasserted", () => {
  it("the penalty is chosen by held-out error, never by fit", () => {
    /**
     * Mutation M10 swapped the selection rule from `loocvR2` to `inSampleR2`
     * and every ML test still passed — because none of them asserted HOW the
     * penalty is picked, only that the value came from the grid. Selecting on
     * fit would always return the smallest penalty (less shrinkage always fits
     * the training rows better), quietly turning v2 back into the
     * unregularised model it exists to replace.
     *
     * A design matrix with a collinear-ish second column, where the grid's
     * two criteria genuinely disagree.
     */
    const X = [
      [1, -1.4, -1.3],
      [1, -0.7, -0.8],
      [1, -0.1, 0.2],
      [1, 0.3, 0.1],
      [1, 0.9, 1.0],
      [1, 1.0, 0.8],
      [1, 1.3, 1.5],
    ];
    const y = [11.2, 11.5, 11.9, 11.85, 12.4, 12.3, 12.7];

    const grid = scoreLambdaGrid(X, y);
    assert.ok(grid.length >= 2, "the grid produced too few fits to choose between");

    const chosen = selectLambda(grid);
    assert.ok(chosen, "no penalty was selected");

    const bestHeldOut = Math.max(...grid.map((g) => g.loocvR2));
    assert.equal(chosen.loocvR2, bestHeldOut, "the selected penalty is not the one with the best held-out error");

    // And the criteria really do disagree here, so the assertion above is not
    // satisfied by accident.
    const bestInSample = grid.reduce((a, b) => (b.inSampleR2 > a.inSampleR2 ? b : a));
    assert.notEqual(
      chosen.lambda,
      bestInSample.lambda,
      "on this input both criteria pick the same penalty, so the test cannot tell them apart"
    );
    assert.equal(
      bestInSample.lambda,
      Math.min(...grid.map((g) => g.lambda)),
      "in-sample fit should always prefer the least shrinkage — if not, this fixture no longer demonstrates the trap"
    );
  });

  it("across real products, some penalty other than the smallest is selected", () => {
    /**
     * The same rule, observed end to end: if selection were by fit, every
     * product would report the grid's smallest penalty.
     */
    const lambdas = recommended(v2)
      .map((id) => wtpOf(v2.get(id)!)?.lambda)
      .filter((l): l is number => typeof l === "number");
    assert.ok(lambdas.length >= 3, `only ${lambdas.length} products reported a penalty`);
    const smallest = Math.min(...HEDONIC_CV_THRESHOLDS.LAMBDA_GRID);
    assert.ok(
      lambdas.some((l) => l > smallest),
      `every product selected the smallest penalty (${smallest}) — selection is not responding to held-out error`
    );
  });
});
