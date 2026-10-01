import { createDb } from "../db/client.js";
import { AnalysisRepository } from "../modules/analysis/analysis.repository.js";
import { CompetitorService, TIER_RANK, type ScoredCompetitor } from "../modules/analysis/competitor.service.js";
import { fitHedonicModel } from "../modules/pricing/hedonic.js";
import type { AttributeRow } from "../modules/analysis/analysis.repository.js";

/**
 * MODEL EVALUATION — baseline vs candidate vs a naive benchmark
 * ============================================================
 *
 * Phase 6 asks whether an ML layer would make the recommendation stronger.
 * The only way to answer that is to MEASURE, so this scores three models on
 * the same task across the whole catalogue:
 *
 *   NAIVE      predict the target's price as the weighted median of its
 *              comparables. No attributes, no fitting. The control.
 *   BASELINE   the shipped hedonic OLS, trusted when in-sample adjusted
 *              R² ≥ 0.5.
 *   CANDIDATE  the same features fitted with ridge regression whose penalty
 *              is chosen by exact leave-one-out cross-validation, trusted on
 *              OUT-OF-SAMPLE R² instead of in-sample fit.
 *
 * The task is a genuine held-out prediction: the model never sees the target
 * product's own price. It is fitted on the comparables and asked to predict a
 * price we already know, so the error is real generalisation error.
 *
 * It is scored twice:
 *   CROSS-SECTIONAL  comparables priced today, target priced today.
 *   FORWARD          comparables priced 45 days ago, target priced today —
 *                    which is the only way to show the model is not simply
 *                    reading a contemporaneous market back to us.
 *
 *   npx tsx src/scripts/evaluate-pricing-models.ts
 */

const FORWARD_TRAIN_DATE = "2026-06-30";
const MIN_OBSERVATIONS = 5;
const TRUST_R2 = 0.5;
/** Penalties tried by the candidate, on standardised columns. */
const LAMBDA_GRID = [1e-6, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/* ------------------------------------------------------------ linear algebra */

/** Invert a small symmetric matrix by Gauss-Jordan. Null when singular. */
function invert(M: number[][]): number[][] | null {
  const p = M.length;
  const A = M.map((row, i) => [...row, ...Array.from({ length: p }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < p; col++) {
    let pivot = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(A[r]![col]!) > Math.abs(A[pivot]![col]!)) pivot = r;
    if (Math.abs(A[pivot]![col]!) < 1e-12) return null;
    [A[col], A[pivot]] = [A[pivot]!, A[col]!];
    const d = A[col]![col]!;
    for (let j = 0; j < 2 * p; j++) A[col]![j]! /= d;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = A[r]![col]!;
      if (f === 0) continue;
      for (let j = 0; j < 2 * p; j++) A[r]![j]! -= f * A[col]![j]!;
    }
  }
  return A.map((row) => row.slice(p));
}

/**
 * Ridge with exact leave-one-out cross-validation.
 *
 * For a linear smoother the LOO residual is eᵢ / (1 − hᵢᵢ), so every fold is
 * available from a single fit. At these sample sizes that is not an
 * optimisation, it is what makes honest validation possible at all: splitting
 * 8 comparables into folds would leave nothing to fit on.
 */
function ridgeLoocv(X: number[][], y: number[], lambda: number) {
  const n = X.length;
  const p = X[0]!.length;
  const XtX = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) => {
      let s = 0;
      for (let k = 0; k < n; k++) s += X[k]![i]! * X[k]![j]!;
      // The intercept is never penalised; shrinking it would bias the level.
      return s + (i === j && i > 0 ? lambda : 0);
    })
  );
  const inv = invert(XtX);
  if (!inv) return null;

  const Xty = Array.from({ length: p }, (_, i) => {
    let s = 0;
    for (let k = 0; k < n; k++) s += X[k]![i]! * y[k]!;
    return s;
  });
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j]!, 0));

  let press = 0;
  let clean = true;
  for (let k = 0; k < n; k++) {
    const xk = X[k]!;
    // hᵢᵢ = xᵢᵀ (XᵀX + λI)⁻¹ xᵢ
    let h = 0;
    for (let i = 0; i < p; i++) {
      let row = 0;
      for (let j = 0; j < p; j++) row += inv[i]![j]! * xk[j]!;
      h += xk[i]! * row;
    }
    const fitted = xk.reduce((s, v, i) => s + v * beta[i]!, 0);
    const denom = 1 - h;
    // h ≈ 1 means that point alone determines its own fit; its LOO residual
    // is undefined and the fold cannot be scored.
    if (!(Math.abs(denom) > 1e-8)) {
      clean = false;
      break;
    }
    press += ((y[k]! - fitted) / denom) ** 2;
  }
  if (!clean) return null;

  const my = mean(y);
  const ssTot = y.reduce((s, v) => s + (v - my) ** 2, 0);
  return { beta, press, loocvR2: ssTot === 0 ? 0 : 1 - press / ssTot };
}

