import { capabilityFor, type Capability } from "./windows.js";

/**
 * SERIES STATISTICS — one definition, shared.
 *
 * Extracted from `marketplace.service.ts` when the dashboard needed the same
 * numbers over the same kind of series. It was private there, and the only
 * ways to give the dashboard a window change were to import across modules,
 * duplicate the arithmetic, or lift it here. Duplicating it is how two
 * screens come to disagree about what a product did, which is the exact
 * failure this whole migration exists to end.
 *
 * Nothing about the arithmetic changed in the move.
 */


export type SeriesPoint = { date: string; minor: number };

export type Summary = {
  n: number;
  capability: Capability;
  first: SeriesPoint | null;
  last: SeriesPoint | null;
  statistics: {
    minMinor: number;
    maxMinor: number;
    spreadMinor: number;
    medianMinor: number | null;
    meanMinor: number | null;
    q1Minor: number | null;
    q3Minor: number | null;
    iqrMinor: number | null;
    changeMinor: number | null;
    changePct: number | null;
    volatilityPct: number | null;
  } | null;
  withheld: Array<{ metric: string; reason: string }>;
};

/**
 * What a window of observations supports — and, explicitly, what it does not.
 *
 * The thresholds are the same ones the frontend analysis uses, for the same
 * reason: a median over three points is arithmetic, not evidence, and a
 * coefficient of variation over three points describes the sampling rather
 * than the market. Every statistic that is withheld says why, so the
 * interface can explain a gap instead of leaving one.
 *
 * The median is the linear-interpolated percentile — the same definition as
 * `percentile()` in the frontend engine, and the same one PostgreSQL's
 * `percentile_cont` implements. Computed here rather than in SQL so that a
 * single function produces every statistic from a single series.
 */
export function summarise(series: SeriesPoint[]): Summary {
  const n = series.length;
  const capability = capabilityFor(n);
  const withheld: Array<{ metric: string; reason: string }> = [];

  if (n === 0) {
    return {
      n: 0,
      capability,
      first: null,
      last: null,
      statistics: null,
      withheld: [
        { metric: "all", reason: "No observations were captured inside this range." },
      ],
    };
  }

  const ordered = [...series].sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  const values = [...series.map((p) => p.minor)].sort((a, b) => a - b);

  const minMinor = values[0]!;
  const maxMinor = values[values.length - 1]!;

  const directional = n >= 2;
  const distributional = n >= 5;

  if (!directional) {
    withheld.push({ metric: "change", reason: "One observation carries a level, not a movement." });
  }
  if (!distributional) {
    withheld.push({ metric: "median", reason: "Fewer than five observations; a median here would describe the sampling." });
    withheld.push({ metric: "volatility", reason: "Fewer than five observations; a coefficient of variation would not be meaningful." });
    withheld.push({ metric: "quartiles", reason: "Fewer than five observations." });
  }

  const mean = values.reduce((s, v) => s + v, 0) / n;
  const changeMinor = directional ? last.minor - first.minor : null;

  return {
    n,
    capability,
    first,
    last,
    statistics: {
      minMinor,
      maxMinor,
      spreadMinor: maxMinor - minMinor,
      medianMinor: distributional ? Math.round(percentile(values, 0.5)) : null,
      meanMinor: directional ? Math.round(mean) : null,
      q1Minor: distributional ? Math.round(percentile(values, 0.25)) : null,
      q3Minor: distributional ? Math.round(percentile(values, 0.75)) : null,
      iqrMinor: distributional ? Math.round(percentile(values, 0.75) - percentile(values, 0.25)) : null,
      changeMinor,
      changePct: changeMinor != null && first.minor !== 0 ? round((changeMinor / first.minor) * 100, 2) : null,
      volatilityPct: distributional && mean !== 0 ? round((stdev(values, mean) / mean) * 100, 2) : null,
    },
    withheld,
  };
}

/** Linear interpolation between order statistics — R-7 / `percentile_cont`. */
export function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/** Population standard deviation — these are all the observations there are. */
export function stdev(values: number[], mean: number): number {
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
