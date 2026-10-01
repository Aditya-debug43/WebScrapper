import { TIER_RANK } from "../analysis/competitor.service.js";
import type { AttributeRow } from "../analysis/analysis.repository.js";

/**
 * EMPIRICAL WILLINGNESS-TO-PAY MODEL
 * ==================================
 *
 * A faithful port of `src/utils/hedonicModel.js`. The question it answers is
 * NOT "is this product better?" but "does the observed market actually pay
 * more for the ways in which it is better?"
 *
 * A least-squares regression of log(price) on the pricing-relevant
 * attributes across the comparable set. If the fit is good enough to be
 * believed, its prediction is an evidence-backed fair value. If it is not —
 * and with the handful of comparables this dataset yields, usually it is not
 * — the model says so and the engine claims NO premium.
 *
 * Deliberately not an LLM. A language model asked for a price is unauditable
 * and unfalsifiable; this is a small statistical model whose coefficients,
 * fit and refusal conditions can all be inspected.
 *
 * ── The trust gate is the whole point ──────────────────────────────────
 * `trusted` requires adjusted R² ≥ 0.5 AND a finite positive prediction, on
 * at least 5 comparables. Nothing downstream may read `predictedMinor`
 * without checking `trusted` first, and the caller is tested for that.
 */

const MIN_OBSERVATIONS = 5;
const MIN_ADJUSTED_R2 = 0.5;

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function pearson(xs: number[], ys: number[]): number {
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

/** Solve (XᵀX + λI)β = Xᵀy by Gaussian elimination with partial pivoting. */
function solveNormalEquations(X: number[][], y: number[], lambda = 1e-6): number[] | null {
  const n = X.length;
  const p = X[0]!.length;
  const A = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p + 1 }, (_, j) => {
      if (j === p) {
        let s = 0;
        for (let k = 0; k < n; k++) s += X[k]![i]! * y[k]!;
        return s;
      }
      let s = 0;
      for (let k = 0; k < n; k++) s += X[k]![i]! * X[k]![j]!;
      return s + (i === j ? lambda : 0);
    })
  );

  for (let col = 0; col < p; col++) {
    let pivot = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(A[r]![col]!) > Math.abs(A[pivot]![col]!)) pivot = r;
    // Singular: the features are collinear and their individual price
    // effects cannot be separated. Refusing is the correct answer.
    if (Math.abs(A[pivot]![col]!) < 1e-12) return null;
    [A[col], A[pivot]] = [A[pivot]!, A[col]!];
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = A[r]![col]! / A[col]![col]!;
      for (let c = col; c <= p; c++) A[r]![c]! -= f * A[col]![c]!;
    }
  }
  return A.map((row, i) => row[p]! / A[i]![i]!);
}

export type HedonicComp = {
  productId: string;
  currentPriceMinor: number;
  rating: number | null;
  brandTier: string | null;
  specifications: Record<string, unknown> | null;
};

export type HedonicTarget = {
  specifications: Record<string, unknown> | null;
  brandTier: string | null;
};

export type HedonicFeature = {
  key: string;
  label: string;
  unit: string | null;
  targetValue: number;
  compMean: number;
  /** Effect of sitting one standard deviation above the comp mean, as a share. */
  perSdPct: number;
  targetSd: number;
};

export type HedonicResult = {
  trusted: boolean;
  n: number;
  r2?: number;
  adjR2?: number;
  features: HedonicFeature[];
  predictedMinor: number | null;
  reason: string;
  threshold?: { minObservations: number; minAdjustedR2: number };
};

export type FeatureDef = {
  key: string;
  label: string;
  unit: string | null;
  of: (row: HedonicComp) => number;
  targetValue: number;
};

/**
 * The candidate feature matrix: the registry's pricing-relevant numerics,
 * plus rating and brand tier — exactly the attributes this project already
 * claims drive price.
 *
 * A feature is kept only if it is present on EVERY comparable and varies
 * across them. A constant column carries no information and breaks the
 * solve; a partially-present one would silently change the sample.
 */
