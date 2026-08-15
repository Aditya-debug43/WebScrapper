import { useOutletContext, Link } from "react-router-dom";
import { Bookmark, BookmarkCheck, ArrowRight, Store } from "lucide-react";
import { useAsyncData } from "../utils/useAsyncData";
import { getProductDetail } from "../api/productsService";
import { useAppState } from "../state/AppStateContext";
import SpecList from "../components/product/SpecList";
import LoadingState from "../components/common/LoadingState";
import { formatMinor } from "../utils/money";
import "./ProductOverview.css";

export default function ProductOverview() {
  const { productId } = useOutletContext();
  const { isTracked, toggleTracked } = useAppState();
  const { data, loading } = useAsyncData(() => getProductDetail(productId), [productId]);

  if (loading || !data) return <LoadingState label="Loading product…" />;

  const { product, brand, categoryPath, attributeDefs, variantSiblings, listings } = data;
  const tracked = isTracked(productId);

  return (
    <div className="po-layout">
      <div className="po-main">
        <section className="po-section">
          <div className="section-head">
            <h2 className="section-title">Identity</h2>
            <button type="button" className={`btn btn-sm ${tracked ? "btn-secondary" : "btn-accent"}`} onClick={() => toggleTracked(productId)}>
              {tracked ? <BookmarkCheck size={14} strokeWidth={2} /> : <Bookmark size={14} strokeWidth={2} />}
              {tracked ? "Tracking" : "Track this product"}
            </button>
          </div>
          <div className="po-identity card">
            <dl className="po-identity-grid">
              <IdentityRow label="Brand" value={brand?.name} />
              <IdentityRow label="Model" value={product.modelName} />
              {product.variantAxes &&
                Object.entries(product.variantAxes).map(([axis, val]) => (
                  <IdentityRow key={axis} label={capitalize(axis)} value={val} />
                ))}
              <IdentityRow label="Category" value={categoryPath.map((c) => c.name).join(" › ")} />
              <IdentityRow label="Lifecycle" value={capitalize(product.lifecycleStatus)} />
              <IdentityRow label="First observed" value={product.firstSeenAt} />
            </dl>
          </div>
        </section>

        <section className="po-section">
          <div className="section-head">
            <h2 className="section-title">Specifications</h2>
            <span className="pill-badge">schema {product.specSchemaVersion}</span>
          </div>
          <SpecList specifications={product.specifications} attributeDefs={attributeDefs} />
        </section>

        {variantSiblings.length > 0 && (
          <section className="po-section">
            <h2 className="section-title" style={{ marginBottom: 14 }}>
              Same model family
            </h2>
            <div className="po-siblings">
              {variantSiblings.map((s) => (
                <Link to={`/products/${s.product.id}`} key={s.product.id} className="po-sibling card">
                  <div>
                    <p className="po-sibling-name">{Object.values(s.product.variantAxes).join(" · ")}</p>
                    <p className="po-sibling-sub">{s.product.modelName}</p>
                  </div>
                  <span className="po-sibling-price tabular">
                    {s.currentPriceMinor != null ? formatMinor(s.currentPriceMinor) : "—"}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      <aside className="po-aside">
        <div className="card po-aside-card">
          <h3 className="section-title" style={{ fontSize: "var(--text-base)", marginBottom: 12 }}>
            Available on
          </h3>
          <div className="po-listing-list">
            {listings.map((l) => (
              <Link to={`/listings/${l.listing.id}`} key={l.listing.id} className="po-listing-row">
                <span className="marketplace-dot" style={{ background: l.marketplace.brandColor }} />
                <span className="po-listing-name">{l.marketplace.name}</span>
                <span className="tabular po-listing-price">
                  {l.currentPriceMinor != null ? formatMinor(l.currentPriceMinor) : "—"}
                </span>
              </Link>
            ))}
          </div>
          <Link to={`/products/${productId}/marketplaces`} className="btn btn-secondary btn-sm po-aside-btn">
            <Store size={14} strokeWidth={2} /> Compare marketplaces
          </Link>
          <Link to={`/products/${productId}/recommendation`} className="btn btn-accent btn-sm po-aside-btn">
            View pricing recommendation <ArrowRight size={14} strokeWidth={2} />
          </Link>
        </div>
      </aside>
    </div>
  );
}

function IdentityRow({ label, value }) {
  return (
    <div className="po-identity-row">
      <dt>{label}</dt>
      <dd>{value ?? "—"}</dd>
    </div>
  );
}

function capitalize(s) {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1).replace(/_/g, " ");
}
