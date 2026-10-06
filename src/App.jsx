import { Routes, Route } from "react-router-dom";
import Masthead from "./components/layout/Masthead";
import Colophon from "./components/layout/Colophon";
import ProductWorkspaceLayout from "./components/layout/ProductWorkspaceLayout";
import { RedirectIfAuthenticated, RequireAuth } from "./components/auth/RouteGuards";
import { AppStateProvider, useAppState } from "./state/AppStateContext";
import { AuthProvider } from "./state/AuthContext";
import { ThemeProvider } from "./state/ThemeContext";

import Dashboard from "./pages/Dashboard";
import Catalogue from "./pages/Catalogue";
import ProductOverview from "./pages/ProductOverview";
import MarketplaceComparison from "./pages/MarketplaceComparison";
import ListingDetail from "./pages/ListingDetail";
import PriceHistoryPage from "./pages/PriceHistoryPage";
import CrossMarketplaceAnalysis from "./pages/CrossMarketplaceAnalysis";
import PricingRecommendation from "./pages/PricingRecommendation";
import DataSources from "./pages/DataSources";

import SignIn from "./pages/auth/SignIn";
import CreateAccount from "./pages/auth/CreateAccount";
import VerifyEmail from "./pages/auth/VerifyEmail";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";

/**
 * The signed-in application.
 *
 * Everything below the masthead is the pricing desk, and every route in it
 * is behind the guard. The authentication screens live outside this shell
 * entirely — they have their own layout, and putting a masthead with a
 * search field and an alert count above a sign-in form would be furniture
 * for a room the visitor has not been let into.
 */
function Workspace() {
  /**
   * The badge counts what this user follows.
   *
   * It used to be an alert count computed over a global seeded product set
   * — a number about products nobody had chosen. There is no synthetic
   * alert source any more, and inventing one would be the same mistake.
   */
  const { trackedProducts } = useAppState();

  return (
    <div className="app-shell">
      <Masthead alertCount={trackedProducts.length} />
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

function AppRoutes() {
  return (
    <Routes>
      {/* Anonymous only. A signed-in visitor is sent to the desk. */}
      <Route element={<RedirectIfAuthenticated />}>
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/create-account" element={<CreateAccount />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Route>

      {/* Everything else. The guard captures where the visitor was going, so
          signing in returns them there rather than dumping them on the
          dashboard. */}
      <Route element={<RequireAuth />}>
        <Route path="/*" element={<Workspace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppStateProvider>
          <AppRoutes />
        </AppStateProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
