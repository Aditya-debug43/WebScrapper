import { Routes, Route } from "react-router-dom";
import Masthead from "./components/layout/Masthead";
import Colophon from "./components/layout/Colophon";
import ProductWorkspaceLayout from "./components/layout/ProductWorkspaceLayout";
import { AppStateProvider, useAppState } from "./state/AppStateContext";
import { ThemeProvider } from "./state/ThemeContext";
import { useAsyncData } from "./utils/useAsyncData";
import { getPriceAlerts } from "./api/dashboardService";

import Dashboard from "./pages/Dashboard";
import Catalogue from "./pages/Catalogue";
import ProductOverview from "./pages/ProductOverview";
import MarketplaceComparison from "./pages/MarketplaceComparison";
import ListingDetail from "./pages/ListingDetail";
import PriceHistoryPage from "./pages/PriceHistoryPage";
import CrossMarketplaceAnalysis from "./pages/CrossMarketplaceAnalysis";
import PricingRecommendation from "./pages/PricingRecommendation";
import DataSources from "./pages/DataSources";

function AppShell() {
  const { trackedProductIds } = useAppState();
  const { data: alerts } = useAsyncData(() => getPriceAlerts(trackedProductIds), [trackedProductIds]);

  return (
    <div className="app-shell">
      <Masthead alertCount={alerts?.length ?? 0} />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/catalogue" element={<Catalogue />} />

          <Route element={<ProductWorkspaceLayout />}>
            <Route path="/products/:productId" element={<ProductOverview />} />
            <Route path="/products/:productId/marketplaces" element={<MarketplaceComparison />} />
            <Route path="/products/:productId/analysis" element={<CrossMarketplaceAnalysis />} />
            <Route path="/products/:productId/recommendation" element={<PricingRecommendation />} />
            <Route path="/listings/:listingId" element={<ListingDetail />} />
            <Route path="/listings/:listingId/history" element={<PriceHistoryPage />} />
          </Route>

          <Route path="/sources" element={<DataSources />} />
        </Routes>
      </main>
      <Colophon />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppStateProvider>
        <AppShell />
      </AppStateProvider>
    </ThemeProvider>
  );
}
