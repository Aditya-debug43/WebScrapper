import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildRecommendation } from "../src/utils/pricingEngine";
import { presentRecommendation } from "../src/utils/recommendationPresenter";

/**
 * THE SCREEN DID NOT CHANGE — asserted, not claimed.
 *
 * Phase 7 made the backend the source of truth for the recommendation and left
 * the browser with a presenter that turns the API's figures into the sentences
 * `RecommendationPanel` already rendered. "The UI is preserved" is worth
 * nothing as a statement, so this compares the two directly: for each golden
 * product, what the browser engine produced against what the presenter
 * produces from the real backend response.
 *
 * Every field the panel reads is compared, PROSE INCLUDED. A reworded
 * sentence, a dropped rationale line, a missing margin row or a differently
 * ordered list all fail here — which is the point, because the alternative is
 * noticing in production that a page lost half its explanation.
 *
 * The engine is now test-only. This file is the main reason it still exists.
 */

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "..", "server", "tests", "fixtures", "backend-recommendations.json"), "utf8")
);
const products = Object.keys(fixture.responses);

/** What the panel reads off a competitor row. */
const comp = (c) => ({
  id: c.product.id,
  name: c.product.canonicalName,
  brandName: c.brand?.name ?? null,
  brandTier: c.brand?.tier ?? null,
  priceMinor: c.currentPriceMinor,
  rating: c.rating,
  similarity: Math.round(c.similarity * 10000) / 10000,
  evidenceWeight: c.evidenceWeight ?? null,
  tier: c.tier,
  tierReason: c.tierReason ?? null,
  qualityNotes: c.quality?.notes ?? [],
  familyAlternateCount: (c.familyAlternates ?? []).length,
});

const margin = (m) => ({
  marketplaceId: m.marketplace.id,
  marketplaceName: m.marketplace.name,
  referralPct: m.feeRule?.referralPct ?? null,
  isCategoryDefault: m.feeRule?.isCategoryDefault ?? null,
  breakEvenMinor: m.breakEvenMinor,
  marginMinor: m.marginMinor,
  marginPct: m.marginPct == null ? null : Math.round(m.marginPct * 1e9) / 1e9,
});

const strategy = (s) => ({
  key: s.key,
  label: s.label,
  priceMinor: s.priceMinor,
  tagline: s.tagline,
  objective: s.objective,
  anchor: s.anchor,
  recommended: s.recommended ?? false,
  // The panel shows a flag only when a premium is NOT evidenced, so that is
  // the distinction worth comparing: the engine leaves `supported` undefined
  // on Fast Sale and Balanced where the API states it positively, and both
  // render identically.
  notEvidenced: s.supported === false,
  warning: s.warning ?? null,
  bestWhen: s.bestWhen,
  rationale: s.rationale,
  bindingConstraintLabel: s.bindingConstraint?.label ?? null,
  position: s.position,
  margins: [...s.margins].map(margin).sort((a, b) => a.marketplaceId.localeCompare(b.marketplaceId)),
});

