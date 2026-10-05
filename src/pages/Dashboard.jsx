import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Package, Store, TrendingUp, BellRing, Search, ArrowRight } from "lucide-react";
import { useAppState } from "../state/AppStateContext";
import { useAuth } from "../state/AuthContext";
import { useAsyncData } from "../utils/useAsyncData";
import { getDesk, OBSERVATION_WINDOWS, DEFAULT_WINDOW_KEY } from "../api/dashboardService";
import MetricCard from "../components/common/MetricCard";
import StatusBadge from "../components/common/StatusBadge";
import LoadingState from "../components/common/LoadingState";
import Breadcrumbs from "../components/common/Breadcrumbs";
import FilterControl from "../components/common/FilterControl";
import { formatMinor, formatPct } from "../utils/money";
import "./Dashboard.css";

/**
 * The desk.
 *
 * Two things changed here after review. The set is no longer two hand-picked
 * products but a stratified sample chosen by `utils/demoSet`, and the
 * observation period is no longer a fixed seven days but one of seven
 * horizons — with the honest consequence made visible, because at the short
 * end most products carry a single observation and therefore no movement at
 * all. The capability column is not decoration; it is the reason a change
 * cell is sometimes empty.
 */

const TIER_LABEL = {
  strong: "Strong",
  moderate: "Moderate",
  thin: "Thin",
  refused: "Refusal case",
};

const CAPABILITY_STATUS = {
  distributional: "good",
  directional: "neutral",
  snapshot: "warning",
  none: "critical",
};

const CAPABILITY_LABEL = {
  distributional: "Full",
  directional: "Direction",
  snapshot: "Snapshot",
  none: "None",
};

/**
 * The API reports percentages as percentages; `formatPct` takes a fraction.
 * Converted here, once, rather than scattering `/ 100` through the markup —
 * a missed one shows a 9% move as 895%.
 */
const asFraction = (pct) => (pct == null ? null : pct / 100);

