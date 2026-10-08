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
 * Follow a product's MARKET, from a result the user picked.
 *
 * The result identifies which product is meant; it is not the thing being
 * tracked. The backend resolves it to a catalogue identity, opens that
 * product's competing sellers across every catalogue id it is published
 * under, and stores them. The response says how many sellers and
 * marketplaces that turned out to be, and what it cost.
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

/**
 * A PRODUCT'S COMPETITIVE MARKET: every seller, every marketplace, the
 * distribution, and this system's own captured history.
 *
 * Free to call. It reads stored evidence and touches no provider, so a
 * seller can keep this open, sort it and compare marketplaces without
 * spending anything. Re-reading the market is a separate, deliberate act —
 * `captureMarket` below.
 *
 * @param {string} productId
 * @param {{ token?: string, yourPrice?: number, signal?: AbortSignal }} [options]
 *   `yourPrice` is in MAJOR units, as a seller would type it, and asks "if I
 *   listed at this, where would I stand?". It is a question, not a stored fact.
 */
export async function getProductMarket(productId, { token, yourPrice, signal } = {}) {
  const params = new URLSearchParams();
  if (yourPrice != null && Number.isFinite(yourPrice)) params.set("yourPrice", String(yourPrice));
  const query = params.toString();

  const body = await apiRequest(
    `/products/${encodeURIComponent(productId)}/market${query ? `?${query}` : ""}`,
    { token, signal }
  );
  return body?.data ?? body;
}

/** Each competing seller's own price series, from this system's captures. */
export async function getSellerHistory(productId, { token, days, signal } = {}) {
  const query = days == null ? "" : `?days=${encodeURIComponent(days)}`;
  const body = await apiRequest(`/products/${encodeURIComponent(productId)}/market/sellers${query}`, {
    token,
    signal,
  });
  return body?.data ?? body;
}

/**
 * Re-read this product's market now.
 *
 * The operation that spends provider calls — one per catalogue id. It
 * returns what it cost beside what it found, so the spend is visible where
 * it happens rather than only in a monthly total.
 */
export async function captureMarket(productId, { token, clusterLimit, force, signal } = {}) {
  const body = await apiRequest(`/products/${encodeURIComponent(productId)}/capture`, {
    method: "POST",
    body: { ...(clusterLimit == null ? {} : { clusterLimit }), ...(force ? { force: true } : {}) },
    token,
    signal,
  });
  return body?.data ?? body;
}

/**
 * The recommended selling price, argued from the competition above.
 *
 * @param {{ yourPrice?: number }} [options] The seller's own intended price,
 *   in major units, so the answer can say where it would place them.
 */
export async function getRecommendedPrice(productId, { token, refresh, yourPrice, signal } = {}) {
  const params = new URLSearchParams();
  if (refresh) params.set("refresh", "true");
  if (yourPrice != null && Number.isFinite(yourPrice)) params.set("yourPrice", String(yourPrice));
  const query = params.toString();

  const body = await apiRequest(
    `/products/${encodeURIComponent(productId)}/recommended-price${query ? `?${query}` : ""}`,
    { token, signal }
  );
  return body?.data ?? body;
}

/** Provider usage, so the cost of all this is visible. */
export async function getMarketUsage({ token, signal } = {}) {
  const body = await apiRequest("/market/usage", { token, signal });
  return body?.data ?? body;
}
