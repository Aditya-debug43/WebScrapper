import { Routes, Route } from "react-router-dom";
import { useState } from "react";
import Sidebar from "./components/layout/Sidebar";
import Header from "./components/layout/Header";
import ProductWorkspaceLayout from "./components/layout/ProductWorkspaceLayout";
import { AppStateProvider, useAppState } from "./state/AppStateContext";
import { useAsyncData } from "./utils/useAsyncData";
import { getPriceAlerts } from "./api/dashboardService";

import Dashboard from "./pages/Dashboard";
import Catalogue from "./pages/Catalogue";
import ProductOverview from "./pages/ProductOverview";
import MarketplaceComparison from "./pages/MarketplaceComparison";
import ListingDetail from "./pages/ListingDetail";
import PriceHistoryPage from "./pages/PriceHistoryPage";
import PricingRecommendation from "./pages/PricingRecommendation";
import DataSources from "./pages/DataSources";

function AppShell() {
  const { trackedProductIds } = useAppState();
  const { data: alerts } = useAsyncData(() => getPriceAlerts(trackedProductIds), [trackedProductIds]);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="app-shell">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="app-main">
        <Header alertCount={alerts?.length ?? 0} onMenuClick={() => setMenuOpen(true)} />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/catalogue" element={<Catalogue />} />

          <Route element={<ProductWorkspaceLayout />}>
            <Route path="/products/:productId" element={<ProductOverview />} />
            <Route path="/products/:productId/marketplaces" element={<MarketplaceComparison />} />
            <Route path="/products/:productId/recommendation" element={<PricingRecommendation />} />
            <Route path="/listings/:listingId" element={<ListingDetail />} />
            <Route path="/listings/:listingId/history" element={<PriceHistoryPage />} />
          </Route>

          <Route path="/sources" element={<DataSources />} />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <AppShell />
    </AppStateProvider>
  );
}
