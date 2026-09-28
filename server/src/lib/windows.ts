/**
 * OBSERVATION WINDOWS
 * ===================
 *
 * The seven horizons the interface already reads a product at. This is the
 * server-side counterpart of `src/utils/observationWindows.js`, and the two
 * must agree on three things or the same product will read differently
 * depending on who computed it:
 *
 *   1. The window list. 1 / 2 / 3 / 7 / 15 / 30 / 90 days.
 *   2. The arithmetic. A window is INCLUSIVE OF BOTH ENDS, so a 1-day window
 *      is the reference day itself and `start = end − (days − 1)`. Off by one
 *      here and every short window silently gains a day of evidence.
 *   3. The anchor. "Today" is the most recent observation the dataset
 *      actually holds, not a wall clock — see `referenceDate` below.
 *
 * A window is only ever a date range. What can be said inside one is decided
 * by how many observations are in it, never by how long it is; that
 * distinction is the whole point of the capability ladder, and it lives with
 * the aggregation rather than here.
 */

export const OBSERVATION_WINDOWS = [
  { key: "1d", days: 1, label: "1 day" },
  { key: "2d", days: 2, label: "2 days" },
  { key: "3d", days: 3, label: "3 days" },
  { key: "7d", days: 7, label: "7 days" },
  { key: "15d", days: 15, label: "15 days" },
  { key: "1m", days: 30, label: "1 month" },
  { key: "3m", days: 90, label: "3 months" },
] as const;

export type WindowKey = (typeof OBSERVATION_WINDOWS)[number]["key"];

export const WINDOW_KEYS = OBSERVATION_WINDOWS.map((w) => w.key) as unknown as WindowKey[];
export const DEFAULT_WINDOW: WindowKey = "1m";

const BY_KEY = new Map(OBSERVATION_WINDOWS.map((w) => [w.key, w]));

export type ResolvedWindow = {
  key: WindowKey;
  days: number;
  label: string;
  /** Inclusive. `YYYY-MM-DD`. */
  from: string;
  /** Inclusive. `YYYY-MM-DD`. */
  to: string;
};

/**
 * Turn a window key into a real date range, anchored on a reference day.
 *
 * The reference day is passed in rather than read here, because the honest
 * anchor is the dataset's own latest capture and only the repository knows
 * what that is. Hardcoding a date would quietly break the moment the data is
 * regenerated; using the wall clock would make every window empty, because
 * this dataset ends in the past relative to nothing in particular.
 */
export function resolveWindow(key: WindowKey, referenceDate: string): ResolvedWindow {
  const spec = BY_KEY.get(key);
  if (!spec) throw new Error(`Unknown observation window: ${key}`);
  return {
    key: spec.key,
    days: spec.days,
    label: spec.label,
    from: shiftDays(referenceDate, -(spec.days - 1)),
    to: referenceDate,
  };
}

/**
 * Date arithmetic on the `YYYY-MM-DD` string, in UTC.
 *
 * `Date.parse` of a bare date string is UTC midnight, and every value here is
 * a calendar date with no time component, so nothing can drift across a
 * timezone boundary. Using the local-time `setDate` path would move the
 * boundary by a day for anyone east or west of UTC.
 */
export function shiftDays(dateIso: string, delta: number): string {
  const at = Date.parse(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(at)) throw new Error(`Not a calendar date: ${dateIso}`);
  return new Date(at + delta * 86_400_000).toISOString().slice(0, 10);
}

/**
 * What a set of observations can support.
 *
 * Derived from the COUNT inside the window, never from the window's length.
 * Two to four points carry a direction but not a volatility — a coefficient
 * of variation over three samples describes the sampling, not the market.
 * One point carries a level and nothing else.
 *
 * These thresholds match `src/utils/observationWindows.js`. They are a
 * judgement call, so they are named rather than inlined.
 */
export const DIRECTIONAL_MIN = 2;
export const DISTRIBUTIONAL_MIN = 5;

export type Capability = "none" | "snapshot" | "directional" | "distributional";

export function capabilityFor(observationCount: number): Capability {
  if (observationCount <= 0) return "none";
  if (observationCount < DIRECTIONAL_MIN) return "snapshot";
  if (observationCount < DISTRIBUTIONAL_MIN) return "directional";
  return "distributional";
}

export const CAPABILITY_NOTE: Record<Capability, string> = {
  none: "Nothing was captured inside this window.",
  snapshot: "One observation. That is a price level, not a movement — nothing can be said about direction or stability at this horizon.",
  directional:
    "Enough observations to say which way the price moved and how wide it ranged, but too few for volatility to mean anything.",
  distributional: "Enough observations for a median, a volatility reading and a trend.",
};
