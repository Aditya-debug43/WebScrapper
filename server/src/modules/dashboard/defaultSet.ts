import type { ProductProfileRow } from "./dashboard.repository.js";

/**
 * THE DEFAULT DESK
 * ================
 *
 * Which products a visitor sees before they have chosen any. Ported from
 * `src/utils/demoSet.js`, which built the same set in the browser by reading
 * the whole bundled catalogue — the single largest reason the frontend needed
 * that dataset at runtime, since choosing twelve products required profiling
 * all of them.
 *
 * The method is unchanged, and it is a method rather than a list on purpose:
 * twelve products picked by eye would all look good, and a desk that never
 * shows a thin or a refused case hides the behaviour most worth showing.
 * Every product is profiled on reach, capture depth and how many candidate
 * comparables share its type and price band; it is assigned the evidence tier
 * those imply; and the set is then filled tier by tier under diversity
 * constraints.
 *
 * Pure. It takes profiles and returns ids, so the strata can be tested
 * without a database.
 */

const TARGET_SIZE = 12;

/** The engine's own absolute price band for a candidate comparable. */
const BAND_LOW = 0.6;
const BAND_HIGH = 1.7;

/** Cadence thresholds mirror the generator's capture tiers (2 / 5 / 12 days). */
const DEEP_CADENCE = 3;
const STANDARD_CADENCE = 6;

const HISTORY_SPAN_DAYS = 120;

/**
 * At most two products from any one department.
 *
 * A hard constraint rather than a scoring nudge: without it the strong tier
 * fills entirely with beauty products, which honestly reflects the catalogue
 * — FMCG carries the review volume that buys the deepest capture cadence —
 * but makes a poor desk, because four shampoos cannot show that the framework
 * is not tuned to one kind of product.
 */
const MAX_PER_DEPARTMENT = 2;

/**
 * Weighted toward the middle because that is where most of a real catalogue
 * lives, with thin and refusal cases over-represented relative to their
 * frequency because they are the ones that test the honesty of the system.
 */
const QUOTA = { strong: 3, moderate: 4, thin: 3, refused: 2 } as const;

export type EvidenceTier = "strong" | "moderate" | "thin" | "refused";

export type Profile = ProductProfileRow & {
  cadenceDays: number | null;
  candidateCount: number;
  typePopulation: number;
  expectedTier: EvidenceTier;
};

/**
 * Capture cadence, inferred from how many points the deepest offer carries
 * over the generator's fixed history span. Exact enough to tier by, and free.
 */
function cadenceOf(pointsPerOffer: number): number | null {
  if (pointsPerOffer <= 1) return null;
  return Math.round((HISTORY_SPAN_DAYS / (pointsPerOffer - 1)) * 10) / 10;
}

/**
 * How many products could even be considered as comparables — the engine's
 * first gate, applied cheaply.
 *
 * A product with two candidates cannot reach the five-competitor target no
 * matter how good the similarity scoring is, which is what makes this a sound
 * proxy for "the engine will struggle here".
 */
function candidateCounts(rows: ProductProfileRow[]): Map<string, { count: number; population: number }> {
  const out = new Map<string, { count: number; population: number }>();
  const byType = new Map<string, ProductProfileRow[]>();

  for (const p of rows) {
    if (!p.productTypeId || p.priceMinor == null) continue;
    const group = byType.get(p.productTypeId) ?? [];
    group.push(p);
    byType.set(p.productTypeId, group);
  }

  for (const group of byType.values()) {
    group.sort((a, b) => a.priceMinor! - b.priceMinor!);
    for (const p of group) {
      const lo = p.priceMinor! * BAND_LOW;
      const hi = p.priceMinor! * BAND_HIGH;
      let n = 0;
      for (const q of group) {
        if (q.id === p.id) continue;
        if (q.priceMinor! >= lo && q.priceMinor! <= hi) n++;
      }
      out.set(p.id, { count: n, population: group.length });
    }
  }

  for (const p of rows) if (!out.has(p.id)) out.set(p.id, { count: 0, population: 0 });
  return out;
}

/**
 * The evidence tier this product is EXPECTED to land in.
 *
 * The engine has the final word when the product is opened; this is a
 * structural read used to make sure the desk spans the range rather than
 * clustering at the top.
 */
