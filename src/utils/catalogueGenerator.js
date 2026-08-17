import { mulberry32, hashSeed } from "./seededRandom";
import { catalogueSeed } from "../data/catalogueSeed";
import { productTypes, marketplaceCategories } from "../data/categories";
import { brands } from "../data/brands";

/**
 * Expands the compact catalogue seed into full, internally-consistent entity
 * graphs: Product → Listing (per marketplace) → Offer (per seller) → Price
 * Observations, plus Review Snapshots per listing.
 *
 * Two invariants this file exists to guarantee:
 *
 *  1. The cheapest current landed price across every generated offer for a
 *     product equals the seed's `price` EXACTLY. The catalogue card, the
 *     marketplace comparison and the price-history chart therefore cannot
 *     disagree — they all read the same observations.
 *
 *  2. Everything is deterministic (seeded PRNG keyed on IDs), so the dataset
 *     is stable across reloads and the same demo shows the same numbers.
 */

const TODAY = "2026-08-14";
const HISTORY_DAYS = 100;

const MARKETPLACE_BY_CODE = {
  fk: "mp_flipkart",
  az: "mp_amazon_in",
  mh: "mp_meesho",
};

// Seller pools per marketplace, cycled deterministically. These are the same
// seller entities defined in sellers.js — generated offers reuse real sellers
// rather than inventing parallel ones.
const SELLER_POOL = {
  mp_flipkart: ["sel_fk_retailnet", "sel_fk_wsretail", "sel_fk_electrohub", "sel_fk_omnitech", "sel_fk_supercomnet"],
  mp_amazon_in: ["sel_az_appario", "sel_az_cloudtail", "sel_az_rkworld", "sel_az_primeelectronics", "sel_az_supercomnet"],
  mp_meesho: ["sel_meesho_shreeenterprises", "sel_meesho_urbanbazaar"],
};

const EXTERNAL_ID_PREFIX = { mp_flipkart: "GEN", mp_amazon_in: "B0G", mp_meesho: "MSHG" };

