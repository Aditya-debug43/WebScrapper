import { Outlet, useParams, useLocation } from "react-router-dom";
import { getProduct } from "../../data/products";
import { getListing, getListingsForProduct } from "../../data/listings";
import { getBrand } from "../../data/brands";
import Breadcrumbs from "../common/Breadcrumbs";
import WorkspaceTabs from "./WorkspaceTabs";

/**
 * Shared chrome for the Product → Listing → Offer → Price History →
 * Recommendation drill-down. Resolves the active product either directly
 * (/products/:productId/*) or via a listing (/listings/:listingId/*), then
 * renders the same breadcrumb + tab strip either way so the entity chain
 * stays visible no matter which page the user is on.
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
        <p className="page-subtitle">Product not found.</p>
      </div>
    );
  }

  const sectionLabel = (() => {
    if (location.pathname.endsWith("/marketplaces")) return "Marketplace Comparison";
    if (location.pathname.endsWith("/recommendation")) return "Pricing Recommendation";
    if (location.pathname.endsWith("/history")) return "Price History";
    if (listingIdParam) return "Listing Detail";
    return "Overview";
  })();

  return (
    <div className="page">
      <Breadcrumbs
        items={[
          { label: "Catalogue", to: "/catalogue" },
          { label: brand ? `${brand.name} ${product.modelName}` : product.canonicalName, to: `/products/${productId}` },
          { label: sectionLabel },
        ]}
      />

      <div className="page-head">
        <div>
          <h1 className="page-title">{product.canonicalName}</h1>
          {product.variantAxes && (
            <p className="page-subtitle">
              {Object.values(product.variantAxes).join(" · ")}
            </p>
          )}
        </div>
      </div>

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
          { label: "Recommendation", to: `/products/${productId}/recommendation` },
        ]}
      />

      <Outlet context={{ productId, product, brand, activeListing, defaultListing, productListings }} />
    </div>
  );
}
