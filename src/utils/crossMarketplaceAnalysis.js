import { getProduct } from "../data/products";
import { getListingsForProduct } from "../data/listings";
import { getMarketplace } from "../data/marketplaces";
import { getLatestReviewSnapshot, getReviewVelocity } from "../data/reviewSnapshots";
import { getBrand, TIER_RANK } from "../data/brands";
import { getPricingRelevantAttributes, getAttributeDefinitions } from "../data/attributeDefinitions";
import { getCommercialState, getProductPriceSeries, buildRecommendation, computeDistributionStats } from "./pricingEngine";
import { formatMinor } from "./money";

/**
 * CROSS-MARKETPLACE ANALYSIS
 * ==========================
 *
 * The recommendation engine already decides a price. This module answers the
 * question that comes BEFORE it: what actually differs between the platforms,
 * the sellers and the competing products — and which of those differences
 * change how a price should be read?
 *
 * It adds no entities and no state. Every figure here is derived from the same
 * Product → Listing → Seller → Offer → Price Observation graph the rest of the
 * app reads, and every conclusion carries the numbers it was computed from, so
 * a reader can check it rather than trust it.
 *
 * WHY THESE PARAMETERS AND NOT OTHERS
 * -----------------------------------
 * The dataset holds far more fields than are worth showing. A parameter earns
 * its place here only if it can change the interpretation of a price:
 *
 *   · price ladder (headline → shipping → landed → universal → conditional)
 *        the same product can look cheapest on one rung and dearest on another
 *   · per-unit price
 *        400 ml at ₹446 is dearer than 650 ml at ₹612. Headline price alone
 *        inverts this comparison, which is the single most common error in
 *        naive marketplace comparison
 *   · trust weight (rating × review volume)
 *        4.7 from 20 reviews is not 4.5 from 20,000
 *   · seller quality and fulfilment
 *        who is behind the offer, and whether the platform stands behind it
 *   · availability
 *        an unbuyable price is not a competing price
 *   · promotion availability CLASS
 *        a card-only discount is not a price everyone pays
 *   · historical position
 *        whether today's market is normal, promotional, or drifting
 *   · match confidence
 *        how sure we are the listing is even the same product
 *
 * Deliberately excluded: buy-box position (already implied by cheapest in-stock
 * landed price), review velocity beyond a demand hint, and raw MRP (a display
 * anchor, not a market signal — it appears only as the legal ceiling).
 */

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const plural = (n, one, many) => (n === 1 ? one : many);
const pct = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 10);

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const i = (s.length - 1) / 2;
  return s.length % 2 ? s[i] : (s[Math.floor(i)] + s[Math.ceil(i)]) / 2;
}

/**
 * Rating alone is not comparable across products with wildly different review
 * volumes. This damps a rating toward the neutral 3.5 midpoint when the sample
 * behind it is thin: full weight only past ~10,000 reviews, and a 20-review
 * 4.7 lands well below a 20,000-review 4.5.
 */
export function trustWeightedRating(rating, reviewCount) {
  if (rating == null) return null;
  const n = reviewCount ?? 0;
  const confidence = Math.min(Math.log10(Math.max(n, 1)) / 4, 1); // 10^4 reviews ⇒ full weight
  return Math.round((3.5 + (rating - 3.5) * confidence) * 100) / 100;
}

/**
 * Attributes that express HOW MUCH PRODUCT YOU GET, and are therefore the only
 * ones a price can meaningfully be divided by.
 *
 * This is an explicit allowlist rather than "the biggest numeric spec", because
 * that heuristic produces nonsense: a phone's largest pricing-relevant numeric
 * is `battery_mah`, and "₹0.09 per mAh" is not a comparison anybody makes — you
 * do not buy a phone by the milliamp-hour. Shampoo, rice, dog food, power banks
 * and SSDs genuinely are bought by quantity, so those are listed here and
 * everything else simply gets no per-unit analysis.
 */
const UNIT_BEARING_ATTRIBUTES = new Set([
  "volume_ml", // shampoo, perfume, serum, face wash, car care
  "pack_volume_l", // cooking oil
  "volume_l", // engine oil
  "pack_weight_kg", // rice, tea, coffee, dry fruits, pet food, protein
  "capacity_mah", // power banks — capacity IS the product
  "capacity_gb", // external SSDs
  "count", // diapers, multivitamins, baby wipes
  "pieces", // cookware sets, dinner sets, building blocks, screwdriver sets
  "pack_size", // multi-packs
]);

