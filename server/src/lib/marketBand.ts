/**
 * KEEPING ACCESSORIES OUT OF A PRODUCT'S MARKET
 * =============================================
 *
 * A shopping search for a product returns the product AND everything sold
 * alongside it. Asking for "Apple iPhone 18 Pro Max" really returns:
 *
 *     ₹958     iPhone 18 Pro Max Camera Bar Artist Series Skins
 *     ₹1,300   iPhone 18 Pro Max Skins & Wraps
 *     ₹1,899   Apple iPhone 18 Pro Max Silicone Case with MagSafe
 *     …
 *     ₹2,39,899  the actual phone
 *
 * Every one of those titles genuinely contains the product name, so no amount
 * of text matching separates them. Taken at face value the median of that set
 * is about ₹6,900 — and a recommendation built on it prices a phone against
 * phone cases. That is not a small inaccuracy; it is a confident, specific,
 * completely wrong number, which is worse than refusing.
 *
 * WHAT SEPARATES THEM IS PRICE, ANCHORED ON SOMETHING WE KNOW
 *
 * We are never guessing in the dark: the user chose a specific offer, and its
 * price was recorded as a real observation. A case does not cost half of a
 * phone. So a competitor is an offer within a band of what this product has
 * actually been observed to cost, and everything outside is a different
 * product that happens to share a name.
 *
 * The band is deliberately wide. It exists to exclude accessories and
 * obviously-wrong rows, not to decide which storage variant counts — that is
 * a pricing judgement and belongs to the engine, which can see the offers
 * this leaves behind.
 *
 * WHAT THIS DOES NOT DO: invent, adjust or reweight a price. It only decides
 * which observed offers are describing the same kind of thing. Excluded rows
 * are counted and reported, never silently dropped.
 */

/**
 * Half the anchor to double it.
 *
 * Wider than the matcher's 0.6–1.7 comparable band, because that band is
 * choosing between near-identical variants while this one only has to tell a
 * phone from a phone case. Erring wide keeps genuine competitors — a steep
 * discount or a premium bundle — at the cost of letting through the
 * occasional expensive accessory, which the median then absorbs.
 */
export const BAND_LOW = 0.5;
export const BAND_HIGH = 2.0;

export type BandedMarket<T> = {
  kept: T[];
  /** Excluded as a different kind of product, with the band that judged them. */
  excluded: T[];
  anchorMinor: number;
  loMinor: number;
  hiMinor: number;
};

/**
 * Split offers into those describing this product and those that do not.
 *
 * `anchorMinor` should be a price this product has really been observed at —
 * normally the offer the user chose when they started tracking it.
 */
export function bandAroundAnchor<T>(
  offers: T[],
  priceOf: (offer: T) => number | null,
  anchorMinor: number
): BandedMarket<T> {
  const loMinor = Math.round(anchorMinor * BAND_LOW);
  const hiMinor = Math.round(anchorMinor * BAND_HIGH);

  const kept: T[] = [];
  const excluded: T[] = [];
  for (const offer of offers) {
    const price = priceOf(offer);
    if (price == null || price <= 0) continue;
    (price >= loMinor && price <= hiMinor ? kept : excluded).push(offer);
  }
  return { kept, excluded, anchorMinor, loMinor, hiMinor };
}

/**
 * An anchor when nothing has been observed yet.
 *
 * Falls back to the DEAREST offers rather than the median, because the
 * contamination is reliably one-directional: a search returns many cheap
 * accessories and few expensive decoys. The 75th percentile sits inside the
 * real product's cluster when accessories are the majority, where the median
 * sits among the accessories themselves.
 *
 * A guess, and a worse anchor than a real observation — used only when there
 * is no observation at all.
 */
export function provisionalAnchor(pricesMinor: number[]): number | null {
  if (pricesMinor.length === 0) return null;
  const sorted = [...pricesMinor].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.75);
  return sorted[Math.min(idx, sorted.length - 1)]!;
}
