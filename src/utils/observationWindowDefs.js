/**
 * THE OBSERVATION HORIZONS, AS DEFINITIONS.
 *
 * The seven windows the interface offers and the capability ladder that says
 * what each one can honestly support. Constants and a lookup — no data, no
 * database, nothing to load.
 *
 * Extracted from `observationWindows.js`, which also holds the helpers that
 * read the bundled observation table. A screen wanting the window LABELS had
 * to import that module and pulled the whole bundled catalogue in behind it,
 * which is exactly the dependency this migration removes.
 *
 * The backend owns the same ladder (`lib/windows.ts`) and decides what a
 * window actually covers. These are the names and the notes the interface
 * puts on them.
 */

export const OBSERVATION_WINDOWS = [
  { key: "d1", days: 1, label: "1 day", short: "1d" },
  { key: "d2", days: 2, label: "2 days", short: "2d" },
  { key: "d3", days: 3, label: "3 days", short: "3d" },
  { key: "d7", days: 7, label: "7 days", short: "7d" },
  { key: "d15", days: 15, label: "15 days", short: "15d" },
  { key: "d30", days: 30, label: "1 month", short: "1m" },
  { key: "d90", days: 90, label: "3 months", short: "3m" },
];

export const DEFAULT_WINDOW_KEY = "d30";

/**
 * What a horizon can support, given how much was captured in it.
 *
 * The point of naming these is refusal: a window holding one observation is a
 * price level and not a movement, and saying "the price is stable" from it
 * would be a claim the data cannot carry. Each note is the sentence the
 * interface shows instead.
 */
export const CAPABILITY = {
  none: { rank: 0, label: "No observation", note: "Nothing was captured inside this window." },
  snapshot: {
    rank: 1,
    label: "Snapshot",
    note: "One observation. That is a price level, not a movement — nothing can be said about direction or stability at this horizon.",
  },
  directional: {
    rank: 2,
    label: "Directional",
    note: "Enough observations to say which way the price moved and how wide it ranged, but too few for volatility to mean anything.",
  },
  distributional: {
    rank: 3,
    label: "Distributional",
    note: "Enough observations for a median, a volatility reading and a trend.",
  },
};

/** The horizon a key names, or the default when the key is unknown or absent. */
export function windowByKey(key) {
  return OBSERVATION_WINDOWS.find((w) => w.key === key) ?? OBSERVATION_WINDOWS.find((w) => w.key === DEFAULT_WINDOW_KEY);
}

/**
 * The key the BACKEND uses for the same horizon.
 *
 * The interface names these `d30`; the API names them `1m`. Two vocabularies
 * for one ladder is not ideal, but they are both already in use — the API's
 * keys appear in its own responses and the interface's in the URL — so the
 * translation lives here rather than being done at each call site.
 */
export function backendWindowKey(key) {
  return windowByKey(key)?.short ?? "1m";
}