/**
 * The attribute this product type is naturally quantified by. Used to express
 * price per unit, which is what makes differently-sized competitors comparable
 * at all — 400 ml at ₹446 is dearer than 650 ml at ₹612, and headline price
 * alone reverses that.
 *
 * Returns null when the product type is not sold by quantity, in which case
 * per-unit analysis is omitted rather than faked.
 */
export function unitBasisFor(productTypeId, specifications) {
  const candidates = getPricingRelevantAttributes(productTypeId).filter(
    (a) => ["integer", "decimal"].includes(a.dataType) && UNIT_BEARING_ATTRIBUTES.has(a.attributeKey)
  );
  let best = null;
  for (const attr of candidates) {
    const value = Number(specifications?.[attr.attributeKey]);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (!best || value > best.value) best = { attr, value };
  }
  if (!best) return null;
  return { key: best.attr.attributeKey, label: best.attr.displayName, unit: best.attr.unit, value: best.value };
}

// ---------------------------------------------------------------------------
// Layer 1 — the marketplace matrix (OBSERVED)
// ---------------------------------------------------------------------------

/**
 * One row per marketplace this product is listed on, holding every parameter
 * that could change how its price is read. Nothing here is averaged across
 * platforms: rating, sellers and promotions are observed independently per
 * listing, and collapsing them would invent a number that exists nowhere.
 */
function buildMarketplaceRows(productId) {
  const states = getCommercialState(productId);
  const byListing = new Map();

  for (const s of states) {
    const key = s.listing.id;
    if (!byListing.has(key)) byListing.set(key, []);
    byListing.get(key).push(s);
  }

  const rows = [];
  for (const listing of getListingsForProduct(productId)) {
    const offers = byListing.get(listing.id) ?? [];
    const inStock = offers.filter((o) => o.inStock);
    const review = getLatestReviewSnapshot(listing.id);
    const marketplace = getMarketplace(listing.marketplaceId);

    const effectives = inStock.map((o) => o.layers.universalEffectiveMinor);

    // The cheapest offer a buyer can actually take, on the comparison basis.
    // EVERY rung of the displayed ladder comes from THIS one offer. Taking the
    // minimum of each rung independently across offers produced a ladder that
    // did not add up (listed ₹553 + ₹0 delivery shown against a ₹569 landed
    // price, because those were two different sellers) — which is exactly the
    // kind of untraceable number this page exists to avoid.
    const best = inStock.reduce(
      (acc, o) => (acc === null || o.layers.universalEffectiveMinor < acc.layers.universalEffectiveMinor ? o : acc),
      null
    );

    const promoCount = { universal: 0, conditional: 0, deferred: 0, financing: 0 };
    const promoLabels = [];
    for (const o of offers) {
      for (const cls of Object.keys(promoCount)) {
        const list = o.layers.promotions[cls] ?? [];
        promoCount[cls] += list.length;
        for (const p of list) promoLabels.push({ cls, label: p.label, type: p.promotionType });
      }
    }

    const sellerRatings = offers.map((o) => o.sellerRating?.rating).filter((v) => v != null);
    const fulfilments = [...new Set(offers.map((o) => o.seller?.defaultFulfilmentType).filter(Boolean))];

    rows.push({
      listingId: listing.id,
      marketplaceId: listing.marketplaceId,
      marketplaceName: marketplace?.name ?? listing.marketplaceId,
      marketplaceType: marketplace?.marketplaceType ?? null,
      brandColor: marketplace?.brandColor ?? null,

      // ---- offer level ----
      offerCount: offers.length,
      inStockCount: inStock.length,
      allOutOfStock: offers.length > 0 && inStock.length === 0,
      headlineMinor: best?.layers.sellingPriceMinor ?? null,
      landedMinor: best?.layers.landedMinor ?? null,
      effectiveMinor: best?.layers.universalEffectiveMinor ?? null,
      dearestEffectiveMinor: effectives.length ? Math.max(...effectives) : null,
      conditionalBestMinor: best?.layers.conditionalBestMinor ?? null,
      universalDiscountMinor: best?.layers.universalDiscountMinor ?? 0,
      shippingMinor: best?.layers.shippingFeeMinor ?? null,
      paidShippingOffers: offers.filter((o) => o.layers.shippingFeeMinor > 0).length,
      mrpMinor: best?.layers.mrpMinor ?? null,

      // ---- seller level ----
      bestSeller: best?.seller?.name ?? null,
      bestSellerRating: best?.sellerRating?.rating ?? null,
      bestSellerFulfilment: best?.seller?.defaultFulfilmentType ?? null,
      bestSellerType: best?.seller?.sellerType ?? null,
      topSellerRating: sellerRatings.length ? Math.max(...sellerRatings) : null,
      medianSellerRating: sellerRatings.length ? median(sellerRatings) : null,
      fulfilments,
      platformFulfilledOffers: offers.filter(
        (o) => o.seller?.defaultFulfilmentType && !/self_ship/.test(o.seller.defaultFulfilmentType)
      ).length,

      // ---- listing level ----
      rating: review?.averageRating ?? null,
      reviewCount: review?.reviewCount ?? null,
      trustRating: trustWeightedRating(review?.averageRating, review?.reviewCount),
      reviewVelocity: getReviewVelocity(listing.id),
      matchConfidence: listing.matchConfidence,
      matchStatus: listing.matchStatus,

      // ---- promotions ----
      promoCount,
      promoLabels: promoLabels.slice(0, 4),
      hasUniversalPromo: promoCount.universal > 0,
    });
  }

  return rows.filter((r) => r.offerCount > 0).sort((a, b) => (a.effectiveMinor ?? Infinity) - (b.effectiveMinor ?? Infinity));
}

