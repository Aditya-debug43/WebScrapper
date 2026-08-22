import { mulberry32, hashSeed } from "./seededRandom";
import { catalogueSeed } from "../data/catalogueSeed";
import { productTypes, marketplaceCategories, getDepartmentId } from "../data/categories";
import { brands } from "../data/brands";
import { marketplaces, marketplaceCoversDepartment } from "../data/marketplaces";
import { generatedSellers } from "./sellerGenerator";

/**
 * Expands the compact catalogue seed into full, internally-consistent entity
 * graphs: Product → Listing (per marketplace) → Offer (per seller) → Price
 * Observations, plus Review Snapshots per listing and Promotions per offer.
 *
 * INVARIANTS THIS FILE EXISTS TO GUARANTEE
 * ----------------------------------------
 *  1. The cheapest current IN-STOCK landed price across every generated offer
 *     for a product equals the seed's `price` EXACTLY. The catalogue card, the
 *     marketplace comparison and the price-history chart therefore cannot
 *     disagree — they all read the same observations.
 *  2. Everything is deterministic (seeded PRNG keyed on IDs), so the dataset is
 *     stable across reloads and the same demo shows the same numbers.
 *  3. Seed ids are unique. A duplicate silently produced two products under one
 *     id with merged offer series, and surfaced only as an indirect price
 *     mismatch — so it is now a hard error at build time.
 *
 * HISTORY DEPTH IS TIERED, NOT UNIFORM
 * ------------------------------------
 * Giving every offer a daily 120-day series would produce roughly half a
 * million observations for this catalogue — more memory than a browser
 * prototype should spend, and not how real capture works either. Real pipelines
 * poll high-traffic products daily and the long tail far less often. So:
 *
 *   deep      daily, 120 days     — high-review products, the ones a pricing
 *                                   analyst actually watches
 *   standard  every 3 days, 120d  — mainstream products
 *   sparse    every 9 days, 120d  — long-tail products
 *
 * The tier is derived from review volume rather than declared per row, so it
 * follows the catalogue's own shape. Sparse history is itself a test fixture:
 * the evidence layer is supposed to notice thin history and say so.
 */

const TODAY = "2026-08-14";
const HISTORY_WINDOW_DAYS = 120;

const MARKETPLACE_BY_CODE = {
  fk: "mp_flipkart",
  az: "mp_amazon_in",
  mh: "mp_meesho",
  my: "mp_myntra",
  aj: "mp_ajio",
  ny: "mp_nykaa",
};

const EXTERNAL_ID_PREFIX = {
  mp_flipkart: "GEN",
  mp_amazon_in: "B0G",
  mp_meesho: "MSHG",
  mp_myntra: "MYNG",
  mp_ajio: "AJOG",
  mp_nykaa: "NYKG",
};

const DOMAIN = {
  mp_flipkart: "flipkart.com",
  mp_amazon_in: "amazon.in",
  mp_meesho: "meesho.com",
  mp_myntra: "myntra.com",
  mp_ajio: "ajio.com",
  mp_nykaa: "nykaa.com",
};

// Marketplaces price the same product differently: value platforms undercut,
// fashion verticals sit slightly above on brand-led categories. This is a real
// structural difference and it is what makes cross-marketplace comparison
// worth doing at all.
const MARKETPLACE_PRICE_BIAS = {
  mp_flipkart: 1.0,
  mp_amazon_in: 1.004,
  mp_meesho: 0.978,
  mp_myntra: 1.022,
  mp_ajio: 1.014,
  mp_nykaa: 1.018,
};

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

const productTypeById = new Map(productTypes.map((p) => [p.id, p]));

function productTypeInfo(ptypeId) {
  const pt = productTypeById.get(ptypeId);
  if (!pt) throw new Error(`Unknown product type in catalogue seed: ${ptypeId}`);
  return pt;
}

const mpCategoryIndex = (() => {
  const map = new Map();
  for (const mc of marketplaceCategories) map.set(`${mc.marketplaceId}::${mc.mappedCategoryId}`, mc.id);
  return map;
})();

function marketplaceCategoryIdFor(marketplaceId, categoryId) {
  return mpCategoryIndex.get(`${marketplaceId}::${categoryId}`) ?? null;
}

