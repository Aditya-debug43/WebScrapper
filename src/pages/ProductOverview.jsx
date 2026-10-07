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
  const { isTracked, stopTracking } = useAppState();
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
            {/*
              * Tracking STARTS from a live search result, because the server
              * resolves which real offer was chosen rather than trusting the
              * browser. So this button can only stop it; starting happens on
              * the discovery page, where there is a result to point at.
              */}
            {tracked ? (
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => stopTracking(productId)}>
                <BookmarkCheck size={14} strokeWidth={2} /> Tracking — stop
              </button>
            ) : (
              <Link to="/catalogue" className="btn btn-sm btn-accent">
                <Bookmark size={14} strokeWidth={2} /> Find and track
              </Link>
            )}
          </div>
          <div className="po-identity">
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
            <h2 className="section-title po-family-title">Same model family</h2>
            <div className="po-siblings">
              {variantSiblings.map((s) => (
                <Link to={`/products/${s.product.id}`} key={s.product.id} className="po-sibling">
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
        <div className="po-aside-card">
          <h3 className="po-aside-title">Available on</h3>
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
  /**
   * An empty string counts as absent, not as a value.
   *
   * A product discovered in a marketplace has no brand or category — the
   * backend returns null and an empty breadcrumb rather than inventing one,
   * and `categoryPath.map(…).join()` turns that into "". Without this the
   * row rendered blank, which reads as a missing value rather than as a
   * value we honestly do not have.
   */
  const shown = value === null || value === undefined || value === "" ? "—" : value;
  return (
    <div className="po-identity-row">
      <dt>{label}</dt>
      <dd>{shown}</dd>
    </div>
  );
}

function capitalize(s) {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1).replace(/_/g, " ");
}
