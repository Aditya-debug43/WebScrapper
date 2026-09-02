import {useOutletContext, Link } from "react-router-dom";
import { useAsyncData } from "../utils/useAsyncData";
import { getMarketplaceComparison } from "../api/listingsService";
import MarketplaceCard from "../components/marketplace/MarketplaceCard";
import MetricCard from "../components/common/MetricCard";
import LoadingState from "../components/common/LoadingState";
import { formatMinor } from "../utils/money";
import {Scale, TrendingDown, ArrowRight } from "lucide-react";
import "./MarketplaceComparison.css";

export default function MarketplaceComparison() {
  const { productId } = useOutletContext();
  const { data, loading } = useAsyncData(() => getMarketplaceComparison(productId), [productId]);

  if (loading || !data) return <LoadingState label="Comparing marketplaces…" />;

  const { listingRows, cheapestAcross, priceGapMinor } = data;
  const cheapestListingId = listingRows.reduce(
    (best, r) => (r.cheapestOffer?.effectiveMinor === cheapestAcross ? r.listing.id : best),
    null
  );

  return (
    <div>
      <div className="mc-summary">
        <MetricCard
          label="Cheapest across marketplaces"
          value={cheapestAcross != null ? formatMinor(cheapestAcross) : "—"}
          icon={TrendingDown}
        />
        <MetricCard label="Price gap" value={formatMinor(priceGapMinor)} icon={Scale} sublabel="between cheapest & priciest" />
      </div>

      <p className="mc-explainer">
        The same real-world product, one Listing per marketplace. Price and rating are per-listing because they're
        observed independently — averaging them across platforms would invent a number that exists nowhere.
      </p>

      <div className="mc-grid">
        {listingRows.map((row) => (
          <MarketplaceCard key={row.listing.id} row={row} isCheapest={row.listing.id === cheapestListingId} />
        ))}
      </div>

      {/* Price is one parameter. The analysis view compares the rest — sellers,
          fulfilment, trust, promotions, history — and says what they mean. */}
      <Link to={`/products/${productId}/analysis`} className="mc-analysis-cta">
        <span>
          <strong>Compare these platforms on more than price</strong>
          Sellers, fulfilment, review strength, offer conditions and history — analysed side by side.
        </span>
        <ArrowRight size={16} strokeWidth={2} />
      </Link>
    </div>
  );
}
