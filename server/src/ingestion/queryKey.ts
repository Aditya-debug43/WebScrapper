/**
 * THE MARKET-QUESTION KEY
 * =======================
 *
 * Two searches that ask the same question about the market should cost one
 * provider call, not two. This turns a typed query into the key that decides
 * it.
 *
 *   "iPhone 17 256 GB"  ─┐
 *   "iphone 17 256gb"    ├─>  "iphone 17 256gb"
 *   "  iPhone  17 256GB" ─┘
 *
 * NORMALISATION COLLAPSES FORMATTING. IT MUST NOT COLLAPSE MEANING.
 *
 * That distinction is the whole risk here, and this project has already paid
 * for getting it wrong once: the matcher used to strip capacities before
 * tokenising, which turned "iPhone 13" and "iPhone 15" into the same token
 * list and matched them to each other. The lesson is that a number attached
 * to a model is not noise.
 *
 * So the only things treated as formatting are case, surrounding whitespace,
 * repeated whitespace, and the gap between a number and a unit that belongs
 * to it (`256 gb` -> `256gb`). Everything else survives: model numbers,
 * capacities, RAM, sizes, generations, colours, variant words. Two queries
 * that differ by a digit are two different questions.
 *
 * Deliberately NOT done here: stemming, synonym folding, word reordering, or
 * dropping "small" words. Each would merge products that are genuinely
 * distinct — "iPhone 15 Pro" and "iPhone 15 Pro Max" differ by one such word.
 */

/** Units that bind to the number in front of them. */
const BOUND_UNITS = ["gb", "tb", "mb", "ml", "mm", "cm", "kg", "gm", "g", "l", "w", "wh", "mah", "inch", "in"];

const UNIT_GAP = new RegExp(`(\\d)\\s+(${BOUND_UNITS.join("|")})\\b`, "g");

/**
 * The key two equivalent queries share.
 *
 * Stable across releases by contract: it is persisted on `capture_runs` and
 * used to find reusable captures, so changing the algorithm silently orphans
 * every snapshot already recorded. A change here needs a migration that
 * recomputes the stored keys.
 */
export function normalizeQuery(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    // Punctuation that separates rather than distinguishes. Hyphens become
    // spaces rather than vanishing, so "wi-fi" and "wi fi" agree while
    // "x100" and "x 100" stay apart.
    .replace(/[,/\\|()[\]{}]/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(UNIT_GAP, "$1$2");
}

/**
 * Is this worth sending to a provider at all?
 *
 * A one-character query returns noise and still costs a call.
 */
export function isUsableQuery(raw: string): boolean {
  return normalizeQuery(raw).replace(/\s/g, "").length >= 2;
}
