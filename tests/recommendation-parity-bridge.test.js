import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildRecommendation } from "../src/utils/pricingEngine";
import { compareRecommendations } from "../src/api/recommendationService";

/**
 * The comparison the recommendation page shows is itself worth testing.
 *
 * `compareRecommendations` reads nine values out of two differently shaped
 * objects. If a reader is wrong it does not throw — it reads `undefined` from
 * both sides, finds them equal, and reports agreement. A green strip on the
 * page would then mean "I compared nothing", which is worse than no strip at
 * all.
 *
 * So this drives it with the real engine output on one side and the real
 * backend DTO on the other, taken from the parity fixture that
 * `server/tests/pricing-parity.test.ts` asserts against. Both sides are real
 * shapes, not hand-written stubs.
 */

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "..", "server", "tests", "fixtures", "pricing-parity.json"), "utf8")
);

/** The backend DTO, reconstructed from the values the fixture captured. */
function backendShapeFor(testCase) {
  if (testCase.status !== "recommended") {
    /**
     * A refusal still reports the evidence assessment — that is what decided
     * to refuse — but carries no price, no anchor, no bounds and no attribute
     * model, because none of them was computed.
     */
    return {
      status: testCase.status,
      strategies: [],
      anchor: null,
      floorMinor: null,
      ceilingMinor: null,
      evidence: { level: testCase.evidence?.level ?? null },
    };
  }
  const s = testCase.strategies;
  return {
    status: "recommended",
    strategies: [
      { key: "fast_sale", priceMinor: s.fast_sale.priceMinor },
      { key: "balanced", priceMinor: s.balanced.priceMinor },
      { key: "premium", priceMinor: s.premium.priceMinor },
    ],
    anchor: { minor: testCase.anchor.minor },
    floorMinor: testCase.floorMinor,
    ceilingMinor: testCase.ceilingMinor,
    wtp: { trusted: testCase.wtp?.trusted ?? null },
    evidence: { level: testCase.evidence?.level ?? null },
  };
}

describe("the recommendation page's backend comparison", () => {
  it("reports agreement when the backend matches the engine", () => {
    for (const testCase of fixture.cases) {
      const local = buildRecommendation(testCase.productId);
      const result = compareRecommendations(local, backendShapeFor(testCase));
      expect(result, testCase.productId).not.toBeNull();
      expect(result.differences, `${testCase.productId}: ${JSON.stringify(result.differences)}`).toEqual([]);
      expect(result.agrees, testCase.productId).toBe(true);
    }
  });

  it("actually compares real values, not undefined on both sides", () => {
    /**
     * The failure mode this file exists for. A recommended product must have
     * compared a price, an anchor and the bounds — if the readers were wrong
     * those would be undefined on both sides and silently "agree".
     */
    const recommendedCase = fixture.cases.find((c) => c.status === "recommended");
    const local = buildRecommendation(recommendedCase.productId);

    expect(local.strategies.find((s) => s.key === "balanced").priceMinor).toBeGreaterThan(0);
    expect(local.anchor.minor).toBeGreaterThan(0);
    expect(local.constraints.floorMinor).toBeGreaterThan(0);
    expect(local.constraints.ceilingMinor).toBeGreaterThan(0);
    expect(typeof local.wtp.trusted).toBe("boolean");
    expect(typeof local.evidence.level).toBe("string");

    expect(compareRecommendations(local, backendShapeFor(recommendedCase)).comparedCount).toBe(9);
  });

  it("names the field when the backend disagrees", () => {
    const testCase = fixture.cases.find((c) => c.status === "recommended");
    const local = buildRecommendation(testCase.productId);
    const wrong = backendShapeFor(testCase);
    wrong.strategies = wrong.strategies.map((s) => (s.key === "balanced" ? { ...s, priceMinor: s.priceMinor + 100 } : s));

    const result = compareRecommendations(local, wrong);
    expect(result.agrees).toBe(false);
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0].field).toBe("balanced");
    expect(result.differences[0].backend).toBe(result.differences[0].local + 100);
  });

  it("catches a refusal the backend does not share", () => {
    const refusing = fixture.cases.find((c) => c.status !== "recommended");
    const local = buildRecommendation(refusing.productId);
    const pretendsToHaveAPrice = {
      status: "recommended",
      strategies: [{ key: "balanced", priceMinor: 12345 }],
      anchor: { minor: 12345 },
      floorMinor: 1,
      ceilingMinor: 99999,
      wtp: { trusted: false },
      evidence: { level: "low" },
    };
    const result = compareRecommendations(local, pretendsToHaveAPrice);
    expect(result.agrees).toBe(false);
    expect(result.differences.map((d) => d.field)).toContain("status");
  });

  it("returns null rather than guessing when either side is missing", () => {
    expect(compareRecommendations(null, {})).toBeNull();
    expect(compareRecommendations({}, null)).toBeNull();
    expect(compareRecommendations(null, null)).toBeNull();
  });
});
