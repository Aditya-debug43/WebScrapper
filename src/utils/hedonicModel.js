import { TIER_RANK } from "../data/brands";
import { getPricingRelevantAttributes } from "../data/attributeDefinitions";

/**
 * EMPIRICAL WILLINGNESS-TO-PAY MODEL
 * ==================================
 *
 * The question this answers is NOT "is this product better?" but "does the
 * observed market actually pay more for the ways in which it is better?"
 *
 * The previous engine conflated the two: it computed a product-strength score
 * and multiplied it by a fixed percentage, so a product judged 10% stronger
 * automatically got a 10%-ish premium regardless of whether any comparable
 * product commanded one. That is an assumed premium, not an evidenced one.
 *
 * This module replaces the assumption with a measurement: a least-squares
 * regression of log(price) on the pricing-relevant attributes across the
 * comparable set. If the fit is good enough to be believed, its prediction for
 * the target is an evidence-backed fair value. If it is not — and with the
 * handful of comparables a prototype dataset yields, it usually is not — the
 * model says so, and the engine falls back to pure market positioning with NO
 * invented premium.
 *
 * Deliberately NOT an LLM. A language model asked to produce a price would be
 * unauditable and unfalsifiable; this is a five-line statistical model whose
 * coefficients, fit and refusal conditions can all be inspected. See §12 of
 * the project context for the full reasoning on where ML does and does not
 * belong here.
 *
 * Structured so a genuine trained model can replace `fitHedonicModel()` later
 * without changing any caller.
 */

// A regression needs meaningfully more observations than parameters. With
// n comparables we allow at most (n-2)/2 features, and never fit below 5.
const MIN_OBSERVATIONS = 5;
const MIN_ADJUSTED_R2 = 0.5;

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pearson(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

/** Solve (XᵀX + λI)β = Xᵀy by Gaussian elimination with partial pivoting. */
function solveNormalEquations(X, y, lambda = 1e-6) {
  const n = X.length;
  const p = X[0].length;
  const A = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p + 1 }, (_, j) => {
      if (j === p) {
        let s = 0;
        for (let k = 0; k < n; k++) s += X[k][i] * y[k];
        return s;
      }
      let s = 0;
      for (let k = 0; k < n; k++) s += X[k][i] * X[k][j];
      return s + (i === j ? lambda : 0);
    })
  );

  for (let col = 0; col < p; col++) {
    let pivot = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    if (Math.abs(A[pivot][col]) < 1e-12) return null; // singular — features collinear
    [A[col], A[pivot]] = [A[pivot], A[col]];
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= p; c++) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row, i) => row[p] / A[i][i]);
}

/**
 * Assemble the candidate feature matrix. Features are the registry's
 * pricing-relevant numerics, plus rating and brand tier — i.e. exactly the
 * attributes the project already claims drive price.
 */
function candidateFeatures(target, comps) {
  const attrs = getPricingRelevantAttributes(target.productTypeId).filter((a) =>
    ["integer", "decimal"].includes(a.dataType)
  );

  const defs = [
    ...attrs.map((a) => ({
      key: a.attributeKey,
      label: a.displayName,
      unit: a.unit,
      of: (row) => Number(row.product.specifications?.[a.attributeKey]),
      targetValue: Number(target.specifications?.[a.attributeKey]),
    })),
    {
      key: "__rating",
      label: "Customer rating",
      unit: "★",
      of: (row) => (row.rating != null ? Number(row.rating) : NaN),
      targetValue: NaN, // filled by caller
    },
    {
      key: "__tier",
      label: "Brand tier",
      unit: null,
      of: (row) => TIER_RANK[row.brand?.tier] ?? NaN,
      targetValue: TIER_RANK[target.__brandTier] ?? NaN,
    },
  ];

  // Keep only features present and varying across the comparable set — a
  // constant column carries no information and breaks the solve.
  return defs.filter((d) => {
    const vals = comps.map(d.of).filter(Number.isFinite);
    if (vals.length !== comps.length) return false;
    return new Set(vals).size > 1 && Number.isFinite(d.targetValue);
  });
}

/**
 * Fit the model and predict the target's evidence-backed price.
 * Always returns a verdict — including "not enough evidence to model this".
 */
