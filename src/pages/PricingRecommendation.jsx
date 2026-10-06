import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { AlertTriangle, RefreshCw, Sparkles, Calculator } from "lucide-react";
import { useAuth } from "../state/AuthContext";
import { getMarketRecommendation } from "../api/discoveryService";
import LoadingState from "../components/common/LoadingState";
import { formatMinor } from "../utils/money";
import "./PricingRecommendation.css";

/**
 * THE RECOMMENDATION SCREEN
 * =========================
 *
 * Priced from real market evidence, and honest about how much of it there is.
 *
 * The change that matters here: a product tracked ten minutes ago used to get
 * nothing, because the old engine needed catalogue comparables and a price
 * history to position against. But one capture already contains what a price
 * has to be argued against — what every marketplace is charging right now —
 * and that is enough for a defensible first answer.
 *
 * So the page shows which evidence was available rather than hiding it:
 *
 *   COLD START        positioned against the current market alone
 *   HISTORY-ENHANCED  against the market AND where this product has traded
 *
 * and separately, which method produced the number:
 *
 *   AI             a model weighed the evidence
 *   DETERMINISTIC  the statistical position, with no model involved
 *
 * Those two are never blurred. A deterministic figure presented as an AI
 * judgement would misrepresent how it was reached, and the fallback exists
 * precisely so an AI outage does not fabricate anything.
 *
 * The standing rule survives: never show a price this page did not receive.
 */

const CONFIDENCE_COPY = {
  low: "Thin evidence — treat as a starting point.",
  medium: "Reasonable evidence across several marketplaces.",
  high: "Broad current market and real observed history.",
};

