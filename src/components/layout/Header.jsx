import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Search, Bell, HelpCircle, Menu } from "lucide-react";
import "./Header.css";

export default function Header({ alertCount = 0, onMenuClick }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    navigate(query.trim() ? `/catalogue?q=${encodeURIComponent(query.trim())}` : "/catalogue");
  }

  return (
    <header className="app-header">
      <button type="button" className="icon-btn header-menu-btn" aria-label="Open menu" onClick={onMenuClick}>
        <Menu size={17} strokeWidth={1.8} />
      </button>
      <form className="header-search" onSubmit={handleSubmit} role="search">
        <Search size={16} strokeWidth={2} />
        <input
          type="text"
          placeholder="Search products, brands, models…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search products"
        />
      </form>

      <div className="header-actions">
        <button type="button" className="icon-btn" aria-label="Help">
          <HelpCircle size={17} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="icon-btn header-bell"
          aria-label={`Notifications${alertCount ? `, ${alertCount} unread` : ""}`}
          onClick={() => navigate("/")}
        >
          <Bell size={17} strokeWidth={1.8} />
          {alertCount > 0 && <span className="header-bell-badge">{alertCount}</span>}
        </button>
      </div>
    </header>
  );
}
