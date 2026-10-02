import { getProductPriceSeries, computeDistributionStats } from "./pricingEngine";
import {
  CAPABILITY,
  DEFAULT_WINDOW_KEY,
  OBSERVATION_WINDOWS,
  cadenceOf,
  coverageInWindow,
  datasetLatestDate,
  windowStart,
} from "./observationWindows";

/**
 * OBSERVATION WINDOW STATISTICS — the half that needs the pricing engine
 * =====================================================================
 *
 * Split out of `observationWindows.js` in Phase 8. The analysis screen takes
 * its window statistics from the backend now, so the only callers left are
 * the dashboard — part of the catalogue migration, not the pricing one — and
 * the tests. Keeping them here means a module that merely names a horizon
 * does not drag the pricing engine into the bundle with it.
 */
/**
 * One product, one horizon.
 *
 * `series` may be passed in by a caller looping over several windows, so the
 * cached product series is resolved once rather than seven times.
 */
export function analyseWindow(productId, days, series = getProductPriceSeries(productId)) {
  const to = datasetLatestDate();
  const from = windowStart(days, to);
  const meta = OBSERVATION_WINDOWS.find((w) => w.days === days) ?? { key: `d${days}`, days, label: `${days} days`, short: `${days}d` };

  const inWindow = series.filter((p) => p.date >= from && p.date <= to);
  const n = inWindow.length;
  const withheld = [];

  const base = {
    ...meta,
    from,
    to,
    n,
    cadenceDays: cadenceOf(series),
    seriesLength: series.length,
    coverage: coverageInWindow(productId, from, to),
    promoDays: inWindow.filter((p) => p.saleLabel).length,
    promoLabels: [...new Set(inWindow.filter((p) => p.saleLabel).map((p) => p.saleLabel))],
    currentMinor: n ? inWindow[n - 1].minor : null,
    firstMinor: n ? inWindow[0].minor : null,
    changeMinor: null,
    changePct: null,
    minMinor: null,
    maxMinor: null,
    spreadMinor: null,
    spreadPct: null,
    medianMinor: null,
    volatility: null,
    volatilityBand: null,
    withheld,
  };

  if (n === 0) {
    withheld.push({
      stat: "everything",
      reason: `No capture landed inside this window. Observations for this product arrive roughly every ${base.cadenceDays ?? "?"} days.`,
    });
    return { ...base, capability: "none" };
  }

  if (n < DIRECTIONAL_MIN) {
    withheld.push({
      stat: "change, range, volatility",
      reason: `A single observation carries a level, not a movement. At this product's capture cadence of about ${base.cadenceDays ?? "?"} days, a ${days}-day window rarely holds more than one.`,
    });
    return { ...base, capability: "snapshot" };
  }

  const values = inWindow.map((p) => p.minor);
  const first = values[0];
  const last = values[values.length - 1];
  const min = Math.min(...values);
  const max = Math.max(...values);

  const directional = {
    ...base,
    changeMinor: last - first,
    changePct: first ? pct((last - first) / first) : null,
    minMinor: min,
    maxMinor: max,
    spreadMinor: max - min,
    spreadPct: min ? pct((max - min) / min) : null,
  };

  if (n < DISTRIBUTIONAL_MIN) {
    withheld.push({
      stat: "median, volatility",
      reason: `${n} observations describe a direction, not a distribution. A coefficient of variation computed on ${n} points measures the sampling, not the market.`,
    });
    return { ...directional, capability: "directional" };
  }

  // Coefficient of variation rather than a rupee standard deviation, so the
  // reading is comparable across price levels — and the same measure, with the
  // same bands, that the analysis layer already uses for the 90-day series.
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  const volatility = mean ? sd / mean : null;

  return {
    ...directional,
    capability: "distributional",
    medianMinor: computeDistributionStats(values).median,
    volatility: volatility == null ? null : Math.round(volatility * 1000) / 10,
    volatilityBand: volatility == null ? null : volatility < 0.03 ? "stable" : volatility < 0.08 ? "moderate" : "volatile",
  };
}

/**
 * Every horizon at once, plus the question the professor's brief actually
 * asks: is what we are looking at temporary, emerging, persistent or stable?
 *
 * That is answered by comparing the short end with the long end, and it is
 * only answered when both ends can carry a direction. Otherwise the honest
 * output is "not established".
 */
export function compareWindows(productId) {
  const series = getProductPriceSeries(productId);
  const windows = OBSERVATION_WINDOWS.map((w) => analyseWindow(productId, w.days, series));
  const by = (key) => windows.find((w) => w.key === key);

  const shortest = windows.find((w) => w.days <= 7 && w.capability !== "none" && w.capability !== "snapshot");
  const longest = by("d90");

  let persistence = { state: "unestablished", label: "Not established", detail: "", shortWindow: null, longWindow: null };

  if (!shortest) {
    persistence.detail =
      "No window of a week or less holds more than one observation for this product, so there is nothing to compare the long horizon against. This is a capture-cadence limit, not a quiet market.";
  } else if (!longest || longest.capability === "none" || longest.changePct == null) {
    persistence.detail = "The three-month window does not carry a direction, so short-term movement cannot be placed in context.";
  } else {
    const s = shortest.changePct;
    const l = longest.changePct;
    const sBig = Math.abs(s) >= MATERIAL_MOVE_PCT;
    const lBig = Math.abs(l) >= MATERIAL_MOVE_PCT;
    persistence.shortWindow = shortest;
    persistence.longWindow = longest;

    if (!sBig && !lBig) {
      persistence = {
        ...persistence,
        state: "stable",
        label: "Stable",
        detail: `The price has not moved materially at either horizon — ${s}% over ${shortest.label.toLowerCase()} and ${l}% over three months, both inside the ${MATERIAL_MOVE_PCT}% band treated as noise.`,
      };
    } else if (sBig && !lBig) {
      persistence = {
        ...persistence,
        state: "recent",
        label: "Recent move",
        detail: `A ${s}% move over ${shortest.label.toLowerCase()} that the three-month view does not show (${l}%). Either it is new, or it is a promotional dip that will unwind — the history section says which.`,
      };
    } else if (!sBig && lBig) {
      persistence = {
        ...persistence,
        state: "settled",
        label: "Settled after a move",
        detail: `The price is ${l}% away from where it sat three months ago, but has not moved in the last ${shortest.label.toLowerCase()} (${s}%). The change has already happened and the market has settled at the new level.`,
      };
    } else if (Math.sign(s) === Math.sign(l)) {
      persistence = {
        ...persistence,
        state: "persistent",
        label: "Persistent trend",
        detail: `The same direction at both horizons — ${s}% over ${shortest.label.toLowerCase()} and ${l}% over three months. This is a trend, not a blip.`,
      };
    } else {
      persistence = {
        ...persistence,
        state: "reversal",
        label: "Reversal",
        detail: `Short and long horizons disagree: ${s}% over ${shortest.label.toLowerCase()} against ${l}% over three months. Something changed recently that runs against the longer pattern.`,
      };
    }
  }

  return { windows, persistence, cadenceDays: windows[0]?.cadenceDays ?? null, latestDate: datasetLatestDate() };
}

