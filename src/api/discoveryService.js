import { apiRequest } from "./http";

/**
 * LIVE DISCOVERY
 * ==============
 *
 * Search asks the market, not our database.
 *
 * The old catalogue could only find what had been seeded, so searching for
 * anything else returned nothing while the provider would happily have
 * answered. Products were the input to matching and never its output, which
 * meant the catalogue could not grow from real data at all.
 *
 * Nothing here falls back to bundled data. A provider outage surfaces as an
 * outage, because a screen that quietly substitutes invented products during
 * one is worse than a screen that says it is broken.
 */

/**
 * The current market for a query.
 *
 * Costs a provider call only when nothing fresh is stored — the backend
 * reuses recent captures and coalesces concurrent identical searches, so
 * typing the same thing twice is free.
 *
 * @param {string} query
 * @param {{ token?: string, limit?: number, refresh?: boolean, signal?: AbortSignal }} [options]
 */
export async function searchMarket(query, { token, limit, refresh, signal } = {}) {
  const params = new URLSearchParams({ q: query });
  if (limit != null) params.set("limit", String(limit));
  if (refresh) params.set("refresh", "true");

  const body = await apiRequest(`/search?${params}`, { token, signal });
  return body?.data ?? body;
}

/**
 * Follow a product, from a result the user picked.
 *
 * Sends only the signed reference the backend issued. Deliberately not the
 * title or the price: what the browser displayed is a copy, and the capture
 * is the record. A client that could post its own figures could ask to track
 * a product at a price nobody ever offered.
 *
 * @param {string} ref  The `ref` from a search result.
 */
export async function trackResult(ref, { token, signal } = {}) {
  const body = await apiRequest("/tracked", { method: "POST", body: { ref }, token, signal });
  return body?.data ?? body;
}

/** What this user follows, with the latest real price for each. */
export async function getTracked({ token, signal } = {}) {
  const body = await apiRequest("/tracked", { token, signal });
  return body?.data ?? body;
}

export async function untrack(trackingId, { token, signal } = {}) {
  const body = await apiRequest(`/tracked/${encodeURIComponent(trackingId)}`, {
    method: "DELETE",
    token,
    signal,
  });
  return body?.data ?? body;
}

/**
 * A price recommendation from real market evidence.
 *
 * Works with no price history at all: one capture already contains what a
 * price has to be argued against. The response says which mode it used —
 * `cold_start` or `history_enhanced` — and whether the number came from the
 * AI layer or the deterministic one, so the interface never has to guess.
 */
export async function getMarketRecommendation(productId, { token, refresh, signal } = {}) {
  const query = refresh ? "?refresh=true" : "";
  const body = await apiRequest(`/products/${encodeURIComponent(productId)}/market-recommendation${query}`, {
    token,
    signal,
  });
  return body?.data ?? body;
}

/** Provider usage, so the cost of all this is visible. */
export async function getMarketUsage({ token, signal } = {}) {
  const body = await apiRequest("/market/usage", { token, signal });
  return body?.data ?? body;
}
