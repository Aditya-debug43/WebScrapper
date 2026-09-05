import { Link } from "react-router-dom";
import "./Breadcrumbs.css";

/**
 * items: [{ label, to? }] — the last item renders as plain text (current page).
 *
 * Set as a tracked micro-caps line with slash separators rather than chevrons:
 * it reads as a dateline above the title, which is the job it is actually
 * doing, and it stops competing with the navigation for attention.
 */
export default function Breadcrumbs({ items }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span className="crumb" key={`${item.label}-${i}`}>
            {i > 0 && (
              <span className="crumb-sep" aria-hidden="true">
                /
              </span>
            )}
            {item.to && !isLast ? (
              <Link to={item.to} className="crumb-link">
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "crumb-current" : undefined} aria-current={isLast ? "page" : undefined}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
