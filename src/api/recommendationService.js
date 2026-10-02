import { apiRequest } from "./http";
import { presentRecommendation } from "../utils/recommendationPresenter";

/**
 * THE RECOMMENDATION COMES FROM THE BACKEND.
 *
 * Phase 7 made `GET /api/v1/products/:id/recommendation` the source of truth.
 * The browser no longer decides a price: it asks, and it presents the answer.
 *
 * ── What changed, and why it matters ───────────────────────────────────
 * Until Phase 7 this module called `buildRecommendation()` and the browser ran
 * the whole pricing engine — anchor, constraints, hedonic regression, the
 * strategies — against an in-memory copy of the catalogue. The backend ran the
 * same logic and the two were asserted to agree. Two implementations that
 * agree today are still two implementations, and the Phase 7 integration found
 * what that costs: the backend's product-strength weights had been wrong since
 * Phase 5 (0.2/0.3 where the engine uses 0.15/0.35) and nothing noticed,
 * because no price depended on them and the screen was reading its own copy.
 *
 * There is now one pricing decision in this system, and it is made server-side.
 *
 * ── The engine is test-only now ────────────────────────────────────────
 * `src/utils/pricingEngine.js` is NOT imported here, or anywhere else on the
 * runtime path. It survives as the oracle the backend is measured against —
 * see `tests/recommendation-presenter.test.js`, which asserts the screen reads
 * identically either way, and `tests/no-runtime-pricing-engine.test.js`, which
 * fails if the engine ever creeps back into the bundle.
 */

/**
 * GET /api/v1/products/:id/recommendation
 *
 * Returns the presented recommendation — the backend's figures, with the
 * sentences the panel renders composed from them. Throws `ApiError` for
 * anything that goes wrong, including an unreachable server, so a caller never
 * has to distinguish "the server said no" from "fetch threw".
 *
 * `model` selects the recommendation model and is omitted by default, which
 * lets the SERVER decide the default (`baseline-v1`). Hard-coding it here would
 * mean a backend change needed a frontend release to take effect.
 */
export async function getRecommendation(productId, { token, model, marketplace, signal } = {}) {
  const query = new URLSearchParams();
  if (model) query.set("model", model);
  if (marketplace) query.set("marketplace", marketplace);
  const suffix = query.toString() ? `?${query}` : "";

  const payload = await apiRequest(`/products/${encodeURIComponent(productId)}/recommendation${suffix}`, {
    token,
    signal,
  });

  /**
   * A response that parsed but is not a recommendation is a contract failure,
   * not something to work around. Presenting a half-answer would put a
   * confident-looking screen in front of data that does not support it, which
   * is the failure this whole design exists to prevent.
   */
  if (!payload?.data?.status) {
    throw new Error("The recommendation service returned a response without a status.");
  }

  return presentRecommendation(payload);
}