// ---------------------------------------------------------------------------
// Layer 2 — what differs between platforms (DERIVED)
// ---------------------------------------------------------------------------

/**
 * Spearman rank correlation between two orderings. Used to ask whether the
 * cheapest platform is also the weakest on trust — a question that only has an
 * answer once both are ranked.
 */
function rankCorrelation(a, b) {
  const n = a.length;
  if (n < 3) return null;
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
    const r = new Array(n);
    idx.forEach(([, i], pos) => (r[i] = pos + 1));
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const d2 = ra.reduce((s, v, i) => s + (v - rb[i]) ** 2, 0);
  return Math.round((1 - (6 * d2) / (n * (n * n - 1))) * 100) / 100;
}

function analyseMarketplaces(rows) {
  const priced = rows.filter((r) => r.effectiveMinor != null);
  if (priced.length === 0) return null;

  const effectives = priced.map((r) => r.effectiveMinor);
  const cheapest = priced[0];
  const dearest = priced[priced.length - 1];
  const spreadMinor = dearest.effectiveMinor - cheapest.effectiveMinor;

  // Does paying more buy a better-rated listing? Negative correlation between
  // price rank and trust rank means the dearer platforms are the weaker ones.
  const withTrust = priced.filter((r) => r.trustRating != null);
  const priceTrustCorrelation =
    withTrust.length >= 3
      ? rankCorrelation(withTrust.map((r) => r.effectiveMinor), withTrust.map((r) => r.trustRating))
      : null;

  // Does including delivery reorder the platforms? If it does, the headline
  // price is actively misleading and the landed rung is the honest one.
  const byHeadline = [...priced].filter((r) => r.headlineMinor != null).sort((a, b) => a.headlineMinor - b.headlineMinor);
  const byLanded = [...priced].filter((r) => r.landedMinor != null).sort((a, b) => a.landedMinor - b.landedMinor);
  const shippingReordersRanking =
    byHeadline.length > 1 && byHeadline.some((r, i) => byLanded[i] && r.marketplaceId !== byLanded[i].marketplaceId);

  const bestTrust = withTrust.length
    ? withTrust.reduce((a, b) => (b.trustRating > a.trustRating ? b : a))
    : null;
  const worstTrust = withTrust.length
    ? withTrust.reduce((a, b) => (b.trustRating < a.trustRating ? b : a))
    : null;

  return {
    marketplaceCount: rows.length,
    pricedCount: priced.length,
    cheapest,
    dearest,
    spreadMinor,
    spreadPct: pct(spreadMinor / cheapest.effectiveMinor),
    medianEffectiveMinor: median(effectives),
    bestTrust,
    worstTrust,
    priceTrustCorrelation,
    // The headline finding: cheapest platform is ALSO the best-trusted one.
    cheapestIsAlsoBestTrusted: bestTrust != null && bestTrust.marketplaceId === cheapest.marketplaceId,
    dearestIsWorstTrusted: worstTrust != null && worstTrust.marketplaceId === dearest.marketplaceId,
    shippingReordersRanking,
    platformsWithUniversalPromo: priced.filter((r) => r.hasUniversalPromo).length,
    platformsWithAnyPromo: priced.filter(
      (r) => r.promoCount.universal + r.promoCount.conditional + r.promoCount.deferred + r.promoCount.financing > 0
    ).length,
    platformsWithPaidShipping: priced.filter((r) => r.paidShippingOffers > 0).length,
    platformsWithStockGap: rows.filter((r) => r.inStockCount < r.offerCount).length,
    lowestMatchConfidence: Math.min(...rows.map((r) => r.matchConfidence ?? 1)),
  };
}