export function candidateFeatures(
  target: HedonicTarget,
  comps: HedonicComp[],
  attrs: AttributeRow[]
): FeatureDef[] {
  const numeric = attrs.filter((a) => a.isPricingRelevant && ["integer", "decimal"].includes(a.dataType));

  const defs: FeatureDef[] = [
    ...numeric.map((a) => ({
      key: a.attributeKey,
      label: a.displayName,
      unit: a.unit,
      of: (row: HedonicComp) => Number(row.specifications?.[a.attributeKey]),
      targetValue: Number(target.specifications?.[a.attributeKey]),
    })),
    {
      key: "__rating",
      label: "Customer rating",
      unit: "★",
      of: (row: HedonicComp) => (row.rating != null ? Number(row.rating) : NaN),
      /**
       * NaN here, and the caller substitutes the real rating afterwards —
       * exactly what the baseline engine does, and it means the filter at
       * the end of this function (which requires a finite `targetValue`)
       * ALWAYS drops this feature. Customer rating is therefore declared as
       * a candidate and never actually fitted.
       *
       * That is a defect in the engine, reproduced here deliberately.
       * Phase 6 moves the validated model without changing what it
       * computes; correcting this would change the recommended price for a
       * large share of the catalogue with no evidence yet that the change
       * is an improvement. Recorded as a candidate for a future model
       * version instead — see the Phase 6 notes in CLAUDE_CONTEXT.md.
       */
      targetValue: NaN,
    },
    {
      key: "__tier",
      label: "Brand tier",
      unit: null,
      of: (row: HedonicComp) => TIER_RANK[row.brandTier ?? ""] ?? NaN,
      targetValue: TIER_RANK[target.brandTier ?? ""] ?? NaN,
    },
  ];

  return defs.filter((d) => {
    const vals = comps.map(d.of).filter(Number.isFinite);
    if (vals.length !== comps.length) return false;
    return new Set(vals).size > 1 && Number.isFinite(d.targetValue);
  });
}

/**
 * The features either model version may use.
 *
 * Two phases, matching the engine: candidates are filtered while the rating's
 * target is still NaN, and only then is the real rating substituted — see the
 * note on `__rating` above.
 */
export function usableFeatures(
  target: HedonicTarget,
  comps: HedonicComp[],
  attrs: AttributeRow[],
  targetRating: number | null
): FeatureDef[] {
  return candidateFeatures(target, comps, attrs)
    .map((d) => (d.key === "__rating" ? { ...d, targetValue: targetRating != null ? Number(targetRating) : NaN } : d))
    .filter((d) => Number.isFinite(d.targetValue));
}

/**
 * Rank the candidates by absolute correlation with log price, keep the
 * strongest few so degrees of freedom stay sane at (n−2)/2, and standardise
 * them so coefficients are comparable and the solve is stable.
 *
 * Shared by both model versions, so they always fit the SAME design matrix
 * and any measured difference between them is the fitting method alone.
 */
export function designMatrix(comps: HedonicComp[], defs: FeatureDef[], logPrices: number[]) {
  const maxFeatures = Math.max(1, Math.floor((comps.length - 2) / 2));
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

  return { cols, X: comps.map((_, i) => [1, ...cols.map((c) => c.z[i]!)]) };
}

/** Build the feature descriptions the response publishes, for either version. */
export function describeFeatures(
  cols: ReturnType<typeof designMatrix>["cols"],
  beta: number[],
  targetZ: number[]
): HedonicFeature[] {
  return cols.map((c, i) => ({
    key: c.def.key,
    label: c.def.label,
    unit: c.def.unit,
    targetValue: c.def.targetValue,
    compMean: Math.round(c.mu * 100) / 100,
    perSdPct: Math.exp(beta[i + 1]!) - 1,
    targetSd: Math.round(targetZ[i]! * 100) / 100,
  }));
}

/**
 * Fit the model and predict the target's evidence-backed price.
 * Always returns a verdict — including "not enough evidence to model this".
 */
export function fitHedonicModel(input: {
  target: HedonicTarget;
  comps: HedonicComp[];
  attrs: AttributeRow[];
  targetRating: number | null;
}): HedonicResult {
  const { target, comps, attrs, targetRating } = input;
  const n = comps.length;

  if (n < MIN_OBSERVATIONS) {
    return {
      trusted: false,
      n,
      reason: `Only ${n} comparable${n === 1 ? "" : "s"} — a price-versus-attribute relationship cannot be estimated from fewer than ${MIN_OBSERVATIONS}. No attribute premium is claimed.`,
      features: [],
      predictedMinor: null,
    };
  }

  const defs = usableFeatures(target, comps, attrs, targetRating);

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

  const { cols, X } = designMatrix(comps, defs, logPrices);
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

  const fitted = X.map((row) => row.reduce((s, x, i) => s + x * beta[i]!, 0));
  const meanLog = mean(logPrices);
  const ssTot = logPrices.reduce((s, y) => s + (y - meanLog) ** 2, 0);
  const ssRes = logPrices.reduce((s, y, i) => s + (y - fitted[i]!) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const k = cols.length;
  const adjR2 = n - k - 1 > 0 ? 1 - ((1 - r2) * (n - 1)) / (n - k - 1) : 0;

  const targetZ = cols.map((c) => (c.def.targetValue - c.mu) / c.sd);
  const predictedLog = beta[0]! + targetZ.reduce((s, z, i) => s + z * beta[i + 1]!, 0);
  const predictedMinor = Math.round(Math.exp(predictedLog));

  const features = describeFeatures(cols, beta, targetZ);

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

export const HEDONIC_THRESHOLDS = { MIN_OBSERVATIONS, MIN_ADJUSTED_R2 } as const;
