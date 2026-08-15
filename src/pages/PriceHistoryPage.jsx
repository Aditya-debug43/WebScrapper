import { useParams, Link, useOutletContext } from "react-router-dom";
import { ArrowRight, TrendingDown, TrendingUp, Activity } from "lucide-react";
import { useAsyncData } from "../utils/useAsyncData";
import { getPriceHistoryForListing } from "../api/priceHistoryService";
import PriceHistoryChart from "../components/charts/PriceHistoryChart";
import MetricCard from "../components/common/MetricCard";
import LoadingState from "../components/common/LoadingState";
import { formatMinor } from "../utils/money";
import "./PriceHistoryPage.css";

export default function PriceHistoryPage() {
  const { listingId } = useParams();
  const { productId } = useOutletContext();
  const { data, loading } = useAsyncData(() => getPriceHistoryForListing(listingId), [listingId]);

  if (loading || !data) return <LoadingState label="Loading price history…" />;

  const { series, priceBasis } = data;
  const allInStock = series.flatMap((s) => s.observations.filter((o) => o.isInStock));
  // Every figure on this page reads the same rung of the price ladder the
  // recommendation engine reads — see PRICE_BASIS in utils/pricingEngine.
  const priceOf = (o) => o.effectiveMinor ?? o.sellingPriceMinor + o.shippingFeeMinor;

  if (series.length === 0 || allInStock.length === 0) {
    return (
      <div className="ph-empty card">
        <p>
          No seller currently has an active offer on this listing, so there is no price history to observe yet.
        </p>
      </div>
    );
  }

  const min = Math.min(...allInStock.map(priceOf));
  const max = Math.max(...allInStock.map(priceOf));
  const latestByOffer = series.map((s) => s.observations[s.observations.length - 1]).filter(Boolean);
  const earliestByOffer = series.map((s) => s.observations[0]).filter(Boolean);
  const avgLatest = latestByOffer.reduce((s, o) => s + priceOf(o), 0) / (latestByOffer.length || 1);
  const avgEarliest = earliestByOffer.reduce((s, o) => s + priceOf(o), 0) / (earliestByOffer.length || 1);
  const netChangePct = (avgLatest - avgEarliest) / avgEarliest;

  return (
    <div>
      <div className="ph-summary">
        <MetricCard label="Lowest observed" value={formatMinor(min)} icon={TrendingDown} />
        <MetricCard label="Highest observed" value={formatMinor(max)} icon={TrendingUp} />
        <MetricCard
          label="Net movement"
          value={`${netChangePct >= 0 ? "+" : ""}${(netChangePct * 100).toFixed(1)}%`}
          icon={Activity}
          trend="up-is-bad"
          sublabel="avg across sellers, full window"
        />
      </div>

      <PriceHistoryChart series={series} priceBasis={priceBasis} />

      <div className="ph-footer">
        <p>
          Every point is an immutable observation — nothing here was ever overwritten. This is what makes discount-
          cycle detection and a defensible recommendation possible.
        </p>
        <Link to={`/products/${productId}/recommendation`} className="btn btn-accent btn-sm">
          See pricing recommendation <ArrowRight size={14} strokeWidth={2} />
        </Link>
      </div>
    </div>
  );
}
