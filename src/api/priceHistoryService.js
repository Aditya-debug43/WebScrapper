import { apiRequest } from "./http";

/**
 * PRICE HISTORY COMES FROM THE BACKEND.
 *
 * This module used to walk the bundled observation table, rebuild the price
 * ladder per observation in the browser, and group the result by offer. The
 * database is now the source of truth and the ladder is computed once, in SQL,
 * on the same rung every other screen compares on.
 *
 * ── Addressed by listing ─────────────────────────────────────────────────
 * `GET /listings/:id/price-history` returns one line per competing seller,
 * oldest-first, already grouped. The chart draws a line per offer, so a flat
 * paginated list would have to be regrouped by the client — and could not be
 * regrouped correctly at all without first fetching every page.
 *
 * ── No fallback ──────────────────────────────────────────────────────────
 * A failure throws. A chart rendered from bundled history during an outage
 * would be a picture of prices that were never observed.
 */

/** The price basis every figure on this screen reads, as the server names it. */
export const PRICE_BASIS = {
  basis: "universalEffective",
  label: "Effective price — what an ordinary buyer pays",
};

/**
 * GET /api/v1/listings/:id/price-history
 *
 * `window` is optional; the endpoint defaults to its own horizon. Returns null
 * only for a listing the backend does not have — every other failure throws,
 * so an empty chart always means "no observations in range" rather than
 * "something broke quietly".
 */
export async function getPriceHistoryForListing(listingId, { window, from, to, signal } = {}) {
  const params = new URLSearchParams();
  if (window) params.set("window", window);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();

  const body = await apiRequest(
    `/listings/${encodeURIComponent(listingId)}/price-history${query ? `?${query}` : ""}`,
    { signal }
  );
  return presentPriceHistory(body);
}

/**
 * The response as the chart's view-model.
 *
 * `effectiveMinor` is the server's `universalEffectiveMinor` under the name
 * the page already used. Nothing is recomputed: a landed price that the
 * server reported is the landed price, and deriving it again here is how two
 * screens start disagreeing about one observation.
 */
export function presentPriceHistory(body) {
  const d = body?.data;
  if (!d) return null;

  return {
    listing: d.listing,
    product: d.product,
    marketplace: d.marketplace,

    series: (d.offers ?? []).map((offer) => ({
      offer: { id: offer.offerId },
      seller: { id: offer.sellerId, name: offer.sellerName },
      observations: (offer.observations ?? []).map((o) => ({
        observationId: o.observationId,
        observedAt: o.observedAt,
        isInStock: o.isInStock,
        isBuyboxWinner: o.isBuyboxWinner,
        saleLabel: o.saleLabel,
        currencyCode: o.currencyCode,
        mrpMinor: o.mrpMinor,
        sellingPriceMinor: o.sellingPriceMinor,
        shippingFeeMinor: o.shippingFeeMinor,
        landedMinor: o.landedMinor,
        effectiveMinor: o.universalEffectiveMinor,
        conditionalBestMinor: o.conditionalBestMinor,
      })),
    })),

    /** Statistics over the daily series, computed server-side. */
    summary: body?.summary ?? null,
    window: body?.meta?.window ?? null,
    range: body?.meta?.range ?? null,
    referenceDate: body?.meta?.referenceDate ?? null,
    observationCount: body?.meta?.observationCount ?? 0,
    priceBasis: body?.meta?.priceBasis ?? PRICE_BASIS,
  };
}
