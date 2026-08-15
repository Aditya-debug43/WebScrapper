import { useParams, Link } from "react-router-dom";
import { ExternalLink, Star, TrendingUp, History } from "lucide-react";
import { useAsyncData } from "../utils/useAsyncData";
import { getListingDetail } from "../api/listingsService";
import OfferCard from "../components/listing/OfferCard";
import StatusBadge from "../components/common/StatusBadge";
import LoadingState from "../components/common/LoadingState";
import "./ListingDetail.css";

const MATCH_STATUS_LABEL = {
  human_confirmed: "Human-confirmed match",
  auto_matched: "Auto-matched",
  unmatched: "Unmatched",
};

export default function ListingDetail() {
  const { listingId } = useParams();
  const { data, loading } = useAsyncData(() => getListingDetail(listingId), [listingId]);

  if (loading || !data) return <LoadingState label="Loading listing…" />;

  const { listing, marketplace, offers, review, reviewVelocity } = data;
  const buyboxOfferId = offers.find((o) => o.observation?.isBuyboxWinner)?.offer.id;

  return (
    <div>
      <div className="ld-top card">
        <div>
          <span className="eyebrow">{marketplace.name} listing</span>
          <p className="ld-raw-title">"{listing.rawTitle}"</p>
          <div className="ld-badges">
            <StatusBadge status={listing.matchStatus === "human_confirmed" ? "good" : "neutral"}>
              {MATCH_STATUS_LABEL[listing.matchStatus]} · {Math.round(listing.matchConfidence * 100)}%
            </StatusBadge>
            <span className="pill-badge">FSN/ASIN: {listing.externalListingId}</span>
          </div>
        </div>
        <a href={listing.listingUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
          View live page <ExternalLink size={13} strokeWidth={2} />
        </a>
      </div>

      {review && (
        <div className="ld-review card">
          <div>
            <span className="ld-review-rating">
              <Star size={16} strokeWidth={0} fill="currentColor" /> {review.averageRating.toFixed(1)}
            </span>
            <span className="ld-review-count">{review.reviewCount.toLocaleString("en-IN")} reviews on this listing</span>
          </div>
          {reviewVelocity != null && (
            <span className="ld-velocity">
              <TrendingUp size={14} strokeWidth={2} />
              ~{Math.round(reviewVelocity)} new reviews / day — demand proxy
            </span>
          )}
        </div>
      )}

      <div className="section-head" style={{ marginTop: 28 }}>
        <h2 className="section-title">Sellers &amp; offers</h2>
        <Link to={`/listings/${listingId}/history`} className="btn btn-ghost btn-sm">
          <History size={14} strokeWidth={2} /> Price history
        </Link>
      </div>
      <p className="ld-explainer">
        {offers.length} seller{offers.length === 1 ? "" : "s"} compete on this listing. The featured offer is the
        lowest in-stock landed price today — not a fixed seller — recomputed from the observation history.
      </p>

      <div className="ld-offers">
        {offers.map((o) => (
          <OfferCard key={o.offer.id} offerView={o} isBuybox={o.offer.id === buyboxOfferId} />
        ))}
      </div>
    </div>
  );
}
