import { apiRequest } from "./http";
import { presentAnalysis } from "../utils/analysisPresenter";

/**
 * THE CROSS-MARKETPLACE ANALYSIS COMES FROM THE BACKEND.
 *
 * Phase 8 made `GET /api/v1/products/:id/analysis` the source of truth for the
 * analysis screen, finishing what Phase 7 started on the recommendation. The
 * browser now calculates no pricing decision anywhere.
 *
 * ── Why three requests ─────────────────────────────────────────────────
 * The screen makes one argument out of three things the backend keeps apart,
 * and keeping them apart is correct:
 *
 *   /analysis       the market, the competitors, the history, the findings
 *   /recommendation the prices those findings argue toward — the "therefore"
 *                   section, plus the attribute model stated as a finding
 *   /price-summary  the seven observation horizons the window selector offers
 *
 * They are fetched in parallel and composed by the presenter. Merging them
 * into one endpoint would couple a recommendation to an analysis that does not
 * need it, and Phase 5 deliberately split them the other way round.
 *
 * A recommendation can be refused while an analysis is perfectly good — that
 * is a normal state for a thin product, not an error, so the recommendation
 * request is allowed to come back refused without taking the page down.
 */

/** The seven horizons the window selector offers. */
const WINDOWS = ["1d", "2d", "3d", "7d", "15d", "1m", "3m"];

/**
 * GET the analysis, the recommendation and the price horizons for one product.
 *
 * Returns the presented view-model. Throws `ApiError` if the ANALYSIS cannot be
 * loaded — that is the page. A failing recommendation or price summary
 * degrades the sections that need them rather than the whole screen.
 */
export async function getCrossMarketplaceAnalysis(productId, { token, marketplace, signalWindow, signal } = {}) {
  const id = encodeURIComponent(productId);
  const scope = marketplace ? `&marketplace=${encodeURIComponent(marketplace)}` : "";
  const windows = WINDOWS.map((w) => `windows=${w}`).join("&");

  /**
   * The analysis is asked for the FULL observed history, not a window.
   *
   * The history section of this screen states the product's whole captured
   * series — "61 observations from 17 April" — and the historical finding is
   * a position within that range. The endpoint's default is a one-month
   * window, which would answer a narrower question than the screen asks: on
   * the golden product it reports 16 observations instead of 61, and turns a
   * premium-arguing finding neutral. The window SELECTOR on this page drives
   * the horizons panel, which is a different question and its own request.
   */
  const fullHistory = "from=0001-01-01";

  /**
   * The horizon the NON-PRICE parameters are measured over, which is the one
   * the window selector names — not the analysis range above. Availability and
   * promotional share are questions about a recent window; the history section
   * is a question about the whole series.
   */
  const signals = signalWindow ? `&signalWindow=${encodeURIComponent(signalWindow)}` : "";

  const [analysis, recommendation, horizons] = await Promise.all([
    apiRequest(`/products/${id}/analysis?${fullHistory}${scope}${signals}`, { token, signal }),
    // Allowed to fail: a refused recommendation is a real state this screen
    // renders, and a 404 on it must not blank an analysis that loaded fine.
    apiRequest(`/products/${id}/recommendation${scope ? `?${scope.slice(1)}` : ""}`, { token, signal }).catch((error) => {
      if (error?.name === "AbortError") throw error;
      return null;
    }),
    apiRequest(`/products/${id}/price-summary?${windows}`, { token, signal }).catch((error) => {
      if (error?.name === "AbortError") throw error;
      return null;
    }),
  ]);

  if (!analysis?.data) {
    throw new Error("The analysis service returned a response without any data.");
  }

  return presentAnalysis({ analysis, recommendation, horizons });
}
