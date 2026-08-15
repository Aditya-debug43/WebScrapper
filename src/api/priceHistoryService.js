import { mockDelay } from "./client";
import { getListing } from "../data/listings";
import { getOffersForListing } from "../data/offers";
import { getSeller } from "../data/sellers";
import { getPriceHistoryForOffer } from "../data/priceObservations";
import { getProduct } from "../data/products";
import { marketplaces } from "../data/marketplaces";
import { buildPriceLayers } from "../utils/priceLayers";
import { PRICE_BASIS } from "../utils/pricingEngine";

/**
 * GET /api/listings/:id/price-history — every offer's observation series on
 * this listing.
 *
 * Each observation is annotated with the price on the ONE comparison basis the
 * engine uses (`effectiveMinor`), resolved against that observation's own date.
 * The raw `sellingPriceMinor` is left untouched alongside it, so the chart can
 * plot what the engine reasons about rather than a second, quieter definition
 * of "the price".
 */
export async function getPriceHistoryForListing(listingId) {
  await mockDelay();
  const listing = getListing(listingId);
  if (!listing) return null;
  const product = getProduct(listing.productId);
  const marketplace = marketplaces.find((m) => m.id === listing.marketplaceId);
  const series = getOffersForListing(listingId).map((offer) => ({
    offer,
    seller: getSeller(offer.sellerId),
    observations: getPriceHistoryForOffer(offer.id).map((obs) => {
      const layers = buildPriceLayers({ observation: obs, offerId: offer.id });
      return {
        ...obs,
        landedMinor: layers.landedMinor,
        effectiveMinor: layers.universalEffectiveMinor,
      };
    }),
  }));
  return { listing, product, marketplace, series, priceBasis: PRICE_BASIS };
}