function isoDaysBefore(endIso, daysBack) {
  const d = new Date(endIso);
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

/** hashSeed is a signed 32-bit hash, so it can be negative — a raw `% length`
 *  would then yield a negative index and silently produce `undefined`. */
function positiveHash(str) {
  return Math.abs(hashSeed(str));
}

function deriveModelName(seed) {
  const brandName = brands.find((b) => b.id === seed.brand)?.name ?? "";
  let name = seed.name.split("(")[0].split("—")[0].trim();
  if (brandName && name.toLowerCase().startsWith(brandName.toLowerCase())) {
    name = name.slice(brandName.length).trim();
  }
  return name || seed.name;
}

function productTypeInfo(ptypeId) {
  const pt = productTypes.find((p) => p.id === ptypeId);
  if (!pt) throw new Error(`Unknown product type in catalogue seed: ${ptypeId}`);
  return pt;
}

function marketplaceCategoryIdFor(marketplaceId, categoryId) {
  return (
    marketplaceCategories.find((mc) => mc.marketplaceId === marketplaceId && mc.mappedCategoryId === categoryId)?.id ??
    null
  );
}

/**
 * Daily price series for one generated offer, ending EXACTLY on `endPrice`.
 * Trend shape varies so the catalogue contains genuine rises, falls and flats
 * rather than one repeated curve.
 */
function generateSeries({
  offerId,
  endPrice,
  mrp,
  trend,
  days = HISTORY_DAYS,
  shippingFee = 0,
  promoNow = false,
  outOfStockDays = 0,
}) {
  const rand = mulberry32(hashSeed(offerId));

  // `promoNow` models a product that is ON PROMOTION RIGHT NOW: its normal
  // level is higher, and the last stretch of observations is discounted down
  // to the advertised price. This is what lets the engine distinguish
  // "this product sells for ₹X" from "this product is temporarily ₹X".
  const PROMO_DEPTH = 0.82;
  const promoDays = 10;
  const normalLevel = promoNow ? Math.round(endPrice / PROMO_DEPTH) : endPrice;

  const startMultiplier = trend === "up" ? 0.9 : trend === "flat" ? 1.012 : 1.13;
  const startPrice = Math.round(normalLevel * startMultiplier);

  // Roughly a third of offers carry a historical promotional dip, chosen
  // deterministically so the same offers always show one.
  const hasSale = !promoNow && hashSeed(offerId) % 3 === 0;
  const saleStart = days - 12;
  const saleEnd = days - 6;

  const startDate = isoDaysBefore(TODAY, days - 1);
  const start = new Date(startDate);
  const rows = [];

  for (let d = 0; d < days; d++) {
    const t = days === 1 ? 1 : d / (days - 1);
    // Ease-out so most of the movement happens early, like a real lifecycle.
    const eased = 1 - Math.pow(1 - t, 1.6);
    let price = startPrice + (normalLevel - startPrice) * eased;
    price += (rand() - 0.5) * 2 * (normalLevel * 0.004);

    let saleLabel = null;
    if (hasSale && d >= saleStart && d <= saleEnd) {
      price *= 0.94;
      saleLabel = "Independence Day Sale";
    }
    // An active promotion runs right up to the present observation.
    if (promoNow && d >= days - promoDays) {
      price *= PROMO_DEPTH;
      saleLabel = "Festive Sale";
    }

    price = Math.max(Math.round(price / 10) * 10, 10);

    const date = new Date(start);
    date.setDate(date.getDate() + d);
    const observedAt = date.toISOString().slice(0, 10);

    rows.push({
      id: `${offerId}_obs_${d}`,
      offerId,
      observedAt,
      recordedAt: `${observedAt}T03:15:00+05:30`,
      mrpMinor: mrp * 100,
      sellingPriceMinor: price * 100,
      shippingFeeMinor: shippingFee * 100,
      currencyCode: "INR",
      // A stockout is a run of observations at the END of the window: the offer
      // traded normally and then went unavailable, which is what the data looks
      // like in practice. The price is still recorded — a page keeps showing a
      // price while the buy button is disabled — so any consumer that forgets
      // to filter on availability will quote an unbuyable number.
      isInStock: outOfStockDays > 0 ? d < days - outOfStockDays : true,
      isBuyboxWinner: false, // assigned per listing below
      saleLabel,
      rawDocumentId: `doc_${offerId}_d${d}`,
      parserVersion: "catalogue-parser-v1.0",
    });
  }

  // Invariant 1: the final observation is the exact advertised price, never a
  // noisy approximation of it. When a promotion is live, the advertised price
  // IS the promotional price — and the label stays, because that is the
  // commercial state actually visible today.
  //
  // When the offer is currently out of stock the invariant moves with it: the
  // last IN-STOCK observation carries the exact price, because that is the last
  // price a buyer could actually have paid.
  const anchorIndex = outOfStockDays > 0 ? Math.max(days - outOfStockDays - 1, 0) : rows.length - 1;
  const anchorRow = rows[anchorIndex];
  anchorRow.sellingPriceMinor = endPrice * 100;
  anchorRow.saleLabel = promoNow ? "Festive Sale" : null;
  return rows;
}

function generateReviews({ listingId, endCount, endRating, points = 5, intervalDays = 20 }) {
  const rand = mulberry32(hashSeed(listingId + "_rev"));
  const startCount = Math.max(Math.round(endCount * 0.12), 5);
  const startRating = Math.max(3.4, endRating - 0.3);
  const startDate = isoDaysBefore(TODAY, (points - 1) * intervalDays);
  const start = new Date(startDate);
  const rows = [];

  for (let i = 0; i < points; i++) {
    const t = points === 1 ? 1 : i / (points - 1);
    const eased = Math.pow(t, 0.85);
    const reviewCount = Math.round(startCount + (endCount - startCount) * eased);
    const isLast = i === points - 1;
    const rating = isLast
      ? endRating
      : Math.round((startRating + (endRating - startRating) * t + (rand() - 0.5) * 0.04) * 10) / 10;
    const date = new Date(start);
    date.setDate(date.getDate() + i * intervalDays);
    rows.push({
      id: `${listingId}_rev_${i}`,
      listingId,
      capturedAt: date.toISOString().slice(0, 10),
      averageRating: rating,
      ratingCount: Math.round(reviewCount * 4.4),
      reviewCount,
      ratingDistribution: distributionFor(rating, reviewCount),
    });
  }
  return rows;
}

function distributionFor(avgRating, total) {
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

function buildAll() {
  const products = [];
  const listings = [];
  const offers = [];
  const observations = [];
  const reviews = [];

  // Seed ids are the primary key for everything generated below — product,
  // listing, offer and observation ids are all derived from them. A duplicate
  // therefore does not throw; it quietly produces two products sharing one id,
  // whose offers and price series merge into each other. That happened once and
  // was only caught by an audit noticing a price-history/current-price
  // mismatch, which is far too indirect a symptom for the cause. Fail loudly.
  const seen = new Set();
  const duplicates = catalogueSeed.map((s) => s.id).filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  if (duplicates.length > 0) {
    throw new Error(
      `catalogueSeed contains duplicate id(s): ${[...new Set(duplicates)].join(", ")}. Seed ids must be unique — every generated entity id derives from them.`
    );
  }

  for (const seed of catalogueSeed) {
    const pt = productTypeInfo(seed.ptype);
    const productId = `prod_${seed.id}`;

    products.push({
      id: productId,
      parentProductId: null,
      isPurchasable: true,
      brandId: seed.brand,
      categoryId: pt.categoryId,
      productTypeId: pt.id,
      canonicalName: seed.name,
      // Model name excludes the brand — UI that renders "brand + model"
      // (breadcrumbs, workspace headers) would otherwise repeat it.
      modelName: deriveModelName(seed),
      variantAxes: seed.variant ?? null,
      specSchemaVersion: pt.schemaVersion,
      specifications: seed.specs,
      identifiers: [],
      lifecycleStatus: "active",
      firstSeenAt: isoDaysBefore(TODAY, HISTORY_DAYS + 30),
    });

    seed.mps.forEach((code, mpIndex) => {
      const marketplaceId = MARKETPLACE_BY_CODE[code];
      const listingId = `lst_${code}_${seed.id}`;
      const rating = Math.max(3.5, Math.round((seed.rating - mpIndex * 0.1) * 10) / 10);
      const reviewCount = Math.round(seed.reviews * (mpIndex === 0 ? 1 : 0.55));

      listings.push({
        id: listingId,
        productId,
        marketplaceId,
        externalListingId: `${EXTERNAL_ID_PREFIX[marketplaceId]}${positiveHash(listingId).toString(36).toUpperCase().slice(-8)}`,
        listingUrl: `https://www.${marketplaceId === "mp_flipkart" ? "flipkart.com" : marketplaceId === "mp_amazon_in" ? "amazon.in" : "meesho.com"}/p/${seed.id}`,
        marketplaceCategoryId: marketplaceCategoryIdFor(marketplaceId, pt.categoryId),
        rawTitle: seed.name,
        marketplaceBrandText: seed.brand.replace("brand_", "").replace(/_/g, " "),
        matchStatus: mpIndex === 0 ? "human_confirmed" : "auto_matched",
        matchConfidence: mpIndex === 0 ? 0.97 : 0.92,
        listingStatus: "active",
        firstSeenAt: isoDaysBefore(TODAY, HISTORY_DAYS + 20),
        lastSeenAt: "2026-08-13",
      });

      reviews.push(...generateReviews({ listingId, endCount: reviewCount, endRating: rating }));

      // The first marketplace in the seed carries the global cheapest price;
      // later marketplaces sit slightly above it.
      //
      // `seed.price` is the LANDED price — what the buyer pays — so when the
      // offer charges shipping, that shipping is carved OUT of the selling
      // price rather than added on top of it. Otherwise adding a shipping fee
      // would silently break invariant 1 and the catalogue card would disagree
      // with the listing page by exactly the delivery charge.
      const shippingFee = seed.shipping ?? 0;
      const landedBase = mpIndex === 0 ? seed.price : Math.round(seed.price * (1 + 0.018 * mpIndex + 0.004));
      const listingBase = landedBase - shippingFee;
      const pool = SELLER_POOL[marketplaceId];
      const sellerCount = Math.min(seed.sellers ?? 1, pool.length);
      const listingSeries = [];

      for (let s = 0; s < sellerCount; s++) {
        const sellerId = pool[(positiveHash(listingId) + s) % pool.length];
        const offerId = `off_${code}_${seed.id}_${s}`;
        // Offer 0 is the cheapest on its listing; others are priced above it.
        const offerPrice = s === 0 ? listingBase : Math.round(listingBase * (1 + 0.025 * s));

        offers.push({
          id: offerId,
          listingId,
          sellerId,
          itemCondition: "new",
          offerStatus: "active",
          firstSeenAt: isoDaysBefore(TODAY, HISTORY_DAYS + 10),
        });

        // `outOfStockDays` takes every seller out; `cheapestOfferOutOfStockDays`
        // takes only offer 0 — the cheapest on the listing — which is the case
        // that catches availability filtering, because the unbuyable price is
        // the one a naive "cheapest offer" query would return.
        const offerOutOfStockDays =
          seed.outOfStockDays ?? (s === 0 ? (seed.cheapestOfferOutOfStockDays ?? 0) : 0);

        listingSeries.push(
          generateSeries({
            offerId,
            endPrice: offerPrice,
            mrp: seed.mrp,
            trend: seed.trend ?? "down",
            promoNow: !!seed.promoNow,
            shippingFee,
            outOfStockDays: offerOutOfStockDays,
          })
        );
      }

      // Buy Box per listing per day — lowest in-stock landed price wins,
      // computed rather than hand-assigned, same rule as the curated data.
      const byDate = new Map();
      for (const series of listingSeries) {
        for (const obs of series) {
          if (!byDate.has(obs.observedAt)) byDate.set(obs.observedAt, []);
          byDate.get(obs.observedAt).push(obs);
        }
      }
      for (const rows of byDate.values()) {
        let winner = null;
        for (const r of rows) {
          if (!r.isInStock) continue;
          const landed = r.sellingPriceMinor + r.shippingFeeMinor;
          if (winner === null || landed < winner.sellingPriceMinor + winner.shippingFeeMinor) winner = r;
        }
        if (winner) winner.isBuyboxWinner = true;
      }

      observations.push(...listingSeries.flat());
    });
  }

  return { products, listings, offers, observations, reviews };
}

const generated = buildAll();

export const generatedProducts = generated.products;
export const generatedListings = generated.listings;
export const generatedOffers = generated.offers;
export const generatedPriceObservations = generated.observations;
export const generatedReviewSnapshots = generated.reviews;
