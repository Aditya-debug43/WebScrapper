import { createContext, useContext, useMemo, useState, useCallback } from "react";

const AppStateContext = createContext(null);

/**
 * WHICH PRODUCTS ARE ON THE DESK.
 *
 * This used to be seeded with `DEFAULT_TRACKED_PRODUCT_IDS`, a stratified
 * sample the browser computed by profiling all 1,172 bundled products. That
 * one line was the largest single reason the frontend needed the catalogue at
 * runtime — choosing twelve products required reading every one of them.
 *
 * The backend chooses now, by the same method. So the initial state here is
 * not a list: it is `null`, meaning "nobody has chosen yet, let the server
 * decide". The server answers with whatever the user has tracked, or the
 * stratified default if they have tracked nothing, and the screen that
 * received that answer hands it back through `adoptResolvedIds`.
 *
 * The distinction is load-bearing. `null` and `[]` are different states: the
 * first asks the server for a desk, the second is a user who has deliberately
 * cleared theirs, and collapsing them would make an empty desk impossible to
 * express.
 */
export function AppStateProvider({ children }) {
  /** `null` until the user picks, which is what defers the choice to the server. */
  const [chosenIds, setChosenIds] = useState(null);
  /** The set the server last resolved, so a toggle has something to start from. */
  const [resolvedIds, setResolvedIds] = useState([]);

  const effectiveIds = chosenIds ?? resolvedIds;

  /**
   * Record what the server actually put on the desk.
   *
   * Only while the user has made no choice of their own — otherwise a page
   * load would silently discard their selection.
   */
  const adoptResolvedIds = useCallback((ids) => {
    setResolvedIds((current) => {
      const next = ids ?? [];
      if (current.length === next.length && current.every((id, i) => id === next[i])) return current;
      return next;
    });
  }, []);

  const isTracked = useCallback((productId) => effectiveIds.includes(productId), [effectiveIds]);

  const toggleTracked = useCallback((productId) => {
    setChosenIds((current) => {
      // The first toggle turns the server's set into the user's own.
      const base = current ?? resolvedIds;
      return base.includes(productId) ? base.filter((id) => id !== productId) : [...base, productId];
    });
  }, [resolvedIds]);

  const value = useMemo(
    () => ({
      /** The ids to render. Never null. */
      trackedProductIds: effectiveIds,
      /**
       * What to ASK the server for: undefined means "you decide". A screen
       * passes this straight through rather than sending the resolved set
       * back, so the server's own default stays authoritative until the user
       * overrides it.
       */
      requestedProductIds: chosenIds ?? undefined,
      hasOwnSelection: chosenIds != null,
      adoptResolvedIds,
      isTracked,
      toggleTracked,
    }),
    [effectiveIds, chosenIds, adoptResolvedIds, isTracked, toggleTracked]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
