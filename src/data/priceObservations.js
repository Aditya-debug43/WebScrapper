import {
  generateOfferPriceSeries,
  assignBuyboxWinners,
} from "../utils/priceSeriesGenerator";
import { generatedPriceObservations } from "../utils/catalogueGenerator";

// Grain: one row = one offer's price, at one moment in time. Append-only —
// nothing here is ever mutated, a correction would be a new row with a later
// recordedAt. 150 days of daily history for the primary demo variant; a
// shorter window for the sibling variant and the comparable-set listings,
// which only need a current price and a light trend.

const PRIMARY_START = "2026-03-17"; // 150 days back from "today" (2026-08-14)
const PRIMARY_DAYS = 150;

const flipkartM14Series = [
  generateOfferPriceSeries({
    offerId: "off_fk_m14_6_128_wsretail",
    startDate: PRIMARY_START,
    days: PRIMARY_DAYS,
    mrp: 17999,
    startSellingPrice: 13999,
    endSellingPrice: 12999,
    saleWindows: [
      { startDay: 40, endDay: 46, dropPct: 0.08, label: "Big Saving Days" },
      { startDay: 143, endDay: 149, dropPct: 0.1, label: "Independence Day Sale" },
    ],
    parserVersionSwitchDay: 120,
    parserVersions: ["fk-parser-v2.1", "fk-parser-v2.3"],
  }),
  generateOfferPriceSeries({
    offerId: "off_fk_m14_6_128_retailnet",
    startDate: PRIMARY_START,
    days: PRIMARY_DAYS,
    mrp: 17999,
    startSellingPrice: 14299,
    endSellingPrice: 13299,
    saleWindows: [
      { startDay: 40, endDay: 46, dropPct: 0.06, label: "Big Saving Days" },
      { startDay: 143, endDay: 149, dropPct: 0.07, label: "Independence Day Sale" },
    ],
    parserVersionSwitchDay: 120,
    parserVersions: ["fk-parser-v2.1", "fk-parser-v2.3"],
  }),
  generateOfferPriceSeries({
    offerId: "off_fk_m14_6_128_supercomnet",
    startDate: PRIMARY_START,
    days: PRIMARY_DAYS,
    mrp: 17999,
    startSellingPrice: 14499,
    endSellingPrice: 13699,
    saleWindows: [{ startDay: 143, endDay: 149, dropPct: 0.05, label: "Independence Day Sale" }],
    parserVersionSwitchDay: 120,
    parserVersions: ["fk-parser-v2.1", "fk-parser-v2.3"],
  }),
];

const amazonM14Series = [
  generateOfferPriceSeries({
    offerId: "off_az_m14_6_128_appario",
    startDate: PRIMARY_START,
    days: PRIMARY_DAYS,
    mrp: 17999,
    startSellingPrice: 13899,
    endSellingPrice: 12899,
    saleWindows: [
      { startDay: 50, endDay: 56, dropPct: 0.09, label: "Great Summer Sale" },
      { startDay: 143, endDay: 149, dropPct: 0.09, label: "Independence Day Sale" },
    ],
    parserVersionSwitchDay: 115,
    parserVersions: ["az-parser-v1.7", "az-parser-v1.8"],
  }),
  generateOfferPriceSeries({
    offerId: "off_az_m14_6_128_cloudtail",
    startDate: PRIMARY_START,
    days: PRIMARY_DAYS,
    mrp: 17999,
    startSellingPrice: 14199,
    endSellingPrice: 13199,
    saleWindows: [
      { startDay: 50, endDay: 56, dropPct: 0.06, label: "Great Summer Sale" },
      { startDay: 143, endDay: 149, dropPct: 0.06, label: "Independence Day Sale" },
    ],
    parserVersionSwitchDay: 115,
    parserVersions: ["az-parser-v1.7", "az-parser-v1.8"],
    shippingFee: 0,
  }),
  generateOfferPriceSeries({
    offerId: "off_az_m14_6_128_supercomnet",
    startDate: PRIMARY_START,
    days: PRIMARY_DAYS,
    mrp: 17999,
    startSellingPrice: 14799,
    endSellingPrice: 13999,
    saleWindows: [{ startDay: 143, endDay: 149, dropPct: 0.04, label: "Independence Day Sale" }],
    stockOutDays: Array.from({ length: 8 }, (_, i) => 70 + i),
    parserVersionSwitchDay: 115,
    parserVersions: ["az-parser-v1.7", "az-parser-v1.8"],
    shippingFee: 49,
  }),
];

