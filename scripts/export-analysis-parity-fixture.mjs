import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * ANALYSIS PARITY FIXTURE
 * =======================
 *
 * The frontend analysis engine is already validated. Phase 5 moves it to the
 * backend, and "moved" only means anything if the two produce the same
 * answers — so this writes down what the ENGINE says for a set of products
 * chosen to exercise every branch, and `server/tests/analysis-parity.test.ts`
 * asks the backend the same questions.
 *
 * It runs on the frontend side because the engine's modules use Vite-style
 * extensionless imports that the backend test runner cannot resolve.
 *
 * WHAT IS CAPTURED, AND WHAT IS NOT
 * ---------------------------------
 * The competitive set, marketplace comparison, strength, history, per-unit
 * basis, coverage and findings. NOT the `wtp` finding or the strategy
 * bridge: both are the pricing recommendation rather than inputs to it, and
 * they belong to the next phase. They are recorded here as `notMigrated` so
 * a parity gap is visible rather than silent.
 *
 * The fixture is checked in. A diff in it is a change to the analytical
 * engine, which should never be quiet.
 *
 *   node scripts/export-analysis-parity-fixture.mjs
 */

const OUT = resolve("server/tests/fixtures/analysis-parity.json");

/**
 * Ten shapes, chosen to exercise the engine rather than to look good.
 *
 * Resolved at runtime against the real catalogue so a rename cannot silently
 * turn a case into a skipped one — the script fails instead.
 */
const GOLDEN = [
  { id: "prod_dove_hair_fall", shape: "strong coverage, 6 marketplaces, per-unit meaningful" },
  { id: "prod_lakme_gloss_lip", shape: "strong competition, 5 marketplaces" },
  { id: "prod_boat_wave_band", shape: "several marketplaces, meaningful history" },
  { id: "prod_cello_gripper_10", shape: "commodity, no promotions at all" },
  { id: "prod_green_soul_vienna", shape: "sparse history — 44 observations" },
  { id: "prod_airpods_pro2", shape: "single marketplace" },
  { id: "prod_galaxy_m14_5g_6_128_blue", shape: "per-unit must be suppressed; variant family" },
  { id: "prod_galaxy_m14_5g_8_256_silver", shape: "same family as the above — identity dedup" },
  { id: "prod_green_soul_mid", shape: "thin competitor pool" },
  { id: "prod_funskool_uno", shape: "refusal / low-evidence behaviour" },
];

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });

