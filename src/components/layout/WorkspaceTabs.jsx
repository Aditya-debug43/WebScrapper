import { NavLink } from "react-router-dom";
import "./WorkspaceTabs.css";

/** tabs: [{ label, to, count?, end? }] */
export default function WorkspaceTabs({ tabs }) {
  return (
    <div className="workspace-tabs">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) => `workspace-tab${isActive ? " active" : ""}`}
        >
          {tab.label}
          {tab.count != null && <span className="workspace-tab-count">{tab.count}</span>}
        </NavLink>
      ))}
    </div>
  );
}
