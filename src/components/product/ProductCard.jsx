import { Link } from "react-router-dom";
import { Star, PackageX } from "lucide-react";
import { formatMinor } from "../../utils/money";
import "./ProductCard.css";

/**
 * A key spec as text.
 *
 * WHICH specs appear is a registry rule and the backend decides it — the
 * filterable attributes, in registry order, the first few this product has a
 * value for. HOW one reads is presentation and stays here. A boolean prints
 * its name alone ("5G"), because "5G: true" is not how anyone says it.
 */
function specText(spec) {
  if (spec.dataType === "boolean") return spec.label;
  return spec.unit ? `${spec.value} ${spec.unit}` : String(spec.value);
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
  const { product, brand, minPriceMinor, maxPriceMinor, marketplaces, rating, reviewCount, inStock } = summary;
  const specs = summary.keySpecs ?? [];
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
            <li key={s.key}>{specText(s)}</li>
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
        {/*
          Each platform comes from the response with its own name and colour,
          rather than being looked up in a table the browser keeps. That table
          is why a store discovered by a data provider rendered as a blank,
          nameless pip: it was not in the list, so there was nothing to find.
          A platform with no brand colour falls back to a neutral swatch
          instead of an invisible one.
        */}
        <span className="pcard-mps">
          {marketplaces.map((mp) => (
            <span
              key={mp.id}
              className="pcard-pip"
              style={{ background: mp.brandColor || "var(--border-strong)" }}
              title={mp.name}
            />
          ))}
          <em>
            {marketplaces.length} marketplace{marketplaces.length === 1 ? "" : "s"}
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