const SIBLING_START = "2026-06-15";
const SIBLING_DAYS = 60;

const flipkartSiblingSeries = [
  generateOfferPriceSeries({
    offerId: "off_fk_m14_8_256_wsretail",
    startDate: SIBLING_START,
    days: SIBLING_DAYS,
    mrp: 20999,
    startSellingPrice: 17499,
    endSellingPrice: 16999,
    saleWindows: [{ startDay: 53, endDay: 59, dropPct: 0.08, label: "Independence Day Sale" }],
  }),
  generateOfferPriceSeries({
    offerId: "off_fk_m14_8_256_retailnet",
    startDate: SIBLING_START,
    days: SIBLING_DAYS,
    mrp: 20999,
    startSellingPrice: 17799,
    endSellingPrice: 17299,
    saleWindows: [{ startDay: 53, endDay: 59, dropPct: 0.05, label: "Independence Day Sale" }],
  }),
];

const amazonSiblingSeries = [
  generateOfferPriceSeries({
    offerId: "off_az_m14_8_256_appario",
    startDate: SIBLING_START,
    days: SIBLING_DAYS,
    mrp: 20999,
    startSellingPrice: 17399,
    endSellingPrice: 16899,
    saleWindows: [{ startDay: 53, endDay: 59, dropPct: 0.07, label: "Independence Day Sale" }],
  }),
  generateOfferPriceSeries({
    offerId: "off_az_m14_8_256_cloudtail",
    startDate: SIBLING_START,
    days: SIBLING_DAYS,
    mrp: 20999,
    startSellingPrice: 17699,
    endSellingPrice: 17199,
    saleWindows: [{ startDay: 53, endDay: 59, dropPct: 0.05, label: "Independence Day Sale" }],
  }),
];

const COMP_START = "2026-06-30";
const COMP_DAYS = 45;

const comparableSeries = [
  generateOfferPriceSeries({
    offerId: "off_fk_redminote13",
    startDate: COMP_START,
    days: COMP_DAYS,
    mrp: 16999,
    startSellingPrice: 12999,
    endSellingPrice: 12499,
    saleWindows: [{ startDay: 38, endDay: 44, dropPct: 0.06, label: "Independence Day Sale" }],
  }),
  generateOfferPriceSeries({
    offerId: "off_fk_realme12x",
    startDate: COMP_START,
    days: COMP_DAYS,
    mrp: 15999,
    startSellingPrice: 11999,
    endSellingPrice: 11499,
    saleWindows: [{ startDay: 38, endDay: 44, dropPct: 0.05, label: "Independence Day Sale" }],
  }),
  generateOfferPriceSeries({
    offerId: "off_az_oneplusnordce4lite",
    startDate: COMP_START,
    days: COMP_DAYS,
    mrp: 19999,
    startSellingPrice: 15999,
    endSellingPrice: 15499,
    saleWindows: [{ startDay: 38, endDay: 44, dropPct: 0.06, label: "Independence Day Sale" }],
  }),
  generateOfferPriceSeries({
    offerId: "off_az_vivot3x",
    startDate: COMP_START,
    days: COMP_DAYS,
    mrp: 16999,
    startSellingPrice: 12699,
    endSellingPrice: 12299,
    saleWindows: [{ startDay: 38, endDay: 44, dropPct: 0.05, label: "Independence Day Sale" }],
  }),
  generateOfferPriceSeries({
    offerId: "off_az_iphone13",
    startDate: COMP_START,
    days: COMP_DAYS,
    mrp: 59900,
    startSellingPrice: 46999,
    endSellingPrice: 45999,
    saleWindows: [{ startDay: 38, endDay: 44, dropPct: 0.04, label: "Independence Day Sale" }],
  }),
];