// ---------------------------------------------------------------------------
// Layer 3 — competitor analysis (DERIVED, on top of the engine's own set)
// ---------------------------------------------------------------------------

/**
 * Decomposes each competitor's headline gap into the dimensions that explain
 * it, so "cheaper" can be qualified rather than accepted. Per-unit price is
 * the important one: it routinely reverses the raw comparison.
 */
function analyseCompetitors(rec, target, unitBasis) {
  const ownEffective = rec.ownMarket?.median ?? rec.currentPriceMinor;
  const ownUnit = unitBasis ? ownEffective / unitBasis.value : null;
  const targetReview = rec.strength?.targetRating;
  const targetReviews = rec.strength?.targetReviews;
  const targetTrust = trustWeightedRating(targetReview, targetReviews);
  const targetTier = TIER_RANK[getBrand(target.brandId)?.tier] ?? 1;

  const rows = rec.comps.map((c) => {
    const compUnitValue = unitBasis ? Number(c.product.specifications?.[unitBasis.key]) : null;
    const compUnit =
      unitBasis && Number.isFinite(compUnitValue) && compUnitValue > 0 ? c.currentPriceMinor / compUnitValue : null;
    const trust = trustWeightedRating(c.rating, c.reviewCount);
    const brand = getBrand(c.product.brandId);

    return {
      id: c.product.id,
      name: c.product.canonicalName,
      brandName: brand?.name ?? null,
      brandTier: brand?.tier ?? null,
      brandTierDelta: (TIER_RANK[brand?.tier] ?? 1) - targetTier,
      tier: c.tier,
      tierReason: c.tierReason ?? null,
      similarity: c.similarity,
      evidenceWeight: c.evidenceWeight,
      priceMinor: c.currentPriceMinor,
      priceGapPct: ownEffective ? pct((c.currentPriceMinor - ownEffective) / ownEffective) : null,
      unitValue: Number.isFinite(compUnitValue) ? compUnitValue : null,
      unitPriceMinor: compUnit,
      unitGapPct: ownUnit && compUnit ? pct((compUnit - ownUnit) / ownUnit) : null,
      // The reversal that matters: cheaper overall, dearer per unit.
      cheaperButDearerPerUnit:
        ownEffective != null && ownUnit != null && compUnit != null
          ? c.currentPriceMinor < ownEffective && compUnit > ownUnit
          : false,
      rating: c.rating,
      reviewCount: c.reviewCount,
      trustRating: trust,
      trustDelta: targetTrust != null && trust != null ? Math.round((trust - targetTrust) * 100) / 100 : null,
      marketplaceIds: c.marketplaceIds ?? [],
      sharedMarketplaces: c.sharedMarketplaces ?? null,
      hasUniversalPromo: !!c.hasUniversalPromo,
      specMatch: c.specDetail ? { match: c.specDetail.match, partial: c.specDetail.partial, differ: c.specDetail.differ } : null,
    };
  });

  return {
    rows,
    ownUnitPriceMinor: ownUnit,
    targetTrustRating: targetTrust,
    cheaperCount: rows.filter((r) => r.priceGapPct != null && r.priceGapPct < 0).length,
    dearerCount: rows.filter((r) => r.priceGapPct != null && r.priceGapPct > 0).length,
    reversals: rows.filter((r) => r.cheaperButDearerPerUnit),
    strongerTrustCount: rows.filter((r) => r.trustDelta != null && r.trustDelta > 0).length,
  };
}

// ---------------------------------------------------------------------------
// Layer 4 — historical position (DERIVED)
// ---------------------------------------------------------------------------

