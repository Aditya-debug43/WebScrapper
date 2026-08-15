import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { DEFAULT_TRACKED_PRODUCT_IDS } from "../api/dashboardService";

const AppStateContext = createContext(null);

export function AppStateProvider({ children }) {
  const [trackedProductIds, setTrackedProductIds] = useState(DEFAULT_TRACKED_PRODUCT_IDS);

  const isTracked = useCallback((productId) => trackedProductIds.includes(productId), [trackedProductIds]);

  const toggleTracked = useCallback((productId) => {
    setTrackedProductIds((ids) =>
      ids.includes(productId) ? ids.filter((id) => id !== productId) : [...ids, productId]
    );
  }, []);

  const value = useMemo(
    () => ({ trackedProductIds, isTracked, toggleTracked }),
    [trackedProductIds, isTracked, toggleTracked]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