// ============================================================================
// EXPANDED COVERAGE — additional marketplace/seller pairs on existing
// products, plus the new laptop and earbuds categories. Trends are
// deliberately varied: most decline gently (typical e-commerce lifecycle),
// a couple are genuinely flat, iPhone 15's launch-discount-recovering rise
// is a real price INCREASE over time, and the Dell Inspiron offer carries an
// isolated mid-series promotional dip that recovers afterward rather than
// ending lower. Every series' final point is what the UI reads as "current
// price" — there is no separately hardcoded "current" value anywhere.
// ============================================================================

// ---- more sellers on existing listings ----
const expandedCoverageSeries = [
  generateOfferPriceSeries({
    offerId: "off_meesho_redminote13",
    startDate: "2026-07-05",
    days: 40,
    mrp: 16999,
    startSellingPrice: 12799,
    endSellingPrice: 12299,
    saleWindows: [{ startDay: 33, endDay: 39, dropPct: 0.05, label: "Independence Day Sale" }],
  }),
  generateOfferPriceSeries({
    offerId: "off_fk_redminote13_electrohub",
    startDate: "2026-07-05",
    days: 40,
    mrp: 16999,
    startSellingPrice: 13199,
    endSellingPrice: 12799,
    saleWindows: [{ startDay: 33, endDay: 39, dropPct: 0.04, label: "Independence Day Sale" }],
  }),
  generateOfferPriceSeries({
    offerId: "off_fk_oneplusnordce4lite",
    startDate: "2026-06-30",
    days: 45,
    mrp: 19999,
    startSellingPrice: 16299,
    endSellingPrice: 15799,
    saleWindows: [{ startDay: 38, endDay: 44, dropPct: 0.05, label: "Independence Day Sale" }],
  }),
];

// ---- iPhone 15 : all four offers RISE over the window — a post-launch
// discount that fades as the initial promotional stock clears ----
const iphone15Series = [
  generateOfferPriceSeries({
    offerId: "off_fk_iphone15_wsretail",
    startDate: "2026-06-15",
    days: 60,
    mrp: 79900,
    startSellingPrice: 68900,
    endSellingPrice: 74900,
  }),
  generateOfferPriceSeries({
    offerId: "off_fk_iphone15_electrohub",
    startDate: "2026-06-20",
    days: 55,
    mrp: 79900,
    startSellingPrice: 69900,
    endSellingPrice: 75900,
  }),
  generateOfferPriceSeries({
    offerId: "off_az_iphone15_appario",
    startDate: "2026-06-15",
    days: 60,
    mrp: 79900,
    startSellingPrice: 68500,
    endSellingPrice: 74500,
  }),
  generateOfferPriceSeries({
    offerId: "off_az_iphone15_cloudtail",
    startDate: "2026-06-17",
    days: 58,
    mrp: 79900,
    startSellingPrice: 69500,
    endSellingPrice: 75500,
  }),
];

// ---- Redmi A3 : budget tier ----
const redmiA3Series = [
  generateOfferPriceSeries({
    offerId: "off_meesho_redmia3",
    startDate: "2026-07-05",
    days: 40,
    mrp: 8999,
    startSellingPrice: 6799,
    endSellingPrice: 6499,
  }),
  generateOfferPriceSeries({
    offerId: "off_fk_redmia3",
    startDate: "2026-07-05",
    days: 40,
    mrp: 8999,
    startSellingPrice: 6999,
    endSellingPrice: 6699,
  }),
];

