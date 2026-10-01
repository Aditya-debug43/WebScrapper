import { performance } from "node:perf_hooks";
import { createDb } from "../db/client.js";
import { AnalysisRepository } from "../modules/analysis/analysis.repository.js";
import { CompetitorService } from "../modules/analysis/competitor.service.js";
import { AnalysisService } from "../modules/analysis/analysis.service.js";
import { PricingRepository } from "../modules/pricing/pricing.repository.js";
import { PricingService, MODEL_VERSIONS, type ModelVersion } from "../modules/pricing/pricing.service.js";

/**
 * RECOMMENDATION BASELINE AND PERFORMANCE — Phase 6, Parts 28 and 30
 *
 * Runs the recommendation for EVERY product and reports:
 *
 *   - how many are recommended and how many refused, against the baseline
 *     established before the migration (1,043 / 113);
 *   - the safety violations that must be zero — a price above MRP, a price
 *     below its floor, strategies out of order, a claim without evidence,
 *     a response that contradicts itself;
 *   - latency, so "it is fast enough" is a measurement rather than a hope.
 *
 * A difference against the baseline is a finding to explain, never a number
 * to edit.
 *
 *   npx tsx src/scripts/recommendation-baseline.ts [--model hedonic-cv-v2]
 */

const requested = process.argv.includes("--model")
  ? (process.argv[process.argv.indexOf("--model") + 1] as ModelVersion)
  : undefined;
if (requested && !MODEL_VERSIONS.includes(requested)) {
  throw new Error(`Unknown model ${requested}. One of: ${MODEL_VERSIONS.join(", ")}`);
}

const EXPECTED_TABLES: Array<[string, string, number]> = [
  ["products", "products", 1172],
  ["categories", "categories", 179],
  ["product types", "product_types", 125],
  ["brands", "brands", 314],
  ["marketplaces", "marketplaces", 6],
  ["listings", "listings", 2947],
  ["sellers", "sellers", 1177],
  ["offers", "offers", 9717],
  ["observations", "price_observations", 354940],
  ["review snapshots", "review_snapshots", 9962],
  ["promotions", "promotions", 5962],
  ["seller rating snapshots", "seller_rating_snapshots", 2015],
  ["marketplace categories", "marketplace_categories", 418],
  ["capture runs", "capture_runs", 9],
];

/**
 * The recommendation baseline, over ALL 1,172 products.
 *
 * Earlier phases recorded "1,156 purchasable → 1,043 recommended / 113
 * refused". That denominator was wrong, and this script found it: there are
 * **1,154** products with a purchasable offer, not 1,156, and 18 with none.
 * 1,043 + 111 + 18 = 1,172, so the total refusal count is the same either way
 * (113 + 16 = 129) — only the population being divided differed.
 *
 * The decisive check was asking the frontend engine the same question over the
 * same 1,172 products (`scripts/engine-recommendation-baseline.mjs`). It
 * returns 1,043 / 129 with the reasons splitting 111 / 18 and zero constraint
 * conflicts — identical to the backend. So the expectations below are the
 * engine's own measured output, not an adjusted number: the recommended count
 * is unchanged at 1,043, and the refusals are now stated against the whole
 * catalogue with their reasons broken out.
 */
const EXPECTED_RECOMMENDED = 1043;
const EXPECTED_REFUSED = 129;
const EXPECTED_REFUSAL_REASONS: Record<string, number> = {
  insufficient_comparables: 111,
  no_current_price: 18,
};

const conn = await createDb();

/**
 * Count queries by wrapping `execute`, which every repository goes through.
 *
 * Latency alone would hide an N+1: a request that fires two hundred fast
 * queries can look acceptable on a local database and fall over on a real
 * one. The count is the number that has to stay flat as the catalogue grows.
 */
let queryCount = 0;
const countingDb = new Proxy(conn.db, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (prop !== "execute" || typeof value !== "function") return value;
    return (...args: unknown[]) => {
      queryCount += 1;
      return (value as (...a: unknown[]) => unknown).apply(target, args);
    };
  },
}) as typeof conn.db;

