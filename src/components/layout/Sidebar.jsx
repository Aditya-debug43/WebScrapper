import { NavLink } from "react-router-dom";
import { LayoutGrid, Search, DatabaseZap, Sparkles, X } from "lucide-react";
import "./Sidebar.css";

const primaryNav = [
  { to: "/", label: "Dashboard", icon: LayoutGrid, end: true },
  { to: "/catalogue", label: "Catalogue", icon: Search },
];

const systemNav = [{ to: "/sources", label: "Data Sources", icon: DatabaseZap }];

export default function Sidebar({ open = false, onClose }) {
  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} aria-hidden="true" />}
      <aside className={`sidebar${open ? " open" : ""}`}>
        <div className="sidebar-brand">
          <span className="sidebar-mark">
            <Sparkles size={16} strokeWidth={2.25} />
          </span>
          <span className="sidebar-wordmark">Mulya</span>
          <button type="button" className="sidebar-close" onClick={onClose} aria-label="Close menu">
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <p className="sidebar-nav-label">Workspace</p>
          <ul>
            {primaryNav.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink to={to} end={end} className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`} onClick={onClose}>
                  <Icon size={17} strokeWidth={1.8} />
                  <span>{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>

          <p className="sidebar-nav-label">System</p>
          <ul>
            {systemNav.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink to={to} className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`} onClick={onClose}>
                  <Icon size={17} strokeWidth={1.8} />
                  <span>{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-foot-card">
            <p className="sidebar-foot-title">Prototype build</p>
            <p className="sidebar-foot-copy">Mock data now · Java REST API next — the service layer swaps without touching these screens.</p>
          </div>
        </div>
      </aside>
    </>
  );
}
