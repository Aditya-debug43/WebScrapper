import { getListingsForProduct } from "../data/listings";
import { getLatestReviewSnapshot, getReviewVelocity } from "../data/reviewSnapshots";

/**
 * PRODUCT-LEVEL REVIEW METRICS — ONE SOURCE OF TRUTH
 * ==================================================
 *
 * Reviews are captured per LISTING, because two marketplaces draw on different
 * customer populations. Everything that talks about "this product's rating"
 * must therefore aggregate those listings, and must aggregate them the SAME
 * WAY, or the numbers disagree between screens.
 *
 * They did disagree. The audit found 80 of 89 products where the pricing
 * engine's rating differed from the catalogue's, because the engine read
 * `getListingsForProduct(id)[0]` — whichever listing happened to be first —
 * while the catalogue took the highest rating and the summed review count.
 * The Galaxy M14 read 4.3★ / 9,840 reviews inside a recommendation and
 * 4.5★ / 16,260 on the product page. A recommendation that quotes a rating the
 * user cannot find on the product page is not explainable, whatever the
 * arithmetic behind it.
 *
 * THE AGGREGATION RULE, defined once, here:
 *
 *   reviewCount  = SUM of the latest review count on every listing.
 *   rating       = review-count-WEIGHTED MEAN of the latest rating on every
 *                  listing. Weighting matters: a 4.8★ listing with 45 reviews
 *                  should not outvote a 4.1★ listing with 42,000. The previous
 *                  catalogue rule (take the maximum) let exactly that happen.
 *
 * Ratings are rounded to one decimal because that is the precision the source
 * marketplaces publish; carrying more would imply accuracy the data lacks.
 */

const cache = new Map();

function compute(productId) {
  const listings = getListingsForProduct(productId);
  const perListing = [];
  let weighted = 0;
  let reviewCount = 0;
  let velocity = 0;
  let velocityKnown = false;

  for (const listing of listings) {
    const snapshot = getLatestReviewSnapshot(listing.id);
    if (!snapshot) continue;
    const count = snapshot.reviewCount ?? 0;
    const rating = snapshot.averageRating ?? null;
    perListing.push({
      listingId: listing.id,
      marketplaceId: listing.marketplaceId,
      rating,
      reviewCount: count,
      capturedAt: snapshot.capturedAt,
    });
    if (rating != null && count > 0) {
      weighted += rating * count;
      reviewCount += count;
    }
    const v = getReviewVelocity(listing.id);
    if (v != null) {
      velocity += v;
      velocityKnown = true;
    }
  }

  if (perListing.length === 0) {
    return {
      rating: null,
      reviewCount: null,
      listingCount: listings.length,
      contributingListings: 0,
      reviewVelocity: null,
      basis: "no review snapshot captured on any listing",
      perListing,
    };
  }

  // A listing can carry a rating with a zero review count; fall back to an
  // unweighted mean rather than dividing by zero.
  const rated = perListing.filter((r) => r.rating != null);
  const rating =
    reviewCount > 0
      ? Math.round((weighted / reviewCount) * 10) / 10
      : rated.length
        ? Math.round((rated.reduce((s, r) => s + r.rating, 0) / rated.length) * 10) / 10
        : null;

  return {
    rating,
    reviewCount: reviewCount || null,
    listingCount: listings.length,
    contributingListings: perListing.length,
    reviewVelocity: velocityKnown ? velocity : null,
    basis:
      perListing.length === 1
        ? "single listing"
        : `review-count-weighted mean across ${perListing.length} listings`,
    perListing,
  };
}

/**
 * The product's rating and review count. Used by the catalogue index, the
 * product cards, the comparable set and the strength model alike — so the
 * number in a recommendation is always the number on the product page.
 */
export function getProductReviewMetrics(productId) {
  let hit = cache.get(productId);
  if (hit === undefined) cache.set(productId, (hit = compute(productId)));
  return hit;
}

/** Convenience for callers that only need the two headline numbers. */
export function getProductRating(productId) {
  const m = getProductReviewMetrics(productId);
  return { rating: m.rating, reviewCount: m.reviewCount };
}
