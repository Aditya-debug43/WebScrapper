import type { PriceDistribution } from "../market/competition.js";

/**
 * THE STATISTICAL POSITION, WITH NO MODEL INVOLVED
 * ================================================
 *
 * A pure function of three inputs, extracted from the pricing service so that
 * every adjustment it makes can be tested with a handful of numbers rather
 * than through a database, a provider and an AI port.
 *
 * That is not tidiness. The guarantee that matters most here — never
 * recommend below the cheapest real offer — was asserted nowhere while this
 * lived as a private method, because constructing the inputs that trigger it
 * required a history median far below the current market, which no
 * integration test happened to produce. Mutation testing found it: the floor
 * guard could be deleted and the suite stayed green.
 *
 * Deliberately explicable: every adjustment is one a seller could have made
 * by hand from the same table, and each states its reason in `factors`. It
 * exists to be a floor under the answer — if the AI is unavailable or wrong,
 * there is still something defensible, and it can be shown next to the AI's
 * view for comparison.
 *
 * It reads the STRUCTURE of the competition, not just its average, because
 * the two most common mistakes in pricing against a market are chasing a lone
 * cheap outlier and joining a crowded floor. A median cannot tell those
 * apart; the floor gap and the floor count can.
 */

/**
 * The structural facts this engine reads.
 *
 * Narrower than the full `CompetitiveStructure` on purpose: the engine needs
 * the floor, the gap above it and how crowded it is, and nothing about WHICH
 * seller holds it. Taking the narrow type means a reader can see at a glance
 * that the recommendation does not depend on any particular competitor's
 * identity.
 */
export type DeterministicStructure = {
  floorMinor: number;
  secondFloorMinor: number | null;
  floorGapMinor: number | null;
  atFloorCount: number;
  clustering: number;
};

/** Only what the engine reads of a product's captured history. */
export type DeterministicHistory = {
  observationCount: number;
  medianMinor: number;
} | null;

export type DeterministicVerdict = {
  recommendedMinor: number;
  rangeMinMinor: number;
  rangeMaxMinor: number;
  confidence: "low" | "medium" | "high";
  /** Every adjustment, in the order applied, each with its reason. */
  factors: string[];
  /** True when the recommendation sits at the contested floor. */
  atFloor: boolean;
};

/** Below this many captures, history describes the sampling, not the product. */
export const MIN_HISTORY_FOR_ENHANCEMENT = 5;
/** Below this many sellers, the current market is not a market. */
export const MIN_USABLE_SELLERS = 3;
/** Within this of the floor, a price is "at" the floor. */
const FLOOR_TOLERANCE = 0.02;
/** A floor this many sellers deep is defended rather than available. */
const CONTESTED_FLOOR = 3;
/** A cheapest price this far below the next is an outlier, not the market. */
const OUTLIER_GAP_PCT = 8;

export function deterministicPrice(
  dist: PriceDistribution,
  struct: DeterministicStructure,
  history: DeterministicHistory
): DeterministicVerdict {
  // Just under the median: competitive without starting a race to the floor.
  let target = Math.round(dist.medianMinor * 0.98);

  const factors: string[] = [
    `Median ${(dist.medianMinor / 100).toFixed(2)} across ${dist.sellerCount} competing seller(s) on ${dist.marketplaceCount} marketplace(s).`,
    "Positioned 2% under the median — competitive without undercutting the floor.",
  ];

  /**
   * A CROWDED FLOOR IS A DEFENDED POSITION.
   *
   * When several sellers already sit within 2% of the cheapest price, moving
   * there does not win the sale — it joins a group that will match any
   * further cut. The defensible move is to sit above that contest, so the
   * target is lifted to the lower quartile at least.
   */
  if (struct.atFloorCount >= CONTESTED_FLOOR) {
    if (target < dist.p25Minor) {
      target = dist.p25Minor;
    }
    factors.push(
      `${struct.atFloorCount} sellers are already within 2% of the cheapest price; that floor is contested, so the target sits above it rather than joining the pack.`
    );
  } else if (struct.floorGapMinor != null && struct.secondFloorMinor != null) {
    /**
     * A LONE CHEAP SELLER IS NOT THE MARKET.
     *
     * One seller well below everyone else is usually stale, grey or
     * mispriced. Pricing against it drags the recommendation down toward a
     * number nobody else is charging, so the second-cheapest is reported as
     * the effective floor when the gap is wide.
     */
    const gapPct = struct.floorMinor > 0 ? (struct.floorGapMinor / struct.floorMinor) * 100 : 0;
    if (gapPct >= OUTLIER_GAP_PCT) {
      factors.push(
        `The cheapest seller is ${gapPct.toFixed(1)}% below the next; treated as an outlier, so the effective floor is ${(struct.secondFloorMinor / 100).toFixed(2)}.`
      );
    }
  }

  if (history && history.observationCount >= MIN_HISTORY_FOR_ENHANCEMENT) {
    /**
     * With real history, the current competition is weighed against where
     * this product has actually traded — 70/30 toward the present, because
     * the market now is what a buyer sees and history is context for it.
     */
    target = Math.round(target * 0.7 + history.medianMinor * 0.3);
    factors.push(
      `Blended with an observed median of ${(history.medianMinor / 100).toFixed(2)} over ${history.observationCount} capture(s) of this product's market.`
    );
  }

  /**
   * NEVER BELOW THE CHEAPEST REAL OFFER.
   *
   * The floor is a fact about the market, not a target to beat —
   * recommending beneath it would be recommending a price no evidence
   * supports. It is last because the blend above can reach below it: a
   * product whose history is well under its current market pulls the target
   * down, and without this the system would advise a seller to undercut a
   * price nobody is currently charging.
   */
  if (target < dist.lowMinor) {
    target = dist.lowMinor;
    factors.push("Raised to the cheapest observed offer — recommending below the market floor would not be defensible.");
  }

  /**
   * CONFIDENCE FOLLOWS THE BREADTH OF THE EVIDENCE, not the tidiness of the
   * answer. A narrow spread across two stores is not strong evidence; it is
   * two data points that happen to agree.
   */
  const confidence: DeterministicVerdict["confidence"] =
    dist.marketplaceCount >= 4 && dist.sellerCount >= 5 && (history?.observationCount ?? 0) >= MIN_HISTORY_FOR_ENHANCEMENT
      ? "high"
      : dist.marketplaceCount >= 3 && dist.sellerCount >= MIN_USABLE_SELLERS
        ? "medium"
        : "low";

  return {
    recommendedMinor: target,
    rangeMinMinor: Math.min(dist.p25Minor, target),
    rangeMaxMinor: Math.max(dist.p75Minor, target),
    confidence,
    factors,
    atFloor: target <= struct.floorMinor * (1 + FLOOR_TOLERANCE),
  };
}
