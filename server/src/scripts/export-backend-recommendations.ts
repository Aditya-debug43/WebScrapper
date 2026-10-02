import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createDb } from "../db/client.js";
import { AnalysisRepository } from "../modules/analysis/analysis.repository.js";
import { CompetitorService } from "../modules/analysis/competitor.service.js";
import { AnalysisService } from "../modules/analysis/analysis.service.js";
import { PricingRepository } from "../modules/pricing/pricing.repository.js";
import { PricingService } from "../modules/pricing/pricing.service.js";

/**
 * BACKEND RECOMMENDATIONS, AS THE BROWSER RECEIVES THEM
 *
 * Phase 7 left the browser with a presenter that turns this response into the
 * sentences the recommendation screen already rendered. Proving the screen is
 * unchanged needs both halves in one place, and they live in different
 * runtimes — so the backend's real output is captured here and
 * `tests/recommendation-presenter.test.js` runs the presenter over it and
 * compares the result against the engine that used to do the job.
 *
 * Checked in deliberately. A diff in this file is a change to the API contract
 * the recommendation screen depends on, which should never be quiet.
 *
 *   npx tsx src/scripts/export-backend-recommendations.ts
 */

const OUT = resolve("tests/fixtures/backend-recommendations.json");

/** The same twelve products the pricing parity fixture uses. */
const GOLDEN = [
  "prod_dove_hair_fall",
  "prod_lakme_gloss_lip",
  "prod_boat_wave_band",
  "prod_cello_gripper_10",
  "prod_green_soul_vienna",
  "prod_airpods_pro2",
  "prod_galaxy_m14_5g_6_128_blue",
  "prod_galaxy_m14_5g_8_256_silver",
  "prod_green_soul_mid",
  "prod_funskool_uno",
  "prod_oneplus_buds3",
  "prod_dell_inspiron15_i5_8_512",
];

const conn = await createDb();
const analysisRepo = new AnalysisRepository(conn.db);
const competitors = new CompetitorService(analysisRepo);
const analysis = new AnalysisService(analysisRepo, competitors);
const pricing = new PricingService(new PricingRepository(conn.db), analysisRepo, competitors, analysis);

const responses: Record<string, unknown> = {};
for (const productId of GOLDEN) {
  responses[productId] = await pricing.recommend(productId);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  `${JSON.stringify(
    {
      generatedBy: "server/src/scripts/export-backend-recommendations.ts",
      note: "Real GET /api/v1/products/:id/recommendation payloads for the golden products, under the default model. A diff here is a change to the contract the recommendation screen reads.",
      productCount: GOLDEN.length,
      responses,
    },
    null,
    2
  )}\n`,
  "utf8"
);

const recommended = GOLDEN.filter((id) => (responses[id] as any).data.status === "recommended").length;
console.log(`· ${GOLDEN.length} products → ${OUT}`);
console.log(`  ${recommended} recommended, ${GOLDEN.length - recommended} refused`);

await conn.close();