/* ---------------------------------------------------------- feature building */

type Comp = { priceMinor: number; rating: number | null; brandTier: string | null; specifications: Record<string, unknown> | null };
type Target = { rating: number | null; brandTier: string | null; specifications: Record<string, unknown> | null };

/**
 * The SAME candidate features the shipped model uses, including its quirk of
 * dropping customer rating (see the note in hedonic.ts). Changing the feature
 * set and the fitting method at once would make the comparison meaningless.
 */
function buildColumns(target: Target, comps: Comp[], attrs: AttributeRow[]) {
  const numeric = attrs.filter((a) => a.isPricingRelevant && ["integer", "decimal"].includes(a.dataType));
  const defs = [
    ...numeric.map((a) => ({
      key: a.attributeKey,
      of: (c: Comp) => Number(c.specifications?.[a.attributeKey]),
      targetValue: Number(target.specifications?.[a.attributeKey]),
    })),
    { key: "__rating", of: (c: Comp) => (c.rating != null ? Number(c.rating) : NaN), targetValue: NaN },
    {
      key: "__tier",
      of: (c: Comp) => TIER_RANK[c.brandTier ?? ""] ?? NaN,
      targetValue: TIER_RANK[target.brandTier ?? ""] ?? NaN,
    },
  ];
  return defs.filter((d) => {
    const vals = comps.map(d.of).filter(Number.isFinite);
    return vals.length === comps.length && new Set(vals).size > 1 && Number.isFinite(d.targetValue);
  });
}

