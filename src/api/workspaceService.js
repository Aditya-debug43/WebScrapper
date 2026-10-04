import { apiRequest } from "./http";

/**
 * THE PRODUCT WORKSPACE'S OWN CONTEXT.
 *
 * The shared chrome around Overview → Marketplaces → Listing → Price History →
 * Analysis → Recommendation needs the same five facts on every one of those
 * pages: which product, its name and brand for the masthead, how many
 * platforms carry it for the rail's badge, and which listing the Listing and
 * Price History tabs should open.
 *
 * It used to read all five synchronously from the bundled dataset, which is
 * also how it could resolve a `/listings/:id` address: it had its own copy of
 * the listing table to look the product up in. That lookup is now a request.
 *
 * ── Why the listing request comes first ──────────────────────────────────
 * Two addresses lead here. `/products/:productId/*` names the product
 * directly. `/listings/:listingId/*` does not, and the product cannot be
 * guessed from it — so that case resolves the listing first and then asks
 * about the product it belongs to. Sequential because the second request needs
 * the first's answer, not through oversight.
 */

/**
 * Resolve the workspace context for either address.
 *
 * Returns null when the identifier matches nothing, which the layout renders
 * as "no product answers to that address" — the same outcome as before, but
 * now it reflects the database rather than the contents of a bundle.
 */
export async function getWorkspaceContext({ productId, listingId }, { signal } = {}) {
  let resolvedProductId = productId ?? null;
  let activeListing = null;

  if (!resolvedProductId && listingId) {
    const listing = await apiRequest(`/listings/${encodeURIComponent(listingId)}`, { signal });
    resolvedProductId = listing?.data?.product?.id ?? null;
    activeListing = listing?.data?.listing ?? null;
  }

  if (!resolvedProductId) return null;

  const id = encodeURIComponent(resolvedProductId);
  const [detail, listings] = await Promise.all([
    apiRequest(`/products/${id}`, { signal }),
    /**
     * Every listing, not a page of them. A product carries a handful — the
     * schema allows one per platform — and the rail needs both the count and
     * the first id, so paginating would cost a second request to learn
     * nothing.
     */
    apiRequest(`/products/${id}/listings?pageSize=100`, { signal }).catch((error) => {
      if (error?.name === "AbortError") throw error;
      return null;
    }),
  ]);

  const product = detail?.data;
  if (!product) return null;

  const rows = listings?.data ?? [];

  return {
    productId: resolvedProductId,
    product: {
      id: product.id,
      canonicalName: product.canonicalName,
      modelName: product.modelName,
      variantAxes: product.variantAxes,
      lifecycleStatus: product.lifecycleStatus,
      categoryId: product.category?.id ?? null,
    },
    brand: product.brand ?? null,

    /**
     * Counted from the listings actually returned, not from the product's own
     * `marketplaceCount`, so the rail's badge and the Marketplaces tab can
     * never disagree about how many platforms there are.
     */
    listingCount: rows.length,

    /**
     * The listing the Listing and Price History tabs open.
     *
     * The active one when the address named it; otherwise the first the
     * backend returned, in the backend's order. Null when the product has no
     * listings at all, and those two tabs are then not offered — a tab leading
     * to a listing that does not exist is worse than an absent tab.
     */
    activeListing,
    defaultListingId: activeListing?.id ?? rows[0]?.id ?? null,

    /** True when listings could not be fetched, as distinct from there being none. */
    listingsUnavailable: listings === null,
  };
}
