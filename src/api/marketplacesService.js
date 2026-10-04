import { apiRequest } from "./http";

/**
 * THE MARKETPLACE DIRECTORY, FROM THE BACKEND.
 *
 * Several screens need to turn a marketplace id into a name and a colour — a
 * row of platform pips, a legend, a filter label. That used to be a lookup
 * against a bundled six-item array, and that array is exactly why a store
 * discovered from provider data rendered as a blank, nameless dot: it was not
 * in the list, so there was nothing to find.
 *
 * The backend decides which marketplaces exist. Adding one is now a row in the
 * database, not a frontend release.
 *
 * ── Cached for the session, deliberately ─────────────────────────────────
 * The directory is small and changes when a provider discovers a store —
 * minutes at the very fastest, not seconds — so one request per page load is
 * waste and one per pip is absurd. The promise is memoised rather than the
 * result, so concurrent callers share a single in-flight request instead of
 * racing to make their own.
 *
 * A failed request is NOT cached: the next caller retries. Caching the failure
 * would turn one bad moment into a session with no marketplace names in it.
 */

let inFlight = null;

/** Every marketplace the backend knows, curated and discovered alike. */
export async function getMarketplaceDirectory({ signal } = {}) {
  if (inFlight) return inFlight;

  inFlight = apiRequest("/marketplaces", { signal })
    .then((body) => {
      const rows = body?.data ?? [];
      return new Map(
        rows.map((m) => [
          m.id,
          {
            id: m.id,
            name: m.name,
            brandColor: m.brandColor ?? null,
            type: m.marketplaceType ?? null,
            /** True for a store learned from a provider rather than modelled. */
            isDiscovered: m.isDiscovered ?? false,
          },
        ])
      );
    })
    .catch((error) => {
      inFlight = null;
      throw error;
    });

  return inFlight;
}

/** Drop the cache. For tests, and for a future "refresh" that needs one. */
export function resetMarketplaceDirectory() {
  inFlight = null;
}
