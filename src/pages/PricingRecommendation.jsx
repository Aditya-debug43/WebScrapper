import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { useAsyncData } from "../utils/useAsyncData";
import { useAuth } from "../state/AuthContext";
import {
  getRecommendation,
  getBackendRecommendation,
  compareRecommendations,
} from "../api/recommendationService";
import RecommendationPanel from "../components/recommendation/RecommendationPanel";
import LoadingState from "../components/common/LoadingState";
import "./PricingRecommendation.css";

/**
 * The panel still renders the LOCAL engine, deliberately.
 *
 * Phase 6 moved the pricing engine to the backend and proved parity, but the
 * backend emits structured factors where this panel renders composed prose,
 * so switching the source outright would mean redesigning the panel. Instead
 * the page consumes the backend alongside the engine and reports whether the
 * two agree — which demonstrates the endpoint works end to end, keeps the
 * engine as the oracle it is supposed to be until the migration is proven in
 * production, and changes nothing about what the user sees.
 */
export default function PricingRecommendation() {
  const { productId } = useOutletContext();
  const { token } = useAuth();
  const { data: rec, loading } = useAsyncData(() => getRecommendation(productId), [productId]);
  const [backend, setBackend] = useState({ state: "idle", comparison: null, message: null });

  useEffect(() => {
    // Signed out, no backend to ask. The page is unchanged in that case.
    if (!token || !rec) {
      setBackend({ state: "idle", comparison: null, message: null });
      return undefined;
    }
    const controller = new AbortController();
    setBackend({ state: "loading", comparison: null, message: null });

    getBackendRecommendation(productId, { token, signal: controller.signal })
      .then((payload) => {
        const comparison = compareRecommendations(rec, payload?.data);
        setBackend({ state: "ready", comparison, message: payload?.meta?.modelVersion ?? null });
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        // A backend that is unreachable must not break the page: the panel
        // above is rendered from the engine and does not depend on it.
        setBackend({ state: "error", comparison: null, message: error?.message ?? "unavailable" });
      });

    return () => controller.abort();
  }, [productId, token, rec]);

  if (loading || !rec) return <LoadingState label="Building recommendation…" />;

  return (
    <div className="pricing-recommendation">
      <SourceStrip backend={backend} />
      <RecommendationPanel rec={rec} />
    </div>
  );
}

/** One line: which engine produced these numbers, and does the backend agree? */
function SourceStrip({ backend }) {
  if (backend.state === "idle" || backend.state === "loading") return null;

  if (backend.state === "error") {
    return (
      <p className="rec-source rec-source--muted">
        <AlertTriangle size={13} strokeWidth={2} />
        Showing the in-app engine. The backend recommendation API could not be reached ({backend.message}).
      </p>
    );
  }

  const { agrees, comparedCount, differences } = backend.comparison ?? {};
  if (agrees) {
    return (
      <p className="rec-source rec-source--agrees">
        <CheckCircle2 size={13} strokeWidth={2} />
        Backend <code>{backend.message}</code> agrees with the in-app engine on all {comparedCount} compared values.
      </p>
    );
  }

  return (
    <p className="rec-source rec-source--differs">
      <AlertTriangle size={13} strokeWidth={2} />
      Backend <code>{backend.message}</code> differs on{" "}
      {differences.map((d) => `${d.field} (${d.local} vs ${d.backend})`).join(", ")}.
    </p>
  );
}
