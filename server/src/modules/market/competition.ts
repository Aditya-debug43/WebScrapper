import { percentile, round } from "../../lib/series.js";

/**
 * An integer quantile of a sorted price list.
 *
 * Two things the shared helper does not do, both of which matter here.
 *
 * It takes a FRACTION — `percentile(xs, 0.5)`, not `50`. Passing a percentage
 * runs the index off the end of the array and yields `undefined`, which then
 * travels as far as an `insert` before anything notices: the first run of
 * this file wrote `default` into three not-null columns and failed there
 * rather than at the arithmetic. Naming it differently removes the trap
 * instead of relying on remembering it.
 *
 * And it ROUNDS. Interpolating between two order statistics produces a
 * fraction of a paisa, which is not a price and cannot be stored in an
 * integer column.
 */
function quantile(sortedAscending: number[], fraction: number): number {
  return Math.round(percentile(sortedAscending, fraction));
}

/**
 * COMPETITION ANALYSIS
 * ====================
 *
 * Pure functions over a product's sellers. No database, no provider, no AI —
 * so every number a recommendation rests on can be checked against a handful
 * of prices in a test, and the pricing engine cannot quietly become the place
 * where statistics are invented.
 *
 * The question these answer is the seller's, not the shopper's: *if I list
 * this product, where do I stand?* That is why the output is positional —
 * who is below me, what it costs to be cheapest, how crowded the floor is —
 * rather than a single average. An average tells a seller nothing about
 * whether undercutting by fifty rupees wins anything.
 */

/** One seller's current offer, as the analysis needs it. */
export type CompetitorOffer = {
  sellerId: string;
  sellerName: string;
  marketplaceId: string;
  marketplaceName: string;
  /** The listed price. */
  priceMinor: number;
  /** Price plus stated shipping, where shipping is stated. */
  landedMinor: number;
  shippingMinor: number | null;
  inStock: boolean;
  rating: number | null;
  reviewCount: number | null;
  url: string | null;
  condition: "new" | "renewed" | "used";
};

export type PriceDistribution = {
  sellerCount: number;
  marketplaceCount: number;
  inStockCount: number;
  lowMinor: number;
  p25Minor: number;
  medianMinor: number;
  p75Minor: number;
  highMinor: number;
  meanMinor: number;
  /** (high − low) / median, as a percentage. How wide the market is. */
  spreadPct: number;
};

/**
 * The distribution of a product's current prices.
 *
 * Computed on LISTED price rather than landed, because that is the number a
 * competitor publishes and the number a seller is compared against on a
 * results page. Landed price is carried separately for the sellers where
 * shipping is actually stated — averaging a mix of landed and listed figures
 * would produce a number that describes neither.
 */
export function distribution(offers: CompetitorOffer[]): PriceDistribution | null {
  if (offers.length === 0) return null;

  const prices = offers.map((o) => o.priceMinor).sort((a, b) => a - b);
  const median = quantile(prices, 0.5);
  const low = prices[0]!;
  const high = prices[prices.length - 1]!;

  return {
    sellerCount: offers.length,
    marketplaceCount: new Set(offers.map((o) => o.marketplaceId)).size,
    inStockCount: offers.filter((o) => o.inStock).length,
    lowMinor: low,
    p25Minor: quantile(prices, 0.25),
    medianMinor: median,
    p75Minor: quantile(prices, 0.75),
    highMinor: high,
    meanMinor: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
    spreadPct: median > 0 ? round(((high - low) / median) * 100, 1) : 0,
  };
}

export type MarketPosition = {
  /** 1 = cheapest. */
  rank: number;
  of: number;
  /** How many sellers this price undercuts. */
  undercuts: number;
  /** 0 = cheapest in the market, 100 = dearest. */
  percentile: number;
  /** Distance from the cheapest seller, as a percentage of it. */
  premiumOverLowPct: number;
  /** Distance from the median, signed. */
  vsMedianPct: number;
};