// ---- Laptops ----
const laptopSeries = [
  generateOfferPriceSeries({
    offerId: "off_fk_ideapad_i3_retailnet",
    startDate: "2026-06-25",
    days: 50,
    mrp: 32990,
    startSellingPrice: 26990,
    endSellingPrice: 25990,
    saleWindows: [{ startDay: 43, endDay: 49, dropPct: 0.05, label: "Independence Day Sale" }],
  }),
  generateOfferPriceSeries({
    offerId: "off_fk_ideapad_i3_electrohub",
    startDate: "2026-06-30",
    days: 45,
    mrp: 32990,
    startSellingPrice: 27490,
    endSellingPrice: 26490,
    saleWindows: [{ startDay: 38, endDay: 44, dropPct: 0.04, label: "Independence Day Sale" }],
  }),
  generateOfferPriceSeries({
    offerId: "off_fk_ideapad_i5_wsretail",
    startDate: "2026-06-25",
    days: 50,
    mrp: 42990,
    startSellingPrice: 35990,
    endSellingPrice: 34990,
    saleWindows: [{ startDay: 43, endDay: 49, dropPct: 0.05, label: "Independence Day Sale" }],
  }),
  generateOfferPriceSeries({
    offerId: "off_az_ideapad_i5_rkworld",
    startDate: "2026-06-30",
    days: 45,
    mrp: 42990,
    startSellingPrice: 36490,
    endSellingPrice: 35490,
    saleWindows: [{ startDay: 38, endDay: 44, dropPct: 0.04, label: "Independence Day Sale" }],
  }),
  // Deliberate isolated mid-series promotional dip that RECOVERS afterward —
  // a flat trend line with a temporary "Diwali Sale" window, distinct from
  // the more common "declines and stays lower" pattern used elsewhere.
  generateOfferPriceSeries({
    offerId: "off_az_dellinspiron15_appario",
    startDate: "2026-06-15",
    days: 60,
    mrp: 54990,
    startSellingPrice: 44990,
    endSellingPrice: 44990,
    saleWindows: [{ startDay: 25, endDay: 31, dropPct: 0.12, label: "Diwali Sale" }],
  }),
  generateOfferPriceSeries({
    offerId: "off_az_dellinspiron15_rkworld",
    startDate: "2026-06-20",
    days: 55,
    mrp: 54990,
    startSellingPrice: 45990,
    endSellingPrice: 44490,
  }),
  // Genuinely flat/stable pricing — no sale window, minimal drift.
  generateOfferPriceSeries({
    offerId: "off_fk_hppavilion15_omnitech",
    startDate: "2026-06-30",
    days: 45,
    mrp: 47990,
    startSellingPrice: 41990,
    endSellingPrice: 41990,
  }),
  generateOfferPriceSeries({
    offerId: "off_fk_asusvivobook15_retailnet",
    startDate: "2026-06-25",
    days: 50,
    mrp: 58990,
    startSellingPrice: 49990,
    endSellingPrice: 47990,
    saleWindows: [{ startDay: 43, endDay: 49, dropPct: 0.06, label: "Independence Day Sale" }],
  }),
  generateOfferPriceSeries({
    offerId: "off_az_asusvivobook15_primeelectronics",
    startDate: "2026-06-30",
    days: 45,
    mrp: 58990,
    startSellingPrice: 50990,
    endSellingPrice: 48990,
    saleWindows: [{ startDay: 38, endDay: 44, dropPct: 0.05, label: "Independence Day Sale" }],
  }),
  generateOfferPriceSeries({
    offerId: "off_az_macbookair_m2_appario",
    startDate: "2026-06-15",
    days: 60,
    mrp: 114900,
    startSellingPrice: 99900,
    endSellingPrice: 97900,
  }),
  generateOfferPriceSeries({
    offerId: "off_az_macbookair_m2_cloudtail",
    startDate: "2026-06-20",
    days: 55,
    mrp: 114900,
    startSellingPrice: 100900,
    endSellingPrice: 98900,
  }),
  // lst_fk_rogstrix has no offers, so no series is generated for it at all.
];

