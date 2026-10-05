import { apiRequest } from "./http";
import { backendWindowKey } from "../utils/observationWindowDefs";

export { OBSERVATION_WINDOWS, DEFAULT_WINDOW_KEY } from "../utils/observationWindowDefs";

/**
 * THE DESK, FROM THE BACKEND.
 *
 * Three things changed in the move, and the third is the reason for the
 * other two.
 *
 * 1. ONE REQUEST, NOT THREE. The page used to call for summaries, alerts and
 *    portfolio totals separately, and each of those independently recomputed
 *    the same per-product window statistics over the bundled dataset. The
 *    same work three times, and three results that could in principle
 *    disagree. They are one server-side computation now and arrive together.
 *
 * 2. NO DEFAULT SET IN THE BROWSER. `DEFAULT_TRACKED_PRODUCT_IDS` used to be
 *    `demoSetIds()` — a stratified sample chosen by profiling all 1,172
 *    products on reach, capture depth and competitive density. That single
 *    export was the largest reason the frontend needed the whole catalogue at
 *    runtime: choosing twelve products required reading every one of them.
 *    The backend picks the set now, by the same method, and the caller simply
 *    does not pass any ids.
 *
 * 3. NO FALLBACK. If the API fails, this throws. It does not quietly serve a
 *    bundled desk, because a desk that silently stops reflecting the database
 *    is worse than a desk that says it is broken.
 *
 * The honest-refusal behaviour survives intact: at this catalogue's capture
 * cadence a one-day window holds a single observation for most products, and
 * a single observation is a price level and not a movement. Such a product
 * comes back with a capability and a null change, and the page is expected to
 * respect that rather than print a change of zero.
 */

/**
 * Everything the desk renders, in one call.
 *
 * @param {object}   [options]
 * @param {string}   [options.token]       Session token; the endpoint is authenticated.
 * @param {string[]} [options.productIds]  Omit to let the backend decide — the
 *                                         user's tracked products, or the
 *                                         stratified default if they have none.
 * @param {string}   [options.windowKey]   Observation horizon, in the
 *                                         interface's own vocabulary (`d30`).
 * @param {AbortSignal} [options.signal]
 */
export async function getDesk({ token, productIds, windowKey, signal } = {}) {
  const params = new URLSearchParams();
  if (productIds?.length) params.set("products", productIds.join(","));
  // The interface names this horizon `d30` and the API names it `1m`. The
  // translation belongs here, not at the call site — sending the interface's
  // key straight through is a 400, and a screen should not have to know that.
  if (windowKey) params.set("window", backendWindowKey(windowKey));
  const query = params.toString();

  const body = await apiRequest(`/dashboard${query ? `?${query}` : ""}`, { token, signal });
  return body?.data ?? body;
}