/** Everything the panel destructures, in one comparable shape. */
function panelView(rec) {
  const shared = {
    insufficientData: rec.insufficientData === true,
    constraintConflict: rec.constraintConflict ?? false,
    currentPriceMinor: rec.currentPriceMinor ?? null,
    coverage: rec.coverage
      ? {
          directCount: rec.coverage.directCount,
          comparableCount: rec.coverage.comparableCount,
          totalCount: rec.coverage.totalCount,
          effectiveComparables: rec.coverage.effectiveComparables,
          target: rec.coverage.target,
          level: rec.coverage.level,
          summary: rec.coverage.summary,
          shortfall: rec.coverage.shortfall,
        }
      : null,
    diversity: rec.diversity
      ? {
          brandCount: rec.diversity.brandCount,
          marketplaceCount: rec.diversity.marketplaceCount,
          priceSpreadPct: rec.diversity.priceSpreadPct,
          notes: rec.diversity.notes,
        }
      : null,
    comps: (rec.comps ?? []).map(comp),
    excludedComps: (rec.excludedComps ?? [])
      .map((c) => ({ ...comp(c), reason: c.reason }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    referenceCount: (rec.competitiveSet?.reference ?? []).length,
  };

  if (rec.insufficientData) {
    return { ...shared, reason: rec.reason, whatWouldHelp: rec.whatWouldHelp ?? [] };
  }

  return {
    ...shared,
    strategies: rec.strategies.map(strategy),
    bounds: rec.bounds,
    confidence: rec.confidence,
    collapsed: rec.collapsed ?? null,
    anchor: { minor: rec.anchor.minor, basis: rec.anchor.basis, detail: rec.anchor.detail },
    normalMinor: rec.normalMinor ?? null,
    distortion: { state: rec.distortion.state, note: rec.distortion.note ?? null },
    ownMarket: rec.ownMarket
      ? { n: rec.ownMarket.n, min: rec.ownMarket.min, median: rec.ownMarket.median, max: rec.ownMarket.max }
      : null,
    stats: { min: rec.stats.min, q1: rec.stats.q1, median: rec.stats.median, q3: rec.stats.q3, max: rec.stats.max },
    zones: {
      poolSize: rec.zones.poolSize,
      ownCount: rec.zones.ownCount,
      compCount: rec.zones.compCount,
      floorZoneMinor: rec.zones.floorZoneMinor,
      competitiveLowMinor: rec.zones.competitiveLowMinor,
      competitiveMidMinor: rec.zones.competitiveMidMinor,
      competitiveHighMinor: rec.zones.competitiveHighMinor,
      outlierAboveMinor: rec.zones.outlierAboveMinor,
      concentration: rec.zones.concentration == null ? null : Math.round(rec.zones.concentration * 1e9) / 1e9,
    },
    wtp: {
      n: rec.wtp.n,
      trusted: rec.wtp.trusted,
      supported: rec.wtp.supported,
      adjR2: rec.wtp.adjR2 ?? null,
      predictedMinor: rec.wtp.predictedMinor ?? null,
      evidencedPremiumMinor: rec.wtp.evidencedPremiumMinor,
      verdict: rec.wtp.verdict,
      featureLabels: (rec.wtp.features ?? []).map((f) => f.label),
    },
    constraints: {
      hard: rec.constraints.hard.map((c) => ({
        key: c.key,
        label: c.label,
        kind: c.kind,
        boundMinor: c.boundMinor,
        binding: c.binding,
        rationale: c.rationale,
      })),
      soft: rec.constraints.soft,
      floorMinor: rec.constraints.floorMinor,
      ceilingMinor: rec.constraints.ceilingMinor,
      ceilingSource: rec.constraints.ceilingSource,
      travel: rec.constraints.travel,
    },
    mrp: { mrpMinor: rec.mrp?.mrpMinor ?? null, reliability: rec.mrp?.reliability ?? null, note: rec.mrp?.note ?? null },
    evidence: {
      level: rec.evidence.level,
      score: rec.evidence.score,
      checks: rec.evidence.checks.map((c) => ({ key: c.key, label: c.label, ok: c.ok, detail: c.detail })),
    },
    currentPriceLayers: rec.currentPriceLayers
      ? {
          mrpMinor: rec.currentPriceLayers.mrpMinor,
          sellingPriceMinor: rec.currentPriceLayers.sellingPriceMinor,
          shippingFeeMinor: rec.currentPriceLayers.shippingFeeMinor,
          landedMinor: rec.currentPriceLayers.landedMinor,
          universalDiscountMinor: rec.currentPriceLayers.universalDiscountMinor,
          universalEffectiveMinor: rec.currentPriceLayers.universalEffectiveMinor,
          conditionalDiscountMinor: rec.currentPriceLayers.conditionalDiscountMinor,
          conditionalBestMinor: rec.currentPriceLayers.conditionalBestMinor,
        }
      : null,
    competition: {
      listingCount: rec.competition.listingCount,
      marketplaceCount: rec.competition.marketplaceCount,
      offerCount: rec.competition.offerCount,
      inStockOfferCount: rec.competition.inStockOfferCount,
      cheapestMinor: rec.competition.cheapestMinor,
      medianMinor: rec.competition.medianMinor,
      spreadMinor: rec.competition.spreadMinor,
    },
    commercial: {
      costPriceMinor: rec.commercial.cost?.costPriceMinor ?? null,
      usesDefaultFeeRule: rec.commercial.usesDefaultFeeRule,
      perMarketplace: rec.commercial.perMarketplace
        .map((m) => ({
          marketplaceId: m.marketplace.id,
          marketplaceName: m.marketplace.name,
          breakEvenMinor: m.breakEvenMinor,
        }))
        .sort((a, b) => a.marketplaceId.localeCompare(b.marketplaceId)),
    },
    strength: {
      index: rec.strength.index,
      components: rec.strength.components.map((c) => ({ key: c.key, label: c.label, score: c.score, weight: c.weight })),
    },
    viability: { known: rec.viability.known, conflict: rec.viability.conflict, note: rec.viability.note },
    sanityChecks: rec.sanityChecks.map((c) => ({ key: c.key, label: c.label, passed: c.passed, detail: c.detail })),
    history: rec.history
      ? {
          observationCount: rec.history.observationCount,
          median30: rec.history.median30,
          median60: rec.history.median60,
          median90: rec.history.median90,
          minMinor: rec.history.minMinor,
          maxMinor: rec.history.maxMinor,
        }
      : null,
  };
}

describe("the presenter reproduces the engine's screen from the backend response", () => {
  it("covers every golden product, recommended and refused", () => {
    expect(products).toHaveLength(12);
    const statuses = products.map((id) => fixture.responses[id].data.status);
    expect(statuses.filter((s) => s === "recommended")).toHaveLength(10);
    expect(statuses.filter((s) => s !== "recommended")).toHaveLength(2);
  });

  for (const productId of products) {
    it(`${productId}: the panel sees the same thing either way`, () => {
      const expected = panelView(buildRecommendation(productId));
      const actual = panelView(presentRecommendation(fixture.responses[productId]));
      expect(actual).toEqual(expected);
    });
  }
});
