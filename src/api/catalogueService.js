import { apiRequest } from "./http";

/**
 * THE CATALOGUE COMES FROM THE BACKEND.
 *
 * This module used to BE the catalogue: it imported the bundled dataset, built
 * a summary index over every product, and computed facets, prices and ratings
 * in the browser. The database is now the source of truth, and this is a client
 * for `GET /api/v1/catalogue`.
 *
 * ── Why one request ──────────────────────────────────────────────────────
 * The screen renders results, facet counts and navigation together, and all
 * three are derived from the same scope. Fetched separately the client would
 * make three round trips and still have to assume they described a consistent
 * scope; the backend composes them from one load and they cannot disagree.
 *
 * ── There is no fallback, deliberately ───────────────────────────────────
 * If the API fails, this throws. The temptation is to fall back to the bundled
 * dataset so the page still renders — and that would be the worst possible
 * behaviour: a production outage would look like a working catalogue showing
 * stale invented data, and the two sources of truth this migration removes
 * would be back. A failure must look like a failure.
 */

/** The sort options the page offers, matching the endpoint's enum. */
export const SORT_OPTIONS = [
  { value: "relevance", label: "Relevance" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "rating", label: "Rating" },
  { value: "reviews", label: "Review count" },
  { value: "recent", label: "Recently added" },
];

/** Multi-select groups travel as comma-separated lists; empty means unset. */
function csv(values) {
  return Array.isArray(values) && values.length ? values.join(",") : null;
}

/** `{ ram_gb: ["8"], storage_gb: ["128 GB"] }` → `ram_gb:8;storage_gb:128 GB` */
function specParam(specFilters) {
  const groups = Object.entries(specFilters ?? {})
    .filter(([, values]) => Array.isArray(values) && values.length)
    .map(([key, values]) => `${key}:${values.join(",")}`);
  return groups.length ? groups.join(";") : null;
}

/**
 * GET /api/v1/catalogue
 *
 * Takes the page's criteria object unchanged and returns the screen's
 * view-model. The parameter names differ from the query string because the
 * page's vocabulary is its own and the endpoint's is the API's; translating
 * here is this module's job.
 */
export async function getCatalogue(
  {
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
    page = 1,
    pageSize = 48,
  } = {},
  { signal } = {}
) {
  const params = new URLSearchParams();
  const set = (key, value) => {
    if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  };

  set("page", page);
  set("pageSize", pageSize);
  set("category", categoryId);
  set("productType", productTypeId);
  set("search", query.trim());
  set("brands", csv(brandIds));
  set("prices", csv(priceBucketIds));
  set("rating", ratingId);
  set("marketplaces", csv(marketplaceIds));
  if (inStockOnly) set("inStock", "true");
  set("specs", specParam(specFilters));
  set("sort", sort);

  const body = await apiRequest(`/catalogue?${params.toString()}`, { signal });
  return presentCatalogue(body);
}

/**
 * The API response as the screen's view-model.
 *
 * Shapes rather than renames: the page reads `results`, `breadcrumb` and
 * `facets` at the top level, and the response keeps pagination and navigation
 * in their own envelopes. Values pass through UNTOUCHED — a null price stays
 * null, so the card can say "No price" instead of printing ₹0.
 */
export function presentCatalogue(body) {
  const rows = body?.data ?? [];
  return {
    results: rows.map((row) => ({
      product: row.product,
      brand: row.product?.brand ?? null,
      minPriceMinor: row.minPriceMinor,
      maxPriceMinor: row.maxPriceMinor,
      marketplaces: row.marketplaces ?? [],
      marketplaceIds: row.marketplaceIds ?? [],
      keySpecs: row.keySpecs ?? [],
      listingCount: row.listingCount,
      offerCount: row.offerCount,
      rating: row.rating,
      reviewCount: row.reviewCount,
      inStock: row.inStock,
    })),

    total: body?.pagination?.total ?? 0,
    page: body?.pagination?.page ?? 1,
    pageSize: body?.pagination?.pageSize ?? 0,
    totalPages: body?.pagination?.totalPages ?? 0,

    scopeTotal: body?.meta?.scopeTotal ?? 0,
    resolvedProductType: body?.meta?.resolvedProductTypeId ?? null,
    breadcrumb: body?.meta?.breadcrumb ?? [],
    childCategories: body?.meta?.childCategories ?? [],
    productTypesInScope: body?.meta?.productTypesInScope ?? [],

    /**
     * Facet groups are passed through as the backend computed them, counts and
     * order included. The sidebar renders them; it does not rank them. The
     * ordering is a decision the server already made — marketplaces in their
     * own sequence, brands by count — and re-sorting here would quietly
     * override it.
     */
    facets: {
      brand: body?.facets?.brand ?? [],
      price: body?.facets?.price ?? [],
      rating: body?.facets?.rating ?? [],
      marketplace: body?.facets?.marketplace ?? [],
      availability: body?.facets?.availability ?? [],
      specs: body?.facets?.specs ?? [],
    },
    priceBuckets: body?.priceBuckets ?? [],
  };
}