function analyseHistory(productId, rec) {
  const series = getProductPriceSeries(productId);
  if (series.length < 4) return null;

  const values = series.map((p) => p.minor);
  const stats = computeDistributionStats(values);
  // The series tracks the CHEAPEST in-stock effective price per day, so
  // "current" here means the cheapest offer available today — not the
  // own-market median, which sits higher because it averages every seller.
  // Both are carried so the page can say which it is showing.
  const current = rec.currentPriceMinor ?? values[values.length - 1];

  // Where today sits inside its own observed history — a percentile, not a
  // vague "low". 0 = cheapest it has ever been, 100 = dearest.
  const below = values.filter((v) => v < current).length;
  const percentile = Math.round((below / values.length) * 100);

  // Volatility as coefficient of variation: comparable across price levels in
  // a way that a rupee standard deviation is not.
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  const volatility = mean ? sd / mean : null;

  const promoDays = series.filter((p) => p.saleLabel).length;
  const first = values[0];
  const trendPct = first ? pct((current - first) / first) : null;

  return {
    observationCount: series.length,
    firstDate: series[0].date,
    lastDate: series[series.length - 1].date,
    minMinor: stats.min,
    maxMinor: stats.max,
    medianMinor: stats.median,
    currentMinor: current,
    percentile,
    volatility: volatility == null ? null : Math.round(volatility * 1000) / 10,
    volatilityBand: volatility == null ? null : volatility < 0.03 ? "stable" : volatility < 0.08 ? "moderate" : "volatile",
    promoDays,
    promoLabels: [...new Set(series.filter((p) => p.saleLabel).map((p) => p.saleLabel))],
    trendPct,
    normalMinor: rec.normalMinor,
    ownMedianMinor: rec.ownMarket?.median ?? null,
    distortion: rec.distortion,
    series,
  };
}

// ---------------------------------------------------------------------------
// Layer 5 — findings: where parameters INTERACT
// ---------------------------------------------------------------------------

/**
 * A finding is a statement that needed at least two dimensions to reach. Each
 * carries the figures behind it so it can be checked, and a `direction` saying
 * which pricing posture it argues for. Anything a single column already says
 * is not a finding and is left to the tables.
 */
