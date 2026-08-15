import { ChevronRight, CornerUpLeft, LayoutGrid } from "lucide-react";
import "./CategoryRail.css";

/**
 * The drill-down navigator: Department → Category → Subcategory → Product Type.
 * Shows one level at a time with a path back up, which is how real marketplace
 * catalogues narrow — rather than dumping the whole tree at once.
 */
export default function CategoryRail({
  breadcrumb,
  childCategories,
  productTypesInScope,
  activeProductTypeId,
  onSelectCategory,
  onSelectProductType,
}) {
  const current = breadcrumb.length ? breadcrumb[breadcrumb.length - 1] : null;
  const parent = breadcrumb.length > 1 ? breadcrumb[breadcrumb.length - 2] : null;

  return (
    <nav className="cat-rail" aria-label="Category navigation">
      <p className="cat-rail-title">
        <LayoutGrid size={13} strokeWidth={2} />
        {current ? "Browsing" : "All departments"}
      </p>

      {current && (
        <button type="button" className="cat-rail-up" onClick={() => onSelectCategory(parent ? parent.id : null)}>
          <CornerUpLeft size={13} strokeWidth={2} />
          {parent ? parent.name : "All departments"}
        </button>
      )}

      {current && <p className="cat-rail-current">{current.name}</p>}

      <ul className="cat-rail-list">
        {childCategories.map((c) => (
          <li key={c.id}>
            <button type="button" className="cat-rail-link" onClick={() => onSelectCategory(c.id)}>
              <span>{c.name}</span>
              <ChevronRight size={13} strokeWidth={2} />
            </button>
          </li>
        ))}
      </ul>

      {productTypesInScope.length > 0 && (
        <>
          <p className="cat-rail-subtitle">Product type</p>
          <ul className="cat-rail-list">
            {productTypesInScope.map((pt) => (
              <li key={pt.id}>
                <button
                  type="button"
                  className={`cat-rail-ptype${activeProductTypeId === pt.id ? " active" : ""}`}
                  onClick={() => onSelectProductType(activeProductTypeId === pt.id ? null : pt.id)}
                >
                  {pt.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </nav>
  );
}