export function fitHedonicModel({ target, comps, targetRating, targetBrandTier }) {
  const n = comps.length;
  const usable = { ...target, __brandTier: targetBrandTier };

  if (n < MIN_OBSERVATIONS) {
    return {
      trusted: false,
      n,
      reason: `Only ${n} comparable${n === 1 ? "" : "s"} — a price-versus-attribute relationship cannot be estimated from fewer than ${MIN_OBSERVATIONS}. No attribute premium is claimed.`,
      features: [],
      predictedMinor: null,
    };
  }

  let defs = candidateFeatures(usable, comps);
  defs = defs.map((d) => (d.key === "__rating" ? { ...d, targetValue: Number(targetRating) } : d));
  defs = defs.filter((d) => Number.isFinite(d.targetValue));

  if (defs.length === 0) {
    return {
      trusted: false,
      n,
      reason: "No pricing-relevant attribute varies across the comparable set, so nothing can be attributed to attributes.",
      features: [],
      predictedMinor: null,
    };
  }

  const logPrices = comps.map((c) => Math.log(c.currentPriceMinor));

  // Rank features by absolute correlation with log price, keep the strongest
  // few so degrees of freedom stay sane.
  const maxFeatures = Math.max(1, Math.floor((n - 2) / 2));
  const ranked = defs
    .map((d) => ({ def: d, r: pearson(comps.map(d.of), logPrices) }))
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
    .slice(0, maxFeatures);

  // Standardise so coefficients are comparable and the solve is stable.
  const cols = ranked.map(({ def }) => {
    const vals = comps.map(def.of);
    const mu = mean(vals);
    const sd = Math.sqrt(mean(vals.map((v) => (v - mu) ** 2))) || 1;
    return { def, mu, sd, z: vals.map((v) => (v - mu) / sd) };
  });

  const X = comps.map((_, i) => [1, ...cols.map((c) => c.z[i])]);
  const beta = solveNormalEquations(X, logPrices);
  if (!beta) {
    return {
      trusted: false,
      n,
      reason: "Comparable attributes are collinear — the market data cannot separate their individual price effects.",
      features: [],
      predictedMinor: null,
    };
  }

  const fitted = X.map((row) => row.reduce((s, x, i) => s + x * beta[i], 0));
  const meanLog = mean(logPrices);
  const ssTot = logPrices.reduce((s, y) => s + (y - meanLog) ** 2, 0);
  const ssRes = logPrices.reduce((s, y, i) => s + (y - fitted[i]) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const k = cols.length;
  const adjR2 = n - k - 1 > 0 ? 1 - ((1 - r2) * (n - 1)) / (n - k - 1) : 0;

  const targetZ = cols.map((c) => (c.def.targetValue - c.mu) / c.sd);
  const predictedLog = beta[0] + targetZ.reduce((s, z, i) => s + z * beta[i + 1], 0);
  const predictedMinor = Math.round(Math.exp(predictedLog));

  const features = cols.map((c, i) => ({
    key: c.def.key,
    label: c.def.label,
    unit: c.def.unit,
    targetValue: c.def.targetValue,
    compMean: Math.round(c.mu * 100) / 100,
    // Effect of this product sitting one standard deviation above the comp
    // mean on this attribute, in percentage terms.
    perSdPct: Math.exp(beta[i + 1]) - 1,
    targetSd: Math.round(targetZ[i] * 100) / 100,
  }));

  const trusted = adjR2 >= MIN_ADJUSTED_R2 && Number.isFinite(predictedMinor) && predictedMinor > 0;

  return {
    trusted,
    n,
    r2: Math.round(r2 * 1000) / 1000,
    adjR2: Math.round(adjR2 * 1000) / 1000,
    features,
    predictedMinor,
    reason: trusted
      ? `Fitted on ${n} comparables; the attribute model explains ${Math.round(adjR2 * 100)}% of price variation (adjusted R²), which is enough to attribute a premium to attributes.`
      : `Fitted on ${n} comparables but the attribute model explains only ${Math.round(adjR2 * 100)}% of price variation (adjusted R², threshold ${MIN_ADJUSTED_R2 * 100}%). The market does not show a consistent price-for-attributes relationship here, so no attribute premium is claimed.`,
    threshold: { minObservations: MIN_OBSERVATIONS, minAdjustedR2: MIN_ADJUSTED_R2 },
  };
}
