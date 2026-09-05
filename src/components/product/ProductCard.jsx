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

/**
 * A catalogue entry, set like an index card rather than a shop tile.
 *
 * The old card led with a grey square holding two letters — a placeholder
 * standing in for product photography this dataset does not have, occupying
 * the most valuable position on the card. It is gone. What leads now is the
 * price, because this is a pricing product and price is what the catalogue is
 * scanned for; the brand monogram survives as quiet typographic texture that
 * gives a long grid some rhythm.
 */
export default function ProductCard({ summary }) {
  const { product, brand, minPriceMinor, maxPriceMinor, marketplaceIds, rating, reviewCount, inStock } = summary;
  const specs = keySpecsFor(product);
  const displayName = brand
    ? product.canonicalName.replace(new RegExp(`^${brand.name}\\s+`, "i"), "")
    : product.canonicalName;

  return (
    <Link to={`/products/${product.id}`} className="pcard">
      <span className="eyebrow pcard-brand">{brand?.name}</span>
      <h3 className="pcard-name">{displayName}</h3>

      {specs.length > 0 && (
        <ul className="pcard-specs">
          {specs.map((s) => (
            <li key={s.key}>{s.text}</li>
          ))}
        </ul>
      )}

      <div className="pcard-price-row">
        <span className="pcard-price tabular">
          {minPriceMinor != null
            ? maxPriceMinor && maxPriceMinor !== minPriceMinor
              ? `${formatMinor(minPriceMinor)}–${formatMinor(maxPriceMinor)}`
              : formatMinor(minPriceMinor)
            : "No price"}
        </span>
        {rating != null && (
          <span className="pcard-rating">
            <Star size={11} strokeWidth={0} fill="currentColor" />
            <span className="tabular">{rating.toFixed(1)}</span>
            {reviewCount ? (
              <em className="tabular">{reviewCount >= 1000 ? `${Math.round(reviewCount / 100) / 10}k` : reviewCount}</em>
            ) : null}
          </span>
        )}
      </div>

      <div className="pcard-foot">
        <span className="pcard-mps">
          {marketplaceIds.map((id) => {
            const mp = marketplaces.find((m) => m.id === id);
            return <span key={id} className="pcard-pip" style={{ background: mp?.brandColor }} title={mp?.name} />;
          })}
          <em>
            {marketplaceIds.length} marketplace{marketplaceIds.length === 1 ? "" : "s"}
          </em>
        </span>
        {!inStock && (
          <span className="pcard-oos">
            <PackageX size={10} strokeWidth={2} /> No active offer
          </span>
        )}
      </div>
    </Link>
  );
}
