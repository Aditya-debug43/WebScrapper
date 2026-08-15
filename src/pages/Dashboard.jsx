import { Link } from "react-router-dom";
import { Package, Store, TrendingUp, BellRing, Search, X } from "lucide-react";
import { useAppState } from "../state/AppStateContext";
import { useAsyncData } from "../utils/useAsyncData";
import { getTrackedProductsSummary, getPriceAlerts, getPortfolioPosition } from "../api/dashboardService";
import MetricCard from "../components/common/MetricCard";
import StatusBadge from "../components/common/StatusBadge";
import LoadingState from "../components/common/LoadingState";
import Breadcrumbs from "../components/common/Breadcrumbs";
import { formatMinor, formatPct } from "../utils/money";
import "./Dashboard.css";

export default function Dashboard() {
  const { trackedProductIds, toggleTracked } = useAppState();
  const { data: summaries, loading } = useAsyncData(
    () => getTrackedProductsSummary(trackedProductIds),
    [trackedProductIds]
  );
  const { data: alerts } = useAsyncData(() => getPriceAlerts(trackedProductIds), [trackedProductIds]);
  const { data: portfolio } = useAsyncData(() => getPortfolioPosition(trackedProductIds), [trackedProductIds]);

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: "Dashboard" }]} />
      <div className="page-head">
        <div>
          <h1 className="page-title">Welcome back</h1>
          <p className="page-subtitle">
            Your tracked products, what moved this week, and where to look next.
          </p>
        </div>
        <Link to="/catalogue" className="btn btn-primary">
          <Search size={15} strokeWidth={2} /> Find a product
        </Link>
      </div>

      <div className="dash-metrics">
        <MetricCard
          label="Tracked products"
          value={portfolio?.trackedCount ?? "—"}
          icon={Package}
          sublabel="across the catalogue"
        />
        <MetricCard
          label="Marketplace coverage"
          value={portfolio ? `${portfolio.marketplaceCoverage} / ${portfolio.marketplaceTotal}` : "—"}
          icon={Store}
          sublabel="marketplaces represented"
        />
        <MetricCard
          label="Avg. 7-day movement"
          value={portfolio ? formatPct(portfolio.avgChangePct, { signed: true }) : "—"}
          icon={TrendingUp}
          trend="up-is-bad"
          delta={portfolio ? formatPct(portfolio.avgChangePct, { signed: true }) : null}
          sublabel="across tracked products"
        />
        <MetricCard label="Active alerts" value={alerts?.length ?? "—"} icon={BellRing} sublabel="last 7 days" />
      </div>

      <div className="dash-grid">
        <section>
          <div className="section-head">
            <h2 className="section-title">Tracked products</h2>
          </div>

          {loading && <LoadingState label="Loading tracked products…" />}

          {!loading && summaries?.length === 0 && (
            <div className="dash-empty card">
              <p>You aren't tracking any products yet.</p>
              <Link to="/catalogue" className="btn btn-secondary btn-sm">
                Browse the catalogue
              </Link>
            </div>
          )}

          <div className="dash-product-list">
            {summaries?.map((s) => (
              <div className="dash-product-row card" key={s.product.id}>
                <div className="dash-product-main">
                  <Link to={`/products/${s.product.id}`} className="dash-product-name">
                    {s.product.canonicalName}
                  </Link>
                  <p className="dash-product-sub">
                    {s.brand?.name} · {s.marketplaceCount} marketplace{s.marketplaceCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="dash-product-price">
                  <span className="tabular dash-product-price-value">
                    {s.currentPriceMinor != null ? formatMinor(s.currentPriceMinor) : "—"}
                  </span>
                  {s.changePct != null && (
                    <StatusBadge status={s.changePct <= -0.02 ? "good" : s.changePct >= 0.02 ? "serious" : "neutral"}>
                      {formatPct(s.changePct, { signed: true })} · 7d
                    </StatusBadge>
                  )}
                </div>
                <button
                  type="button"
                  className="icon-btn dash-untrack"
                  aria-label={`Stop tracking ${s.product.canonicalName}`}
                  onClick={() => toggleTracked(s.product.id)}
                  title="Stop tracking"
                >
                  <X size={15} strokeWidth={1.8} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="section-head">
            <h2 className="section-title">Alerts</h2>
          </div>
          <div className="dash-alerts card">
            {alerts?.length === 0 && <p className="dash-alerts-empty">No notable price movements right now.</p>}
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
