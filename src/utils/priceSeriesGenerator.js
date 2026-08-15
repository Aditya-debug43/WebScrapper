import { mulberry32, hashSeed } from "./seededRandom";

/**
 * Generates a daily price_observation series for one offer.
 * Grain: one row per (offerId, observedAt) — never overwritten, only appended,
 * matching the append-only design of the price history fact table.
 *
 * Amounts are generated in whole rupees for readability, then converted to
 * minor units (paise) on the way out, same as the stored schema.
 */
export function generateOfferPriceSeries({
  offerId,
  startDate,
  days,
  mrp,
  startSellingPrice,
  endSellingPrice,
  saleWindows = [], // [{ startDay, endDay, dropPct, label }]
  stockOutDays = [],
  shippingFee = 0,
  parserVersionSwitchDay = null,
  parserVersions = ["v2.1", "v2.3"],
}) {
  const rand = mulberry32(hashSeed(offerId));
  const start = new Date(startDate);
  const obs = [];

  for (let d = 0; d < days; d++) {
    const t = days === 1 ? 0 : d / (days - 1);
    let price = startSellingPrice + (endSellingPrice - startSellingPrice) * t;
    price += (rand() - 0.5) * 2 * (startSellingPrice * 0.006);

    const activeSale = saleWindows.find((w) => d >= w.startDay && d <= w.endDay);
    if (activeSale) price *= 1 - activeSale.dropPct;

    price = Math.round(price / 10) * 10;

    const date = new Date(start);
    date.setDate(date.getDate() + d);
    const observedAt = date.toISOString().slice(0, 10);

    obs.push({
      id: `${offerId}_obs_${d}`,
      offerId,
      observedAt,
      recordedAt: `${observedAt}T03:15:00+05:30`,
      mrpMinor: mrp * 100,
      sellingPriceMinor: price * 100,
      shippingFeeMinor: shippingFee * 100,
      currencyCode: "INR",
      isInStock: !stockOutDays.includes(d),
      isBuyboxWinner: false, // assigned in a post-pass across a listing's offers
      saleLabel: activeSale ? activeSale.label : null,
      rawDocumentId: `doc_${offerId}_d${d}`,
      parserVersion:
        parserVersionSwitchDay !== null && d >= parserVersionSwitchDay
          ? parserVersions[1]
          : parserVersions[0],
    });
  }
  return obs;
}

/**
 * For every date shared across a set of offers on the same listing, marks the
 * lowest in-stock landed price (selling + shipping) as the Buy Box / featured
 * offer winner for that day — mirrors how Amazon's Buy Box and Flipkart's
 * default seller selection actually work, computed from data rather than
 * hand-assigned.
 */
export function assignBuyboxWinners(offerSeriesList) {
  const byDate = new Map();
  for (const series of offerSeriesList) {
    for (const obs of series) {
      if (!byDate.has(obs.observedAt)) byDate.set(obs.observedAt, []);
      byDate.get(obs.observedAt).push(obs);
    }
  }
  for (const rows of byDate.values()) {
    const inStock = rows.filter((r) => r.isInStock);
    if (inStock.length === 0) continue;
    let winner = inStock[0];
    for (const r of inStock) {
      const landed = r.sellingPriceMinor + r.shippingFeeMinor;
      const winnerLanded = winner.sellingPriceMinor + winner.shippingFeeMinor;
      if (landed < winnerLanded) winner = r;
    }
    winner.isBuyboxWinner = true;
  }
  return offerSeriesList.flat();
}

export function generateReviewSnapshotSeries({
  listingId,
  startDate,
  points,
  startCount,
  endCount,
  startRating,
  endRating,
  intervalDays = 30,
}) {
  const rand = mulberry32(hashSeed(listingId + "_reviews"));
  const start = new Date(startDate);
  const rows = [];
  for (let i = 0; i < points; i++) {
    const t = points === 1 ? 1 : i / (points - 1);
    const eased = Math.pow(t, 0.85); // review growth front-loads slightly then tapers
    const reviewCount = Math.round(startCount + (endCount - startCount) * eased);
    const ratingCount = Math.round(reviewCount * 4.4);
    const rating = startRating + (endRating - startRating) * t + (rand() - 0.5) * 0.04;
    const date = new Date(start);
    date.setDate(date.getDate() + i * intervalDays);
    rows.push({
      id: `${listingId}_rev_${i}`,
      listingId,
      capturedAt: date.toISOString().slice(0, 10),
      averageRating: Math.round(rating * 10) / 10,
      ratingCount,
      reviewCount,
      ratingDistribution: distributionFor(rating, reviewCount),
    });
  }
  return rows;
}

function distributionFor(avgRating, total) {
  // Rough shape: skew mass toward 5-star as avgRating rises, small fixed 1-2 star tail.
  const fiveShare = Math.min(0.78, Math.max(0.42, (avgRating - 2.6) / 2.2));
  const oneShare = 0.05;
  const twoShare = 0.04;
  const threeShare = 0.09;
  const fourShare = Math.max(0.06, 1 - fiveShare - oneShare - twoShare - threeShare);
  return {
    1: Math.round(total * oneShare),
    2: Math.round(total * twoShare),
    3: Math.round(total * threeShare),
    4: Math.round(total * fourShare),
    5: Math.round(total * fiveShare),
  };
}