// Sellers, bucketed per marketplace and ordered so anchors come first. The
// generator draws from the head for popular products and deeper into the tail
// for long-tail ones, which reproduces the real top-heavy offer distribution.
const SELLER_POOL = (() => {
  const map = new Map();
  for (const mp of marketplaces) map.set(mp.id, []);
  for (const s of generatedSellers) map.get(s.marketplaceId)?.push(s);
  return map;
})();

/**
 * How deep a history this product gets, derived from its market traction.
 *
 * The cadences are capture intervals, not a compromise on realism: a real
 * pipeline polls a best-seller every couple of days and a long-tail SKU
 * fortnightly, because crawl budget is finite. Holding every offer at daily
 * resolution would put this dataset past 400,000 observations, which is more
 * than a browser prototype should carry in memory for no analytical gain —
 * the 90-day median and the distortion check read the same signal either way.
 */
function historyTierFor(seed) {
  if (seed.reviews >= 25000) return { key: "deep", stepDays: 2 };
  if (seed.reviews >= 6000) return { key: "standard", stepDays: 5 };
  return { key: "sparse", stepDays: 12 };
}

/**
 * Daily-or-sampled price series for one generated offer, ending EXACTLY on
 * `endPrice` at its last in-stock observation. Trend shape varies so the
 * catalogue contains genuine rises, falls, flats and promotional recoveries
 * rather than one repeated curve.
 */
function generateSeries({
  offerId,
  endPrice,
  mrp,
  trend,
  stepDays,
  shippingFee = 0,
  promoNow = false,
  outOfStockDays = 0,
  seasonal = false,
}) {
  const rand = mulberry32(hashSeed(offerId));

  // `promoNow` models a product ON PROMOTION RIGHT NOW: its normal level is
  // higher, and the last stretch of observations is discounted down to the
  // advertised price. This is what lets the engine distinguish "this product
  // sells for ₹X" from "this product is temporarily ₹X".
  const PROMO_DEPTH = 0.82;
  const promoDays = 10;
  const normalLevel = promoNow ? Math.round(endPrice / PROMO_DEPTH) : endPrice;

  const startMultiplier = trend === "up" ? 0.9 : trend === "flat" ? 1.012 : 1.13;
  const startPrice = Math.round(normalLevel * startMultiplier);

  // Roughly a third of offers carry a historical promotional dip, chosen
  // deterministically so the same offers always show one.
  const hasSale = !promoNow && positiveHash(offerId) % 3 === 0;
  const saleStart = HISTORY_WINDOW_DAYS - 40;
  const saleEnd = HISTORY_WINDOW_DAYS - 33;

  // A seasonal product runs a slow annual swing on top of its trend — the
  // shape an air cooler or a room heater actually traces.
  const seasonalAmplitude = seasonal ? 0.07 : 0;

  const rows = [];
  const offsets = [];
  for (let d = 0; d < HISTORY_WINDOW_DAYS; d += stepDays) offsets.push(d);
  // Always include the final day, whatever the step, so "today" is observed.
  if (offsets[offsets.length - 1] !== HISTORY_WINDOW_DAYS - 1) offsets.push(HISTORY_WINDOW_DAYS - 1);

  const startDate = isoDaysBefore(TODAY, HISTORY_WINDOW_DAYS - 1);
  const start = new Date(startDate);

  for (let i = 0; i < offsets.length; i++) {
    const d = offsets[i];
    const t = HISTORY_WINDOW_DAYS === 1 ? 1 : d / (HISTORY_WINDOW_DAYS - 1);
    // Ease-out so most of the movement happens early, like a real lifecycle.
    const eased = 1 - Math.pow(1 - t, 1.6);
    let price = startPrice + (normalLevel - startPrice) * eased;
    price += (rand() - 0.5) * 2 * (normalLevel * 0.004);
    if (seasonalAmplitude) price *= 1 + seasonalAmplitude * Math.sin((d / HISTORY_WINDOW_DAYS) * Math.PI * 2);

    let saleLabel = null;
    if (hasSale && d >= saleStart && d <= saleEnd) {
      price *= 0.94;
      saleLabel = "Independence Day Sale";
    }
    if (promoNow && d >= HISTORY_WINDOW_DAYS - promoDays) {
      price *= PROMO_DEPTH;
      saleLabel = "Festive Sale";
    }

    // A seller may not list above the printed MRP — that is a legal ceiling,
    // not a pricing preference. Without this clamp a "down" trend starting 13%
    // above today's price silently produced historical observations above MRP
    // on tight-MRP products, which the pricing engine would then have to treat
    // as valid history.
    price = Math.min(price, mrp);
    price = Math.max(Math.round(price / 10) * 10, 10);
    if (price > mrp) price = Math.floor(mrp / 10) * 10;

    const date = new Date(start);
    date.setDate(date.getDate() + d);
    const observedAt = date.toISOString().slice(0, 10);

    rows.push({
      id: `${offerId}_o${i}`,
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
      isInStock: outOfStockDays > 0 ? d < HISTORY_WINDOW_DAYS - outOfStockDays : true,
      isBuyboxWinner: false, // assigned per listing below
      saleLabel,
      rawDocumentId: `doc_${offerId}_${i}`,
      parserVersion: "catalogue-parser-v1.2",
    });
  }

  // Invariant 1: the last IN-STOCK observation carries the exact advertised
  // price, never a noisy approximation. When a promotion is live the advertised
  // price IS the promotional price, and the label stays, because that is the
  // commercial state actually visible today.
  let anchorIndex = rows.length - 1;
  while (anchorIndex > 0 && !rows[anchorIndex].isInStock) anchorIndex--;
  rows[anchorIndex].sellingPriceMinor = Math.min(endPrice, mrp) * 100;
  rows[anchorIndex].saleLabel = promoNow ? "Festive Sale" : null;
  return rows;
}

