import { performance } from "node:perf_hooks";
import { createDb } from "../db/client.js";
import { AnalysisRepository } from "../modules/analysis/analysis.repository.js";
import { CompetitorService } from "../modules/analysis/competitor.service.js";
import { AnalysisService } from "../modules/analysis/analysis.service.js";
import { MarketplaceRepository } from "../modules/marketplace/marketplace.repository.js";
import { MarketplaceService } from "../modules/marketplace/marketplace.service.js";
import { PricingRepository } from "../modules/pricing/pricing.repository.js";
import { PricingService } from "../modules/pricing/pricing.service.js";

/**
 * WHAT THE ANALYSIS SCREEN COSTS — Phase 8, Part 16
 *
 * The screen makes three requests. This measures each of them, and the three
 * together, across a sample of products, counting queries as well as time —
 * latency alone would hide an N+1 on a local database.
 *
 * Phase 5 recorded /analysis at ~0.8 s and 12 queries. A regression against
 * that is a finding, not a number to accept.
 *
 *   npx tsx src/scripts/analysis-performance.ts
 */

const SAMPLE = [
  "prod_dove_hair_fall",
  "prod_lakme_gloss_lip",
  "prod_boat_wave_band",
  "prod_cello_gripper_10",
  "prod_green_soul_vienna",
  "prod_oneplus_buds3",
  "prod_galaxy_m14_5g_6_128_blue",
  "prod_dell_inspiron15_i5_8_512",
  "prod_airpods_pro2",
  "prod_funskool_uno",
];
const WINDOWS = ["1d", "2d", "3d", "7d", "15d", "1m", "3m"] as const;

const conn = await createDb();

let queries = 0;
const counting = new Proxy(conn.db, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (prop !== "execute" || typeof value !== "function") return value;
    return (...args: unknown[]) => {
      queries += 1;
      return (value as (...a: unknown[]) => unknown).apply(target, args);
    };
  },
}) as typeof conn.db;

const analysisRepo = new AnalysisRepository(counting);
const competitors = new CompetitorService(analysisRepo);
const analysis = new AnalysisService(analysisRepo, competitors);
const pricing = new PricingService(new PricingRepository(counting), analysisRepo, competitors, analysis);
const marketplace = new MarketplaceService(new MarketplaceRepository(counting));

type Sample = { ms: number[]; queries: number[] };
const blank = (): Sample => ({ ms: [], queries: [] });
const timings: Record<string, Sample> = {
  analysis: blank(),
  recommendation: blank(),
  priceSummary: blank(),
  total: blank(),
};

const time = async (bucket: string, run: () => Promise<unknown>) => {
  const startedAt = performance.now();
  const before = queries;
  await run().catch(() => null);
  timings[bucket]!.ms.push(performance.now() - startedAt);
  timings[bucket]!.queries.push(queries - before);
};

for (const productId of SAMPLE) {
  const startedAt = performance.now();
  const before = queries;

  // Sequential here so each call's own cost is attributable; the browser
  // fires all three at once, so the wall-clock a user sees is the slowest.
  await time("analysis", () => analysis.productAnalysis(productId, { from: "0001-01-01" }));
  await time("recommendation", () => pricing.recommend(productId));
  await time("priceSummary", () => marketplace.priceSummary(productId, { windows: [...WINDOWS] }));

  timings.total!.ms.push(performance.now() - startedAt);
  timings.total!.queries.push(queries - before);
}

const report = (label: string, s: Sample) => {
  const sorted = [...s.ms].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
  const q = [...new Set(s.queries)].sort((a, b) => a - b);
  console.log(
    `  ${label.padEnd(16)} p50 ${at(0.5).toFixed(0).padStart(5)} ms   max ${at(1).toFixed(0).padStart(5)} ms   ` +
      `queries ${Math.min(...s.queries)}–${Math.max(...s.queries)}${q.length === 1 ? " (flat)" : ""}`
  );
};

console.log(`\n${"=".repeat(78)}\nANALYSIS SCREEN — ${SAMPLE.length} products\n${"=".repeat(78)}`);
report("/analysis", timings.analysis!);
report("/recommendation", timings.recommendation!);
report("/price-summary", timings.priceSummary!);
report("all three", timings.total!);
console.log(`\n  The browser issues the three in parallel, so a user waits for the slowest,`);
console.log(`  not the sum. Measured on PGlite in-process — a native server is faster.\n`);

await conn.close();