function buildFindings({ rec, mpAnalysis, compAnalysis, history, unitBasis, target }) {
  const out = [];
  const add = (f) => out.push(f);

  // --- 1. Cross-marketplace price vs trust -------------------------------
  if (mpAnalysis && mpAnalysis.pricedCount >= 3) {
    if (mpAnalysis.cheapestIsAlsoBestTrusted) {
      add({
        id: "cheapest_is_best_trusted",
        dimension: "Marketplace",
        direction: "aggressive",
        headline: `${mpAnalysis.cheapest.marketplaceName} is both the cheapest and the best-rated platform`,
        detail: `At ${formatMinor(mpAnalysis.cheapest.effectiveMinor)} it is ${mpAnalysis.spreadPct}% below ${mpAnalysis.dearest.marketplaceName} (${formatMinor(mpAnalysis.dearest.effectiveMinor)}), yet carries the strongest review base — ${mpAnalysis.cheapest.rating}★ from ${mpAnalysis.cheapest.reviewCount?.toLocaleString("en-IN")} reviews. The usual assumption that the cheapest platform is the weakest does not hold here, so a higher price cannot be justified on platform trust alone.`,
        evidence: [
          `${mpAnalysis.cheapest.marketplaceName}: ${formatMinor(mpAnalysis.cheapest.effectiveMinor)}, ${mpAnalysis.cheapest.rating}★ / ${mpAnalysis.cheapest.reviewCount?.toLocaleString("en-IN")}`,
          `${mpAnalysis.dearest.marketplaceName}: ${formatMinor(mpAnalysis.dearest.effectiveMinor)}, ${mpAnalysis.dearest.rating}★ / ${mpAnalysis.dearest.reviewCount?.toLocaleString("en-IN")}`,
        ],
      });
    } else if (mpAnalysis.priceTrustCorrelation != null && mpAnalysis.priceTrustCorrelation > 0.5) {
      add({
        id: "price_tracks_trust",
        dimension: "Marketplace",
        direction: "premium",
        headline: "Dearer platforms are also the better-rated ones",
        detail: `Price rank and trust rank correlate at ${mpAnalysis.priceTrustCorrelation} across ${mpAnalysis.pricedCount} platforms, so the price gradient is at least partly buying audience quality rather than being pure margin.`,
        evidence: [
          `Spearman correlation of effective price vs trust-weighted rating: ${mpAnalysis.priceTrustCorrelation}`,
        ],
      });
    }

    if (mpAnalysis.spreadPct != null && mpAnalysis.spreadPct >= 5) {
      add({
        id: "platform_spread",
        dimension: "Marketplace",
        direction: "neutral",
        headline: `The same product spans ${mpAnalysis.spreadPct}% across platforms`,
        detail: `${formatMinor(mpAnalysis.cheapest.effectiveMinor)} on ${mpAnalysis.cheapest.marketplaceName} to ${formatMinor(mpAnalysis.dearest.effectiveMinor)} on ${mpAnalysis.dearest.marketplaceName}. A single "market price" for this product does not exist — which platform you are pricing for is part of the question.`,
        evidence: mpAnalysis.cheapest && mpAnalysis.dearest
          ? [`Spread ${formatMinor(mpAnalysis.spreadMinor)} across ${mpAnalysis.pricedCount} priced platforms`]
          : [],
      });
    }
  }

  // --- 2. Shipping changes the ranking -----------------------------------
  if (mpAnalysis?.shippingReordersRanking) {
    add({
      id: "shipping_reorders",
      dimension: "Offer",
      direction: "neutral",
      headline: "Adding delivery reorders which platform is cheapest",
      detail: `${mpAnalysis.platformsWithPaidShipping} ${plural(mpAnalysis.platformsWithPaidShipping, "platform carries", "platforms carry")} offers that charge delivery, and the cheapest headline price is not the cheapest landed price. Comparisons on the displayed price alone rank these platforms incorrectly.`,
      evidence: [`Compared on landed price (item + delivery), not the displayed price`],
    });
  }

  // --- 3. Per-unit reversal ----------------------------------------------
  if (unitBasis && compAnalysis?.reversals.length) {
    const r = compAnalysis.reversals[0];
    add({
      id: "per_unit_reversal",
      dimension: "Competitor",
      direction: "premium",
      headline: `${compAnalysis.reversals.length} ${plural(compAnalysis.reversals.length, "competitor looks", "competitors look")} cheaper but ${plural(compAnalysis.reversals.length, "costs", "cost")} more per ${unitBasis.unit ?? "unit"}`,
      detail: `${r.name} is ${Math.abs(r.priceGapPct)}% below this product on headline price, but at ${r.unitValue}${unitBasis.unit ?? ""} it works out ${r.unitGapPct}% dearer per ${unitBasis.unit ?? "unit"}. On a like-for-like basis this product is the better value, which is evidence the current price is defensible rather than high.`,
      evidence: [
        `This product: ${unitBasis.value}${unitBasis.unit ?? ""} — ${formatMinor(compAnalysis.ownUnitPriceMinor * 100)} per 100${unitBasis.unit ?? ""}`,
        `${r.name}: ${r.unitValue}${unitBasis.unit ?? ""} — ${formatMinor(r.unitPriceMinor * 100)} per 100${unitBasis.unit ?? ""}`,
      ],
    });
  }

  // --- 4. Position against the competitive median ------------------------
  if (rec.stats?.median != null && rec.ownMarket?.median != null) {
    const gap = pct((rec.ownMarket.median - rec.stats.median) / rec.stats.median);
    add({
      id: "vs_comp_median",
      dimension: "Competitor",
      direction: gap > 0 ? "premium" : "aggressive",
      headline: `Priced ${Math.abs(gap)}% ${gap > 0 ? "above" : "below"} the competitive median`,
      detail: `This product's own market sits at ${formatMinor(rec.ownMarket.median)} against a competitive median of ${formatMinor(rec.stats.median)}, computed across ${rec.comps.length} screened competitors weighted by how relevant each one is.`,
      evidence: [
        `Own market median ${formatMinor(rec.ownMarket.median)} across ${rec.ownMarket.n} in-stock offers`,
        `Competitive median ${formatMinor(rec.stats.median)} (evidence-weighted, ${rec.coverage.effectiveComparables} effective comparables)`,
      ],
    });
  }

  // --- 5. Trust strength vs the competitor set ---------------------------
  const st = rec.strength;
  if (st && st.targetRating != null && st.medianRating != null) {
    const stronger = st.targetRating > st.medianRating;
    const reviewsStronger = st.targetReviews && st.medianReviews && st.targetReviews > st.medianReviews;
    add({
      id: "trust_vs_comps",
      dimension: "Trust",
      direction: stronger && reviewsStronger ? "premium" : stronger ? "neutral" : "aggressive",
      headline: `Customer trust is ${stronger ? "ahead of" : st.targetRating < st.medianRating ? "behind" : "level with"} the competitor set`,
      detail: `${st.targetRating}★ against a competitor median of ${st.medianRating}★, on ${st.targetReviews?.toLocaleString("en-IN")} reviews versus a median of ${Math.round(st.medianReviews ?? 0).toLocaleString("en-IN")}. ${
        reviewsStronger
          ? "The larger review base makes that rating the more reliable of the two, which supports holding price."
          : "The review base is not larger than the field, so the rating advantage carries less weight than it appears to."
      }`,
      evidence: [
        `Rating ${st.targetRating}★ vs comp median ${st.medianRating}★`,
        `Reviews ${st.targetReviews?.toLocaleString("en-IN")} vs comp median ${Math.round(st.medianReviews ?? 0).toLocaleString("en-IN")}`,
      ],
    });
  }

  // --- 6. Specification position -----------------------------------------
  if (st && (st.specAdvantages.length || st.specDisadvantages.length)) {
    const ahead = st.specAdvantages.map((a) => a.label);
    const behind = st.specDisadvantages.map((a) => a.label);
    add({
      id: "spec_position",
      dimension: "Specification",
      direction: ahead.length > behind.length ? "premium" : behind.length > ahead.length ? "aggressive" : "neutral",
      headline:
        ahead.length && !behind.length
          ? `Ahead of the field on ${ahead.join(", ")}`
          : behind.length && !ahead.length
            ? `Behind the field on ${behind.join(", ")}`
            : `Mixed specification position`,
      detail: `Measured against the competitor median on the ${
        getPricingRelevantAttributes(target.productTypeId).length
      } pricing-relevant attributes this product type declares. ${
        ahead.length ? `Ahead on ${ahead.length}.` : ""
      } ${behind.length ? `Behind on ${behind.length}.` : ""}`.trim(),
      evidence: [
        ...st.specAdvantages.map((a) => `${a.label}: ${a.mine}${a.unit ?? ""} vs comp median ${a.compMedian}${a.unit ?? ""} — ahead`),
        ...st.specDisadvantages.map((a) => `${a.label}: ${a.mine}${a.unit ?? ""} vs comp median ${a.compMedian}${a.unit ?? ""} — behind`),
      ],
    });
  }

  // --- 7. Historical position --------------------------------------------
  if (history) {
    const distorted = history.distortion?.state !== "normal";
    add({
      id: "historical_position",
      dimension: "History",
      direction: distorted ? "neutral" : history.percentile > 70 ? "aggressive" : history.percentile < 30 ? "premium" : "neutral",
      headline: distorted
        ? `The current market looks ${history.distortion.state}`
        : history.percentile <= 20
          ? `The cheapest offer today is near the bottom of its own 90-day range`
          : history.percentile >= 80
            ? `The cheapest offer today is near the top of its own 90-day range`
            : `The cheapest offer today sits mid-range against its own history`,
      detail: distorted
        ? history.distortion.note
        : `Across ${history.observationCount} observations from ${history.firstDate}, the cheapest in-stock price has moved between ${formatMinor(history.minMinor)} and ${formatMinor(history.maxMinor)}. Today's ${formatMinor(history.currentMinor)} sits at the ${history.percentile}th percentile of that range — ${
            history.percentile <= 20
              ? "so the entry price is currently soft, which leaves room above it rather than arguing for a cut"
              : history.percentile >= 80
                ? "so the entry price is already near its ceiling and there is little historical headroom"
                : "a normal position with no strong signal either way"
          }. The series is ${history.volatilityBand} (${history.volatility}% coefficient of variation)${history.ownMedianMinor ? `, and the own-market median across all sellers is ${formatMinor(history.ownMedianMinor)}` : ""}.`,
      evidence: [
        `90-day normal ${formatMinor(history.normalMinor)}`,
        `Observed range ${formatMinor(history.minMinor)} – ${formatMinor(history.maxMinor)} over ${history.observationCount} points`,
        history.promoDays ? `${history.promoDays} observations fell inside a promotional window (${history.promoLabels.join(", ")})` : `No promotional windows in the captured series`,
      ],
    });
  }

  // --- 8. Willingness to pay ---------------------------------------------
  const wtp = rec.wtp;
  if (wtp) {
    add({
      id: "wtp",
      dimension: "Willingness to pay",
      direction: wtp.supported ? "premium" : "aggressive",
      headline: wtp.supported
        ? "The market measurably pays for this product's attributes"
        : "No measurable attribute premium in this market",
      detail: wtp.verdict,
      evidence: wtp.trusted
        ? [
            `Fitted on ${wtp.n} comparables, adjusted R² ${wtp.adjR2}`,
            ...(wtp.features ?? []).map((f) => `${f.label}: ${f.targetValue}${f.unit ?? ""} vs comp mean ${f.compMean}${f.unit ?? ""}`),
          ]
        : [`Model abstained — ${wtp.reason}`],
    });
  }

  // --- 9. Availability ----------------------------------------------------
  if (mpAnalysis?.platformsWithStockGap) {
    add({
      id: "availability",
      dimension: "Availability",
      direction: "neutral",
      headline: `${mpAnalysis.platformsWithStockGap} ${plural(mpAnalysis.platformsWithStockGap, "platform has", "platforms have")} offers that are currently unavailable`,
      detail: `Out-of-stock offers are excluded from every price statistic on this page. An unbuyable price is not a competing price, and including it would understate the market.`,
      evidence: [`Only in-stock offers contribute to the own-market and competitive figures`],
    });
  }

  // --- 10. Match confidence ----------------------------------------------
  if (mpAnalysis && mpAnalysis.lowestMatchConfidence < 0.95) {
    add({
      id: "match_confidence",
      dimension: "Data quality",
      direction: "neutral",
      headline: `Weakest listing match is ${Math.round(mpAnalysis.lowestMatchConfidence * 100)}% confident`,
      detail: `Not every listing is human-confirmed as this exact product. Where confidence is lower, some of the offers treated as this product's may belong to a near neighbour — which is why this feeds the evidence score rather than being ignored.`,
      evidence: [`Lowest listing match confidence across ${mpAnalysis.marketplaceCount} platforms: ${Math.round(mpAnalysis.lowestMatchConfidence * 100)}%`],
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Layer 6 — the bridge to the recommendation
// ---------------------------------------------------------------------------

/**
 * Groups the findings by the pricing posture each one argues for, then states
 * what actually bounded the result. This is the join between "here is what we
 * observed" and "therefore this is the price" — without it the analysis is a
 * dashboard, and the recommendation is an assertion.
 */
function buildBridge(rec, findings) {
  const forPremium = findings.filter((f) => f.direction === "premium");
  const forAggressive = findings.filter((f) => f.direction === "aggressive");
  const neutral = findings.filter((f) => f.direction === "neutral");

  const strategies = rec.strategies.map((s) => ({
    key: s.key,
    label: s.label,
    priceMinor: s.priceMinor,
    supported: s.supported,
    boundBy: s.bindingConstraint?.label ?? null,
    rationale: s.rationale,
    vsOwnMarketPct:
      rec.ownMarket?.median != null ? pct((s.priceMinor - rec.ownMarket.median) / rec.ownMarket.median) : null,
    vsCompMedianPct: rec.stats?.median != null ? pct((s.priceMinor - rec.stats.median) / rec.stats.median) : null,
  }));

  return {
    forPremium,
    forAggressive,
    neutral,
    verdict: rec.wtp?.supported
      ? "The evidence supports a premium position, and the Premium strategy is extended accordingly."
      : "No evidenced premium. Premium is held at the top of this product's own observed range rather than above it.",
    strategies,
    ceilingMinor: rec.constraints.ceilingMinor,
    ceilingSource: rec.constraints.ceilingSource,
    floorMinor: rec.constraints.floorMinor,
    collapsed: rec.collapsed,
    confidence: rec.evidence.level,
    coverage: rec.coverage,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * The whole analysis for one product. Returns `available: false` with a reason
 * when the product cannot support one — a single-marketplace product has no
 * cross-marketplace story, and saying so is more useful than rendering an
 * analysis of one row.
 */
export function buildCrossMarketplaceAnalysis(productId) {
  const target = getProduct(productId);
  if (!target) return { available: false, reason: "Product not found." };

  const rec = buildRecommendation(productId);
  const marketplaceRows = buildMarketplaceRows(productId);
  const mpAnalysis = analyseMarketplaces(marketplaceRows);
  const unitBasis = unitBasisFor(target.productTypeId, target.specifications);

  // The recommendation may legitimately refuse. The observation layers are
  // still real and still worth showing — what disappears is the interpretation
  // that depends on a comparable set.
  if (rec.insufficientData) {
    return {
      available: true,
      limited: true,
      limitedReason: rec.reason,
      whatWouldHelp: rec.whatWouldHelp ?? [],
      target,
      brand: getBrand(target.brandId),
      recommendation: rec,
      marketplaceRows,
      marketplaceAnalysis: mpAnalysis,
      unitBasis,
      competitors: null,
      history: analyseHistory(productId, rec),
      findings: [],
      bridge: null,
      attributeSchema: getAttributeDefinitions(target.productTypeId),
    };
  }

  const competitors = analyseCompetitors(rec, target, unitBasis);
  const history = analyseHistory(productId, rec);
  const findings = buildFindings({ rec, mpAnalysis, compAnalysis: competitors, history, unitBasis, target });
  const bridge = buildBridge(rec, findings);

  return {
    available: true,
    limited: false,
    target,
    brand: getBrand(target.brandId),
    recommendation: rec,
    marketplaceRows,
    marketplaceAnalysis: mpAnalysis,
    unitBasis,
    competitors,
    history,
    findings,
    bridge,
    attributeSchema: getAttributeDefinitions(target.productTypeId),
  };
}