function generateReviews({ listingId, endCount, endRating, points = 5, intervalDays = 22 }) {
  const rand = mulberry32(hashSeed(listingId + "_rev"));
  const startCount = Math.max(Math.round(endCount * 0.12), 5);
  const startRating = Math.max(3.2, endRating - 0.3);
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

/**
 * Promotions for one offer. Every availability class is represented across the
 * catalogue, because collapsing them into "a discount" is precisely the error
 * the price-ladder model exists to prevent — see data/promotions.js.
 *
 * DISCOUNT VALUES ARE CAPPED AS A SHARE OF PRICE.
 * Each rule below has a sensible floor (a ₹20 discount on a ₹20,000 phone is
 * not a promotion), but an unguarded floor is wrong in the other direction: a
 * flat ₹50 minimum on a ₹78 pen is a 64% discount, and fourteen products ended
 * up advertising an effective price 40–64% below their own market — enough to
 * push one of them out of its own price band and make it refuse to price at
 * all. `capped()` applies the floor only when the price can carry it, and never
 * lets any single promotion exceed its class ceiling.
 */
function generatePromotions({ offerId, marketplaceId, priceRupees, rand }) {
  const out = [];
  const roll = rand();

  /**
   * @param floor    the smallest discount worth advertising
   * @param computed the price-proportional value this rule wants
   * @param maxShare the largest fraction of price this class may ever take
   * @returns a rounded value, or 0 when nothing sensible fits
   */
  const capped = (floor, computed, maxShare) => {
    const ceiling = Math.floor(priceRupees * maxShare);
    if (ceiling < 10) return 0; // too cheap for any credible promotion
    const value = Math.min(Math.max(Math.min(floor, ceiling), computed), ceiling);
    return value >= 10 ? Math.round(value) : 0;
  };

  // Universal instant discounts are the only class that moves the comparison
  // price, so they are kept genuinely uncommon — about one offer in nine.
  if (roll < 0.11 && priceRupees > 400) {
    const value = capped(20, Math.round((priceRupees * (0.03 + rand() * 0.05)) / 10) * 10, 0.12);
    if (value > 0)
    out.push({
      id: `promo_${offerId}_inst`,
      offerId,
      promotionType: "instant_discount",
      label: `Instant discount of ₹${value} at checkout`,
      discountValueMinor: value * 100,
      validFrom: isoDaysBefore(TODAY, 20),
      validTo: isoDaysBefore(TODAY, -12),
      terms: { flatMinor: value * 100 },
      eligibility: null,
    });
  }

  if (roll > 0.55 && priceRupees > 2000) {
    const value = Math.min(2000, capped(100, Math.round((priceRupees * 0.1) / 50) * 50, 0.15));
    if (value > 0)
    out.push({
      id: `promo_${offerId}_bank`,
      offerId,
      promotionType: "bank_offer",
      label: `₹${value} instant discount with select bank cards`,
      discountValueMinor: value * 100,
      validFrom: isoDaysBefore(TODAY, 30),
      validTo: isoDaysBefore(TODAY, -20),
      terms: { flatMinor: value * 100, cardTypes: ["credit"] },
      eligibility: "Select bank credit cards, minimum spend applies",
    });
  }

  if (roll > 0.72 && priceRupees > 500) {
    const value = capped(30, Math.round((priceRupees * 0.05) / 10) * 10, 0.12);
    if (value > 0)
    out.push({
      id: `promo_${offerId}_coupon`,
      offerId,
      promotionType: "coupon",
      label: `Extra ₹${value} off with coupon`,
      discountValueMinor: value * 100,
      validFrom: isoDaysBefore(TODAY, 14),
      validTo: isoDaysBefore(TODAY, -8),
      terms: { flatMinor: value * 100, requiresCode: true },
      eligibility: "Coupon must be applied at checkout",
    });
  }

  if (roll > 0.85 && priceRupees > 1500) {
    const value = capped(50, Math.round((priceRupees * 0.04) / 10) * 10, 0.12);
    if (value > 0)
    out.push({
      id: `promo_${offerId}_cashback`,
      offerId,
      promotionType: "cashback",
      label: `₹${value} cashback as wallet credit`,
      discountValueMinor: value * 100,
      validFrom: isoDaysBefore(TODAY, 25),
      validTo: isoDaysBefore(TODAY, -15),
      terms: { flatMinor: value * 100 },
      eligibility: "Credited to wallet within 7 days of delivery",
    });
  }

  if (priceRupees > 8000 && roll > 0.4) {
    out.push({
      id: `promo_${offerId}_emi`,
      offerId,
      promotionType: "no_cost_emi",
      label: "No-cost EMI from ₹" + Math.round(priceRupees / 6).toLocaleString("en-IN") + "/month",
      discountValueMinor: Math.round(priceRupees * 0.06) * 100,
      validFrom: isoDaysBefore(TODAY, 40),
      validTo: isoDaysBefore(TODAY, -30),
      terms: { tenureMonths: 6 },
      eligibility: "6-month tenure on eligible cards",
    });
  }

  // Marketplace-wide seasonal campaigns — a universal class, scoped to the
  // platform running them rather than to the seller.
  if (roll > 0.93 && (marketplaceId === "mp_flipkart" || marketplaceId === "mp_amazon_in")) {
    const value = capped(50, Math.round((priceRupees * 0.04) / 10) * 10, 0.10);
    if (value > 0)
    out.push({
      id: `promo_${offerId}_campaign`,
      offerId,
      promotionType: "marketplace_campaign",
      label: "Festive campaign discount",
      discountValueMinor: value * 100,
      validFrom: isoDaysBefore(TODAY, 8),
      validTo: isoDaysBefore(TODAY, -6),
      terms: { flatMinor: value * 100 },
      eligibility: null,
    });
  }

  if (priceRupees > 15000 && roll > 0.66) {
    const value = Math.round(priceRupees * (0.12 + rand() * 0.12));
    out.push({
      id: `promo_${offerId}_exchange`,
      offerId,
      promotionType: "exchange",
      label: `Up to ₹${value.toLocaleString("en-IN")} off on exchange`,
      discountValueMinor: value * 100,
      validFrom: isoDaysBefore(TODAY, 45),
      validTo: isoDaysBefore(TODAY, -25),
      terms: { maxValueMinor: value * 100 },
      eligibility: "Subject to device condition and pincode availability",
    });
  }

  return out;
}

function buildAll() {
  const products = [];
  const listings = [];
  const offers = [];
  const observations = [];
  const reviews = [];
  const promotions = [];

  // Invariant 3 — a duplicate seed id used to merge two products silently.
  const seenSeedIds = new Set();
  for (const seed of catalogueSeed) {
    if (seenSeedIds.has(seed.id)) {
      throw new Error(`Duplicate catalogue seed id: "${seed.id}". Ids must be unique — a duplicate silently merges two products.`);
    }
    seenSeedIds.add(seed.id);
  }

  // Variant families: one non-purchasable parent per `family`, created once.
  const familyParents = new Map();
  for (const seed of catalogueSeed) {
    if (!seed.family || familyParents.has(seed.family)) continue;
    const pt = productTypeInfo(seed.ptype);
    const parentId = `prod_${seed.family}`;
    familyParents.set(seed.family, parentId);
    products.push({
      id: parentId,
      parentProductId: null,
      // The parent is a grouping node, never buyable. Every price, offer and
      // recommendation hangs off the variants.
      isPurchasable: false,
      brandId: seed.brand,
      categoryId: pt.categoryId,
      productTypeId: pt.id,
      canonicalName: seed.familyName ?? seed.name,
      modelName: deriveModelName({ ...seed, name: seed.familyName ?? seed.name }),
      variantAxes: null,
      specSchemaVersion: pt.schemaVersion,
      specifications: seed.specs,
      identifiers: [],
      lifecycleStatus: "active",
      firstSeenAt: isoDaysBefore(TODAY, HISTORY_WINDOW_DAYS + 30),
    });
  }

  for (const seed of catalogueSeed) {
    const pt = productTypeInfo(seed.ptype);
    const productId = `prod_${seed.id}`;
    const departmentId = getDepartmentId(pt.categoryId);
    const tier = historyTierFor(seed);

    products.push({
      id: productId,
      parentProductId: seed.family ? familyParents.get(seed.family) : null,
      isPurchasable: true,
      brandId: seed.brand,
      categoryId: pt.categoryId,
      productTypeId: pt.id,
      canonicalName: seed.name,
      // Model name excludes the brand — UI that renders "brand + model"
      // (breadcrumbs, workspace headers) would otherwise repeat it.
      modelName: deriveModelName(seed),
      variantAxes: seed.variant ?? (seed.variantAxis ? { [seed.variantAxis]: seed.specs[seed.variantAxis] } : null),
      specSchemaVersion: pt.schemaVersion,
      specifications: seed.specs,
      identifiers: [],
      lifecycleStatus: "active",
      firstSeenAt: isoDaysBefore(TODAY, HISTORY_WINDOW_DAYS + 30),
    });

    // A seed only lists on marketplaces that actually carry its department —
    // a saree does not appear on a beauty vertical, however the seed is written.
    const eligibleCodes = seed.mps.filter((code) => {
      const mpId = MARKETPLACE_BY_CODE[code];
      return mpId && marketplaceCoversDepartment(mpId, departmentId);
    });
    const codes = eligibleCodes.length ? eligibleCodes : [seed.mps[0]].filter((c) => MARKETPLACE_BY_CODE[c]);
    // Placeholder: price multipliers are computed once `codes` is final, below.
    let priceMultipliers = null;

    // COVERAGE SPREADS WITH DEMAND. A product that sells well gets picked up by
    // marketplaces beyond the ones it launched on — that is how catalogue
    // coverage actually grows, and it is why cross-marketplace comparison has
    // anything to compare. The seed declares where a product STARTED; popular
    // products deterministically gain one or two more eligible platforms.
    // Long-tail products stay where the seed put them, which is equally real:
    // a niche item on one platform is a normal state, not missing data.
    if (seed.reviews >= 4000) {
      const extraBudget = seed.reviews >= 20000 ? 2 : 1;
      const candidates = marketplaces
        .filter((mp) => marketplaceCoversDepartment(mp.id, departmentId))
        .filter((mp) => !codes.some((c) => MARKETPLACE_BY_CODE[c] === mp.id));
      let added = 0;
      for (const mp of candidates) {
        if (added >= extraBudget) break;
        // Deterministic, and not every eligible platform takes every product.
        if (positiveHash(`${seed.id}_${mp.id}`) % 100 < 55) {
          const code = Object.keys(MARKETPLACE_BY_CODE).find((k) => MARKETPLACE_BY_CODE[k] === mp.id);
          if (code) {
            codes.push(code);
            added++;
          }
        }
      }
    }

    // Per-marketplace price multipliers, NORMALISED so the cheapest is exactly
    // 1.0. Marketplaces genuinely price the same product differently and the
    // relative gaps are what make cross-marketplace comparison interesting —
    // but invariant 1 says the cheapest landed price equals the seed's `price`
    // exactly. Normalising preserves the relative spread while pinning the
    // minimum, so both hold. (Applying the raw bias directly let a Meesho
    // listing land 2.2% under the seed price and quietly broke the invariant on
    // 63 products.)
    let invariantMpIndex = 0;
    {
      const raw = codes.map((code, i) => (MARKETPLACE_PRICE_BIAS[MARKETPLACE_BY_CODE[code]] ?? 1) * (1 + 0.012 * i));
      const min = Math.min(...raw);
      // The marketplace carrying the invariant is whichever ends up cheapest —
      // NOT necessarily the seed's first, since a value platform can undercut
      // it. Guarding index 0 instead let the true cheapest offer go out of
      // stock and broke the invariant on 22 products.
      invariantMpIndex = raw.indexOf(min);
      priceMultipliers = raw.map((m) => m / min);
    }

    codes.forEach((code, mpIndex) => {
      const marketplaceId = MARKETPLACE_BY_CODE[code];
      const listingId = `lst_${code}_${seed.id}`;
      const listingRand = mulberry32(positiveHash(listingId));

      const rating = Math.max(3.3, Math.round((seed.rating - mpIndex * 0.1) * 10) / 10);
      const reviewCount = Math.max(20, Math.round(seed.reviews * (mpIndex === 0 ? 1 : 0.55 / mpIndex)));

      listings.push({
        id: listingId,
        productId,
        marketplaceId,
        externalListingId: `${EXTERNAL_ID_PREFIX[marketplaceId]}${positiveHash(listingId).toString(36).toUpperCase().slice(-8)}`,
        listingUrl: `https://www.${DOMAIN[marketplaceId]}/p/${seed.id}`,
        marketplaceCategoryId: marketplaceCategoryIdFor(marketplaceId, pt.categoryId),
        rawTitle: seed.name,
        marketplaceBrandText: seed.brand.replace("brand_", "").replace(/_/g, " "),
        matchStatus: mpIndex === 0 ? "human_confirmed" : "auto_matched",
        matchConfidence: mpIndex === 0 ? 0.97 : 0.92,
        listingStatus: "active",
        firstSeenAt: isoDaysBefore(TODAY, HISTORY_WINDOW_DAYS + 20),
        lastSeenAt: "2026-08-13",
      });

      // Review depth follows history depth: a product we poll daily is one we
      // have watched long enough to have several review snapshots for.
      const reviewPoints = tier.key === "deep" ? 5 : tier.key === "standard" ? 3 : 2;
      reviews.push(...generateReviews({ listingId, endCount: reviewCount, endRating: rating, points: reviewPoints }));

      // `seed.price` is the LANDED price — what the buyer pays — so when the
      // offer charges shipping, that shipping is carved OUT of the selling
      // price rather than added on top of it. Otherwise adding a shipping fee
      // would silently break invariant 1.
      const shippingFee = seed.shipping ?? 0;
      const landedBase = Math.round(seed.price * priceMultipliers[mpIndex]);
      const listingBase = landedBase - shippingFee;

      const pool = SELLER_POOL.get(marketplaceId) ?? [];
      // Contested listings attract more sellers. A product nobody buys carries
      // one or two offers; a best-seller is fought over by four or five, which
      // is what makes the own-market distribution meaningful for those products
      // and correctly thin for the rest.
      const contested = tier.key === "deep" ? 2 : tier.key === "standard" ? 1 : 0;
      const sellerCount = Math.max(1, Math.min((seed.sellers ?? 2) + contested, 5));
      const listingSeries = [];

      // A seller may hold only ONE offer on a given listing. Without this, the
      // deterministic draw below collided often enough that 1,436 of 2,918
      // multi-offer listings repeated a sellerId — which made the UI's
      // "N sellers compete on this listing" literally untrue, and inflated the
      // product's own-market offer count with the same merchant counted twice.
      const usedSellerIds = new Set();

      for (let s = 0; s < sellerCount; s++) {
        // Draw sellers deterministically, biased toward the head of the pool
        // (the anchors) for high-traffic products and deeper into the tail for
        // the long tail — which is how real offer distributions look.
        const reach = tier.key === "deep" ? 0.25 : tier.key === "standard" ? 0.6 : 1;
        const window = Math.max(1, Math.floor(pool.length * reach));
        const start = (positiveHash(`${listingId}_${s}`) % window) + s;

        // Probe forward from the drawn index until an unused seller is found.
        // Probing (rather than re-hashing) keeps the head-of-pool bias intact,
        // so the top-heavy offer distribution survives the uniqueness rule.
        let seller = null;
        for (let probe = 0; probe < pool.length; probe++) {
          const candidate = pool[(start + probe) % pool.length];
          if (candidate && !usedSellerIds.has(candidate.id)) {
            seller = candidate;
            break;
          }
        }
        if (!seller) break; // pool exhausted — fewer offers is correct, not a duplicate
        usedSellerIds.add(seller.id);

        const offerId = `off_${code}_${seed.id}_${s}`;
        // Offer 0 is the cheapest on its listing; others are priced above it —
        // but never above MRP. On a tight-MRP product the later sellers simply
        // pile up at the ceiling, which is what actually happens when the legal
        // maximum sits close to the going rate.
        const offerPrice =
          s === 0 ? listingBase : Math.min(Math.round(listingBase * (1 + 0.022 * s)), seed.mrp - shippingFee);

        offers.push({
          id: offerId,
          listingId,
          sellerId: seller.id,
          itemCondition: "new",
          offerStatus: "active",
          firstSeenAt: isoDaysBefore(TODAY, HISTORY_WINDOW_DAYS + 10),
        });

        // AVAILABILITY AND DELIVERY VARY PER OFFER, not per product.
        //
        // Both are deliberately withheld from the cheapest offer on the seed's
        // primary marketplace: that offer carries invariant 1 (its landed price
        // IS the seed price), so making it unavailable would mean the catalogue
        // card advertises a price no buyer can pay. Every other offer is fair
        // game, which is also how it works in practice — the keenest seller is
        // usually the one holding stock.
        const isInvariantOffer = mpIndex === invariantMpIndex && s === 0;
        const stockRoll = positiveHash(`${offerId}_stock`) % 100;
        const generatedStockout = !isInvariantOffer && stockRoll < 6 ? 4 + (stockRoll % 9) : 0;
        const offerOutOfStockDays =
          seed.outOfStockDays ?? (s === 0 ? (seed.cheapestOfferOutOfStockDays ?? 0) : 0) ?? 0;

        // Sellers who charge delivery list the item lower to compensate, so the
        // LANDED price is unchanged and the comparison stays like-for-like.
        // That is exactly the trap the price ladder exists to handle: the
        // cheapest-looking selling price is not the cheapest offer.
        //
        // The delivery charge is carved OUT of the item price, so it can only
        // be applied where the item price can absorb it. On a ₹78 pen an
        // unguarded ₹79 charge drove the selling price to −₹1 and the listing
        // page rendered "−₹1 · 101% off". Two guards now prevent that:
        // the fee may never exceed MAX_SHIPPING_SHARE of the landed price, and
        // the surviving fee is capped again against this specific offer's price
        // so the residual item price can never fall below MIN_SELLING_RUPEES.
        const MIN_SELLING_RUPEES = 10;
        const MAX_SHIPPING_SHARE = 0.25;
        const shipRoll = positiveHash(`${offerId}_ship`) % 100;
        const chargesShipping = !isInvariantOffer && !seed.shipping && landedBase <= 200000 && shipRoll < 14;
        let offerShipping = shippingFee;
        if (!shippingFee && chargesShipping) {
          const affordable = Math.min(
            Math.floor(landedBase * MAX_SHIPPING_SHARE),
            offerPrice - MIN_SELLING_RUPEES
          );
          const candidate = [29, 39, 49, 59, 79][shipRoll % 5];
          // Only charge delivery when a realistic fee actually fits; otherwise
          // this offer ships free, which is what a seller of a ₹78 pen does.
          offerShipping = candidate <= affordable ? candidate : 0;
        }

        listingSeries.push(
          generateSeries({
            offerId,
            endPrice: Math.max(MIN_SELLING_RUPEES, offerPrice - (offerShipping - shippingFee)),
            mrp: seed.mrp,
            trend: seed.trend ?? "down",
            stepDays: tier.stepDays,
            promoNow: !!seed.promoNow,
            shippingFee: offerShipping,
            outOfStockDays: Math.max(offerOutOfStockDays, generatedStockout),
            seasonal: !!seed.seasonal,
          })
        );

        promotions.push(
          ...generatePromotions({
            offerId,
            marketplaceId,
            priceRupees: offerPrice,
            rand: mulberry32(positiveHash(offerId + "_promo")),
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
      void listingRand;
    });
  }

  return { products, listings, offers, observations, reviews, promotions };
}

const generated = buildAll();

export const generatedProducts = generated.products;
export const generatedListings = generated.listings;
export const generatedOffers = generated.offers;
export const generatedPriceObservations = generated.observations;
export const generatedReviewSnapshots = generated.reviews;
export const generatedPromotions = generated.promotions;
