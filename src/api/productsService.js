import { mockDelay } from "./client";
import { products, getProduct, getVariantSiblings } from "../data/products";
import { getBrand } from "../data/brands";
import { getCategoryPath } from "../data/categories";
import { getAttributeDefinitions } from "../data/attributeDefinitions";
import { getListingsForProduct } from "../data/listings";
import { marketplaces } from "../data/marketplaces";
import { getLatestReviewSnapshot } from "../data/reviewSnapshots";
import { getCurrentEffectivePrice } from "../utils/pricingEngine";
import { getProductReviewMetrics } from "../utils/productMetrics";

function summarizeListings(productId) {
  return getListingsForProduct(productId).map((listing) => {
    const marketplace = marketplaces.find((m) => m.id === listing.marketplaceId);
    const review = getLatestReviewSnapshot(listing.id);
    const price = getCurrentEffectivePrice(listing.productId);
    return {
      listing,
      marketplace,
      rating: review?.averageRating ?? null,
      reviewCount: review?.reviewCount ?? null,
      currentPriceMinor: price?.universalEffectiveMinor ?? null,
    };
  });
}

/** GET /api/products?query=&categoryId= — canonical products only, never raw listings. */
export async function searchProducts({ query = "", categoryId = null } = {}) {
  await mockDelay();
  const q = query.trim().toLowerCase();
  return products
    .filter((p) => p.isPurchasable)
    .filter((p) => (categoryId ? p.categoryId === categoryId : true))
    .filter((p) => (q ? p.canonicalName.toLowerCase().includes(q) || p.modelName.toLowerCase().includes(q) : true))
    .map((product) => {
      const brand = getBrand(product.brandId);
      const listingSummaries = summarizeListings(product.id);
      const prices = listingSummaries.map((l) => l.currentPriceMinor).filter(Boolean);
      return {
        product,
        brand,
        marketplaceCount: listingSummaries.length,
        minPriceMinor: prices.length ? Math.min(...prices) : null,
        maxPriceMinor: prices.length ? Math.max(...prices) : null,
        // Product-level rating comes from the shared aggregation, not from
        // whichever listing happens to be first — see utils/productMetrics.
        avgRating: getProductReviewMetrics(product.id).rating,
      };
    });
}

/** GET /api/products/:id — full product identity: brand, category path, specs, variant family, listings. */
export async function getProductDetail(productId) {
  await mockDelay();
  const product = getProduct(productId);
  if (!product) return null;
  const brand = getBrand(product.brandId);
  const categoryPath = getCategoryPath(product.categoryId);
  const attributeDefs = product.specSchemaVersion
    ? getAttributeDefinitions(product.productTypeId, product.specSchemaVersion)
    : [];
  const siblings = getVariantSiblings(productId).map((sib) => ({
    product: sib,
    currentPriceMinor: getCurrentEffectivePrice(sib.id)?.universalEffectiveMinor ?? null,
  }));
  const listingSummaries = summarizeListings(productId);

  return {
    product,
    brand,
    categoryPath,
    attributeDefs,
    variantSiblings: siblings,
    listings: listingSummaries,
  };
}
