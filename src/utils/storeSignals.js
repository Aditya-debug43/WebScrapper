import { getListingsForProduct } from "../data/listings";
import { getOffersForListing } from "../data/offers";
import { getSeller, getLatestSellerRating } from "../data/sellers";
import { getLatestObservation, getPriceHistoryForOffer } from "../data/priceObservations";
import { getActivePromotionsForOffer } from "../data/promotions";
import { getReviewVelocity } from "../data/reviewSnapshots";
import { getProductReviewMetrics } from "./productMetrics";
import { buildPriceLayers } from "./priceLayers";
import { trustWeightedRating } from "./crossMarketplaceAnalysis";
import { analyseWindow, datasetLatestDate, windowStart } from "./observationWindows";
import { formatMinor } from "./money";

/**
 * NON-PRICE PARAMETERS
 * ====================
 *
 * The brief: "identify which other parameters than product price you can take
 * that can be helpful to increase the review of the client store."
 *
 * The test applied to every candidate was not "is this field in the database"
 * — most of them are — but: **can a seller name the decision this parameter
 * changes?** A number that cannot finish the sentence "…so I should ___" is a
 * column, not a parameter, and it was left out.
 *
 * WHAT IS IMPLEMENTED, AND THE DECISION EACH ONE SERVES
 * -----------------------------------------------------
 *  trust          Trust-weighted rating — can my rating defend a premium, or
 *                 is it a small-sample illusion?
 *  demand         Review velocity — the only demand-shaped signal this dataset
 *                 holds. Is interest growing relative to rivals?
 *  featured       Buy-box hold — am I actually winning the default position,
 *                 or is one rival holding it?
 *  availability   Stockout exposure — am I losing the position to being out of
 *                 stock rather than to price?
 *  competition    Sellers contesting my own listing — is this a price war?
 *  fulfilment     Who ships — self-ship against marketplace-fulfilled rivals is
 *                 a delivery-speed disadvantage no price cut fixes.
 *  shipping       Delivery as a share of what the buyer actually pays.
 *  promotion      Promotion dependence — is my "price" a promo price?
 *  discount       Discount depth against MRP, versus the comparable set.
 *  reach          Marketplace coverage gap — platforms my competitors sell on
 *                 and I do not.
 *
 * WHAT WAS DELIBERATELY REJECTED
 * -------------------------------
 *  Sales volume, conversion rate, sessions, add-to-cart, search rank,
 *  impression share, return rate, ad spend — none of these exist in this
 *  dataset. Industry guidance names sales velocity as a primary Buy Box
 *  signal; we do not have it, and manufacturing it would be the exact
 *  fabrication this project has refused everywhere else. It is recorded as a
 *  known gap instead.
 *
 *  True price elasticity and willingness-to-pay-from-demand: both need
 *  quantity sold at more than one price. The hedonic model in the engine
 *  estimates what the market charges for ATTRIBUTES across a cross-section of
 *  products; that is not a demand curve and is never described as one.
 *
 *  Rating distribution skew: present in the data, but it is generated as a
 *  deterministic function of the average rating, so it carries no information
 *  the average does not already carry. Reporting it would imply a second,
 *  independent signal that does not exist.
 *
 * Every parameter below is computed from observations already in the graph.
 * Nothing here writes, generates or interpolates data, and nothing here feeds
 * back into the pricing engine — the recommendation is unchanged by this file.
 */

const pct1 = (v) => Math.round(v * 1000) / 10;
const plural = (n, one, many) => (n === 1 ? one : many);

/** A parameter is only reported when it can be computed; otherwise it says why not. */
function param(key, label, opts) {
  return {
    key,
    label,
    available: opts.value != null,
    value: opts.value ?? null,
    display: opts.display ?? (opts.value != null ? String(opts.value) : "—"),
    unit: opts.unit ?? null,
    basis: opts.basis, // "observed" | "derived"
    decision: opts.decision,
    detail: opts.detail ?? null,
    comparison: opts.comparison ?? null,
    unavailableReason: opts.value == null ? opts.unavailableReason ?? "Not observable for this product." : null,
  };
}

