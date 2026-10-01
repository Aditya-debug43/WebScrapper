import {
  designMatrix,
  describeFeatures,
  mean,
  usableFeatures,
  type HedonicComp,
  type HedonicResult,
  type HedonicTarget,
} from "./hedonic.js";
import type { AttributeRow } from "../analysis/analysis.repository.js";

/**
 * CROSS-VALIDATED WILLINGNESS-TO-PAY MODEL — `hedonic-cv-v2`
 * ==========================================================
 *
 * The same features and the same target as `baseline-v1`. Two differences,
 * both about honesty rather than power:
 *
 *   1. The fit is RIDGE, with the penalty chosen from a grid.
 *   2. The trust gate is OUT-OF-SAMPLE R², measured by exact leave-one-out
 *      cross-validation, instead of in-sample adjusted R².
 *
 * ── Why this exists ────────────────────────────────────────────────────
 * The baseline's gate was measured across the whole catalogue (see
 * `src/scripts/evaluate-pricing-models.ts` and
 * `docs/PRICING_MODEL_RESEARCH.md`). Of 477 products whose attribute model it
 * trusts, 226 — 47% — fail cross-validation, and on exactly those products the
 * model predicts WORSE than copying the competitive median: 18.7% MAPE against
 * the naive 17.8%, with RMSE 29% higher. Adjusted R² does not protect against
 * overfitting when n is 5–32 and the features were selected by correlation with
 * the same target, which is precisely this situation.
 *
 * The penalty helps at the margin. The gate is the point.
 *
 * ── Why leave-one-out, and not k-fold ─────────────────────────────────
 * At n = 8 there is nothing to split. Held-out folds would leave six rows to
 * fit three coefficients. Leave-one-out uses n − 1 rows per fold, and for a
 * linear smoother every fold is available in closed form from a single fit:
 *
 *     LOO residual for i = eᵢ / (1 − hᵢᵢ),    H = X(XᵀX + λI)⁻¹Xᵀ
 *
 * So exact LOOCV here costs one fit per λ, not n fits. It is not an
 * optimisation; it is what makes validation possible at these sample sizes.
 *
 * ── What it still is not ───────────────────────────────────────────────
 * A market-value estimate. There is no sales volume in this dataset, so this
 * model — like the baseline — measures what the market ASKS for attributes,
 * not what buyers would pay. It is an association, it is labelled as one, and
 * it may move a price only inside the bounds the policy sets.
 */

/** Penalties tried, on standardised columns. λ=1e-6 is effectively plain OLS. */
const LAMBDA_GRID = [1e-6, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50] as const;
const MIN_OBSERVATIONS = 5;
const MIN_LOOCV_R2 = 0.5;

export const HEDONIC_CV_THRESHOLDS = {
  MIN_OBSERVATIONS,
  MIN_LOOCV_R2,
  LAMBDA_GRID: [...LAMBDA_GRID],
} as const;

/** What v2 adds to the shared result shape. */
export type HedonicCvResult = HedonicResult & {
  /** Out-of-sample R² from leave-one-out cross-validation. The trust basis. */
  loocvR2?: number;
  /** In-sample R², reported only so the gap to `loocvR2` is visible. */
  inSampleR2?: number;
  /** The selected ridge penalty. */
  lambda?: number;
  /** How many folds were scored — equal to n when every fold was scorable. */
  foldCount?: number;
  cvThreshold?: { minObservations: number; minLoocvR2: number };
};

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
      const factor = A[r]![col]!;
      if (factor === 0) continue;
      for (let j = 0; j < 2 * p; j++) A[r]![j]! -= factor * A[col]![j]!;
    }
  }
  return A.map((row) => row.slice(p));
}

/**
 * One ridge fit, plus the leave-one-out prediction error it implies.
 *
 * The intercept is never penalised — shrinking it would pull every predicted
 * price toward zero rather than toward the comparable mean.
 */
function ridgeWithLoocv(X: number[][], y: number[], lambda: number) {
  const n = X.length;
  const p = X[0]!.length;

  const XtX = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) => {
      let s = 0;
      for (let k = 0; k < n; k++) s += X[k]![i]! * X[k]![j]!;
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
  let folds = 0;
  for (let k = 0; k < n; k++) {
    const xk = X[k]!;
    let leverage = 0;
    for (let i = 0; i < p; i++) {
      let row = 0;
      for (let j = 0; j < p; j++) row += inv[i]![j]! * xk[j]!;
      leverage += xk[i]! * row;
    }
    const fitted = xk.reduce((s, v, i) => s + v * beta[i]!, 0);
    const denom = 1 - leverage;
    /**
     * Leverage of 1 means this point alone determines its own fitted value, so
     * removing it leaves the model undefined there and the fold cannot be
     * scored. Refusing the whole λ is right: a cross-validation that quietly
     * skips its hardest folds is not a cross-validation.
     */
    if (!(Math.abs(denom) > 1e-8)) return null;
    press += ((y[k]! - fitted) / denom) ** 2;
    folds += 1;
  }

  const my = mean(y);
  const ssTot = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const fitted = X.map((row) => row.reduce((s, v, i) => s + v * beta[i]!, 0));
  const ssRes = y.reduce((s, v, i) => s + (v - fitted[i]!) ** 2, 0);

  return {
    beta,
    folds,
    loocvR2: ssTot === 0 ? 0 : 1 - press / ssTot,
    inSampleR2: ssTot === 0 ? 0 : 1 - ssRes / ssTot,
  };
}

