import { mockDelay } from "./client";
import { products } from "../data/products";
import { getBrand, brands } from "../data/brands";
import {
  categories,
  productTypes,
  getCategoryPath,
  getCategory,
  getChildCategories,
  getDepartments,
  getCategorySubtreeIds,
  getProductTypesForCategory,
} from "../data/categories";
import { getFilterableAttributes } from "../data/attributeDefinitions";
import { getListingsForProduct } from "../data/listings";
import { getOffersForListing } from "../data/offers";
import { getLatestObservation } from "../data/priceObservations";
import { marketplaces } from "../data/marketplaces";
import { buildPriceLayers } from "../utils/priceLayers";
import { getProductReviewMetrics } from "../utils/productMetrics";

/**
 * Catalogue read model.
 *
 * Everything the filter sidebar shows is derived from the attribute-definition
 * registry (which specs are filterable, and how) plus the products actually in
 * scope — no filter is hardcoded per category in the UI. Adding a product type
 * with its own schema gives it working filters with no code change here.
 */

// ---------------------------------------------------------------------------
// Product summary index — built once, since every catalogue query needs price,
// rating and marketplace coverage for every candidate product.
// ---------------------------------------------------------------------------
const summaryByProductId = (() => {
  const map = new Map();
  for (const product of products) {
    if (!product.isPurchasable) continue;

    const listings = getListingsForProduct(product.id);
    const marketplaceIds = [];
    const prices = [];
    let anyInStock = false;
    let offerCount = 0;

    // Rating and review count come from the shared aggregation in
    // utils/productMetrics — the same call the pricing engine makes — so the
    // catalogue and a recommendation can never quote different numbers for the
    // same product.
    const reviewMetrics = getProductReviewMetrics(product.id);

    for (const listing of listings) {
      if (!marketplaceIds.includes(listing.marketplaceId)) marketplaceIds.push(listing.marketplaceId);
      for (const offer of getOffersForListing(listing.id)) {
        offerCount++;
        const obs = getLatestObservation(offer.id);
        if (!obs) continue;
        if (obs.isInStock) {
          anyInStock = true;
          // Universal effective price — the same basis the recommendation
          // engine benchmarks on, so catalogue and detail pages agree.
          const layers = buildPriceLayers({
            observation: obs,
            offerId: offer.id,
            categoryId: product.categoryId,
            marketplaceId: listing.marketplaceId,
          });
          prices.push(layers.universalEffectiveMinor);
        }
      }
    }

    map.set(product.id, {
      product,
      brand: getBrand(product.brandId),
      categoryPath: getCategoryPath(product.categoryId),
      productType: productTypes.find((pt) => pt.id === product.productTypeId) ?? null,
      minPriceMinor: prices.length ? Math.min(...prices) : null,
      maxPriceMinor: prices.length ? Math.max(...prices) : null,
      marketplaceIds,
      listingCount: listings.length,
      offerCount,
      rating: reviewMetrics.rating,
      reviewCount: reviewMetrics.reviewCount ?? 0,
      ratingBasis: reviewMetrics.basis,
      inStock: anyInStock,
    });
  }
  return map;
})();

export function getProductSummary(productId) {
  return summaryByProductId.get(productId) ?? null;
}

const allSummaries = [...summaryByProductId.values()];

// ---------------------------------------------------------------------------
// Price buckets — generated from the price range actually present in scope, so
// a ₹399 perfume catalogue and a ₹1.3L television catalogue both get sensible
// bands instead of one hardcoded ladder that fits neither.
// ---------------------------------------------------------------------------
function buildPriceBuckets(summaries) {
  const prices = summaries.map((s) => s.minPriceMinor).filter((p) => p != null);
  if (prices.length === 0) return [];
  const maxRupees = Math.max(...prices) / 100;

  const ladders = [
    [500, 1000, 2000, 5000],
    [1000, 2500, 5000, 10000],
    [5000, 10000, 20000, 40000],
    [10000, 25000, 50000, 100000],
    [25000, 50000, 100000, 200000],
  ];
  const ladder = ladders.find((l) => maxRupees <= l[l.length - 1] * 1.6) ?? ladders[ladders.length - 1];

  const buckets = [];
  let prev = 0;
  for (const edge of ladder) {
    buckets.push({ id: `p_${prev}_${edge}`, label: prev === 0 ? `Under ₹${fmt(edge)}` : `₹${fmt(prev)} – ₹${fmt(edge)}`, minMinor: prev * 100, maxMinor: edge * 100 });
    prev = edge;
  }
  buckets.push({ id: `p_${prev}_max`, label: `₹${fmt(prev)} & above`, minMinor: prev * 100, maxMinor: null });
  return buckets;
}

function fmt(n) {
  if (n >= 100000) return `${n / 100000}L`;
  if (n >= 1000) return `${n / 1000}k`;
  return String(n);
}