export function tierOf(p: {
  candidateCount: number;
  marketplaceCount: number;
  cadenceDays: number | null;
}): EvidenceTier {
  const deepHistory = p.cadenceDays != null && p.cadenceDays <= DEEP_CADENCE;
  const okHistory = p.cadenceDays != null && p.cadenceDays <= STANDARD_CADENCE;

  // Below two candidates the engine cannot reach the two-comparable minimum
  // however good the similarity scoring is, so this is where refusal lives.
  if (p.candidateCount < 2) return "refused";
  if (p.candidateCount < 4 || p.marketplaceCount < 1) return "thin";
  if (p.marketplaceCount >= 4 && deepHistory && p.candidateCount >= 8) return "strong";
  if (p.marketplaceCount >= 2 && okHistory && p.candidateCount >= 5) return "moderate";
  return "thin";
}

export function buildProfiles(rows: ProductProfileRow[]): Profile[] {
  const usable = rows.filter((p) => p.offerCount > 0 && p.priceMinor != null);
  const counts = candidateCounts(usable);
  return usable.map((p) => {
    const c = counts.get(p.id) ?? { count: 0, population: 0 };
    const cadenceDays = cadenceOf(p.pointsPerOffer);
    return {
      ...p,
      cadenceDays,
      candidateCount: c.count,
      typePopulation: c.population,
      expectedTier: tierOf({
        candidateCount: c.count,
        marketplaceCount: p.marketplaceCount,
        cadenceDays,
      }),
    };
  });
}

/**
 * Fill the set tier by tier, preferring within a tier whatever adds most that
 * is not already represented — a new department, a new product type, a new
 * price decade.
 *
 * Where a tier cannot be filled under the department cap, the shortfall is
 * carried and topped up from the other tiers at the end rather than quietly
 * dropped: a desk of nine products when twelve were asked for is a bug that
 * looks like a decision.
 */
export function pickStratified(
  profiles: Profile[],
  quota: Record<string, number> = QUOTA,
  targetSize = TARGET_SIZE
): Profile[] {
  const chosen: Profile[] = [];
  const deptCount = new Map<string | null, number>();
  const usedTypes = new Set<string>();
  const usedDecades = new Set<number>();
  const taken = new Set<string>();

  const priceDecade = (minor: number) => Math.floor(Math.log10(Math.max(minor / 100, 1)));

  const bestFrom = (pool: Profile[]): Profile | null => {
    let best: Profile | null = null;
    let bestScore = -Infinity;
    for (const p of pool) {
      if (taken.has(p.id)) continue;
      if ((deptCount.get(p.departmentId) ?? 0) >= MAX_PER_DEPARTMENT) continue;
      let score = 0;
      if (!deptCount.has(p.departmentId)) score += 100;
      if (!usedTypes.has(p.productTypeId)) score += 40;
      if (!usedDecades.has(priceDecade(p.priceMinor!))) score += 25;
      score += Math.min(p.marketplaceCount, 6) * 2;
      score += Math.min(p.candidateCount, 12);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  };

  const commit = (p: Profile) => {
    chosen.push(p);
    taken.add(p.id);
    deptCount.set(p.departmentId, (deptCount.get(p.departmentId) ?? 0) + 1);
    usedTypes.add(p.productTypeId);
    usedDecades.add(priceDecade(p.priceMinor!));
  };

  // Deterministic: same catalogue, same twelve products, so the desk does not
  // reshuffle between reloads.
  const sorted = (tier: string) =>
    profiles.filter((p) => p.expectedTier === tier).sort((a, b) => (a.id < b.id ? -1 : 1));

  let shortfall = 0;
  for (const [tier, count] of Object.entries(quota)) {
    const pool = sorted(tier);
    for (let i = 0; i < count; i++) {
      const best = bestFrom(pool);
      if (!best) {
        shortfall += count - i;
        break;
      }
      commit(best);
    }
  }

  const everything = profiles.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  while (shortfall > 0) {
    const best = bestFrom(everything);
    if (!best) break;
    commit(best);
    shortfall--;
  }

  return chosen.slice(0, targetSize);
}

export function selectDefaultSet(rows: ProductProfileRow[]): Profile[] {
  return pickStratified(buildProfiles(rows));
}