export default function Dashboard() {
  const { token } = useAuth();
  const { requestedProductIds, adoptResolvedIds } = useAppState();
  const [params, setParams] = useSearchParams();
  const windowKey = OBSERVATION_WINDOWS.some((w) => w.key === params.get("w"))
    ? params.get("w")
    : DEFAULT_WINDOW_KEY;

  /**
   * One request, not three.
   *
   * The summaries, the alerts and the portfolio totals are three views of a
   * single calculation and now arrive as one — previously each call
   * recomputed the same per-product window statistics independently.
   */
  const { data: desk, loading, error } = useAsyncData(
    () => getDesk({ token, productIds: requestedProductIds, windowKey }),
    [token, requestedProductIds, windowKey]
  );

  useEffect(() => {
    if (desk) adoptResolvedIds(desk.tracked.map((t) => t.product.id));
  }, [desk, adoptResolvedIds]);

  const summaries = desk?.tracked ?? null;
  const alerts = desk?.alerts ?? null;
  const portfolio = desk?.portfolio ? { ...desk.portfolio, asOf: desk.asOf } : null;

  const setWindow = (key) => {
    const next = new URLSearchParams(params);
    if (key === DEFAULT_WINDOW_KEY) next.delete("w");
    else next.set("w", key);
    setParams(next, { replace: false });
  };

  /**
   * An outage is shown, never papered over.
   *
   * The desk used to be computed in the browser and so could not fail; now
   * it can. Rendering an empty desk on an error would be indistinguishable
   * from a user who tracks nothing, which is how a broken deployment comes
   * to look healthy.
   */
  if (error) {
    return (
      <div className="page">
        <Breadcrumbs items={[{ label: "Dashboard" }]} />
        <div className="pw-missing">
          <span className="eyebrow">Unavailable</span>
          <h1 className="page-title">The desk could not be loaded</h1>
          <p className="page-subtitle">{error.message}</p>
          <Link to="/catalogue" className="btn btn-primary pw-missing-cta">
            Browse the catalogue <ArrowRight size={14} strokeWidth={2} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: "Dashboard" }]} />
      <div className="page-head">
        <div>
          <h1 className="page-title">Your desk</h1>
          <p className="page-subtitle">
            A stratified set of products spanning strong, moderate, thin and refused evidence — read at whichever
            observation horizon you choose.
          </p>
        </div>
        <Link to="/catalogue" className="btn btn-primary">
          <Search size={15} strokeWidth={2} /> Find a product
        </Link>
      </div>

      {/* ------------------------------ horizon ------------------------------ */}
      <section className="desk-window">
        <div className="desk-window-head">
          <span className="eyebrow">Observation window</span>
          {portfolio && (
            <span className="desk-window-asof">
              as of <span className="tabular">{portfolio.asOf}</span>, the most recent capture in the dataset
            </span>
          )}
        </div>
        <div className="scroll-x desk-window-scroll">
          <FilterControl
            options={OBSERVATION_WINDOWS.map((w) => ({ value: w.key, label: w.label }))}
            value={windowKey}
            onChange={setWindow}
            ariaLabel="Observation window"
          />
        </div>
        {portfolio && (
          <p className="desk-window-note">
            Over {portfolio.windowLabel.toLowerCase()},{" "}
            <strong className="tabular">{portfolio.directionalCount}</strong> of{" "}
            <strong className="tabular">{portfolio.trackedCount}</strong> products carry enough observations to show a
            direction
            {portfolio.snapshotCount > 0 && (
              <>
                {" "}
                — <strong className="tabular">{portfolio.snapshotCount}</strong> hold only a single observation, which
                is a price level and not a movement
              </>
            )}
            .
          </p>
        )}
      </section>

      <div className="dash-metrics stagger">
        <MetricCard
          label="Products on the desk"
          value={portfolio?.trackedCount ?? "—"}
          icon={Package}
          sublabel="stratified across evidence tiers"
        />
        <MetricCard
          label="Marketplace coverage"
          value={portfolio ? `${portfolio.marketplaceCoverage} / ${portfolio.marketplaceTotal}` : "—"}
          icon={Store}
          sublabel="platforms represented"
        />
        <MetricCard
          label={`Avg. movement · ${portfolio?.windowLabel ?? ""}`}
          value={portfolio?.avgChangePct != null ? formatPct(asFraction(portfolio.avgChangePct), { signed: true }) : "—"}
          icon={TrendingUp}
          trend="up-is-bad"
          delta={portfolio?.avgChangePct != null ? formatPct(asFraction(portfolio.avgChangePct), { signed: true }) : null}
          sublabel={
            portfolio
              ? `across the ${portfolio.directionalCount} with a direction`
              : "across products with a direction"
          }
        />
        <MetricCard
          label="Active alerts"
          value={alerts?.length ?? "—"}
          icon={BellRing}
          sublabel={portfolio ? portfolio.windowLabel.toLowerCase() : ""}
        />
      </div>

      <div className="dash-grid">
        <section>
          <div className="section-head">
            <h2 className="section-title">The set</h2>
          </div>

          {loading && <LoadingState label="Reading observations…" />}

          {!loading && summaries?.length === 0 && (
            <div className="dash-empty">
              <p>No products on the desk.</p>
              <Link to="/catalogue" className="btn btn-secondary btn-sm">
                Browse the catalogue
              </Link>
            </div>
          )}

          {!loading && summaries?.length > 0 && (
            <div className="scroll-x">
              <table className="desk-table">
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Evidence</th>
                    <th scope="col" className="num">Platforms</th>
                    <th scope="col" className="num">Obs.</th>
                    <th scope="col">Supports</th>
                    <th scope="col" className="num">Price</th>
                    <th scope="col" className="num">Change</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((s) => (
                    <tr key={s.product.id}>
                      <th scope="row">
                        <Link to={`/products/${s.product.id}/analysis`} className="desk-name">
                          {s.product.canonicalName}
                        </Link>
                        <span className="desk-sub">
                          {s.product.brandName}
                          {s.product.categoryName ? ` · ${s.product.categoryName}` : ""}
                        </span>
                      </th>
                      <td>
                        <span className={`desk-tier ${s.expectedTier ?? "thin"}`}>
                          {TIER_LABEL[s.expectedTier] ?? "—"}
                        </span>
                      </td>
                      <td className="num tabular">{s.marketplaceCount}</td>
                      <td className="num tabular">{s.observationCount}</td>
                      <td>
                        <StatusBadge status={CAPABILITY_STATUS[s.capability] ?? "neutral"}>
                          {CAPABILITY_LABEL[s.capability] ?? s.capability}
                        </StatusBadge>
                      </td>
                      <td className="num tabular">
                        {s.currentPriceMinor != null ? formatMinor(s.currentPriceMinor) : "—"}
                      </td>
                      <td className="num tabular">
                        {s.changePct != null ? (
                          <span className={s.changePct > 0 ? "up" : s.changePct < 0 ? "down" : ""}>
                            {formatPct(asFraction(s.changePct), { signed: true })}
                          </span>
                        ) : (
                          <span className="desk-none" title={s.withheld?.[0]?.reason ?? ""}>
                            not established
                          </span>
                        )}
                      </td>
                      <td className="desk-go">
                        <Link to={`/products/${s.product.id}/analysis`} aria-label={`Analyse ${s.product.canonicalName}`}>
                          <ArrowRight size={14} strokeWidth={2} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="desk-note">
            <strong>Evidence</strong> is the structural tier the product was selected into — marketplace reach, capture
            depth and how many candidate comparables share its type and price band. <strong>Supports</strong> is what
            the chosen window can actually carry: a snapshot is one observation, a direction needs two, and a
            distribution needs five.
          </p>
        </section>

        <section>
          <div className="section-head">
            <h2 className="section-title">Alerts</h2>
          </div>
          <div className="dash-alerts">
            {alerts?.length === 0 && (
              <p className="dash-alerts-empty">
                Nothing moved more than {portfolio?.alertThresholdPct ?? 4}% over{" "}
                {portfolio?.windowLabel.toLowerCase() ?? "this window"}. Windows that
                hold a single observation cannot raise an alert at all.
              </p>
            )}
            {alerts?.map((a) => (
              <div className="dash-alert-row" key={a.id}>
                <StatusBadge status={a.severity}>{a.type === "price_drop" ? "Drop" : "Rise"}</StatusBadge>
                <p>{a.message}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