// ---- Wireless earbuds ----
const earbudsSeries = [
  generateOfferPriceSeries({
    offerId: "off_fk_boatairdopes141_omnitech",
    startDate: "2026-07-05",
    days: 40,
    mrp: 1990,
    startSellingPrice: 799,
    endSellingPrice: 699,
    saleWindows: [{ startDay: 33, endDay: 39, dropPct: 0.1, label: "Independence Day Sale" }],
  }),
  generateOfferPriceSeries({
    offerId: "off_fk_boatairdopes141_retailnet",
    startDate: "2026-07-10",
    days: 35,
    mrp: 1990,
    startSellingPrice: 849,
    endSellingPrice: 749,
  }),
  generateOfferPriceSeries({
    offerId: "off_meesho_boatairdopes141",
    startDate: "2026-07-05",
    days: 40,
    mrp: 1990,
    startSellingPrice: 749,
    endSellingPrice: 649,
  }),
  generateOfferPriceSeries({
    offerId: "off_fk_realmebudst300_electrohub",
    startDate: "2026-07-05",
    days: 40,
    mrp: 2999,
    startSellingPrice: 1799,
    endSellingPrice: 1699,
  }),
  generateOfferPriceSeries({
    offerId: "off_az_oneplusbuds3_appario",
    startDate: "2026-06-30",
    days: 45,
    mrp: 3999,
    startSellingPrice: 2799,
    endSellingPrice: 2699,
  }),
  generateOfferPriceSeries({
    offerId: "off_az_oneplusbuds3_primeelectronics",
    startDate: "2026-07-05",
    days: 40,
    mrp: 3999,
    startSellingPrice: 2899,
    endSellingPrice: 2799,
  }),
  // Second genuinely flat/stable example.
  generateOfferPriceSeries({
    offerId: "off_az_galaxybudsfe_cloudtail",
    startDate: "2026-07-05",
    days: 40,
    mrp: 5999,
    startSellingPrice: 3990,
    endSellingPrice: 3990,
  }),
  generateOfferPriceSeries({
    offerId: "off_fk_galaxybudsfe_wsretail",
    startDate: "2026-07-05",
    days: 40,
    mrp: 5999,
    startSellingPrice: 4190,
    endSellingPrice: 3990,
  }),
  generateOfferPriceSeries({
    offerId: "off_az_airpodspro2_appario",
    startDate: "2026-06-25",
    days: 50,
    mrp: 24900,
    startSellingPrice: 21900,
    endSellingPrice: 20900,
  }),
  generateOfferPriceSeries({
    // "renewed" condition — priced below the "new" offer above, as expected.
    offerId: "off_az_airpodspro2_rkworld",
    startDate: "2026-06-30",
    days: 45,
    mrp: 24900,
    startSellingPrice: 20900,
    endSellingPrice: 19900,
  }),
];

// Every new series, keyed by offer ID — makes listing-grouping below exact
// and immune to array-reordering mistakes (no positional indexing, no
// string-prefix filtering).
const seriesByOfferId = new Map(
  [...expandedCoverageSeries, ...iphone15Series, ...redmiA3Series, ...laptopSeries, ...earbudsSeries].map((s) => [
    s[0].offerId,
    s,
  ])
);
// off_fk_redminote13 itself lives in comparableSeries (defined further up,
// alongside the other originally single-seller comparable-set offers).
seriesByOfferId.set("off_fk_redminote13", comparableSeries.find((s) => s[0].offerId === "off_fk_redminote13"));

function seriesFor(offerId) {
  const series = seriesByOfferId.get(offerId);
  if (!series) throw new Error(`No generated price series for offer "${offerId}"`);
  return series;
}

