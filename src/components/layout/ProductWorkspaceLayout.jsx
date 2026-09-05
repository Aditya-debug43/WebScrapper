import { Outlet, useParams, useLocation, Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { getProduct } from "../../data/products";
import { getListing, getListingsForProduct } from "../../data/listings";
import { getBrand } from "../../data/brands";
import Breadcrumbs from "../common/Breadcrumbs";
import WorkspaceTabs from "./WorkspaceTabs";
import "./ProductWorkspaceLayout.css";

/**
 * Shared chrome for the Product → Listing → Offer → Price History →
 * Recommendation drill-down. Resolves the active product either directly
 * (/products/:productId/*) or via a listing (/listings/:listingId/*), then
 * renders the same masthead + progression rail either way so the entity chain
 * stays visible no matter which page the user is on.
 *
 * The header sits outside the page container and the rail runs full-bleed
 * beneath it, so the rail can stick to the masthead while the body scrolls.
 */
export default function ProductWorkspaceLayout() {
  const { productId: productIdParam, listingId: listingIdParam } = useParams();
  const location = useLocation();

  const activeListing = listingIdParam ? getListing(listingIdParam) : null;
  const productId = productIdParam ?? activeListing?.productId;
  const product = productId ? getProduct(productId) : null;
  const brand = product ? getBrand(product.brandId) : null;

  const productListings = productId ? getListingsForProduct(productId) : [];
  const defaultListing = activeListing ?? productListings[0] ?? null;

  if (!product) {
    return (
      <div className="page">
        <div className="pw-missing">
          <span className="eyebrow">Not found</span>
          <h1 className="page-title">No product answers to that address</h1>
          <p className="page-subtitle">
            The identifier in this URL does not match any product or listing in the catalogue. It may have been
            mistyped, or it may belong to a dataset this build does not carry.
          </p>
          <Link to="/catalogue" className="btn btn-primary pw-missing-cta">
            Browse the catalogue <ArrowRight size={14} strokeWidth={2} />
          </Link>
        </div>
      </div>
    );
  }

  const sectionLabel = (() => {
    if (location.pathname.endsWith("/marketplaces")) return "Marketplace Comparison";
    if (location.pathname.endsWith("/analysis")) return "Cross-Marketplace Analysis";
    if (location.pathname.endsWith("/recommendation")) return "Pricing Recommendation";
    if (location.pathname.endsWith("/history")) return "Price History";
    if (listingIdParam) return "Listing Detail";
    return "Overview";
  })();

  return (
    <div className="pw">
      <header className="pw-head">
        <div className="pw-head-inner">
          <Breadcrumbs
            items={[
              { label: "Catalogue", to: "/catalogue" },
              { label: brand ? `${brand.name} ${product.modelName}` : product.canonicalName, to: `/products/${productId}` },
              { label: sectionLabel },
            ]}
          />

          <div className="pw-title-row">
            <div className="pw-identity">
              <h1 className="pw-title">{product.canonicalName}</h1>
              {product.variantAxes && (
                <p className="pw-variant">{Object.values(product.variantAxes).join(" · ")}</p>
              )}
            </div>

            <dl className="pw-facts">
              <div>
                <dt>Brand</dt>
                <dd>{brand?.name ?? "—"}</dd>
              </div>
              <div>
                <dt>Listed on</dt>
                <dd className="tabular">{productListings.length}</dd>
              </div>
              <div>
                <dt>Lifecycle</dt>
                <dd>{(product.lifecycleStatus ?? "—").replace(/_/g, " ")}</dd>
              </div>
            </dl>
          </div>
        </div>
      </header>

      <WorkspaceTabs
        tabs={[
          { label: "Overview", to: `/products/${productId}`, end: true },
          { label: "Marketplaces", to: `/products/${productId}/marketplaces`, count: productListings.length },
          ...(defaultListing
            ? [
                { label: "Listing", to: `/listings/${defaultListing.id}`, end: true },
                { label: "Price History", to: `/listings/${defaultListing.id}/history` },
              ]
            : []),
          { label: "Analysis", to: `/products/${productId}/analysis` },
          { label: "Recommendation", to: `/products/${productId}/recommendation` },
        ]}
      />

      <div className="page pw-body">
        <Outlet context={{ productId, product, brand, activeListing, defaultListing, productListings }} />
      </div>
    </div>
  );
}
