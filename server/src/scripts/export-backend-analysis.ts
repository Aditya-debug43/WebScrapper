import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createDb } from "../db/client.js";
import { AnalysisRepository } from "../modules/analysis/analysis.repository.js";
import { CompetitorService } from "../modules/analysis/competitor.service.js";
import { AnalysisService } from "../modules/analysis/analysis.service.js";
import { MarketplaceRepository } from "../modules/marketplace/marketplace.repository.js";
import { MarketplaceService } from "../modules/marketplace/marketplace.service.js";
import { PricingRepository } from "../modules/pricing/pricing.repository.js";
import { PricingService } from "../modules/pricing/pricing.service.js";

/**
 * BACKEND ANALYSIS, AS THE BROWSER RECEIVES IT
 *
 * Phase 8 left the analysis screen with a presenter that turns these three
 * responses into the sentences it used to compose itself. Proving the screen
 * is unchanged needs both halves in one place and they live in different
 * runtimes, so the backend's real output is captured here and
 * `tests/analysis-presenter.test.js` runs the presenter over it and compares
 * the result against the browser engine it replaces.
 *
 *   npx tsx src/scripts/export-backend-analysis.ts
 */

const OUT = resolve("tests/fixtures/backend-analysis.json");

/** Eight shapes: strong, adequate, thin, single-marketplace, refused, sparse. */
const GOLDEN = [
  "prod_dove_hair_fall",
  "prod_lakme_gloss_lip",
  "prod_boat_wave_band",
  "prod_cello_gripper_10",
  "prod_green_soul_vienna",
  "prod_oneplus_buds3",
  "prod_airpods_pro2",
  "prod_funskool_uno",
];

const WINDOWS = ["1d", "2d", "3d", "7d", "15d", "1m", "3m"] as const;

const conn = await createDb();
const analysisRepo = new AnalysisRepository(conn.db);
const competitors = new CompetitorService(analysisRepo);
const analysis = new AnalysisService(analysisRepo, competitors);
const pricing = new PricingService(new PricingRepository(conn.db), analysisRepo, competitors, analysis);
const marketplace = new MarketplaceService(new MarketplaceRepository(conn.db));

const responses: Record<string, unknown> = {};
for (const productId of GOLDEN) {
  // The same three requests, with the same parameters, the screen makes.
  const [a, r, h] = await Promise.all([
    analysis.productAnalysis(productId, { from: "0001-01-01" }),
    pricing.recommend(productId).catch(() => null),
    marketplace.priceSummary(productId, { windows: [...WINDOWS] }).catch(() => null),
  ]);
  responses[productId] = { analysis: a, recommendation: r, horizons: h };
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  `${JSON.stringify(
    {
      generatedBy: "server/src/scripts/export-backend-analysis.ts",
      note: "Real /analysis, /recommendation and /price-summary payloads for the golden products, with the parameters the analysis screen uses. A diff here is a change to the contract that screen reads.",
      productCount: GOLDEN.length,
      responses,
    },
    null,
    2
  )}\n`,
  "utf8"
);

console.log(`· ${GOLDEN.length} products → ${OUT}`);
await conn.close();