try {
  const [{ getProduct }, engine, analysis, { getAttributeDefinitions }] = await Promise.all([
    vite.ssrLoadModule("/src/data/products.js"),
    vite.ssrLoadModule("/src/utils/pricingEngine.js"),
    vite.ssrLoadModule("/src/utils/crossMarketplaceAnalysis.js"),
    vite.ssrLoadModule("/src/data/attributeDefinitions.js"),
  ]);

  const missing = GOLDEN.filter((g) => !getProduct(g.id)).map((g) => g.id);
  if (missing.length) throw new Error(`These golden products do not exist: ${missing.join(", ")}`);

  const cases = [];

  for (const golden of GOLDEN) {
    const product = getProduct(golden.id);
    const mrp = maxObservedMrp(engine, golden.id);
    const set = engine.buildComparableSet(golden.id, { mrpMinor: mrp });
    const result = analysis.buildCrossMarketplaceAnalysis(golden.id);

    cases.push({
      productId: golden.id,
      shape: golden.shape,
      canonicalName: product.canonicalName,
      productTypeId: product.productTypeId,

      /** The competitive set, member by member. */
      competitiveSet: {
        memberIds: set.members.map((c) => c.product.id),
        directIds: set.direct.map((c) => c.product.id),
        comparableIds: set.comparable.map((c) => c.product.id),
        referenceIds: set.reference.map((c) => c.product.id),
        excludedCount: set.excluded.length,
        members: set.members.map((c) => ({
          productId: c.product.id,
          tier: c.tier,
          similarity: c.similarity,
          evidenceWeight: c.evidenceWeight,
          currentPriceMinor: c.currentPriceMinor,
          sharedMarketplaces: c.sharedMarketplaces,
          marketplaceIds: [...c.marketplaceIds].sort(),
          rating: c.rating,
          reviewCount: c.reviewCount,
          isSameFamily: c.isSameFamily,
          qualityScore: c.quality.score,
          specScore: c.specDetail.score,
          specMatch: c.specDetail.match,
          specPartial: c.specDetail.partial,
          specDiffer: c.specDetail.differ,
          specMissing: c.specDetail.missing,
          breakdown: c.breakdown,
        })),
        coverage: {
          directCount: set.coverage.directCount,
          comparableCount: set.coverage.comparableCount,
          totalCount: set.coverage.totalCount,
          effectiveComparables: set.coverage.effectiveComparables,
          meetsTarget: set.coverage.meetsTarget,
          sufficient: set.coverage.sufficient,
          level: set.coverage.level,
        },
      },

      /** Marketplace comparison. */
      marketplace: result.marketplaceAnalysis
        ? {
            marketplaceCount: result.marketplaceAnalysis.marketplaceCount,
            pricedCount: result.marketplaceAnalysis.pricedCount,
            cheapestMarketplaceId: result.marketplaceAnalysis.cheapest.marketplaceId,
            dearestMarketplaceId: result.marketplaceAnalysis.dearest.marketplaceId,
            spreadMinor: result.marketplaceAnalysis.spreadMinor,
            spreadPct: result.marketplaceAnalysis.spreadPct,
            medianEffectiveMinor: result.marketplaceAnalysis.medianEffectiveMinor,
            priceTrustCorrelation: result.marketplaceAnalysis.priceTrustCorrelation,
            cheapestIsAlsoBestTrusted: result.marketplaceAnalysis.cheapestIsAlsoBestTrusted,
            shippingReordersRanking: result.marketplaceAnalysis.shippingReordersRanking,
            platformsWithPaidShipping: result.marketplaceAnalysis.platformsWithPaidShipping,
            platformsWithStockGap: result.marketplaceAnalysis.platformsWithStockGap,
            lowestMatchConfidence: result.marketplaceAnalysis.lowestMatchConfidence,
          }
        : null,

      marketplaceRows: (result.marketplaceRows ?? []).map((r) => ({
        marketplaceId: r.marketplaceId,
        offerCount: r.offerCount,
        inStockCount: r.inStockCount,
        headlineMinor: r.headlineMinor,
        landedMinor: r.landedMinor,
        effectiveMinor: r.effectiveMinor,
        shippingMinor: r.shippingMinor,
        rating: r.rating,
        reviewCount: r.reviewCount,
        trustRating: r.trustRating,
        matchConfidence: r.matchConfidence,
        promoCount: r.promoCount,
        hasUniversalPromo: r.hasUniversalPromo,
      })),

      /** Per-unit basis — null is a real answer and is asserted as one. */
      unitBasis: result.unitBasis
        ? { key: result.unitBasis.key, unit: result.unitBasis.unit, value: result.unitBasis.value }
        : null,

      /**
       * History over the engine's FULL series. The backend defaults to a
       * window, so the parity test asks it for the matching range.
       */
      history: result.history
        ? {
            observationCount: result.history.observationCount,
            firstDate: result.history.firstDate,
            lastDate: result.history.lastDate,
            minMinor: result.history.minMinor,
            maxMinor: result.history.maxMinor,
            medianMinor: result.history.medianMinor,
            currentMinor: result.history.currentMinor,
            percentile: result.history.percentile,
            volatility: result.history.volatility,
            volatilityBand: result.history.volatilityBand,
            promoDays: result.history.promoDays,
            trendPct: result.history.trendPct,
          }
        : null,

      /**
       * The 90-day normal and the distortion measured against it. Captured
       * because a one-day shift in the window boundary is otherwise
       * invisible — it changes the ratio without necessarily flipping the
       * state, and nothing else would notice.
       */
      normalMinor: result.recommendation?.normalMinor ?? null,
      distortionState: result.recommendation?.distortion?.state ?? null,
      distortionRatio: result.recommendation?.distortion?.ratio ?? null,

      /** Strength index, an analysis input the recommendation later consumes. */
      strength: result.recommendation?.strength
        ? {
            targetRating: result.recommendation.strength.targetRating,
            targetReviews: result.recommendation.strength.targetReviews,
            medianRating: result.recommendation.strength.medianRating,
            medianReviews: result.recommendation.strength.medianReviews,
            specAdvantageCount: result.recommendation.strength.specAdvantages.length,
            specDisadvantageCount: result.recommendation.strength.specDisadvantages.length,
            specTies: result.recommendation.strength.specTies,
          }
        : null,

      /** Competitor-level derived figures, including the per-unit reversal. */
      competitors: result.competitors
        ? {
            ownUnitPriceMinor: result.competitors.ownUnitPriceMinor,
            targetTrustRating: result.competitors.targetTrustRating,
            cheaperCount: result.competitors.cheaperCount,
            dearerCount: result.competitors.dearerCount,
            reversalIds: result.competitors.reversals.map((r) => r.id),
            strongerTrustCount: result.competitors.strongerTrustCount,
            rows: result.competitors.rows.map((r) => ({
              id: r.id,
              tier: r.tier,
              similarity: r.similarity,
              evidenceWeight: r.evidenceWeight,
              priceMinor: r.priceMinor,
              priceGapPct: r.priceGapPct,
              unitValue: r.unitValue,
              unitPriceMinor: r.unitPriceMinor,
              unitGapPct: r.unitGapPct,
              cheaperButDearerPerUnit: r.cheaperButDearerPerUnit,
              trustRating: r.trustRating,
              trustDelta: r.trustDelta,
            })),
          }
        : null,

      /** Own market and competitive statistics — the anchors Phase 6 will read. */
      ownMarket: result.recommendation?.ownMarket
        ? {
            n: result.recommendation.ownMarket.n,
            min: result.recommendation.ownMarket.min,
            median: result.recommendation.ownMarket.median,
            max: result.recommendation.ownMarket.max,
          }
        : null,
      competitiveStatistics: result.recommendation?.stats
        ? {
            n: result.recommendation.stats.n,
            min: result.recommendation.stats.min,
            median: result.recommendation.stats.median,
            max: result.recommendation.stats.max,
          }
        : null,

      /** Finding PRESENCE is the strongest single parity signal. */
      findingIds: (result.findings ?? []).map((f) => f.id).sort(),
      findings: (result.findings ?? []).map((f) => ({ id: f.id, dimension: f.dimension, direction: f.direction })),

      analysisState: {
        available: result.available,
        limited: result.limited ?? false,
        attributeCount: getAttributeDefinitions(product.productTypeId).length,
      },
    });
  }

  /**
   * Two findings are knowingly absent from the backend. Recording them here
   * means the parity test can assert the gap is EXACTLY these two rather
   * than tolerating any difference.
   */
  const notMigrated = ["wtp", "bridge"];

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    `${JSON.stringify(
      {
        generatedBy: "scripts/export-analysis-parity-fixture.mjs",
        note: "Expected values come from src/utils/competitiveSet.js and src/utils/crossMarketplaceAnalysis.js — the validated engine. Regenerate deliberately; a diff here is a change to the analytical engine.",
        notMigrated,
        caseCount: cases.length,
        cases,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const totalMembers = cases.reduce((n, c) => n + c.competitiveSet.memberIds.length, 0);
  const totalFindings = cases.reduce((n, c) => n + c.findingIds.length, 0);
  console.log(`· ${cases.length} products → ${OUT}`);
  console.log(`  ${totalMembers} competitive-set members, ${totalFindings} findings captured`);
  for (const c of cases) {
    console.log(
      `  ${c.productId.padEnd(34)} ${String(c.competitiveSet.memberIds.length).padStart(2)} members · ` +
        `${String(c.findingIds.length).padStart(2)} findings · coverage ${c.competitiveSet.coverage.level}`
    );
  }
} finally {
  await vite.close();
}

/** The same rule the engine applies: the highest MRP observed on the product. */
function maxObservedMrp(engine, productId) {
  let max = null;
  for (const state of engine.getCommercialState(productId)) {
    const mrp = state.layers?.mrpMinor;
    if (mrp != null && mrp > 0 && (max === null || mrp > max)) max = mrp;
  }
  return max;
}
