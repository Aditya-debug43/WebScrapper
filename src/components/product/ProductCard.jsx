import { Link } from "react-router-dom";
import { Star, PackageX } from "lucide-react";
import { formatMinor } from "../../utils/money";
import { getFilterableAttributes } from "../../data/attributeDefinitions";
import { marketplaces } from "../../data/marketplaces";
import "./ProductCard.css";

/** Up to three registry-defined specs worth showing on a card, per product type. */
function keySpecsFor(product, limit = 3) {
  if (!product.specifications || !product.productTypeId) return [];
  const defs = getFilterableAttributes(product.productTypeId);
  const out = [];
  for (const def of defs) {
    const value = product.specifications[def.attributeKey];
    if (value === undefined || value === null) continue;
    // Keyed by attribute, not by rendered text — two different specs can share
    // a display value (a mixer with 3 jars and 3 speed settings both read "3").
    if (def.dataType === "boolean") {
      if (value === true) out.push({ key: def.attributeKey, text: def.displayName });
    } else {
      out.push({ key: def.attributeKey, text: def.unit ? `${value} ${def.unit}` : String(value) });
    }
    if (out.length >= limit) break;
  }
  return out;
}

export default function ProductCard({ summary }) {
  const { product, brand, minPriceMinor, maxPriceMinor, marketplaceIds, rating, reviewCount, inStock } = summary;
  const specs = keySpecsFor(product);
  const displayName = brand ? product.canonicalName.replace(new RegExp(`^${brand.name}\\s+`, "i"), "") : product.canonicalName;

  return (
    <Link to={`/products/${product.id}`} className="product-card card">
      <div className="product-card-thumb">
        <span className="product-card-thumb-mark">{(brand?.name ?? "?").slice(0, 2).toUpperCase()}</span>
        {!inStock && (
          <span className="product-card-oos">
            <PackageX size={11} strokeWidth={2} /> No active offer
          </span>
        )}
      </div>

      <div className="product-card-body">
        <span className="eyebrow">{brand?.name}</span>
        <h3 className="product-card-name">{displayName}</h3>

        {specs.length > 0 && (
          <ul className="product-card-specs">
            {specs.map((s) => (
              <li key={s.key}>{s.text}</li>
            ))}
          </ul>
        )}

        <div className="product-card-meta">
          <span className="product-card-price tabular">
            {minPriceMinor != null
              ? maxPriceMinor && maxPriceMinor !== minPriceMinor
                ? `${formatMinor(minPriceMinor)} – ${formatMinor(maxPriceMinor)}`
                : formatMinor(minPriceMinor)
              : "Price unavailable"}
          </span>
          {rating != null && (
            <span className="product-card-rating">
              <Star size={12} strokeWidth={0} fill="currentColor" />
              {rating.toFixed(1)}
              {reviewCount ? <em> ({reviewCount >= 1000 ? `${Math.round(reviewCount / 100) / 10}k` : reviewCount})</em> : null}
            </span>
          )}
        </div>

        <div className="product-card-foot">
          <span className="product-card-mps">
            {marketplaceIds.map((id) => {
              const mp = marketplaces.find((m) => m.id === id);
              return <span key={id} className="product-card-mp-dot" style={{ background: mp?.brandColor }} title={mp?.name} />;
            })}
            <em>
              {marketplaceIds.length} marketplace{marketplaceIds.length === 1 ? "" : "s"}
            </em>
          </span>
        </div>
      </div>
    </Link>
  );
}
