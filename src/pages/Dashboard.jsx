import { Link, useSearchParams } from "react-router-dom";
import { Package, Store, TrendingUp, BellRing, Search, ArrowRight } from "lucide-react";
import { useAppState } from "../state/AppStateContext";
import { useAsyncData } from "../utils/useAsyncData";
import {
  getTrackedProductsSummary,
  getPriceAlerts,
  getPortfolioPosition,
  OBSERVATION_WINDOWS,
  DEFAULT_WINDOW_KEY,
} from "../api/dashboardService";
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

export default function Dashboard() {
  const { trackedProductIds } = useAppState();
  const [params, setParams] = useSearchParams();
  const windowKey = OBSERVATION_WINDOWS.some((w) => w.key === params.get("w"))
    ? params.get("w")
    : DEFAULT_WINDOW_KEY;

  const { data: summaries, loading } = useAsyncData(
    () => getTrackedProductsSummary(trackedProductIds, windowKey),
    [trackedProductIds, windowKey]
  );
  const { data: alerts } = useAsyncData(
    () => getPriceAlerts(trackedProductIds, windowKey),
    [trackedProductIds, windowKey]
  );
  const { data: portfolio } = useAsyncData(
    () => getPortfolioPosition(trackedProductIds, windowKey),
    [trackedProductIds, windowKey]
  );

  const setWindow = (key) => {
    const next = new URLSearchParams(params);
    if (key === DEFAULT_WINDOW_KEY) next.delete("w");
    else next.set("w", key);
    setParams(next, { replace: false });
  };

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
          value={portfolio?.avgChangePct != null ? formatPct(portfolio.avgChangePct, { signed: true }) : "—"}
          icon={TrendingUp}
          trend="up-is-bad"
          delta={portfolio?.avgChangePct != null ? formatPct(portfolio.avgChangePct, { signed: true }) : null}
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
                          {s.brand?.name}
                          {s.profile?.categoryName ? ` · ${s.profile.categoryName}` : ""}
                        </span>
                      </th>
                      <td>
                        <span className={`desk-tier ${s.profile?.expectedTier ?? "thin"}`}>
                          {TIER_LABEL[s.profile?.expectedTier] ?? "—"}
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
                            {formatPct(s.changePct, { signed: true })}
                          </span>
                        ) : (
                          <span className="desk-none" title={s.window?.withheld?.[0]?.reason ?? ""}>
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
                Nothing moved more than 4% over {portfolio?.windowLabel.toLowerCase() ?? "this window"}. Windows that
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
