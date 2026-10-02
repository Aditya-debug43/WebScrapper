import { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useAuth } from "../state/AuthContext";
import { getRecommendation } from "../api/recommendationService";
import RecommendationPanel from "../components/recommendation/RecommendationPanel";
import LoadingState from "../components/common/LoadingState";
import "./PricingRecommendation.css";

/**
 * The recommendation screen.
 *
 * Since Phase 7 the price comes from the backend and the browser calculates
 * nothing. The page therefore has to handle the things a network call can do
 * that a function call cannot — being slow, failing, or being refused — and
 * each of those has its own state below.
 *
 * The one rule that shapes all of them: **never show a price this page did not
 * receive.** No stale result while a new one loads, no locally computed
 * fallback when the request fails. A number on this screen is the backend's
 * answer or there is no number.
 */
export default function PricingRecommendation() {
  const { productId } = useOutletContext();
  const { token } = useAuth();
  const [state, setState] = useState({ status: "loading", rec: null, error: null });

  /**
   * Bumped to re-run the effect on a retry. A ref-and-state pair would work
   * too; this keeps the fetch in one place with the same cancellation.
   */
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  /** Guards against a slow response for a product the user has navigated away from. */
  const requestedFor = useRef(null);

  useEffect(() => {
    if (!productId) return undefined;
    const controller = new AbortController();
    const key = `${productId}:${attempt}`;
    requestedFor.current = key;

    // Clear first: a previous product's recommendation must not be on screen
    // while this one loads.
    setState({ status: "loading", rec: null, error: null });

    getRecommendation(productId, { token, signal: controller.signal })
      .then((rec) => {
        if (requestedFor.current !== key) return;
        setState({ status: "ready", rec, error: null });
      })
      .catch((error) => {
        if (error?.name === "AbortError" || requestedFor.current !== key) return;
        setState({ status: "error", rec: null, error });
      });

    return () => controller.abort();
  }, [productId, token, attempt]);

  if (state.status === "loading") return <LoadingState label="Building recommendation…" />;
  if (state.status === "error") return <RecommendationError error={state.error} onRetry={retry} />;

  // A refusal is a successful response, and the panel renders it: the backend
  // says what is missing and the screen says so too, rather than showing a
  // price nobody computed.
  return (
    <div className="pricing-recommendation">
      <RecommendationPanel rec={state.rec} />
    </div>
  );
}

/**
 * The request failed. Distinguished by code, because the actions differ: a
 * missing product is permanent, an expired session needs a sign-in, and a dead
 * network is worth retrying.
 *
 * Authentication is NOT handled here — an expired token is cleared by the API
 * layer and the route guard sends the user to sign in, which is the behaviour
 * every other authenticated screen already has. Reimplementing it on this page
 * would make this the one screen that logs out differently.
 */
function RecommendationError({ error, onRetry }) {
  const code = error?.code ?? "UNEXPECTED_ERROR";
  const notFound = code === "NOT_FOUND";
  const offline = code === "NETWORK_ERROR";

  return (
    <div className="rec-root">
      <section className="card rec-refusal">
        <header>
          <span className="rec-refusal-icon conflict">
            <AlertTriangle size={18} strokeWidth={2} />
          </span>
          <div>
            <h2>
              {notFound
                ? "This product could not be found"
                : offline
                  ? "Could not reach the pricing service"
                  : "The recommendation could not be loaded"}
            </h2>
            <p>{error?.message ?? "Something went wrong while building the recommendation."}</p>
          </div>
        </header>

        <p className="rec-refusal-note">
          No price is shown because none was received. The recommendation is computed server-side from the captured
          market, and a figure invented here to fill the gap would look exactly as authoritative as a real one.
        </p>

        {!notFound && (
          <button type="button" className="rec-retry" onClick={onRetry}>
            <RefreshCw size={13} strokeWidth={2} />
            Try again
          </button>
        )}
      </section>
    </div>
  );
}