/** Where a given price would sit among these sellers. */
export function positionOf(priceMinor: number, offers: CompetitorOffer[]): MarketPosition | null {
  if (offers.length === 0) return null;
  const prices = offers.map((o) => o.priceMinor).sort((a, b) => a - b);
  const low = prices[0]!;
  const median = quantile(prices, 0.5);

  const cheaperThanMe = prices.filter((p) => p < priceMinor).length;
  const dearerThanMe = prices.filter((p) => p > priceMinor).length;

  return {
    rank: cheaperThanMe + 1,
    of: prices.length + 1,
    undercuts: dearerThanMe,
    percentile: round((cheaperThanMe / prices.length) * 100, 1),
    premiumOverLowPct: low > 0 ? round(((priceMinor - low) / low) * 100, 1) : 0,
    vsMedianPct: median > 0 ? round(((priceMinor - median) / median) * 100, 1) : 0,
  };
}

export type CompetitiveStructure = {
  cheapest: CompetitorOffer;
  dearest: CompetitorOffer;
  /**
   * What it costs to take the cheapest slot: one minor unit below the current
   * floor. Reported as the gap to the second cheapest too, because that is
   * the real question — undercutting a lone outlier by 1 rupee is not the
   * same move as undercutting a pack of six.
   */
  floorMinor: number;
  secondFloorMinor: number | null;
  floorGapMinor: number | null;
  /**
   * Sellers within 2% of the floor. A crowded floor means price leadership is
   * contested and will be matched; a lonely floor means the cheapest seller
   * is an outlier, possibly a stale or grey listing.
   */
  atFloorCount: number;
  /**
   * 0..1 — how concentrated the market is around its median. High means
   * everyone is charging much the same thing, so price is not the lever.
   */
  clustering: number;
};

const FLOOR_TOLERANCE = 0.02;

/** The shape of the competition, beyond its summary statistics. */
export function structure(offers: CompetitorOffer[]): CompetitiveStructure | null {
  const inPlay = offers.filter((o) => o.inStock);
  const pool = inPlay.length > 0 ? inPlay : offers;
  if (pool.length === 0) return null;

  const sorted = [...pool].sort((a, b) => a.priceMinor - b.priceMinor);
  const cheapest = sorted[0]!;
  const dearest = sorted[sorted.length - 1]!;
  const floor = cheapest.priceMinor;
  const second = sorted[1]?.priceMinor ?? null;

  const prices = sorted.map((o) => o.priceMinor);
  const median = quantile(prices, 0.5);
  /**
   * Clustering as the share of sellers within 5% of the median. Chosen over a
   * variance measure because it answers the seller's question directly: "if I
   * move my price 5%, how many competitors do I cross?"
   */
  const near = median > 0 ? prices.filter((p) => Math.abs(p - median) / median <= 0.05).length : 0;

  return {
    cheapest,
    dearest,
    floorMinor: floor,
    secondFloorMinor: second,
    floorGapMinor: second == null ? null : second - floor,
    atFloorCount: prices.filter((p) => p <= floor * (1 + FLOOR_TOLERANCE)).length,
    clustering: round(near / prices.length, 3),
  };
}

/**
 * SPLIT THE MARKET BY CONDITION BEFORE ANY STATISTIC IS TAKEN.
 *
 * Found against live data. A capture for "apple iphone 16 pro 256gb" returned
 * six sellers, of which one was selling a RENEWED unit at ₹89,999 and another
 * a USED one at ₹1,08,399, against new stock at ₹1,14,999–₹1,47,227. Pooled,
 * the market's floor was the refurbished price and its spread was 50%, and
 * the recommendation was reasoning about "the cheapest seller" as though a
 * seller of a new phone could match it.
 *
 * They are not competitors. A refurbished unit and a new one are different
 * products sold to different buyers, and a new-stock seller who prices
 * against the refurbished floor is pricing against a market they are not in.
 *
 * So condition is a partition, not an attribute. The NEW offers are the
 * market when any exist, because that is what a seller listing new stock is
 * competing in; the rest are returned separately, because a refurbished
 * market twenty per cent below is real and worth seeing — it is simply not
 * the market the price is argued from.
 *
 * When there is no new stock at all, the refurbished offers become the market
 * on their own. A product that is only sold refurbished still has a price.
 */
