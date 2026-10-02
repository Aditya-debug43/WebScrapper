import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCrossMarketplaceAnalysis } from "../src/utils/crossMarketplaceAnalysis";
import { presentAnalysis } from "../src/utils/analysisPresenter";

/**
 * THE ANALYSIS SCREEN DID NOT CHANGE — asserted, not claimed.
 *
 * Phase 8 made the backend the source of truth for the cross-marketplace
 * analysis and left the browser with a presenter that turns the API's figures
 * into the sentences the screen already rendered. This compares the two
 * directly across eight products chosen for their shapes — strong, adequate,
 * thin, single-marketplace, refused — and compares the values the screen
 * displays, prose included.
 *
 * The browser engine is now test-only. This file is the main reason it still
 * exists.
 */

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "..", "server", "tests", "fixtures", "backend-analysis.json"), "utf8")
);
const products = Object.keys(fixture.responses);

/**
 * One finding, as the screen states it.
 *
 * `spec_position` lists the attributes it is ahead or behind on, and the two
 * sides disagree on their ORDER: the engine iterated an in-memory array, the
 * backend iterates its attribute query. Neither order means anything and the
 * engine's is not reproducible from a database, so the labels are sorted on
 * both sides here. Every other word is compared exactly.
 */
const finding = (f) => {
  const base = { id: f.id, dimension: f.dimension, direction: f.direction, headline: f.headline, detail: f.detail, evidence: f.evidence };
  if (f.id !== "spec_position") return base;
  const labels = (headline) => {
    const match = /^(Ahead of the field on|Behind the field on) (.+)$/.exec(headline ?? "");
    return match ? `${match[1]} ${match[2].split(", ").sort().join(", ")}` : headline;
  };
  return { ...base, headline: labels(f.headline), evidence: [...(f.evidence ?? [])].sort() };
};

/** Everything the page destructures and renders. */
function screenView(a) {
  if (!a.available) return { available: false, reason: a.reason };

  const mp = a.marketplaceAnalysis;
  return {
    available: true,
    limited: a.limited === true,
    marketplaceRows: (a.marketplaceRows ?? []).map((r) => ({
      marketplaceId: r.marketplaceId,
      marketplaceName: r.marketplaceName,
      effectiveMinor: r.effectiveMinor,
      landedMinor: r.landedMinor,
      headlineMinor: r.headlineMinor,
      shippingMinor: r.shippingMinor,
      universalDiscountMinor: r.universalDiscountMinor,
      conditionalBestMinor: r.conditionalBestMinor,
      offerCount: r.offerCount,
      inStockCount: r.inStockCount,
      allOutOfStock: r.allOutOfStock,
      rating: r.rating,
      reviewCount: r.reviewCount,
      trustRating: r.trustRating,
      bestSeller: r.bestSeller,
      bestSellerRating: r.bestSellerRating,
      bestSellerFulfilment: r.bestSellerFulfilment,
      matchConfidence: r.matchConfidence,
      promoCount: r.promoCount,
    })),
    marketplaceAnalysis: mp && {
      pricedCount: mp.pricedCount,
      spreadPct: mp.spreadPct,
      priceTrustCorrelation: mp.priceTrustCorrelation,
      shippingReordersRanking: mp.shippingReordersRanking,
      platformsWithUniversalPromo: mp.platformsWithUniversalPromo,
      platformsWithAnyPromo: mp.platformsWithAnyPromo,
      platformsWithPaidShipping: mp.platformsWithPaidShipping,
      cheapestName: mp.cheapest?.marketplaceName ?? null,
      cheapestMinor: mp.cheapest?.effectiveMinor ?? null,
      dearestName: mp.dearest?.marketplaceName ?? null,
      dearestMinor: mp.dearest?.effectiveMinor ?? null,
    },
    competitors: a.competitors && {
      rows: (a.competitors.rows ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        brandTier: c.brandTier,
        tier: c.tier,
        priceMinor: c.priceMinor,
        priceGapPct: c.priceGapPct,
        unitPriceMinor: c.unitPriceMinor,
        unitGapPct: c.unitGapPct,
        cheaperButDearerPerUnit: c.cheaperButDearerPerUnit,
        rating: c.rating,
        reviewCount: c.reviewCount,
        evidenceWeight: c.evidenceWeight,
        // Sorted on both sides: the engine listed platforms in whatever order
        // the set was built in, which is arbitrary and not reproducible. The
        // presenter sorts them so the column is deterministic.
        marketplaceIds: [...(c.marketplaceIds ?? [])].sort(),
      })),
      reversalCount: (a.competitors.reversals ?? []).length,
    },
    history: a.history && {
      observationCount: a.history.observationCount,
      firstDate: a.history.firstDate,
      minMinor: a.history.minMinor,
      maxMinor: a.history.maxMinor,
      currentMinor: a.history.currentMinor,
      percentile: a.history.percentile,
      volatility: a.history.volatility,
      volatilityBand: a.history.volatilityBand,
      promoDays: a.history.promoDays,
      normalMinor: a.history.normalMinor,
      distortionState: a.history.distortion?.state ?? null,
      distortionNote: a.history.distortion?.note ?? null,
    },
    findings: (a.findings ?? []).map(finding),
    unitBasis: a.unitBasis,
    coverage: a.recommendation?.coverage && {
      directCount: a.recommendation.coverage.directCount,
      comparableCount: a.recommendation.coverage.comparableCount,
    },
    bridge: a.bridge && {
      verdict: a.bridge.verdict,
      confidence: a.bridge.confidence,
      floorMinor: a.bridge.floorMinor,
      ceilingMinor: a.bridge.ceilingMinor,
      ceilingSource: a.bridge.ceilingSource,
      collapsed: a.bridge.collapsed ?? null,
      forPremium: a.bridge.forPremium.map((f) => f.id),
      forAggressive: a.bridge.forAggressive.map((f) => f.id),
      neutral: a.bridge.neutral.map((f) => f.id),
      strategies: a.bridge.strategies.map((s) => ({
        key: s.key,
        label: s.label,
        priceMinor: s.priceMinor,
        boundBy: s.boundBy,
        vsOwnMarketPct: s.vsOwnMarketPct,
        vsCompMedianPct: s.vsCompMedianPct,
      })),
    },
  };
}

describe("the presenter reproduces the analysis screen from the backend response", () => {
  it("covers eight products across the coverage grades", () => {
    expect(products).toHaveLength(8);
    const engine = products.map((id) => buildCrossMarketplaceAnalysis(id));
    // Both a full analysis and a limited one must be represented, or the
    // comparison only proves the easy path.
    expect(engine.filter((a) => a.available && !a.limited).length).toBeGreaterThanOrEqual(5);
    expect(engine.filter((a) => a.limited).length).toBeGreaterThanOrEqual(1);
  });

  for (const productId of products) {
    it(`${productId}: the screen sees the same thing either way`, () => {
      const expected = screenView(buildCrossMarketplaceAnalysis(productId));
      const actual = screenView(presentAnalysis(fixture.responses[productId]));
      expect(actual).toEqual(expected);
    });
  }
});
