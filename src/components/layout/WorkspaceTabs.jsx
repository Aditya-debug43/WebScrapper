import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import "./WorkspaceTabs.css";

/**
 * Not a tab bar — a progression.
 *
 * Overview → Marketplaces → Listing → Price History → Analysis →
 * Recommendation is the argument this product makes: identity, then evidence,
 * then interpretation, then a decision. Rendering it as an unordered row of
 * pills threw that away. Numbering it, and running a rule through the numbers,
 * says the order means something — which is the single most important thing
 * the navigation can communicate here.
 *
 * tabs: [{ label, to, count?, end? }]
 */
export default function WorkspaceTabs({ tabs }) {
  const railRef = useRef(null);
  const { pathname } = useLocation();

  // Centre the current step when the rail has to scroll on narrow screens.
  //
  // Explicit scroll maths rather than scrollIntoView, because the rail is a
  // sticky element and scrollIntoView on one of those also moves the page. And
  // it runs twice: on mount the display face has usually not loaded yet, the
  // steps are narrower than they will be, and the rail concludes it does not
  // need to scroll at all. `fonts.ready` is when the measurement is true.
  useEffect(() => {
    const centre = () => {
      const rail = railRef.current;
      const active = rail?.querySelector(".wt-step.active");
      if (!rail || !active) return;

      const a = active.getBoundingClientRect();
      const r = rail.getBoundingClientRect();
      // Before first layout every box measures zero, and "already visible" is
      // then trivially true — which is exactly how this silently did nothing.
      if (r.width === 0) return;
      if (a.left >= r.left - 1 && a.right <= r.right + 1) return; // already visible

      // Instant, not smooth. A smooth scroll issued while the page is still
      // settling gets cancelled and the rail silently stays at zero — and in
      // any case this is the rail arriving already in the right place, not a
      // movement the reader asked for.
      const delta = a.left + a.width / 2 - (r.left + r.width / 2);
      rail.scrollTo({ left: rail.scrollLeft + delta, behavior: "auto" });
    };

    const frame = requestAnimationFrame(centre);
    const backstop = setTimeout(centre, 250);
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) centre();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearTimeout(backstop);
    };
  }, [pathname]);

  return (
    <div className="wt">
      <div className="wt-inner">
        <nav className="wt-rail scroll-x" ref={railRef} aria-label="Analysis steps">
          <ol className="wt-list">
            {tabs.map((tab, i) => (
              <li key={tab.to}>
                <NavLink
                  to={tab.to}
                  end={tab.end}
                  className={({ isActive }) => `wt-step${isActive ? " active" : ""}`}
                >
                  <span className="wt-index tabular" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="wt-label">{tab.label}</span>
                  {tab.count != null && <span className="wt-count tabular">{tab.count}</span>}
                </NavLink>
              </li>
            ))}
          </ol>
        </nav>
      </div>
    </div>
  );
}
