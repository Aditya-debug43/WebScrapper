import { Link } from "react-router-dom";
import { Star, Store, ArrowRight } from "lucide-react";
import { formatMinor } from "../../utils/money";
import StatusBadge from "../common/StatusBadge";
import "./MarketplaceCard.css";

export default function MarketplaceCard({ row, isCheapest }) {
  const { listing, marketplace, offerCount, cheapestOffer, rating, reviewCount, netRealization } = row;

  return (
    <div className={`marketplace-card card${isCheapest ? " cheapest" : ""}`}>
      <div className="marketplace-card-head">
        <span className="marketplace-dot" style={{ background: marketplace.brandColor }} />
        <span className="marketplace-card-name">{marketplace.name}</span>
        {isCheapest && <StatusBadge status="good">Cheapest</StatusBadge>}
      </div>

      <div className="marketplace-card-price tabular">
        {cheapestOffer?.effectiveMinor != null ? formatMinor(cheapestOffer.effectiveMinor) : "—"}
      </div>
      <p className="marketplace-card-price-sub">effective price, cheapest offer</p>

      <div className="marketplace-card-stats">
        <div>
          <span className="marketplace-card-stat-label">
            <Store size={12.5} strokeWidth={2} /> Sellers
          </span>
          <span className="marketplace-card-stat-value">{offerCount}</span>
        </div>
        <div>
          <span className="marketplace-card-stat-label">
            <Star size={12.5} strokeWidth={0} fill="currentColor" /> Rating
          </span>
          <span className="marketplace-card-stat-value">
            {rating != null ? rating.toFixed(1) : "—"}
            {reviewCount != null && <small> · {reviewCount.toLocaleString("en-IN")}</small>}
          </span>
        </div>
        <div>
          <span className="marketplace-card-stat-label">Net realisation</span>
          <span className="marketplace-card-stat-value">
            {netRealization ? formatMinor(netRealization.netRealizationMinor) : "—"}
          </span>
        </div>
      </div>

      <Link to={`/listings/${listing.id}`} className="marketplace-card-link">
        View listing <ArrowRight size={14} strokeWidth={2} />
      </Link>
    </div>
  );
}
