import { mockDelay } from "./client";
import { getProduct } from "../data/products";
import { getListing, getListingsForProduct } from "../data/listings";
import { getOffersForListing } from "../data/offers";
import { getSeller, getLatestSellerRating } from "../data/sellers";
import { getLatestObservation } from "../data/priceObservations";
import { getPromotionsForOffer, getActivePromotionsForOffer } from "../data/promotions";
import { getLatestReviewSnapshot, getReviewVelocity } from "../data/reviewSnapshots";
import { marketplaces } from "../data/marketplaces";
import { getCurrentFeeRule, computeNetRealizationMinor } from "../data/feeRules";
import { buildPriceLayers, describeLadder } from "../utils/priceLayers";

/**
 * An offer's full commercial state, built on the price ladder. The important
 * property: `effectiveMinor` is the UNIVERSAL effective price — what a buyer
 * with no particular card, coupon or trade-in pays — so comparisons between
 * sellers are like-for-like. Conditional, deferred and financing benefits are
 * carried separately and never folded into it.
 */
function buildOfferView(offer, listing, product) {
  const observation = getLatestObservation(offer.id);
  const layers = buildPriceLayers({
    observation,
    offerId: offer.id,
    categoryId: product?.categoryId,
    marketplaceId: listing?.marketplaceId,
  });
  return {
    offer,
    seller: getSeller(offer.sellerId),
    sellerRating: getLatestSellerRating(offer.sellerId),
    observation,
    layers,
    ladder: describeLadder(layers),
    promotions: getPromotionsForOffer(offer.id),
    activePromotions: observation ? getActivePromotionsForOffer(offer.id, observation.observedAt) : [],
    landedMinor: layers?.landedMinor ?? null,
    effectiveMinor: layers?.universalEffectiveMinor ?? null,
    conditionalBestMinor: layers?.conditionalBestMinor ?? null,
  };
}

/** GET /api/products/:id/marketplaces — one product, its listings, side by side. */
export async function getMarketplaceComparison(productId) {
  await mockDelay();
  const product = getProduct(productId);
  const listingRows = getListingsForProduct(productId).map((listing) => {
    const marketplace = marketplaces.find((m) => m.id === listing.marketplaceId);
    const offerViews = getOffersForListing(listing.id).map((o) => buildOfferView(o, listing, product));
    const inStockOffers = offerViews.filter((o) => o.observation?.isInStock);
    const cheapest = inStockOffers.reduce(
      (min, o) => (min === null || (o.effectiveMinor ?? Infinity) < (min.effectiveMinor ?? Infinity) ? o : min),
      null
    );
    const review = getLatestReviewSnapshot(listing.id);
    const feeRule = getCurrentFeeRule(marketplace.id, product.categoryId);
    const net = cheapest?.observation
      ? computeNetRealizationMinor({
          sellingPriceMinor: cheapest.observation.sellingPriceMinor,
          shippingFeeMinor: cheapest.observation.shippingFeeMinor,
          feeRule,
        })
      : null;
    return {
      listing,
      marketplace,
      offerCount: offerViews.length,
      cheapestOffer: cheapest,
      rating: review?.averageRating ?? null,
      reviewCount: review?.reviewCount ?? null,
      reviewVelocity: getReviewVelocity(listing.id),
      feeRule,
      netRealization: net,
    };
  });

  const validPrices = listingRows.map((r) => r.cheapestOffer?.effectiveMinor).filter((v) => v != null);
  const cheapestAcross = validPrices.length ? Math.min(...validPrices) : null;
  const priceGapMinor =
    validPrices.length > 1 ? Math.max(...validPrices) - Math.min(...validPrices) : 0;

  return { product, listingRows, cheapestAcross, priceGapMinor };
}

/** GET /api/listings/:id — the listing plus every competing seller/offer on it. */
export async function getListingDetail(listingId) {
  await mockDelay();
  const listing = getListing(listingId);
  if (!listing) return null;
  const product = getProduct(listing.productId);
  const marketplace = marketplaces.find((m) => m.id === listing.marketplaceId);
  const offers = getOffersForListing(listingId)
    .map((o) => buildOfferView(o, listing, product))
    .sort((a, b) => (a.effectiveMinor ?? Infinity) - (b.effectiveMinor ?? Infinity));
  const review = getLatestReviewSnapshot(listingId);
  const reviewVelocity = getReviewVelocity(listingId);

  return { listing, product, marketplace, offers, review, reviewVelocity };
}
