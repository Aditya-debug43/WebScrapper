import { Star, Ticket, Wallet, CreditCard, Tag } from "lucide-react";
import Avatar from "../common/Avatar";
import StatusBadge from "../common/StatusBadge";
import { formatMinor, formatPct } from "../../utils/money";
import "./OfferCard.css";

const FULFILMENT_LABEL = {
  fba: "Fulfilled by Amazon",
  flipkart_assured: "Flipkart Assured",
  self_ship: "Self-shipped",
};

const SELLER_TYPE_LABEL = {
  marketplace_owned: "Marketplace-owned",
  third_party: "Third-party seller",
  brand_direct: "Brand direct",
};

const CLASS_META = {
  universal: { icon: Tag, label: "Everyone", cls: "promo-universal" },
  conditional: { icon: CreditCard, label: "If eligible", cls: "promo-conditional" },
  deferred: { icon: Wallet, label: "After purchase", cls: "promo-deferred" },
  financing: { icon: Ticket, label: "Payment terms", cls: "promo-financing" },
};

export default function OfferCard({ offerView, isBuybox }) {
  const { seller, sellerRating, observation, layers, ladder, activePromotions } = offerView;
  if (!layers) return null;

  const discountPct = layers.mrpMinor ? 1 - layers.sellingPriceMinor / layers.mrpMinor : null;
  const grouped = activePromotions.reduce((acc, p) => {
    (acc[p.availabilityClass] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div className={`offer-card card${isBuybox ? " buybox" : ""}`}>
      <div className="offer-card-seller">
        <Avatar name={seller?.name ?? "?"} size={38} />
        <div className="offer-card-seller-meta">
          <div className="offer-card-seller-name-row">
            <span className="offer-card-seller-name">{seller?.name ?? "Unknown seller"}</span>
            {isBuybox && <StatusBadge status="good">Featured offer</StatusBadge>}
          </div>
          <p className="offer-card-seller-sub">
            {SELLER_TYPE_LABEL[seller?.sellerType] ?? "Seller"} · {FULFILMENT_LABEL[seller?.defaultFulfilmentType] ?? "—"}
          </p>
        </div>
        {sellerRating && (
          <div className="offer-card-rating">
            <Star size={12.5} strokeWidth={0} fill="currentColor" />
            {sellerRating.rating.toFixed(1)}
            <span>({sellerRating.ratingCount.toLocaleString("en-IN")})</span>
          </div>
        )}
      </div>

      <div className="offer-card-price-block">
        <div className="offer-card-price-main">
          <span className="offer-card-price tabular">{formatMinor(layers.sellingPriceMinor)}</span>
          {layers.mrpMinor > layers.sellingPriceMinor && (
            <>
              <span className="offer-card-mrp tabular">{formatMinor(layers.mrpMinor)}</span>
              <span className="offer-card-discount">{formatPct(discountPct)} off</span>
            </>
          )}
        </div>

        {/* The price ladder — each rung is a different question, so they are
            never collapsed into one "effective price". */}
        <div className="offer-card-ladder">
          {ladder.map((row) => (
            <div className={`offer-ladder-row rung-${row.kind}`} key={row.key}>
              <span>
                {row.label}
                {row.note && <em> · {row.note}</em>}
              </span>
              <span className="tabular">
                {row.valueMinor === 0 && row.zeroLabel ? row.zeroLabel : formatMinor(row.valueMinor)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="offer-card-foot">
        <StatusBadge status={observation?.isInStock ? "good" : "critical"}>
          {observation?.isInStock ? "In stock" : "Out of stock"}
        </StatusBadge>
        <span className="offer-card-condition pill-badge">{offerView.offer.itemCondition}</span>
      </div>

      {activePromotions.length > 0 && (
        <div className="offer-card-promos">
          {Object.entries(grouped).map(([cls, promos]) => {
            const meta = CLASS_META[cls];
            const Icon = meta?.icon ?? Tag;
            return (
              <div className={`offer-promo-group ${meta?.cls ?? ""}`} key={cls}>
                <span className="offer-promo-class">
                  <Icon size={11} strokeWidth={2.25} />
                  {meta?.label ?? cls}
                </span>
                <ul>
                  {promos.map((p) => (
                    <li key={p.id}>
                      {p.label}
                      {p.eligibility && <em> — {p.eligibility}</em>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