const analysisRepo = new AnalysisRepository(countingDb);
const competitors = new CompetitorService(analysisRepo);
const analysis = new AnalysisService(analysisRepo, competitors);
const pricing = new PricingService(new PricingRepository(countingDb), analysisRepo, competitors, analysis);

const bar = "=".repeat(88);
console.log(`\n${bar}\nDATASET COUNTS\n${bar}`);
let countMismatches = 0;
for (const [label, table, expected] of EXPECTED_TABLES) {
  const rows = await conn.query<{ n: string }>(`select count(*)::text as n from ${table}`);
  const actual = Number(rows[0]!.n);
  const ok = actual === expected;
  if (!ok) countMismatches += 1;
  console.log(
    `  ${ok ? "ok  " : "DIFF"} ${label.padEnd(26)} ${String(actual).padStart(7)}` +
      (ok ? "" : `   expected ${expected}`)
  );
}

const model = requested ?? "baseline-v1";
console.log(`\n${bar}\nRECOMMENDATION BASELINE — model ${model}\n${bar}`);

const products = await conn.query<{ id: string }>("select id from products order by id");

let recommended = 0;
let refused = 0;
const refusalReasons = new Map<string, number>();
const violations = {
  mrp: [] as string[],
  floor: [] as string[],
  ceiling: [] as string[],
  ordering: [] as string[],
  /** CF-1: a premium claimed with no trusted model behind it. */
  cf1: [] as string[],
  contradiction: [] as string[],
  error: [] as string[],
};
const latencies: number[] = [];

const queryCounts: number[] = [];

for (const { id } of products) {
  const started = performance.now();
  const queriesBefore = queryCount;
  let result: Awaited<ReturnType<typeof pricing.recommend>>;
  try {
    result = await pricing.recommend(id, requested ? { modelVersion: requested } : {});
  } catch (cause) {
    violations.error.push(`${id}: ${cause instanceof Error ? cause.message : String(cause)}`);
    continue;
  }
  latencies.push(performance.now() - started);
  queryCounts.push(queryCount - queriesBefore);

  const data = result.data as Record<string, any>;
  if (data.status !== "recommended") {
    refused += 1;
    refusalReasons.set(data.reason ?? "unknown", (refusalReasons.get(data.reason ?? "unknown") ?? 0) + 1);
    // A refusal must carry no price at all.
    if (data.recommendation != null || (data.strategies ?? []).length > 0) {
      violations.contradiction.push(`${id}: refused but still returned a price`);
    }
    continue;
  }
  recommended += 1;

  const strategies = data.strategies as Array<Record<string, any>>;
  const mrp = (data.constraints.hard as Array<Record<string, any>>).find((c) => c.key === "mrp_ceiling");

  for (const s of strategies) {
    if (mrp?.boundMinor != null && s.priceMinor > mrp.boundMinor) {
      violations.mrp.push(`${id}: ${s.key} ${s.priceMinor} > MRP ${mrp.boundMinor}`);
    }
    if (s.priceMinor < data.floorMinor) violations.floor.push(`${id}: ${s.key} ${s.priceMinor} < ${data.floorMinor}`);
    if (s.priceMinor > data.ceilingMinor) violations.ceiling.push(`${id}: ${s.key} ${s.priceMinor} > ${data.ceilingMinor}`);
  }

  const fast = strategies.find((s) => s.key === "fast_sale")!;
  const balanced = strategies.find((s) => s.key === "balanced")!;
  const premium = strategies.find((s) => s.key === "premium")!;
  if (!(fast.priceMinor <= balanced.priceMinor && balanced.priceMinor <= premium.priceMinor)) {
    violations.ordering.push(`${id}: ${fast.priceMinor} / ${balanced.priceMinor} / ${premium.priceMinor}`);
  }

  // CF-1 — the claim the whole design exists to prevent.
  if (!data.wtp.trusted && (data.wtp.evidencedPremiumMinor !== 0 || data.premiumCeiling.headroomMinor !== 0)) {
    violations.cf1.push(`${id}: premium claimed with an untrusted model`);
  }

  if (data.recommendation.priceMinor !== balanced.priceMinor) {
    violations.contradiction.push(`${id}: headline ${data.recommendation.priceMinor} != balanced ${balanced.priceMinor}`);
  }
  if (data.model.version !== model) {
    violations.contradiction.push(`${id}: response claims model ${data.model.version}`);
  }
}

