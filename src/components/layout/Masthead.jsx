import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { Search, Sun, Moon, Menu, X, BellDot } from "lucide-react";
import { useTheme } from "../../state/ThemeContext";
import "./Masthead.css";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/catalogue", label: "Catalogue" },
  { to: "/sources", label: "Sources" },
];

/**
 * The application's only piece of global chrome.
 *
 * There is no sidebar: a 250px rail was spending a fifth of the viewport on
 * three links, and the analytical tables are the thing that actually needed
 * the width. What replaces it is a masthead — wordmark, inline navigation,
 * search, alerts, theme — over full-bleed content.
 *
 * This is also the one place in the interface that uses a translucent
 * material. It floats over scrolling content, so it reads as a layer; every
 * content surface below it stays opaque and crisp.
 */
export default function Masthead({ alertCount = 0 }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef(null);

  // Close the mobile sheet whenever the route changes under it.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  // "/" focuses search — the shortcut a data tool is expected to have.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "")) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === searchRef.current) searchRef.current.blur();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function submit(e) {
    e.preventDefault();
    navigate(query.trim() ? `/catalogue?q=${encodeURIComponent(query.trim())}` : "/catalogue");
    searchRef.current?.blur();
  }

  return (
    <>
      <header className="mast">
        <div className="mast-inner">
          <NavLink to="/" className="mast-brand" aria-label="Mulya — home">
            <span className="mast-mark" aria-hidden="true">
              <span /><span /><span />
            </span>
            <span className="mast-word">Mulya</span>
            <span className="mast-kicker">Pricing Intelligence</span>
          </NavLink>

          <nav className="mast-nav" aria-label="Primary">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `mast-link${isActive ? " active" : ""}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Below 560px this collapses to the submit button alone: pressing it
              with an empty field lands on the catalogue, whose own search field
              is the better place to type on a phone. Nothing is lost. */}
          <form className="mast-search" onSubmit={submit} role="search">
            <button type="submit" className="mast-search-go" aria-label="Search">
              <Search size={14} strokeWidth={2} />
            </button>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products, brands, models"
              aria-label="Search products"
            />
            <kbd aria-hidden="true">/</kbd>
          </form>

          <div className="mast-actions">
            <button
              type="button"
              className="mast-alerts"
              onClick={() => navigate("/")}
              aria-label={alertCount ? `${alertCount} price alerts` : "Price alerts"}
            >
              <BellDot size={15} strokeWidth={1.75} />
              {alertCount > 0 && <span className="tabular">{alertCount}</span>}
            </button>

            <ThemeToggle />

            <button
              type="button"
              className="icon-btn mast-menu"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={16} strokeWidth={1.9} />
            </button>
          </div>
        </div>
      </header>

      {menuOpen && (
        <>
          <div className="sheet-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <div className="mast-sheet" role="dialog" aria-label="Menu">
            <div className="mast-sheet-head">
              <span className="eyebrow">Navigate</span>
              <button type="button" className="icon-btn" onClick={() => setMenuOpen(false)} aria-label="Close menu">
                <X size={16} strokeWidth={1.9} />
              </button>
            </div>
            <nav className="mast-sheet-nav">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `mast-sheet-link${isActive ? " active" : ""}`}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </>
      )}
    </>
  );
}

function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="icon-btn mast-theme"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {resolved === "dark" ? <Sun size={15} strokeWidth={1.9} /> : <Moon size={15} strokeWidth={1.9} />}
    </button>
  );
}
