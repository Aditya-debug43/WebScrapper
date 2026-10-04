import { apiRequest } from "./http";
import { describeLadder } from "../utils/priceLadderView";

/**
 * MARKETPLACE PRESENCE AND LISTING DETAIL COME FROM THE BACKEND.
 *
 * This module used to join listings, offers, sellers, observations, promotions
 * and fee rules in the browser, and compute the price ladder and net
 * realisation from a bundled fee table. All of that is now server-side; the
 * database is the source of truth.
 *
 * Two screens, one request each:
 *
 *   GET /products/:id/marketplaces   the comparison table — one row per
 *                                    platform, with the ladder, the seller
 *                                    behind the price, fees and net
 *   GET /listings/:id                one listing and every seller competing
 *                                    on it
 *
 * The listing endpoint is reached by LISTING id and resolves the product
 * itself. That lookup is why this module previously needed its own copy of the
 * listing table.
 *
 * ── No fallback ──────────────────────────────────────────────────────────
 * A failure throws. Falling back to bundled data would make an outage look
 * like a working screen showing invented prices.
 */

/** GET /api/v1/products/:id/marketplaces — one product, its platforms side by side. */
export async function getMarketplaceComparison(productId, { signal } = {}) {
  const body = await apiRequest(`/products/${encodeURIComponent(productId)}/marketplaces`, { signal });
  return presentMarketplaceComparison(body);
}

/**
 * The response as the comparison screen's view-model.
 *
 * `cheapestOffer.layers` is the backend's `currentPrice` renamed to the shape
 * the table reads. It is a rename, not a recomputation: every rung is the
 * server's, including `conditionalBestMinor`. The one derived value is
 * `discountFromMrpPct`, which is a ratio between two numbers already present
 * and belongs with the formatting that uses it.
 */
export function presentMarketplaceComparison(body) {
  const rows = body?.data ?? [];

  const listingRows = rows.map((row) => {
    const price = row.currentPrice ?? null;
    const layers = price
      ? {
          mrpMinor: price.mrpMinor,
          sellingPriceMinor: price.sellingPriceMinor,
          shippingFeeMinor: price.shipping?.minMinor ?? null,
          landedMinor: price.landedMinor,
          universalEffectiveMinor: price.effectiveMinor,
          conditionalBestMinor: row.cheapestOffer?.conditionalBestMinor ?? price.effectiveMinor,
          discountFromMrpPct:
            price.mrpMinor && price.sellingPriceMinor != null
              ? 1 - price.sellingPriceMinor / price.mrpMinor
              : null,
        }
      : null;

    return {
      listing: row.listing,
      marketplace: row.marketplace,
      coverage: row.coverage,
      availability: row.availability,
      offerCount: row.coverage?.offerCount ?? 0,

      /**
       * Null when nothing on this platform was observed in stock. The table
       * renders an em dash rather than a zero — the product is listed and
       * unavailable, which is a real state and not a price of nothing.
       */
      cheapestOffer: row.cheapestOffer
        ? {
            id: row.cheapestOffer.id,
            seller: row.cheapestOffer.seller,
            activePromotions: row.cheapestOffer.activePromotions ?? [],
            effectiveMinor: row.cheapestOffer.effectiveMinor,
            layers,
          }
        : null,

      rating: row.rating?.average ?? null,
      reviewCount: row.rating?.reviewCount ?? null,
      reviewVelocity: row.reviewVelocity ?? null,
      feeRule: row.feeRule ?? null,

      /**
       * Kept under the name the table already used. Null where no fee rule is
       * captured for the platform — routine for a store discovered from
       * provider data, and reported as unknown rather than as the full price.
       */
      netRealization: row.netRealisation
        ? { ...row.netRealisation, netRealizationMinor: row.netRealisation.netRealisationMinor }
        : null,
    };
  });

  const prices = listingRows.map((r) => r.cheapestOffer?.effectiveMinor).filter((v) => v != null);

  return {
    productId: body?.meta?.productId ?? null,
    referenceDate: body?.meta?.referenceDate ?? null,
    listingRows,
    cheapestAcross: prices.length ? Math.min(...prices) : null,
    priceGapMinor: prices.length > 1 ? Math.max(...prices) - Math.min(...prices) : 0,
  };
}

/** GET /api/v1/listings/:id — the listing plus every competing seller on it. */
export async function getListingDetail(listingId, { signal } = {}) {
  const body = await apiRequest(`/listings/${encodeURIComponent(listingId)}`, { signal });
  return presentListingDetail(body);
}

/**
 * The listing response as the detail screen's view-model.
 *
 * Offers arrive cheapest-first and already carry their seller, that seller's
 * rating, the full ladder and the promotions active on the reference date. The
 * `ladder` array below is the only thing built here, and it is presentation:
 * which rungs are worth showing and in what words.
 */
export function presentListingDetail(body) {
  const d = body?.data;
  if (!d) return null;

  return {
    listing: d.listing,
    product: d.product,
    marketplace: d.marketplace,
    review: d.rating
      ? { averageRating: d.rating.average, reviewCount: d.rating.reviewCount, capturedAt: d.rating.capturedAt }
      : null,
    reviewVelocity: d.reviewVelocity ?? null,

    offers: (d.offers ?? []).map((o) => ({
      offer: { id: o.id, itemCondition: o.condition, offerStatus: o.status },
      seller: o.seller
        ? {
            id: o.seller.id,
            name: o.seller.name,
            sellerType: o.seller.type,
            defaultFulfilmentType: o.seller.fulfilment,
          }
        : null,
      /**
       * Null for a seller with no rating history, which includes every
       * storefront seller created from provider data. The card omits the stars
       * rather than printing zero of them.
       */
      sellerRating: o.seller?.rating == null ? null : { rating: o.seller.rating, ratingCount: o.seller.ratingCount },
      observation: { isInStock: o.isInStock, isBuyboxWinner: o.isBuyboxWinner, observedAt: o.observedAt },
      layers: o.price
        ? {
            mrpMinor: o.price.mrpMinor,
            sellingPriceMinor: o.price.sellingPriceMinor,
            shippingFeeMinor: o.price.shippingFeeMinor,
            landedMinor: o.price.landedMinor,
            universalDiscountMinor: o.price.universalDiscountMinor,
            universalEffectiveMinor: o.price.universalEffectiveMinor,
            conditionalDiscountMinor: o.price.conditionalDiscountMinor,
            conditionalBestMinor: o.price.conditionalBestMinor,
          }
        : null,
      ladder: o.price ? describeLadder(o.price) : [],
      activePromotions: o.activePromotions ?? [],
      landedMinor: o.price?.landedMinor ?? null,
      effectiveMinor: o.price?.universalEffectiveMinor ?? null,
      conditionalBestMinor: o.price?.conditionalBestMinor ?? null,
    })),
  };
}