const delta = (actual: number, expected: number) =>
  actual === expected ? "" : `   expected ${expected}  (${actual > expected ? "+" : ""}${actual - expected})`;

console.log(`  recommended            ${String(recommended).padStart(5)}${delta(recommended, EXPECTED_RECOMMENDED)}`);
console.log(`  refused                ${String(refused).padStart(5)}${delta(refused, EXPECTED_REFUSED)}`);
console.log(`  total                  ${String(recommended + refused).padStart(5)}`);
let reasonMismatches = 0;
for (const [reason, n] of [...refusalReasons].sort((a, b) => b[1] - a[1])) {
  const expected = EXPECTED_REFUSAL_REASONS[reason];
  const ok = expected === n;
  if (!ok) reasonMismatches += 1;
  console.log(
    `    ${ok ? "ok  " : "DIFF"} refused: ${reason.padEnd(26)} ${String(n).padStart(4)}` +
      (ok ? "" : `   expected ${expected ?? "(unknown reason)"}`)
  );
}
for (const reason of Object.keys(EXPECTED_REFUSAL_REASONS)) {
  if (refusalReasons.has(reason)) continue;
  reasonMismatches += 1;
  console.log(`    DIFF refused: ${reason.padEnd(26)}    0   expected ${EXPECTED_REFUSAL_REASONS[reason]}`);
}

console.log(`\n  SAFETY VIOLATIONS (every one of these must be zero)`);
for (const [label, list] of [
  ["MRP violations", violations.mrp],
  ["floor violations", violations.floor],
  ["ceiling violations", violations.ceiling],
  ["ordering violations", violations.ordering],
  ["CF-1 violations", violations.cf1],
  ["contradictions", violations.contradiction],
  ["errors", violations.error],
] as const) {
  console.log(`    ${list.length === 0 ? "ok  " : "FAIL"} ${label.padEnd(22)} ${list.length}`);
  for (const detail of list.slice(0, 5)) console.log(`         ${detail}`);
  if (list.length > 5) console.log(`         … and ${list.length - 5} more`);
}

latencies.sort((a, b) => a - b);
const at = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))]!;
console.log(`\n${bar}\nPERFORMANCE — ${latencies.length} in-process recommendations\n${bar}`);
console.log(`  p50 ${at(0.5).toFixed(0)} ms    p90 ${at(0.9).toFixed(0)} ms    p99 ${at(0.99).toFixed(0)} ms    max ${at(1).toFixed(0)} ms`);
console.log(`  mean ${(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(0)} ms`);
console.log(`  (PGlite in-process, so this is query and compute time with no network or pool contention)`);

const uniqueCounts = [...new Set(queryCounts)].sort((a, b) => a - b);
console.log(
  `\n  queries per recommendation — min ${Math.min(...queryCounts)}, max ${Math.max(...queryCounts)}` +
    (uniqueCounts.length <= 6 ? `  (all values: ${uniqueCounts.join(", ")})` : "")
);
console.log(
  `  ${
    Math.max(...queryCounts) <= 40
      ? "flat and small — nothing scales with the competitor pool, so there is no N+1"
      : "CHECK: the count is high enough to suspect a per-competitor query"
  }`
);

const failed =
  countMismatches > 0 ||
  reasonMismatches > 0 ||
  Object.values(violations).some((v) => v.length > 0) ||
  recommended !== EXPECTED_RECOMMENDED ||
  refused !== EXPECTED_REFUSED;

console.log(
  `\n  ${failed ? "DIFFERENCES FOUND — every one must be explained, not accepted" : "baseline matched exactly"}\n`
);

await conn.close();
process.exit(failed ? 1 : 0);
