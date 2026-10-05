import { priceObservations, getPriceHistoryForOffer } from "../data/priceObservations";
import { getListingsForProduct } from "../data/listings";
import { getOffersForListing } from "../data/offers";

/**
 * OBSERVATION WINDOWS — the vocabulary
 * ====================================
 *
 * The seven horizons, the capability ladder and the date arithmetic. No
 * pricing engine: Phase 8 split the statistics that need one into
 * `observationWindowStats.js`, so a screen that only needs to NAME a window
 * cannot reach the engine through this file. The analysis screen now gets its
 * window statistics from the backend.
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

/**
 * Re-exported from `observationWindowDefs.js`, where they now live.
 *
 * They are pure definitions and were moved out so a screen can read a window
 * label without importing this module, which also loads the bundled
 * observation table. Existing callers keep working through these names.
 */
export { OBSERVATION_WINDOWS, DEFAULT_WINDOW_KEY, CAPABILITY, windowByKey } from "./observationWindowDefs";


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
export function cadenceOf(series) {
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
export function coverageInWindow(productId, from, to) {
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

/** Convenience for callers that hold a key rather than a day count. */