export type SegmentedMarket = {
  /** The offers a price should be argued against. */
  primary: CompetitorOffer[];
  /** Which condition `primary` holds. */
  primaryCondition: "new" | "renewed" | "used";
  /** Everything else, grouped, so it can be reported rather than discarded. */
  secondary: Array<{ condition: "renewed" | "used" | "new"; offers: CompetitorOffer[] }>;
};

export function segmentByCondition(offers: CompetitorOffer[]): SegmentedMarket | null {
  if (offers.length === 0) return null;

  const byCondition = new Map<"new" | "renewed" | "used", CompetitorOffer[]>();
  for (const offer of offers) {
    byCondition.set(offer.condition, [...(byCondition.get(offer.condition) ?? []), offer]);
  }

  /** New first; failing that, the best condition actually on offer. */
  const order: Array<"new" | "renewed" | "used"> = ["new", "renewed", "used"];
  const primaryCondition = order.find((c) => (byCondition.get(c)?.length ?? 0) > 0)!;

  return {
    primary: byCondition.get(primaryCondition)!,
    primaryCondition,
    secondary: order
      .filter((c) => c !== primaryCondition && (byCondition.get(c)?.length ?? 0) > 0)
      .map((condition) => ({ condition, offers: byCondition.get(condition)! })),
  };
}

export type MarketTrendPoint = { capturedOn: string; medianMinor: number; sellerCount: number };

export type MarketTrend = {
  direction: "rising" | "falling" | "flat";
  changePct: number;
  /** Days actually covered by our own observations. Never backfilled. */
  spanDays: number;
  points: number;
  /**
   * The smallest and largest seller counts behind the window. A median that
   * moved while the seller count halved may be describing the sample rather
   * than the market, and a reader is entitled to know that.
   */
  minSellerCount: number;
  maxSellerCount: number;
  /** True when seller counts are stable enough for the move to be about price. */
  comparable: boolean;
};

/** A material move. Below this, a median shuffling between adjacent sellers. */
const FLAT_BAND_PCT = 1.5;

/**
 * The trend in a product's own captured history.
 *
 * Deliberately refuses to interpolate, extrapolate or smooth. Two captures
 * three days apart are two points three days apart; they are not a daily
 * series, and presenting them as one would manufacture observations. If the
 * window holds one point there is no trend, and that is the honest answer on
 * the day a product is first tracked.
 */
export function trend(points: MarketTrendPoint[]): MarketTrend | null {
  if (points.length < 2) return null;

  const ordered = [...points].sort((a, b) => a.capturedOn.localeCompare(b.capturedOn));
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;

  const changePct = first.medianMinor > 0 ? round(((last.medianMinor - first.medianMinor) / first.medianMinor) * 100, 2) : 0;
  const counts = ordered.map((p) => p.sellerCount);
  const minSellerCount = Math.min(...counts);
  const maxSellerCount = Math.max(...counts);

  const spanDays = Math.max(
    0,
    Math.round((Date.parse(`${last.capturedOn}T00:00:00Z`) - Date.parse(`${first.capturedOn}T00:00:00Z`)) / 86_400_000)
  );

  return {
    direction: changePct > FLAT_BAND_PCT ? "rising" : changePct < -FLAT_BAND_PCT ? "falling" : "flat",
    changePct,
    spanDays,
    points: ordered.length,
    minSellerCount,
    maxSellerCount,
    /**
     * Within a factor of two. Beyond that the two medians are computed over
     * materially different populations and the comparison is not a price
     * movement, whatever the arithmetic says.
     */
    comparable: minSellerCount > 0 && maxSellerCount / minSellerCount <= 2,
  };
}
