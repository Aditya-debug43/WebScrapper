import { apiRequest } from "./http";

/**
 * THE PRODUCT COMES FROM THE BACKEND.
 *
 * This module used to assemble a product from the bundled dataset — joining
 * products to brands, categories, listings and review snapshots in the
 * browser. The database is now the source of truth.
 *
 * ── Why two requests ─────────────────────────────────────────────────────
 * The backend keeps identity and commerce apart on purpose, and that split is
 * right:
 *
 *   /products/:id               what the product IS — brand, taxonomy, the
 *                               specification document and the schema that
 *                               describes it, its variant siblings
 *   /products/:id/marketplaces  where it is SOLD — one row per platform, with
 *                               the price ladder, coverage, availability and
 *                               the listing's rating
 *
 * Folding the second into the first would make every identity lookup pay for
 * a price query. They are fetched in parallel and composed here.
 *
 * ── There is no fallback ─────────────────────────────────────────────────
 * If the API fails this throws. Falling back to the bundled dataset would turn
 * an outage into a page that looks fine while showing invented data.
 */

/**
 * GET the full product overview.
 *
 * Marketplace presence is allowed to fail WITHOUT taking the page down: a
 * product that is genuinely sold nowhere is a normal state, and so is a
 * newly-catalogued one whose listings have not been captured yet. Identity is
 * the page; coverage is a section of it.
 */
export async function getProductDetail(productId, { signal } = {}) {
  const id = encodeURIComponent(productId);

  const [detail, marketplaces] = await Promise.all([
    apiRequest(`/products/${id}`, { signal }),
    apiRequest(`/products/${id}/marketplaces`, { signal }).catch((error) => {
      if (error?.name === "AbortError") throw error;
      return null;
    }),
  ]);

  return presentProductDetail(detail, marketplaces);
}

/**
 * The two responses as the overview's view-model.
 *
 * Every value passes through as the backend reported it. A missing rating
 * stays null rather than becoming 0, and a product with no captured offer has
 * `currentPriceMinor: null` rather than a zero that would read as free — with
 * live provider data those gaps are routine, not hypothetical.
 */
export function presentProductDetail(detail, marketplacesBody) {
  const p = detail?.data;
  if (!p) return null;

  const rows = marketplacesBody?.data ?? [];

  return {
    product: {
      id: p.id,
      canonicalName: p.canonicalName,
      modelName: p.modelName,
      isPurchasable: p.isPurchasable,
      lifecycleStatus: p.lifecycleStatus,
      firstSeenAt: p.firstSeenAt,
      parentProductId: p.parentProductId,
      variantAxes: p.variantAxes,
      specifications: p.specifications ?? {},
      specSchemaVersion: p.specSchemaVersion,
      brandId: p.brand?.id ?? null,
      categoryId: p.category?.id ?? null,
      productTypeId: p.productType?.id ?? null,
    },
    brand: p.brand ?? null,
    category: p.category ?? null,
    productType: p.productType ?? null,

    /** Root-first ancestry, ending at the product's own category. */
    categoryPath: p.categoryPath ?? [],

    /** The schema of this product's specification document, in registry order. */
    attributeDefs: p.attributeDefinitions ?? [],

    variantSiblings: (p.variantSiblings ?? []).map((sibling) => ({
      product: sibling,
      /**
       * Deliberately null. A sibling's price is a second price query per
       * variant, and the overview lists siblings to navigate between them,
       * not to compare their prices — the marketplace screen does that.
       */
      currentPriceMinor: null,
    })),

    /**
     * One row per platform carrying this product.
     *
     * `marketplacesUnavailable` distinguishes "this product is listed nowhere"
     * from "we could not ask" — the same distinction the ingestion layer
     * refuses to blur, and for the same reason: they look identical on screen
     * and mean opposite things.
     */
    listings: rows.map((row) => ({
      listing: row.listing,
      marketplace: row.marketplace,
      coverage: row.coverage ?? null,
      availability: row.availability ?? null,
      rating: row.rating?.average ?? null,
      reviewCount: row.rating?.reviewCount ?? null,
      currentPriceMinor: row.currentPrice?.effectiveMinor ?? null,
    })),
    marketplacesUnavailable: marketplacesBody === null,
    marketplaceCount: p.marketplaceCount ?? rows.length,
  };
}
