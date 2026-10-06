import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getTracked, untrack as untrackApi } from "../api/discoveryService";
import { useAuth } from "./AuthContext";

const AppStateContext = createContext(null);

/**
 * WHAT THIS USER FOLLOWS.
 *
 * Two earlier versions of this file were wrong in the same way. The first
 * seeded itself with `DEFAULT_TRACKED_PRODUCT_IDS`, a stratified sample the
 * browser computed by profiling all 1,172 bundled products. The second asked
 * the backend for a default set instead — better, but still a list nobody had
 * chosen.
 *
 * There is no default now. You follow something by tracking it, the server
 * records who follows what, and an empty desk is the honest state for a new
 * account rather than a problem to paper over.
 *
 * The list is held here because two screens need it — the dashboard renders
 * it, and a product page needs to know whether its star is lit — and neither
 * should fetch it separately and drift.
 */
export function AppStateProvider({ children }) {
  const { token } = useAuth();
  const [tracked, setTracked] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) {
      setTracked([]);
      return;
    }
    setLoading(true);
    try {
      setTracked(await getTracked({ token }));
    } catch {
      /**
       * A failure leaves the list as it was rather than clearing it. An empty
       * desk means "you follow nothing", and a network blip must not be
       * allowed to say that.
       */
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isTracked = useCallback(
    (productId) => tracked.some((t) => t.productId === productId),
    [tracked]
  );

  const stopTracking = useCallback(
    async (productId) => {
      const row = tracked.find((t) => t.productId === productId);
      if (!row) return;
      await untrackApi(row.trackingId, { token });
      await refresh();
    },
    [tracked, token, refresh]
  );

  const value = useMemo(
    () => ({
      trackedProducts: tracked,
      trackedProductIds: tracked.map((t) => t.productId),
      loading,
      isTracked,
      stopTracking,
      refreshTracked: refresh,
    }),
    [tracked, loading, isTracked, stopTracking, refresh]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