// Listings with more than one offer need a real buy-box comparison across
// their sellers, day by day.
const MULTI_SELLER_LISTING_OFFER_IDS = [
  ["off_fk_redminote13", "off_fk_redminote13_electrohub"],
  ["off_fk_iphone15_wsretail", "off_fk_iphone15_electrohub"],
  ["off_az_iphone15_appario", "off_az_iphone15_cloudtail"],
  ["off_fk_ideapad_i3_retailnet", "off_fk_ideapad_i3_electrohub"],
  ["off_az_dellinspiron15_appario", "off_az_dellinspiron15_rkworld"],
  ["off_az_macbookair_m2_appario", "off_az_macbookair_m2_cloudtail"],
  ["off_fk_boatairdopes141_omnitech", "off_fk_boatairdopes141_retailnet"],
  ["off_az_oneplusbuds3_appario", "off_az_oneplusbuds3_primeelectronics"],
  ["off_az_airpodspro2_appario", "off_az_airpodspro2_rkworld"],
];

// Listings with exactly one offer — that offer trivially "wins" every day.
const SINGLE_SELLER_OFFER_IDS = [
  "off_meesho_redminote13",
  "off_fk_oneplusnordce4lite",
  "off_meesho_redmia3",
  "off_fk_redmia3",
  "off_fk_ideapad_i5_wsretail",
  "off_az_ideapad_i5_rkworld",
  "off_fk_hppavilion15_omnitech",
  "off_fk_asusvivobook15_retailnet",
  "off_az_asusvivobook15_primeelectronics",
  "off_meesho_boatairdopes141",
  "off_fk_realmebudst300_electrohub",
  "off_az_galaxybudsfe_cloudtail",
  "off_fk_galaxybudsfe_wsretail",
];

const newObservations = [
  ...MULTI_SELLER_LISTING_OFFER_IDS.flatMap((offerIds) => assignBuyboxWinners(offerIds.map(seriesFor))),
  ...SINGLE_SELLER_OFFER_IDS.flatMap((offerId) => {
    const series = seriesFor(offerId);
    series.forEach((row) => (row.isBuyboxWinner = true));
    return series;
  }),
];

// Buy Box / featured-offer winner is derived per listing, per day — the
// lowest in-stock landed price on that listing wins — not hand-assigned.
export const priceObservations = [
  ...assignBuyboxWinners(flipkartM14Series),
  ...assignBuyboxWinners(amazonM14Series),
  ...assignBuyboxWinners(flipkartSiblingSeries),
  ...assignBuyboxWinners(amazonSiblingSeries),
  ...comparableSeries
    .filter((s) => s[0].offerId !== "off_fk_redminote13") // regrouped above — lst_fk_redminote13 now has 2 sellers
    .map((series) => {
      series.forEach((row) => (row.isBuyboxWinner = true)); // sole seller on these listings
      return series;
    })
    .flat(),
  ...newObservations,
  // Catalogue-breadth observations — same grain, same append-only rule, buy-box
  // already resolved per listing inside the generator.
  ...generatedPriceObservations,
];

// Index by offer, built once. The observation table is by far the largest in
// the system (it grows with catalogue × sellers × days), so the per-offer
// lookups the UI does constantly must not scan it linearly each time.
const byOfferId = (() => {
  const map = new Map();
  for (const obs of priceObservations) {
    let arr = map.get(obs.offerId);
    if (!arr) map.set(obs.offerId, (arr = []));
    arr.push(obs);
  }
  for (const arr of map.values()) arr.sort((a, b) => (a.observedAt < b.observedAt ? -1 : 1));
  return map;
})();

export function getPriceHistoryForOffer(offerId) {
  return byOfferId.get(offerId) ?? [];
}

export function getLatestObservation(offerId) {
  const rows = byOfferId.get(offerId);
  return rows && rows.length ? rows[rows.length - 1] : null;
}

export function getPriceHistoryForListing(listingId, offerIds) {
  return priceObservations
    .filter((o) => offerIds.includes(o.offerId))
    .sort((a, b) => (a.observedAt < b.observedAt ? -1 : 1));
}