function pearson(xs: number[], ys: number[]) {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    dx += (xs[i]! - mx) ** 2;
    dy += (ys[i]! - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

/** The candidate: same features, ridge penalty chosen by LOOCV, judged on LOOCV R². */
function fitCandidate(target: Target, comps: Comp[], attrs: AttributeRow[]) {
  const n = comps.length;
  if (n < MIN_OBSERVATIONS) return { trusted: false, predictedMinor: null, loocvR2: null, lambda: null, k: 0 };

  const defs = buildColumns(target, comps, attrs);
  if (defs.length === 0) return { trusted: false, predictedMinor: null, loocvR2: null, lambda: null, k: 0 };

  const logPrices = comps.map((c) => Math.log(c.priceMinor));
  const maxFeatures = Math.max(1, Math.floor((n - 2) / 2));
  const ranked = defs
    .map((d) => ({ def: d, r: pearson(comps.map(d.of), logPrices) }))
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
    .slice(0, maxFeatures);

  const cols = ranked.map(({ def }) => {
    const vals = comps.map(def.of);
    const mu = mean(vals);
    const sd = Math.sqrt(mean(vals.map((v) => (v - mu) ** 2))) || 1;
    return { def, mu, sd, z: vals.map((v) => (v - mu) / sd) };
  });
  const X = comps.map((_, i) => [1, ...cols.map((c) => c.z[i]!)]);

  let best: { lambda: number; loocvR2: number; beta: number[] } | null = null;
  for (const lambda of LAMBDA_GRID) {
    const fit = ridgeLoocv(X, logPrices, lambda);
    if (!fit) continue;
    if (!best || fit.loocvR2 > best.loocvR2) best = { lambda, loocvR2: fit.loocvR2, beta: fit.beta };
  }
  if (!best) return { trusted: false, predictedMinor: null, loocvR2: null, lambda: null, k: cols.length };

  const targetZ = cols.map((c) => (c.def.targetValue - c.mu) / c.sd);
  const predictedLog = best.beta[0]! + targetZ.reduce((s, z, i) => s + z * best!.beta[i + 1]!, 0);
  const predictedMinor = Math.round(Math.exp(predictedLog));

  return {
    trusted: best.loocvR2 >= TRUST_R2 && Number.isFinite(predictedMinor) && predictedMinor > 0,
    predictedMinor: Number.isFinite(predictedMinor) ? predictedMinor : null,
    loocvR2: best.loocvR2,
    lambda: best.lambda,
    k: cols.length,
  };
}

/* ------------------------------------------------------------------- metrics */

type Row = { actual: number; predicted: number };

function score(rows: Row[]) {
  if (rows.length === 0) return null;
  const abs = rows.map((r) => Math.abs(r.predicted - r.actual));
  const ape = rows.map((r) => Math.abs(r.predicted - r.actual) / r.actual);
  const logErr = rows.map((r) => Math.log(r.predicted) - Math.log(r.actual));
  const actualLogs = rows.map((r) => Math.log(r.actual));
  const meanActualLog = mean(actualLogs);
  const ssTot = actualLogs.reduce((s, v) => s + (v - meanActualLog) ** 2, 0);
  const ssRes = logErr.reduce((s, v) => s + v ** 2, 0);
  const sorted = [...ape].sort((a, b) => a - b);
  return {
    n: rows.length,
    maeRupees: mean(abs) / 100,
    rmseRupees: Math.sqrt(mean(abs.map((v) => v ** 2))) / 100,
    mape: mean(ape),
    medianApe: sorted[Math.floor((sorted.length - 1) / 2)]!,
    r2Log: ssTot === 0 ? 0 : 1 - ssRes / ssTot,
  };
}

const fmt = (s: ReturnType<typeof score>, label: string, total: number) =>
  s == null
    ? `  ${label.padEnd(22)} no predictions`
    : `  ${label.padEnd(22)} n=${String(s.n).padStart(4)} (${((s.n / total) * 100).toFixed(0).padStart(3)}% cover)  ` +
      `MAE ₹${s.maeRupees.toFixed(0).padStart(6)}  RMSE ₹${s.rmseRupees.toFixed(0).padStart(7)}  ` +
      `MAPE ${(s.mape * 100).toFixed(1).padStart(6)}%  medAPE ${(s.medianApe * 100).toFixed(1).padStart(5)}%  R²(log) ${s.r2Log.toFixed(3).padStart(7)}`;

/* ---------------------------------------------------------------------- main */

const conn = await createDb();
const repo = new AnalysisRepository(conn.db);
const competitors = new CompetitorService(repo);

const referenceDate = await repo.referenceDate();
if (!referenceDate) throw new Error("no observations");

const allProducts = await conn.query<{ id: string; productTypeId: string | null; brandTier: string | null; specifications: Record<string, unknown> | null }>(
  `select p.id, p.product_type_id as "productTypeId", b.tier as "brandTier", p.specifications
     from products p left join brands b on b.id = p.brand_id
    where p.product_type_id is not null
    order by p.id`
);

/** The target's own price today: the cheapest in-stock effective offer. */
const currentPrices = new Map<string, number>();
for (const row of await conn.query<{ productId: string; minor: number }>(
  `select l.product_id as "productId", min(latest.eff)::int as minor
     from listings l
     join offers o on o.listing_id = l.id
     join lateral (
       select (po.selling_price_minor + po.shipping_fee_minor
               - least((select coalesce(sum(pr.discount_value_minor),0)::int from promotions pr
                         where pr.offer_id = po.offer_id and pr.availability_class = 'universal'
                           and (pr.valid_from is null or pr.valid_from <= po.observed_at)
                           and (pr.valid_to is null or pr.valid_to >= po.observed_at)),
                      po.selling_price_minor + po.shipping_fee_minor)) as eff,
              po.is_in_stock
         from price_observations po where po.offer_id = o.id
        order by po.observed_at desc limit 1) latest on true
    where latest.is_in_stock
    group by l.product_id`
)) {
  currentPrices.set(row.productId, row.minor);
}

/** Every product's cheapest effective price on or before the forward train date. */
const trainPrices = new Map<string, number>();
for (const row of await conn.query<{ productId: string; minor: number }>(
  `select l.product_id as "productId", min(asof.eff)::int as minor
     from listings l
     join offers o on o.listing_id = l.id
     join lateral (
       select (po.selling_price_minor + po.shipping_fee_minor
               - least((select coalesce(sum(pr.discount_value_minor),0)::int from promotions pr
                         where pr.offer_id = po.offer_id and pr.availability_class = 'universal'
                           and (pr.valid_from is null or pr.valid_from <= po.observed_at)
                           and (pr.valid_to is null or pr.valid_to >= po.observed_at)),
                      po.selling_price_minor + po.shipping_fee_minor)) as eff,
              po.is_in_stock
         from price_observations po
        where po.offer_id = o.id and po.observed_at <= '${FORWARD_TRAIN_DATE}'
        order by po.observed_at desc limit 1) asof on true
    where asof.is_in_stock
    group by l.product_id`
)) {
  trainPrices.set(row.productId, row.minor);
}

const ratings = new Map<string, number | null>();
for (const row of await conn.query<{ productId: string; rating: number | null }>(
  `select l.product_id as "productId",
          (sum(latest.average_rating * latest.rating_count) / nullif(sum(latest.rating_count),0))::float as rating
     from listings l
     join lateral (select rs.average_rating, rs.rating_count from review_snapshots rs
                    where rs.listing_id = l.id order by rs.captured_at desc limit 1) latest on true
    group by l.product_id`
)) {
  ratings.set(row.productId, row.rating);
}

const attrCache = new Map<string, AttributeRow[]>();
const attrsFor = async (productTypeId: string) => {
  if (!attrCache.has(productTypeId)) attrCache.set(productTypeId, await repo.attributesFor(productTypeId));
  return attrCache.get(productTypeId)!;
};

const weightedMedian = (comps: ScoredCompetitor[]) => {
  const rows = comps
    .map((c) => ({ v: c.currentPriceMinor, w: c.evidenceWeight ?? 0 }))
    .filter((r) => r.w > 0 && Number.isFinite(r.v))
    .sort((a, b) => a.v - b.v);
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.w, 0);
  let acc = 0;
  for (const r of rows) {
    acc += r.w;
    if (acc >= total / 2) return r.v;
  }
  return rows[rows.length - 1]!.v;
};

const cross = { naive: [] as Row[], baseline: [] as Row[], candidate: [] as Row[] };
const forward = { naive: [] as Row[], baseline: [] as Row[], candidate: [] as Row[] };
const bothTrusted = { baseline: [] as Row[], candidate: [] as Row[] };
/**
 * The decisive subset: products the BASELINE trusts and the candidate does
 * not. These are the fits that clear in-sample adjusted R² but fail
 * leave-one-out validation. If the baseline's error here is far worse than on
 * the fits both models accept, those extra "trusted" premiums were spurious
 * and the looser gate is a defect rather than extra coverage.
 */
const baselineOnly = { baseline: [] as Row[], naive: [] as Row[] };
let considered = 0;
let withEnoughComps = 0;
const lambdas: number[] = [];

for (const product of allProducts) {
  const actual = currentPrices.get(product.id);
  if (actual == null || actual <= 0) continue;
  considered += 1;

  const set = await competitors.build(product.id);
  const comps = set.members;
  if (comps.length < MIN_OBSERVATIONS) continue;
  withEnoughComps += 1;

  const attrs = await attrsFor(product.productTypeId!);
  const target = { rating: ratings.get(product.id) ?? null, brandTier: product.brandTier, specifications: product.specifications };

  /* ---- cross-sectional: everything priced today --------------------------- */

  const naive = weightedMedian(comps);
  if (naive != null) cross.naive.push({ actual, predicted: naive });

  const compRows: Comp[] = comps.map((c) => ({
    priceMinor: c.currentPriceMinor,
    rating: c.rating,
    brandTier: c.brandTier,
    specifications: null,
  }));
  // Specifications come from the products table, not the scored competitor.
  const specs = await conn.query<{ id: string; specifications: Record<string, unknown> | null }>(
    `select id, specifications from products where id in (${comps.map((c) => `'${c.productId}'`).join(",")})`
  );
  const specById = new Map(specs.map((s) => [s.id, s.specifications]));
  comps.forEach((c, i) => {
    compRows[i]!.specifications = specById.get(c.productId) ?? null;
  });

  const baseline = fitHedonicModel({
    target: { specifications: product.specifications, brandTier: product.brandTier },
    comps: comps.map((c, i) => ({
      productId: c.productId,
      currentPriceMinor: c.currentPriceMinor,
      rating: c.rating,
      brandTier: c.brandTier,
      specifications: compRows[i]!.specifications,
    })),
    attrs,
    targetRating: target.rating,
  });
  if (baseline.trusted && baseline.predictedMinor) cross.baseline.push({ actual, predicted: baseline.predictedMinor });

  const candidate = fitCandidate(target, compRows, attrs);
  if (candidate.trusted && candidate.predictedMinor) {
    cross.candidate.push({ actual, predicted: candidate.predictedMinor });
    if (candidate.lambda != null) lambdas.push(candidate.lambda);
  }

  // Head to head on the products BOTH models are willing to answer, so the
  // comparison is not one model's easy cases against another's hard ones.
  if (baseline.trusted && baseline.predictedMinor && candidate.trusted && candidate.predictedMinor) {
    bothTrusted.baseline.push({ actual, predicted: baseline.predictedMinor });
    bothTrusted.candidate.push({ actual, predicted: candidate.predictedMinor });
  }
  if (baseline.trusted && baseline.predictedMinor && !candidate.trusted) {
    baselineOnly.baseline.push({ actual, predicted: baseline.predictedMinor });
    if (naive != null) baselineOnly.naive.push({ actual, predicted: naive });
  }

  /* ---- forward: comparables priced 45 days earlier ------------------------ */

  const pastRows: Comp[] = [];
  const pastComps: ScoredCompetitor[] = [];
  comps.forEach((c, i) => {
    const past = trainPrices.get(c.productId);
    if (past == null || past <= 0) return;
    pastRows.push({ ...compRows[i]!, priceMinor: past });
    pastComps.push({ ...c, currentPriceMinor: past });
  });
  if (pastRows.length < MIN_OBSERVATIONS) continue;

  const naivePast = weightedMedian(pastComps);
  if (naivePast != null) forward.naive.push({ actual, predicted: naivePast });

  const baselinePast = fitHedonicModel({
    target: { specifications: product.specifications, brandTier: product.brandTier },
    comps: pastComps.map((c, i) => ({
      productId: c.productId,
      currentPriceMinor: c.currentPriceMinor,
      rating: c.rating,
      brandTier: c.brandTier,
      specifications: pastRows[i]!.specifications,
    })),
    attrs,
    targetRating: target.rating,
  });
  if (baselinePast.trusted && baselinePast.predictedMinor) {
    forward.baseline.push({ actual, predicted: baselinePast.predictedMinor });
  }

  const candidatePast = fitCandidate(target, pastRows, attrs);
  if (candidatePast.trusted && candidatePast.predictedMinor) {
    forward.candidate.push({ actual, predicted: candidatePast.predictedMinor });
  }
}

const bar = "=".repeat(118);
console.log(`\n${bar}`);
console.log(`PRICING MODEL EVALUATION — reference date ${referenceDate}, forward train date ${FORWARD_TRAIN_DATE}`);
console.log(bar);
console.log(`  products with a current price:        ${considered}`);
console.log(`  products with ${MIN_OBSERVATIONS}+ comparables:        ${withEnoughComps}  ← the population every model is scored on`);

console.log(`\nCROSS-SECTIONAL — comparables and target both priced today`);
console.log(fmt(score(cross.naive), "NAIVE weighted median", withEnoughComps));
console.log(fmt(score(cross.baseline), "BASELINE hedonic OLS", withEnoughComps));
console.log(fmt(score(cross.candidate), "CANDIDATE ridge+LOOCV", withEnoughComps));

console.log(`\nHEAD TO HEAD — only products BOTH attribute models will answer`);
console.log(fmt(score(bothTrusted.baseline), "BASELINE", bothTrusted.baseline.length || 1));
console.log(fmt(score(bothTrusted.candidate), "CANDIDATE", bothTrusted.candidate.length || 1));

console.log(`\nTHE FITS ONLY THE BASELINE TRUSTS — cleared in-sample adjusted R², failed cross-validation`);
console.log(fmt(score(baselineOnly.baseline), "BASELINE here", baselineOnly.baseline.length || 1));
console.log(fmt(score(baselineOnly.naive), "NAIVE on the same", baselineOnly.naive.length || 1));
console.log(fmt(score(bothTrusted.baseline), "BASELINE where both ok", bothTrusted.baseline.length || 1));

console.log(`\nFORWARD — comparables priced ${FORWARD_TRAIN_DATE}, target priced ${referenceDate} (no contemporaneous leakage)`);
console.log(fmt(score(forward.naive), "NAIVE weighted median", withEnoughComps));
console.log(fmt(score(forward.baseline), "BASELINE hedonic OLS", withEnoughComps));
console.log(fmt(score(forward.candidate), "CANDIDATE ridge+LOOCV", withEnoughComps));

if (lambdas.length) {
  const counts = new Map<number, number>();
  for (const l of lambdas) counts.set(l, (counts.get(l) ?? 0) + 1);
  console.log(
    `\n  penalties the candidate selected: ${[...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([l, c]) => `λ=${l}×${c}`)
      .join(", ")}`
  );
}
console.log("");

await conn.close();