export default function PricingRecommendation() {
  const { productId } = useOutletContext();
  const { token } = useAuth();
  const [state, setState] = useState({ status: "loading", rec: null, error: null });

  const load = useCallback(
    async (refresh = false) => {
      setState({ status: "loading", rec: null, error: null });
      try {
        const rec = await getMarketRecommendation(productId, { token, refresh });
        setState({ status: "ready", rec, error: null });
      } catch (error) {
        setState({ status: "failed", rec: null, error });
      }
    },
    [productId, token]
  );

  useEffect(() => {
    load();
  }, [load]);

  if (state.status === "loading") return <LoadingState label="Reading the market…" />;

  if (state.status === "failed") {
    return (
      <div className="pr-unavailable">
        <AlertTriangle size={18} strokeWidth={2} />
        <h2>No recommendation</h2>
        <p>{state.error.message}</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => load()}>
          <RefreshCw size={13} strokeWidth={2} /> Try again
        </button>
      </div>
    );
  }

  const rec = state.rec;

  /**
   * Refused, with the reason.
   *
   * Reached when the current market is too thin as well — not merely when
   * history is missing. No number is offered at all, rather than a weak one
   * dressed in caveats.
   */
  if (!rec.available) {
    return (
      <div className="pr-unavailable">
        <AlertTriangle size={18} strokeWidth={2} />
        <h2>Insufficient real market evidence</h2>
        <p>{rec.message}</p>
        <dl className="pr-evidence-grid">
          <div>
            <dt>Usable offers</dt>
            <dd className="tabular">{rec.evidence.usableOffers}</dd>
          </div>
          <div>
            <dt>Marketplaces</dt>
            <dd className="tabular">{rec.evidence.marketplaces}</dd>
          </div>
          <div>
            <dt>Observations</dt>
            <dd className="tabular">{rec.evidence.historyObservations}</dd>
          </div>
        </dl>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => load(true)}>
          <RefreshCw size={13} strokeWidth={2} /> Refresh the market
        </button>
      </div>
    );
  }

  const coldStart = rec.mode === "cold_start";

  return (
    <div className="pr-layout">
      <section className="pr-headline">
        <div className="pr-badges">
          <span className={`pr-mode ${coldStart ? "cold" : "enhanced"}`}>
            {coldStart ? "Cold start" : "History-enhanced"}
          </span>
          <span className="pr-method">
            {rec.method === "ai" ? (
              <>
                <Sparkles size={12} strokeWidth={2} /> {rec.ai.provider} · {rec.ai.model}
              </>
            ) : (
              <>
                <Calculator size={12} strokeWidth={2} /> Deterministic
              </>
            )}
          </span>
        </div>

        <p className="eyebrow">Recommended price</p>
        <p className="pr-price tabular">{formatMinor(rec.recommendedPriceMinor)}</p>
        <p className="pr-range tabular">
          {formatMinor(rec.rangeMinMinor)} – {formatMinor(rec.rangeMaxMinor)}
        </p>
        <p className="pr-confidence">
          <strong>{rec.confidence}</strong> confidence — {CONFIDENCE_COPY[rec.confidence]}
        </p>
      </section>

      <section className="pr-section">
        <h3 className="section-title">Current market</h3>
        <dl className="pr-evidence-grid">
          <div>
            <dt>Lowest</dt>
            <dd className="tabular">{formatMinor(rec.market.minMinor)}</dd>
          </div>
          <div>
            <dt>Median</dt>
            <dd className="tabular">{formatMinor(rec.market.medianMinor)}</dd>
          </div>
          <div>
            <dt>Highest</dt>
            <dd className="tabular">{formatMinor(rec.market.maxMinor)}</dd>
          </div>
          <div>
            <dt>Offers</dt>
            <dd className="tabular">{rec.market.offerCount}</dd>
          </div>
          <div>
            <dt>Marketplaces</dt>
            <dd className="tabular">{rec.market.marketplaceCount}</dd>
          </div>
        </dl>
        <p className="pr-captured">
          Captured <span className="tabular">{new Date(rec.market.capturedAt).toLocaleString("en-IN")}</span>
          {rec.market.reused && " · reused, not re-fetched"}
        </p>
      </section>

      <section className="pr-section">
        <h3 className="section-title">Observed history</h3>
        {rec.history ? (
          <dl className="pr-evidence-grid">
            <div>
              <dt>Observations</dt>
              <dd className="tabular">{rec.history.observationCount}</dd>
            </div>
            <div>
              <dt>Median</dt>
              <dd className="tabular">{formatMinor(rec.history.medianMinor)}</dd>
            </div>
            <div>
              <dt>Change</dt>
              {/* One point is a level, not a movement — so it says so. */}
              <dd className="tabular">
                {rec.history.changePct != null ? `${rec.history.changePct.toFixed(1)}%` : "not established"}
              </dd>
            </div>
            <div>
              <dt>First seen</dt>
              <dd className="tabular">{rec.history.firstObservedAt}</dd>
            </div>
          </dl>
        ) : (
          <p className="pr-none">
            No observations yet. History begins with the first capture and grows from there — nothing is
            backfilled.
          </p>
        )}
      </section>

      {rec.method === "ai" && rec.ai.reasoning && (
        <section className="pr-section">
          <h3 className="section-title">Reasoning</h3>
          <p className="pr-reasoning">{rec.ai.reasoning}</p>
          <p className="pr-captured">
            Generated <span className="tabular">{new Date(rec.ai.generatedAt).toLocaleString("en-IN")}</span>
          </p>
        </section>
      )}

      <section className="pr-section">
        <h3 className="section-title">Statistical position</h3>
        {/*
          * Always shown, even when the AI produced the headline figure, so the
          * two can be compared rather than one quietly replacing the other.
          */}
        <p className="pr-deterministic tabular">{formatMinor(rec.deterministic.recommendedMinor)}</p>
        <ul className="pr-factors">
          {rec.deterministic.factors.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </section>

      {rec.warnings.length > 0 && (
        <section className="pr-section">
          <h3 className="section-title">What to keep in mind</h3>
          <ul className="pr-warnings">
            {rec.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <button type="button" className="btn btn-secondary btn-sm" onClick={() => load(true)}>
        <RefreshCw size={13} strokeWidth={2} /> Refresh the market
      </button>
    </div>
  );
}