/** Current commercial state of every offer on every listing of this product. */
function currentOfferState(productId) {
  const listings = getListingsForProduct(productId);
  const rows = [];
  for (const listing of listings) {
    for (const offer of getOffersForListing(listing.id)) {
      const obs = getLatestObservation(offer.id);
      if (!obs) continue;
      const layers = buildPriceLayers({ observation: obs, offerId: offer.id });
      const seller = getSeller(offer.sellerId);
      rows.push({
        listing,
        offer,
        seller,
        sellerRating: getLatestSellerRating(offer.sellerId),
        obs,
        layers,
        promos: getActivePromotionsForOffer(offer.id, obs.observedAt),
      });
    }
  }
  return { listings, rows };
}

/**
 * Who holds the featured offer, and how firmly, across the window.
 *
 * `isBuyboxWinner` is computed per listing per capture date as the cheapest
 * in-stock landed price — the same rule Amazon's Buy Box and Flipkart's
 * default seller approximate — so this is an observed outcome, not a guess.
 *
 * Measured PER LISTING and only then summarised. Pooling every platform's
 * winners into one figure was the first version of this, and it was wrong: six
 * platforms each with an unchallenged winner came out as "the top seller holds
 * 16.7%", which reads as a wide-open contest and is the opposite of the truth.
 * The default position is a per-listing contest, so that is the unit.
 */
const LOCKED_SHARE = 80;

function featuredPosition(productId, from, to) {
  const perListing = [];

  for (const listing of getListingsForProduct(productId)) {
    const wins = new Map();
    let days = 0;
    for (const offer of getOffersForListing(listing.id)) {
      for (const obs of getPriceHistoryForOffer(offer.id)) {
        if (obs.observedAt < from || obs.observedAt > to) continue;
        if (!obs.isBuyboxWinner) continue;
        days++;
        wins.set(offer.sellerId, (wins.get(offer.sellerId) ?? 0) + 1);
      }
    }
    if (days === 0) continue;
    const ranked = [...wins.entries()].sort((a, b) => b[1] - a[1]);
    perListing.push({
      listingId: listing.id,
      marketplaceId: listing.marketplaceId,
      days,
      distinctWinners: ranked.length,
      topSellerId: ranked[0][0],
      topSellerName: getSeller(ranked[0][0])?.name ?? "Unknown seller",
      topShare: pct1(ranked[0][1] / days),
    });
  }

  if (perListing.length === 0) return null;

  const locked = perListing.filter((l) => l.topShare >= LOCKED_SHARE);
  const contested = perListing.filter((l) => l.topShare < LOCKED_SHARE);
  // The listing where the default position changes hands most often — the one
  // worth looking at, because it is the one that can still be won.
  const mostContested = [...perListing].sort((a, b) => a.topShare - b.topShare)[0];
  const meanTopShare = pct1(perListing.reduce((s, l) => s + l.topShare, 0) / perListing.length / 100);

  return { perListing, lockedCount: locked.length, contestedCount: contested.length, mostContested, meanTopShare, listingsMeasured: perListing.length };
}

/** Reviews per day spans three orders of magnitude across this catalogue. */
function formatRate(v) {
  if (v == null) return "—";
  if (v < 10) return `${Math.round(v * 100) / 100}`;
  if (v < 100) return `${Math.round(v * 10) / 10}`;
  return `${Math.round(v).toLocaleString("en-IN")}`;
}

/** Review velocity summed across this product's listings — reviews per day. */
function reviewVelocityFor(productId) {
  let sum = 0;
  let any = false;
  for (const l of getListingsForProduct(productId)) {
    const v = getReviewVelocity(l.id);
    if (v != null) {
      sum += v;
      any = true;
    }
  }
  return any ? Math.round(sum * 100) / 100 : null;
}