const RATING_OPTIONS = [
  { id: "r4", label: "4★ & above", min: 4 },
  { id: "r35", label: "3.5★ & above", min: 3.5 },
  { id: "r3", label: "3★ & above", min: 3 },
];

// ---------------------------------------------------------------------------
// Filter predicates — each group is separable so facet counts can be computed
// with that group's own selection excluded (standard faceted-search behaviour:
// picking "Samsung" must not make every other brand's count drop to zero).
// ---------------------------------------------------------------------------
function matchesQuery(s, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    s.product.canonicalName.toLowerCase().includes(q) ||
    s.product.modelName.toLowerCase().includes(q) ||
    (s.brand?.name ?? "").toLowerCase().includes(q) ||
    (s.productType?.name ?? "").toLowerCase().includes(q)
  );
}

function matchesScope(s, categoryId, productTypeId) {
  if (productTypeId && s.product.productTypeId !== productTypeId) return false;
  if (categoryId) {
    const subtree = getCategorySubtreeIds(categoryId);
    if (!subtree.includes(s.product.categoryId)) return false;
  }
  return true;
}

function matchesBrand(s, brandIds) {
  return brandIds.length === 0 || brandIds.includes(s.product.brandId);
}

function matchesPrice(s, bucketIds, buckets) {
  if (bucketIds.length === 0) return true;
  if (s.minPriceMinor == null) return false;
  return bucketIds.some((id) => {
    const b = buckets.find((x) => x.id === id);
    if (!b) return false;
    return s.minPriceMinor >= b.minMinor && (b.maxMinor === null || s.minPriceMinor < b.maxMinor);
  });
}

function matchesRating(s, ratingId) {
  if (!ratingId) return true;
  const opt = RATING_OPTIONS.find((r) => r.id === ratingId);
  return opt ? (s.rating ?? 0) >= opt.min : true;
}

function matchesMarketplace(s, marketplaceIds) {
  return marketplaceIds.length === 0 || marketplaceIds.some((id) => s.marketplaceIds.includes(id));
}

function matchesAvailability(s, inStockOnly) {
  return !inStockOnly || s.inStock;
}

function specValueMatches(def, value, selected) {
  if (value === undefined || value === null) return false;
  if (def.filterType === "boolean") return selected.includes(String(Boolean(value)));
  if (def.filterType === "enum") return selected.includes(String(value));
  if (def.filterType === "range") {
    return selected.some((bucketLabel) => {
      const bucket = (def.buckets ?? []).find((b) => b.label === bucketLabel);
      if (!bucket) return false;
      const num = Number(value);
      return num >= bucket.min && (bucket.max === null || num < bucket.max);
    });
  }
  return false;
}

function matchesSpecs(s, specFilters, specDefs) {
  for (const [key, selected] of Object.entries(specFilters)) {
    if (!selected || selected.length === 0) continue;
    const def = specDefs.find((d) => d.attributeKey === key);
    if (!def) continue;
    if (!specValueMatches(def, s.product.specifications?.[key], selected)) return false;
  }
  return true;
}

const SORTS = {
  relevance: (a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0),
  price_asc: (a, b) => (a.minPriceMinor ?? Infinity) - (b.minPriceMinor ?? Infinity),
  price_desc: (a, b) => (b.minPriceMinor ?? -Infinity) - (a.minPriceMinor ?? -Infinity),
  rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
  reviews: (a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0),
  recent: (a, b) => (a.product.firstSeenAt < b.product.firstSeenAt ? 1 : -1),
};

export const SORT_OPTIONS = [
  { value: "relevance", label: "Relevance" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "rating", label: "Rating" },
  { value: "reviews", label: "Review count" },
  { value: "recent", label: "Recently added" },
];

/**
 * GET /api/catalogue
 * The single query the catalogue page runs. Returns the matching products, the
 * facets to render (with counts), and the navigation context.
 */
