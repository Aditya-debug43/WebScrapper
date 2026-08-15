import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import "./Breadcrumbs.css";

/** items: [{ label, to? }] — the last item renders as plain text (current page). */
export default function Breadcrumbs({ items }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span className="breadcrumb-item" key={`${item.label}-${i}`}>
            {i > 0 && <ChevronRight size={13} strokeWidth={2} className="breadcrumb-sep" />}
            {item.to && !isLast ? (
              <Link to={item.to} className="breadcrumb-link">
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "breadcrumb-current" : ""}>{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