export function buildStoreSignals(productId, { windowDays = 30, analysis = null } = {}) {
  const to = datasetLatestDate();
  const from = windowStart(windowDays, to);
  const win = analyseWindow(productId, windowDays);
  const { listings, rows } = currentOfferState(productId);

  if (rows.length === 0) {
    return {
      available: false,
      reason: "No offer has ever been observed for this product, so there is nothing to assess beyond price either.",
      parameters: [],
      findings: [],
      window: win,
    };
  }

  // ---------------------------------------------------------------- inputs
  const inStock = rows.filter((r) => r.obs.isInStock);
  const cheapest = inStock.reduce(
    (best, r) => (best === null || r.layers.universalEffectiveMinor < best.layers.universalEffectiveMinor ? r : best),
    null
  );
  const metrics = getProductReviewMetrics(productId);
  const trust = trustWeightedRating(metrics?.rating ?? null, metrics?.reviewCount ?? null);
  const velocity = reviewVelocityFor(productId);
  const featured = featuredPosition(productId, from, to);

  const payingShipping = rows.filter((r) => (r.layers.shippingFeeMinor ?? 0) > 0);
  const shippingShare =
    cheapest && cheapest.layers.landedMinor
      ? pct1((cheapest.layers.shippingFeeMinor ?? 0) / cheapest.layers.landedMinor)
      : null;

  const fulfilled = rows.filter((r) => r.seller && r.seller.defaultFulfilmentType !== "self_ship");
  const fulfilmentShare = rows.length ? pct1(fulfilled.length / rows.length) : null;

  const discountDepth =
    cheapest && cheapest.layers.mrpMinor
      ? pct1((cheapest.layers.mrpMinor - cheapest.layers.universalEffectiveMinor) / cheapest.layers.mrpMinor)
      : null;

  const promoShare = win.n ? pct1(win.promoDays / win.n) : null;
  const universalLive = rows.some((r) => r.promos.some((p) => p.availabilityClass === "universal"));

  // Competitors, when the caller already built the analysis. Reused rather
  // than recomputed: the competitive set is expensive and the engine owns it.
  const comps = analysis?.competitors?.rows ?? [];
  const compVelocities = comps
    .map((c) => ({ name: c.name, v: reviewVelocityFor(c.id) }))
    .filter((c) => c.v != null);
  const medianCompVelocity = compVelocities.length
    ? [...compVelocities].sort((a, b) => a.v - b.v)[Math.floor(compVelocities.length / 2)].v
    : null;

  const ownMarketplaces = new Set(listings.map((l) => l.marketplaceId));
  const compMarketplaceCount = new Map();
  for (const c of comps) for (const id of c.marketplaceIds ?? []) compMarketplaceCount.set(id, (compMarketplaceCount.get(id) ?? 0) + 1);
  // A platform is a gap only if MOST of the competitive set sells there and we
  // do not — one rival on a niche platform is not a coverage gap.
  const gapPlatforms = [...compMarketplaceCount.entries()]
    .filter(([id, n]) => !ownMarketplaces.has(id) && comps.length >= 3 && n / comps.length >= 0.5)
    .map(([id]) => id);

  // ------------------------------------------------------------ parameters
  const parameters = [
    param("trust", "Trust-weighted rating", {
      value: trust,
      display: trust != null ? `${trust}★` : "—",
      basis: "derived",
      decision: "Can this rating defend a premium, or is it a small-sample effect?",
      detail:
        metrics?.reviewCount != null
          ? `${metrics.rating}★ raw across ${metrics.reviewCount.toLocaleString("en-IN")} reviews, damped toward 3.5 by review volume.`
          : null,
      unavailableReason: "No review snapshot has been captured for any listing of this product.",
    }),
    param("demand", "Review velocity", {
      value: velocity,
      display: velocity != null ? `${formatRate(velocity)}/day` : "—",
      basis: "observed",
      decision: "Is interest in this listing growing, and how does that compare with rivals?",
      detail:
        "New reviews per day across all listings. This is the closest thing the dataset holds to a demand signal — it is a proxy, not units sold.",
      comparison:
        medianCompVelocity != null && velocity != null
          ? {
              label: "competitor median",
              value: medianCompVelocity,
              display: `${formatRate(medianCompVelocity)}/day`,
              deltaPct: medianCompVelocity ? pct1((velocity - medianCompVelocity) / medianCompVelocity) : null,
            }
          : null,
      unavailableReason: "Fewer than two review snapshots exist, so a rate of change cannot be computed.",
    }),
    param("featured", "Featured offer locked", {
      value: featured?.lockedCount ?? null,
      display: featured ? `${featured.lockedCount} of ${featured.listingsMeasured}` : "—",
      basis: "observed",
      decision: "Is the default buying position contested, or already locked by one seller?",
      detail: featured
        ? `On ${featured.lockedCount} of ${featured.listingsMeasured} ${plural(featured.listingsMeasured, "platform", "platforms")} a single seller held the featured offer on ${LOCKED_SHARE}% or more of captured days. Most open: ${featured.mostContested.topSellerName} on ${featured.mostContested.topShare}% over ${featured.mostContested.days} ${plural(featured.mostContested.days, "day", "days")}.`
        : null,
      unavailableReason: "No featured-offer day was captured inside this window.",
    }),
    param("availability", "Out of stock", {
      value: win.coverage.outOfStockShare,
      display: win.coverage.outOfStockShare != null ? `${win.coverage.outOfStockShare}%` : "—",
      unit: "%",
      basis: "observed",
      decision: "Am I losing the featured position to availability rather than to price?",
      detail:
        win.coverage.observationRows > 0
          ? `${win.coverage.outOfStockRows} of ${win.coverage.observationRows} offer-days in this window were out of stock. Right now ${inStock.length} of ${rows.length} offers are buyable.`
          : null,
      unavailableReason: "No offer-day was captured inside this window.",
    }),
    param("competition", "Sellers on the listing", {
      value: rows.length,
      display: `${rows.length} across ${listings.length} ${plural(listings.length, "platform", "platforms")}`,
      basis: "observed",
      decision: "How many sellers are competing for the same buyer on the same page?",
      detail: `${inStock.length} currently in stock.`,
    }),
    param("fulfilment", "Marketplace-fulfilled", {
      value: fulfilmentShare,
      display: fulfilmentShare != null ? `${fulfilmentShare}%` : "—",
      unit: "%",
      basis: "observed",
      decision: "Is delivery speed working for or against this listing?",
      detail: `${fulfilled.length} of ${rows.length} offers ship through the marketplace rather than the seller. Delivery speed is a documented driver of the featured position, independent of price.`,
    }),
    param("shipping", "Delivery share of price", {
      value: shippingShare,
      display: shippingShare != null ? `${shippingShare}%` : "—",
      unit: "%",
      basis: "derived",
      decision: "Would absorbing delivery move this listing up the ranking more cheaply than a price cut?",
      detail: cheapest
        ? `${payingShipping.length} of ${rows.length} offers charge for delivery. On the cheapest offer, delivery is ${formatMinor(cheapest.layers.shippingFeeMinor ?? 0)} of a ${formatMinor(cheapest.layers.landedMinor)} landed price.`
        : null,
      unavailableReason: "No in-stock offer, so there is no landed price to divide.",
    }),
    param("promotion", "Promotional days", {
      value: promoShare,
      display: promoShare != null ? `${promoShare}%` : "—",
      unit: "%",
      basis: "observed",
      decision: "Is the current price a standing price or a promotional one?",
      detail:
        win.n > 0
          ? `${win.promoDays} of ${win.n} captured ${plural(win.n, "day", "days")} in this window fell inside a promotion${win.promoLabels.length ? ` (${win.promoLabels.join(", ")})` : ""}. A universal discount is ${universalLive ? "live right now" : "not live right now"}.`
          : null,
      unavailableReason: "No observation inside this window.",
    }),
    param("discount", "Discount off MRP", {
      value: discountDepth,
      display: discountDepth != null ? `${discountDepth}%` : "—",
      unit: "%",
      basis: "derived",
      decision: "Is the headline discount unusual for this market?",
      detail: cheapest?.layers.mrpMinor
        ? `Cheapest effective price against an observed MRP of ${formatMinor(cheapest.layers.mrpMinor)}.`
        : null,
      unavailableReason: "No MRP is printed on any observed offer, so depth cannot be measured.",
    }),
    param("reach", "Platforms carried", {
      value: listings.length,
      display: `${listings.length} of ${ownMarketplaces.size + gapPlatforms.length}`,
      basis: "observed",
      decision: "Are competitors selling somewhere this product is absent?",
      detail: comps.length
        ? gapPlatforms.length
          ? `${gapPlatforms.length} ${plural(gapPlatforms.length, "platform carries", "platforms carry")} most of the competitive set but not this product.`
          : "No platform carries most of the competitive set while missing this product."
        : "No competitive set was established, so coverage cannot be compared.",
    }),
  ];

  // -------------------------------------------------------------- findings
  // Each of these needed at least two parameters to reach. They are generated
  // only where the data supports them, so a product with thin evidence simply
  // produces fewer of them.
  const findings = [];
  const add = (f) => findings.push(f);

  // Rating strength vs the base it rests on.
  if (metrics?.rating != null && metrics.reviewCount != null && trust != null) {
    const damping = Math.round((metrics.rating - trust) * 100) / 100;
    if (metrics.reviewCount < 500 && damping >= 0.15) {
      add({
        id: "sig_thin_reviews",
        dimension: "Trust",
        direction: "aggressive",
        headline: `A ${metrics.rating}★ rating resting on only ${metrics.reviewCount.toLocaleString("en-IN")} reviews`,
        detail: `Damped for the size of the base it sits on, the rating reads ${trust}★ rather than ${metrics.rating}★. A high average over a small number of reviews is not yet evidence a buyer will pay more for it, and it should not be leaned on to justify a premium.`,
        evidence: [
          `Raw ${metrics.rating}★ across ${metrics.reviewCount.toLocaleString("en-IN")} reviews`,
          `Trust-weighted ${trust}★ — damped by ${damping}`,
        ],
      });
    } else if (metrics.reviewCount >= 5000 && trust >= 4.2) {
      add({
        id: "sig_strong_trust",
        dimension: "Trust",
        direction: "premium",
        headline: `Customer trust is backed by a substantial review base`,
        detail: `${metrics.rating}★ across ${metrics.reviewCount.toLocaleString("en-IN")} reviews survives damping at ${trust}★. A rating this well-supported is one of the few non-price assets that genuinely sustains a higher price.`,
        evidence: [`Trust-weighted ${trust}★`, `${metrics.reviewCount.toLocaleString("en-IN")} reviews across ${listings.length} ${plural(listings.length, "listing", "listings")}`],
      });
    }
  }

  // Demand proxy against the competitive set.
  if (velocity != null && medianCompVelocity != null && medianCompVelocity > 0) {
    const delta = pct1((velocity - medianCompVelocity) / medianCompVelocity);
    if (Math.abs(delta) >= 25) {
      add({
        id: "sig_velocity",
        dimension: "Demand proxy",
        direction: delta > 0 ? "premium" : "aggressive",
        headline:
          delta > 0
            ? `Reviews are accumulating ${delta}% faster than the competitive median`
            : `Reviews are accumulating ${Math.abs(delta)}% slower than the competitive median`,
        detail:
          delta > 0
            ? `${formatRate(velocity)} new reviews a day against a competitor median of ${formatRate(medianCompVelocity)}. Review accumulation is a proxy for purchase volume, not a measurement of it — but a listing pulling well ahead of its rivals on it is not one that needs to buy attention with price.`
            : `${formatRate(velocity)} new reviews a day against a competitor median of ${formatRate(medianCompVelocity)}. Slower accumulation can mean lower volume, a younger listing, or simply less prompting — it is a reason to look, not a conclusion on its own.`,
        evidence: [
          `This product ${formatRate(velocity)}/day`,
          `Competitor median ${formatRate(medianCompVelocity)}/day across ${compVelocities.length} ${plural(compVelocities.length, "rival", "rivals")}`,
        ],
      });
    }
  }

  // Featured position × availability — the interaction that matters most.
  if (featured && win.coverage.outOfStockShare != null) {
    if (featured.lockedCount > 0) {
      const example = featured.perListing.find((l) => l.topShare >= LOCKED_SHARE);
      add({
        id: "sig_featured_locked",
        dimension: "Featured offer",
        direction: "neutral",
        headline: `The featured offer is locked to one seller on ${featured.lockedCount} of ${featured.listingsMeasured} ${plural(featured.listingsMeasured, "platform", "platforms")}`,
        detail: `On ${example.marketplaceId.replace(/^mp_/, "").replace(/_/g, " ")}, ${example.topSellerName} held the default position on ${example.topShare}% of captured days against ${example.distinctWinners - 1} other ${plural(example.distinctWinners - 1, "seller", "sellers")}. Where the position is this concentrated, matching on price rarely dislodges it — the holder simply matches back — so the lever is usually delivery, availability or seller rating rather than price.`,
        evidence: [
          `${featured.lockedCount} of ${featured.listingsMeasured} platforms above the ${LOCKED_SHARE}% lock threshold`,
          `Mean top-seller share ${featured.meanTopShare}% across platforms measured`,
          `Most contested: ${featured.mostContested.topShare}% on ${featured.mostContested.marketplaceId.replace(/^mp_/, "").replace(/_/g, " ")}`,
        ],
      });
    }
    if (win.coverage.outOfStockShare >= 10) {
      add({
        id: "sig_availability",
        dimension: "Availability",
        direction: "neutral",
        headline: `${win.coverage.outOfStockShare}% of offer-days in this window were out of stock`,
        detail: `Availability, not price, decides who can hold the default position: an unbuyable offer cannot win it at any price. Before reading the price gap as a competitiveness problem, this share is worth removing.`,
        evidence: [
          `${win.coverage.outOfStockRows} of ${win.coverage.observationRows} offer-days unavailable`,
          `${inStock.length} of ${rows.length} offers buyable right now`,
        ],
      });
    }
  }

  // Promotion dependence — is the comparison price a standing price?
  if (promoShare != null && promoShare >= 30 && win.n >= 3) {
    add({
      id: "sig_promo_dependence",
      dimension: "Promotion",
      direction: "aggressive",
      headline: `${promoShare}% of captured days in this window were promotional`,
      detail: `A price that is discounted this often is the working price, not an exception — and the figure every competitiveness comparison on this page is built from is therefore a promotional one. Sustained discounting also teaches buyers to wait for the next one.`,
      evidence: [
        `${win.promoDays} of ${win.n} captured days inside a promotion`,
        win.promoLabels.length ? `Windows: ${win.promoLabels.join(", ")}` : "Promotion window unlabelled",
      ],
    });
  }

  // Shipping as a lever separate from price.
  if (shippingShare != null && shippingShare >= 5 && cheapest) {
    add({
      id: "sig_shipping",
      dimension: "Delivery",
      direction: "aggressive",
      headline: `Delivery is ${shippingShare}% of what the buyer actually pays`,
      detail: `${formatMinor(cheapest.layers.shippingFeeMinor)} of the ${formatMinor(cheapest.layers.landedMinor)} landed price is delivery. Absorbing it moves the effective price by the same amount as an equivalent price cut, but leaves the headline price — and the reference point buyers anchor on — intact.`,
      evidence: [
        `${payingShipping.length} of ${rows.length} offers charge for delivery`,
        `Cheapest offer: ${formatMinor(cheapest.layers.sellingPriceMinor)} + ${formatMinor(cheapest.layers.shippingFeeMinor)} delivery`,
      ],
    });
  }

  // Fulfilment mix — a documented driver of the default position.
  if (fulfilmentShare != null && rows.length >= 3 && fulfilmentShare <= 34) {
    add({
      id: "sig_fulfilment",
      dimension: "Delivery",
      direction: "neutral",
      headline: `Only ${fulfilmentShare}% of offers on this product ship through the marketplace`,
      detail: `Self-shipped offers carry slower and less predictable delivery, which marketplaces weight when choosing a default offer. Where rivals are marketplace-fulfilled, a price advantage can be cancelled by a delivery disadvantage that no price cut addresses.`,
      evidence: [`${fulfilled.length} of ${rows.length} offers marketplace-fulfilled`],
    });
  }

  // Coverage gap — a non-price growth lever.
  if (gapPlatforms.length > 0) {
    add({
      id: "sig_reach",
      dimension: "Reach",
      direction: "neutral",
      headline: `${gapPlatforms.length} ${plural(gapPlatforms.length, "platform carries", "platforms carry")} most of the competitive set but not this product`,
      detail: `This is demand the product is not visible to at any price. Listing where rivals already sell is usually a cheaper route to volume than competing harder on the platforms already covered.`,
      evidence: [
        `Listed on ${listings.length} of ${ownMarketplaces.size + gapPlatforms.length} platforms seen across this competitive set`,
        `Competitive set of ${comps.length} measured`,
      ],
    });
  }

  return {
    available: true,
    window: win,
    parameters,
    findings,
    context: {
      featured,
      velocity,
      medianCompVelocity,
      trust,
      rawRating: metrics?.rating ?? null,
      reviewCount: metrics?.reviewCount ?? null,
      offerCount: rows.length,
      inStockCount: inStock.length,
      listingCount: listings.length,
      gapPlatforms,
    },
    /**
     * Signals a production system would use and this dataset cannot support.
     * Kept in the payload so the interface can state the limit rather than
     * leaving the reader to assume it was considered and dismissed.
     */
    knownGaps: [
      "Units sold and sales velocity — the primary demand signal in every industry account of marketplace ranking. Not captured here, and not inferable from price observations.",
      "Conversion rate, sessions and add-to-cart — require storefront analytics this prototype has no access to.",
      "Search rank and impression share — would show whether a listing is losing visibility rather than losing on price.",
      "Returns, cancellations and delivery-SLA breaches — the seller-performance side of the default-position decision.",
    ],
  };
}
