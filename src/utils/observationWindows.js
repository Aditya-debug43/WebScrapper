import { priceObservations, getPriceHistoryForOffer } from "../data/priceObservations";
import { getListingsForProduct } from "../data/listings";
import { getOffersForListing } from "../data/offers";
import { getProductPriceSeries, computeDistributionStats } from "./pricingEngine";

/**
 * OBSERVATION WINDOWS
 * ===================
 *
 * The same product read at seven horizons. The point is not seven filters —
 * it is that a horizon and the evidence inside it are two different things,
 * and in this dataset they come apart badly at the short end.
 *
 * Capture cadence here is tiered by traction, the way a real crawl budget is:
 * a high-traffic product is observed every two days, a mainstream one every
 * five, a long-tail one every twelve. Measured across the catalogue, that
 * means a 1-day window holds exactly ONE observation for about three quarters
 * of products, and a 3-day window is no better. A 90-day window holds five or
 * more for every single product.
 *
 * So a window cannot be handed a fixed set of statistics. What it can support
 * has to be derived from what is actually inside it:
 *
 *   none            0 observations   the window is shorter than the cadence
 *   snapshot        1 observation    a level, and nothing else. No change, no
 *                                    spread, no volatility — one point has none
 *   directional     2-4              change first-to-last, observed range. No
 *                                    volatility: a coefficient of variation on
 *                                    three points describes the sampling, not
 *                                    the market
 *   distributional  5+               median, volatility, trend — the full set
 *
 * Every statistic a window cannot support is recorded in `withheld` with the
 * reason, so the interface can say why a number is missing rather than leaving
 * a gap the reader has to interpret.
 *
 * Nothing here generates or interpolates an observation. A thin window stays
 * thin.
 */

export const OBSERVATION_WINDOWS = [
  { key: "d1", days: 1, label: "1 day", short: "1d" },
  { key: "d2", days: 2, label: "2 days", short: "2d" },
  { key: "d3", days: 3, label: "3 days", short: "3d" },
  { key: "d7", days: 7, label: "7 days", short: "7d" },
  { key: "d15", days: 15, label: "15 days", short: "15d" },
  { key: "d30", days: 30, label: "1 month", short: "1m" },
  { key: "d90", days: 90, label: "3 months", short: "3m" },
];

export const DEFAULT_WINDOW_KEY = "d30";

export const CAPABILITY = {
  none: { rank: 0, label: "No observation", note: "Nothing was captured inside this window." },
  snapshot: {
    rank: 1,
    label: "Snapshot",
    note: "One observation. That is a price level, not a movement — nothing can be said about direction or stability at this horizon.",
  },
  directional: {
    rank: 2,
    label: "Directional",
    note: "Enough observations to say which way the price moved and how wide it ranged, but too few for volatility to mean anything.",
  },
  distributional: {
    rank: 3,
    label: "Distributional",
    note: "Enough observations for a median, a volatility reading and a trend.",
  },
};

/** 2-4 points can carry a direction; 5 is where a spread becomes a distribution. */
const DIRECTIONAL_MIN = 2;
const DISTRIBUTIONAL_MIN = 5;

/**
 * A move smaller than this is treated as noise when classifying whether a
 * signal persists across horizons. Named rather than inlined because it is a
 * judgement call, and a reader is entitled to see where the line was drawn.
 */
const MATERIAL_MOVE_PCT = 2;

const pct = (v) => Math.round(v * 1000) / 10;

/**
 * "Today" is the most recent observation the dataset actually holds, not a
 * wall clock and not a constant copied from the generator. Anchoring on the
 * data means the windows stay correct if the dataset is ever regenerated.
 */
let latestDate = null;
export function datasetLatestDate() {
  if (latestDate) return latestDate;
  let max = "";
  for (const o of priceObservations) if (o.observedAt > max) max = o.observedAt;
  latestDate = max;
  return latestDate;
}

export function windowStart(days, endIso = datasetLatestDate()) {
  const d = new Date(endIso);
  // Inclusive of both ends: a 1-day window is the latest capture day itself.
  d.setDate(d.getDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

/** Median gap in days between consecutive observations — the capture cadence. */
function cadenceOf(series) {
  if (series.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < series.length; i++) {
    gaps.push((new Date(series[i].date) - new Date(series[i - 1].date)) / 86400000);
  }
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return Math.round(median * 10) / 10;
}

/**
 * Who was observed inside the window — read from the raw observations rather
 * than the deduped price series, because the series keeps only the cheapest
 * offer per day and would undercount coverage.
 */
function coverageInWindow(productId, from, to) {
  const marketplaces = new Set();
  const offers = new Set();
  const sellers = new Set();
  let rows = 0;
  let outOfStock = 0;

  for (const listing of getListingsForProduct(productId)) {
    let listingSeen = false;
    for (const offer of getOffersForListing(listing.id)) {
      let offerSeen = false;
      for (const obs of getPriceHistoryForOffer(offer.id)) {
        if (obs.observedAt < from || obs.observedAt > to) continue;
        rows++;
        if (!obs.isInStock) outOfStock++;
        offerSeen = true;
        listingSeen = true;
      }
      if (offerSeen) {
        offers.add(offer.id);
        sellers.add(offer.sellerId);
      }
    }
    if (listingSeen) marketplaces.add(listing.marketplaceId);
  }

  return {
    marketplaceCount: marketplaces.size,
    offerCount: offers.size,
    sellerCount: sellers.size,
    observationRows: rows,
    outOfStockRows: outOfStock,
    outOfStockShare: rows ? Math.round((outOfStock / rows) * 1000) / 10 : null,
  };
}

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

/** Convenience for callers that hold a key rather than a day count. */
export function windowByKey(key) {
  return OBSERVATION_WINDOWS.find((w) => w.key === key) ?? OBSERVATION_WINDOWS.find((w) => w.key === DEFAULT_WINDOW_KEY);
}
