import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * PRICING PARITY FIXTURE
 * ======================
 *
 * The frontend pricing engine is validated and is the baseline. Phase 6
 * moves it to the backend, and "moved" only means anything if the two
 * produce the same prices. This writes down what the ENGINE says for a set
 * of products chosen to exercise every branch, and
 * `server/tests/pricing-parity.test.ts` asks the backend the same questions.
 *
 * It runs on the frontend side because the engine's modules use Vite-style
 * extensionless imports the backend test runner cannot resolve.
 *
 * The fixture is checked in. A diff in it is a change to the pricing
 * engine, which should never be quiet.
 *
 *   node scripts/export-pricing-parity-fixture.mjs
 */

const OUT = resolve("server/tests/fixtures/pricing-parity.json");

/**
 * Ten shapes the brief names, chosen to exercise the engine rather than to
 * look good. Two carry a seller cost, so the break-even floor is genuinely
 * reached rather than always falling back to the market.
 */
const GOLDEN = [
  { id: "prod_dove_hair_fall", shape: "strong data, 6 marketplaces, per-unit meaningful" },
  { id: "prod_lakme_gloss_lip", shape: "strong competition, 5 marketplaces" },
  { id: "prod_boat_wave_band", shape: "multi-marketplace, meaningful history" },
  { id: "prod_cello_gripper_10", shape: "commodity, no promotions at all" },
  { id: "prod_green_soul_vienna", shape: "sparse history — 44 observations" },
  { id: "prod_airpods_pro2", shape: "single marketplace — refusal expected" },
  { id: "prod_galaxy_m14_5g_6_128_blue", shape: "HAS SELLER COST — break-even floor is live" },
  { id: "prod_galaxy_m14_5g_8_256_silver", shape: "same model family — identity dedup" },
  { id: "prod_green_soul_mid", shape: "thin competitor pool" },
  { id: "prod_funskool_uno", shape: "insufficient evidence — refusal expected" },
  { id: "prod_oneplus_buds3", shape: "HAS SELLER COST — earbuds fee rules" },
  { id: "prod_dell_inspiron15_i5_8_512", shape: "HAS SELLER COST — laptop fee rules" },
];

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });

try {
  const [{ getProduct }, engine] = await Promise.all([
    vite.ssrLoadModule("/src/data/products.js"),
    vite.ssrLoadModule("/src/utils/pricingEngine.js"),
  ]);

  const missing = GOLDEN.filter((g) => !getProduct(g.id)).map((g) => g.id);
  if (missing.length) throw new Error(`These golden products do not exist: ${missing.join(", ")}`);

  const cases = [];
  for (const golden of GOLDEN) {
    const rec = engine.buildRecommendation(golden.id);
    const product = getProduct(golden.id);

    const strategyOf = (key) => {
      const s = (rec.strategies ?? []).find((x) => x.key === key);
      if (!s) return null;
      return {
        key: s.key,
        priceMinor: s.priceMinor,
        supported: s.supported ?? null,
        bindingConstraintKey: s.bindingConstraint?.key ?? null,
        bindingBoundMinor: s.bindingConstraint?.boundMinor ?? null,
      };
    };

    cases.push({
      productId: golden.id,
      shape: golden.shape,
      canonicalName: product.canonicalName,

      /** The refusal state is as important as any price. */
      status: rec.insufficientData ? "insufficient_evidence" : "recommended",
      constraintConflict: rec.constraintConflict ?? false,

      strategies: rec.insufficientData
        ? null
        : { fast_sale: strategyOf("fast_sale"), balanced: strategyOf("balanced"), premium: strategyOf("premium") },

      anchor: rec.anchor ? { minor: rec.anchor.minor, basis: rec.anchor.basis } : null,
      floorMinor: rec.constraints?.floorMinor ?? null,
      ceilingMinor: rec.constraints?.ceilingMinor ?? null,
      ceilingSource: rec.constraints?.ceilingSource ?? null,
      travel: rec.constraints?.travel ?? null,

      mrp: {
        // The MRP the engine enforced, and whether it judged it inflated.
        boundMinor: rec.constraints?.hard?.find((h) => h.key === "mrp_ceiling")?.boundMinor ?? null,
        binding: rec.constraints?.hard?.find((h) => h.key === "mrp_ceiling")?.binding ?? null,
      },
      breakEven: {
        boundMinor: rec.constraints?.hard?.find((h) => h.key === "break_even_floor")?.boundMinor ?? null,
        binding: rec.constraints?.hard?.find((h) => h.key === "break_even_floor")?.binding ?? null,
      },

      premiumCeiling: rec.premiumCeiling
        ? {
            basis: rec.premiumCeiling.basis,
            baseMinor: rec.premiumCeiling.baseMinor,
            headroomMinor: rec.premiumCeiling.headroomMinor,
            capMinor: rec.premiumCeiling.capMinor,
            poolQ3Minor: rec.premiumCeiling.poolQ3Minor,
            poolQ3Suppressed: rec.premiumCeiling.poolQ3Suppressed,
          }
        : null,

      /** The WTP model, including — especially — its refusals. */
      wtp: rec.wtp
        ? {
            trusted: rec.wtp.trusted,
            n: rec.wtp.n,
            r2: rec.wtp.r2 ?? null,
            adjR2: rec.wtp.adjR2 ?? null,
            predictedMinor: rec.wtp.predictedMinor,
            featureKeys: (rec.wtp.features ?? []).map((f) => f.key).sort(),
            featureCount: (rec.wtp.features ?? []).length,
            evidencedPremiumMinor: rec.wtp.evidencedPremiumMinor ?? null,
            supported: rec.wtp.supported ?? null,
          }
        : null,

      evidence: rec.evidence
        ? {
            level: rec.evidence.level,
            score: rec.evidence.score,
            sufficient: rec.evidence.sufficient,
            coverageCap: rec.evidence.coverageCap,
            cappedByCoverage: rec.evidence.cappedByCoverage,
            dispersion: rec.evidence.dispersion,
            okChecks: rec.evidence.checks.filter((c) => c.ok).map((c) => c.key).sort(),
          }
        : null,

      ownMarket: rec.ownMarket
        ? { n: rec.ownMarket.n, min: rec.ownMarket.min, median: rec.ownMarket.median, max: rec.ownMarket.max }
        : null,
      compStats: rec.stats ? { n: rec.stats.n, min: rec.stats.min, median: rec.stats.median, max: rec.stats.max } : null,
      poolStats: rec.zones
        ? {
            floorZoneMinor: rec.zones.floorZoneMinor,
            competitiveLowMinor: rec.zones.competitiveLowMinor,
            competitiveMidMinor: rec.zones.competitiveMidMinor,
            competitiveHighMinor: rec.zones.competitiveHighMinor,
            outlierAboveMinor: rec.zones.outlierAboveMinor,
          }
        : null,
      normalMinor: rec.normalMinor ?? null,
      distortionState: rec.distortion?.state ?? null,
    });
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    `${JSON.stringify(
      {
        generatedBy: "scripts/export-pricing-parity-fixture.mjs",
        note: "Expected values come from src/utils/pricingEngine.js — the validated engine and the baseline for Phase 6. Regenerate deliberately; a diff here is a change to the pricing model.",
        caseCount: cases.length,
        cases,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const recommended = cases.filter((c) => c.status === "recommended").length;
  const trusted = cases.filter((c) => c.wtp?.trusted).length;
  const withBreakEven = cases.filter((c) => c.breakEven.boundMinor != null).length;
  console.log(`· ${cases.length} products → ${OUT}`);
  console.log(`  ${recommended} recommended, ${cases.length - recommended} refused`);
  console.log(`  ${trusted} with a TRUSTED attribute model, ${withBreakEven} with a live break-even floor`);
  for (const c of cases) {
    console.log(
      `  ${c.productId.padEnd(34)} ${c.status.padEnd(22)} ` +
        (c.strategies
          ? `${String(c.strategies.fast_sale?.priceMinor).padStart(8)} / ${String(c.strategies.balanced?.priceMinor).padStart(8)} / ${String(c.strategies.premium?.priceMinor).padStart(8)}  wtp:${c.wtp?.trusted ? "trusted" : "no"}`
          : "—")
    );
  }
} finally {
  await vite.close();
}