export async function getCatalogue({
  categoryId = null,
  productTypeId = null,
  query = "",
  brandIds = [],
  priceBucketIds = [],
  ratingId = null,
  marketplaceIds = [],
  inStockOnly = false,
  specFilters = {},
  sort = "relevance",
} = {}) {
  await mockDelay();

  // Scope first: everything else (facets included) is computed within it.
  const scoped = allSummaries.filter((s) => matchesScope(s, categoryId, productTypeId) && matchesQuery(s, query));

  // Spec facets only make sense once a single product type is in scope —
  // "RAM" is meaningless across a set containing shoes and refrigerators.
  const resolvedProductType =
    productTypeId ??
    (new Set(scoped.map((s) => s.product.productTypeId)).size === 1 ? scoped[0]?.product.productTypeId : null);
  const specDefs = resolvedProductType ? getFilterableAttributes(resolvedProductType) : [];

  const buckets = buildPriceBuckets(scoped);

  const predicates = {
    brand: (s) => matchesBrand(s, brandIds),
    price: (s) => matchesPrice(s, priceBucketIds, buckets),
    rating: (s) => matchesRating(s, ratingId),
    marketplace: (s) => matchesMarketplace(s, marketplaceIds),
    availability: (s) => matchesAvailability(s, inStockOnly),
    specs: (s) => matchesSpecs(s, specFilters, specDefs),
  };

  const applyAllExcept = (except) =>
    scoped.filter((s) => Object.entries(predicates).every(([key, fn]) => key === except || fn(s)));

  const results = scoped.filter((s) => Object.values(predicates).every((fn) => fn(s)));

  // ---- facet counts, each computed with its own group excluded ----
  const brandPool = applyAllExcept("brand");
  const brandFacet = brands
    .map((b) => ({ id: b.id, label: b.name, count: brandPool.filter((s) => s.product.brandId === b.id).length }))
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const pricePool = applyAllExcept("price");
  const priceFacet = buckets
    .map((b) => ({
      id: b.id,
      label: b.label,
      count: pricePool.filter(
        (s) => s.minPriceMinor != null && s.minPriceMinor >= b.minMinor && (b.maxMinor === null || s.minPriceMinor < b.maxMinor)
      ).length,
    }))
    .filter((f) => f.count > 0);

  const ratingPool = applyAllExcept("rating");
  const ratingFacet = RATING_OPTIONS.map((r) => ({
    id: r.id,
    label: r.label,
    count: ratingPool.filter((s) => (s.rating ?? 0) >= r.min).length,
  })).filter((f) => f.count > 0);

  const mpPool = applyAllExcept("marketplace");
  const marketplaceFacet = marketplaces
    .map((m) => ({ id: m.id, label: m.name, count: mpPool.filter((s) => s.marketplaceIds.includes(m.id)).length }))
    .filter((f) => f.count > 0);

  const availabilityPool = applyAllExcept("availability");
  const availabilityFacet = [{ id: "in_stock", label: "In stock", count: availabilityPool.filter((s) => s.inStock).length }];

  const specPool = applyAllExcept("specs");
  const specFacets = specDefs
    .map((def) => {
      let options = [];
      if (def.filterType === "boolean") {
        options = [
          { id: "true", label: "Yes", count: specPool.filter((s) => s.product.specifications?.[def.attributeKey] === true).length },
          { id: "false", label: "No", count: specPool.filter((s) => s.product.specifications?.[def.attributeKey] === false).length },
        ];
      } else if (def.filterType === "enum") {
        const values = [...new Set(specPool.map((s) => s.product.specifications?.[def.attributeKey]).filter((v) => v != null))];
        options = values
          .map((v) => ({
            id: String(v),
            label: def.unit ? `${v} ${def.unit}` : String(v),
            count: specPool.filter((s) => String(s.product.specifications?.[def.attributeKey]) === String(v)).length,
          }))
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      } else if (def.filterType === "range") {
        options = (def.buckets ?? []).map((b) => ({
          id: b.label,
          label: b.label,
          count: specPool.filter((s) => {
            const v = s.product.specifications?.[def.attributeKey];
            if (v == null) return false;
            const num = Number(v);
            return num >= b.min && (b.max === null || num < b.max);
          }).length,
        }));
      }
      return {
        key: def.attributeKey,
        label: def.displayName,
        filterType: def.filterType,
        options: options.filter((o) => o.count > 0),
      };
    })
    .filter((f) => f.options.length > 1); // a facet with one option filters nothing

  results.sort(SORTS[sort] ?? SORTS.relevance);

  const currentCategory = categoryId ? getCategory(categoryId) : null;
  return {
    results,
    total: results.length,
    scopeTotal: scoped.length,
    breadcrumb: currentCategory ? getCategoryPath(categoryId) : [],
    childCategories: categoryId ? getChildCategories(categoryId) : getDepartments(),
    productTypesInScope: categoryId ? getProductTypesForCategory(categoryId) : [],
    resolvedProductType,
    facets: {
      brand: brandFacet,
      price: priceFacet,
      rating: ratingFacet,
      marketplace: marketplaceFacet,
      availability: availabilityFacet,
      specs: specFacets,
    },
  };
}

/** GET /api/catalogue/taxonomy — the department → category → subcategory tree with live counts. */
export async function getTaxonomy() {
  await mockDelay();
  const countFor = (categoryId) => {
    const subtree = getCategorySubtreeIds(categoryId);
    return allSummaries.filter((s) => subtree.includes(s.product.categoryId)).length;
  };
  return getDepartments().map((dept) => ({
    ...dept,
    productCount: countFor(dept.id),
    children: getChildCategories(dept.id).map((cat) => ({
      ...cat,
      productCount: countFor(cat.id),
      children: getChildCategories(cat.id).map((sub) => ({
        ...sub,
        productCount: countFor(sub.id),
        productTypes: getProductTypesForCategory(sub.id).map((pt) => ({
          ...pt,
          productCount: allSummaries.filter((s) => s.product.productTypeId === pt.id).length,
        })),
      })),
    })),
  }));
}

export { categories, productTypes };