export type LambdaScore = {
  lambda: number;
  loocvR2: number;
  inSampleR2: number;
  beta: number[];
  folds: number;
};

/** Every penalty that could be fitted, with the two R² figures for each. */
export function scoreLambdaGrid(X: number[][], y: number[]): LambdaScore[] {
  const scored: LambdaScore[] = [];
  for (const lambda of LAMBDA_GRID) {
    const fit = ridgeWithLoocv(X, y, lambda);
    if (fit) scored.push({ lambda, ...fit });
  }
  return scored;
}

/**
 * Pick the penalty with the best HELD-OUT error. Never the best fit.
 *
 * Selecting on in-sample R² would always return the smallest penalty, because
 * less shrinkage always fits the training rows better — which would quietly
 * turn this back into the unregularised model it exists to replace. Split out
 * and exported so a test can assert the rule rather than the outcome.
 */
export function selectLambda(scored: LambdaScore[]): LambdaScore | null {
  let best: LambdaScore | null = null;
  for (const candidate of scored) {
    if (!best || candidate.loocvR2 > best.loocvR2) best = candidate;
  }
  return best;
}

/**
 * Fit and predict, trusting only what survives cross-validation.
 *
 * Returns a verdict in every case, including "the market shows no relationship
 * here that generalises". The refusals are the reason this version exists.
 */
export function fitHedonicCvModel(input: {
  target: HedonicTarget;
  comps: HedonicComp[];
  attrs: AttributeRow[];
  targetRating: number | null;
}): HedonicCvResult {
  const { target, comps, attrs, targetRating } = input;
  const n = comps.length;
  const cvThreshold = { minObservations: MIN_OBSERVATIONS, minLoocvR2: MIN_LOOCV_R2 };

  if (n < MIN_OBSERVATIONS) {
    return {
      trusted: false,
      n,
      reason: `Only ${n} comparable${n === 1 ? "" : "s"} — a price-versus-attribute relationship cannot be estimated from fewer than ${MIN_OBSERVATIONS}, let alone cross-validated. No attribute premium is claimed.`,
      features: [],
      predictedMinor: null,
      cvThreshold,
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
      cvThreshold,
    };
  }

  const logPrices = comps.map((c) => Math.log(c.currentPriceMinor));
  const { cols, X } = designMatrix(comps, defs, logPrices);

  const grid = scoreLambdaGrid(X, logPrices);
  const best = selectLambda(grid);

  if (!best) {
    return {
      trusted: false,
      n,
      reason:
        "The comparable set cannot be cross-validated — at every penalty tried, at least one comparable entirely determines its own fitted price, so no fold can be held out. Nothing is claimed from a model that cannot be tested.",
      features: [],
      predictedMinor: null,
      cvThreshold,
    };
  }

  const targetZ = cols.map((c) => (c.def.targetValue - c.mu) / c.sd);
  const predictedLog = best.beta[0]! + targetZ.reduce((s, z, i) => s + z * best!.beta[i + 1]!, 0);
  const predicted = Math.round(Math.exp(predictedLog));
  const predictedMinor = Number.isFinite(predicted) ? predicted : null;

  const trusted = best.loocvR2 >= MIN_LOOCV_R2 && predictedMinor != null && predictedMinor > 0;
  const loocvPct = Math.round(best.loocvR2 * 100);
  /**
   * A negative held-out R² is not a small number, it is a verdict: the model
   * predicts a held-out comparable WORSE than the comparable-set mean would.
   * Saying "explains −140% of variation" would read as a formatting bug, so
   * that case gets its own wording.
   */
  const worseThanAverage = best.loocvR2 < 0;

  return {
    trusted,
    n,
    r2: Math.round(best.inSampleR2 * 1000) / 1000,
    inSampleR2: Math.round(best.inSampleR2 * 1000) / 1000,
    loocvR2: Math.round(best.loocvR2 * 1000) / 1000,
    lambda: best.lambda,
    foldCount: best.folds,
    features: describeFeatures(cols, best.beta, targetZ),
    predictedMinor,
    reason: trusted
      ? `Fitted on ${n} comparables and cross-validated across ${best.folds} held-out folds; the attribute model predicts ${loocvPct}% of price variation out of sample (leave-one-out R², penalty ${best.lambda}), which is enough to attribute a premium to attributes.`
      : worseThanAverage
        ? `Fitted on ${n} comparables, but across ${best.folds} held-out folds the attribute model predicts a held-out comparable WORSE than simply using the comparable-set average (leave-one-out R² ${best.loocvR2.toFixed(2)}). It may look convincing on the data it was fitted to; it has no predictive value here, so no attribute premium is claimed.`
        : `Fitted on ${n} comparables, but across ${best.folds} held-out folds the attribute model predicts only ${loocvPct}% of price variation out of sample (leave-one-out R², threshold ${MIN_LOOCV_R2 * 100}%). It may still look convincing on the data it was fitted to; it does not generalise, so no attribute premium is claimed.`,
    cvThreshold,
  };
}
