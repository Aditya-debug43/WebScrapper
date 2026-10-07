import { normalizeQuery } from "./queryKey.js";

/**
 * IS THIS RESULT THE THING THAT WAS SEARCHED FOR?
 * ===============================================
 *
 * A shopping search for "iphone 18 pro" returns, in order:
 *
 *     ₹1,63,568  Apple iPhone 18 Pro 256GB Black
 *     ₹1,63,568  Apple iPhone 18 Pro 256GB Burgundy
 *     ₹2,602     Otofly iPhone 18 Pro Silicone Case with MagSafe
 *     ₹4,338     iPhone 18 Pro SolidX
 *     ₹6,653     iPhone 18 Pro AirX
 *     ... thirty more cases, skins and covers
 *
 * Two real phones and thirty-eight accessories, every one of which genuinely
 * contains the searched words. Shown unranked, the page is a case catalogue.
 * Fed to pricing, the market median becomes ₹4,338 and a flagship phone is
 * recommended at the price of a rubber case.
 *
 * WHY THERE IS NO WORD LIST HERE
 *
 * The obvious fix — drop titles containing "case", "cover", "skin",
 * "protector" — fails the moment the catalogue is not phones. Laptops bring
 * "sleeve", "bag", "charger", "dock"; cameras bring "strap", "hood", "cage";
 * shoes bring "laces", "insole". The list is endless, always incomplete, and
 * wrong for the user who genuinely wants a case.
 *
 * WHAT IS USED INSTEAD: THE SHAPE OF THE RESULT SET
 *
 * Three signals, none of which names a product category, and all of which
 * calibrate themselves against the results actually returned:
 *
 *   COVERAGE      how much of the query the title accounts for. A title
 *                 missing half the query is about something else.
 *
 *   EXTRANEOUS    tokens the title adds beyond the query that are not
 *                 specifications. "256GB" and "Black" qualify a product;
 *                 "Silicone Case" and "SolidX" introduce a different one.
 *                 Numbers, units, colours and the seller's own name are not
 *                 counted, because those decorate rather than replace.
 *
 *   COHORT        prices cluster. The real product and its storage variants
 *                 sit together; accessories sit an order of magnitude below.
 *                 The cohort is not assumed to be the dearest — it is the one
 *                 whose titles add fewest extraneous tokens, which is what
 *                 "these titles are about the thing itself" looks like
 *                 numerically.
 *
 * The last signal is what makes the whole thing general. It learns, from this
 * response alone, that "case" marks an accessory for a phone and "sleeve"
 * does for a laptop, without being told either. And when the user searches
 * FOR an accessory — "iphone 18 pro case" — those titles cover the query
 * fully, add nothing extraneous, and form the dominant cohort, so they become
 * the product and the phones become the outliers. The rule inverts by itself.
 *
 * ONE RULE, USED EVERYWHERE. Search ranks with it, pricing evidence is
 * filtered by it, and the scheduler records observations through it, so a
 * product cannot be displayed as one thing and priced as another.
 */

/** What a result is, relative to what was asked for. */
export type Relevance = "strong" | "plausible" | "accessory" | "irrelevant";

export type ScoredResult<T> = {
  item: T;
  relevance: Relevance;
  /** 0..1. Ranking only — not shown to the user as a number. */
  score: number;
  coverage: number;
  extraneous: string[];
  reason: string;
};

/** Tokens that qualify a product rather than replace it. */
const SPEC_PATTERN = /^(?:\d+(?:\.\d+)?(?:gb|tb|mb|ml|mm|cm|kg|g|l|w|wh|mah|inch|in|k|hz)?|\d+(?:st|nd|rd|th)|v\d+|gen\d*)$/i;

/**
 * Short alphanumeric model and configuration codes — i5, i7, m3, a17,
 * rtx4060, 15-eg3020na.
 *
 * These name a configuration, not a kind of object. Counting them as
 * extraneous made "HP Pavilion 15 Laptop Intel Core i5 16GB" look like four
 * words about something else, and threw the laptops away.
 */
const MODEL_CODE = /^[a-z]{1,4}\d+[a-z0-9-]*$|^\d+[a-z]+[a-z0-9-]*$/i;

/**
 * Colour and finish words.
 *
 * NOT a product-category list — these never distinguish one kind of object
 * from another, they only distinguish two of the same object. Kept short on
 * purpose: an unrecognised colour costs one extraneous token, which the
 * cohort signal then absorbs.
 */
const QUALIFIERS = new Set([
  "black", "white", "blue", "grey", "gray", "silver", "gold", "green", "red", "purple",
  "pink", "yellow", "orange", "titanium", "graphite", "midnight", "starlight", "lavender",
  "burgundy", "beige", "cream", "navy", "teal", "bronze", "copper", "rose", "natural", "desert",
  "new", "latest", "official", "genuine", "original", "unlocked", "sealed", "edition",
  "and", "with", "for", "the", "a", "in", "of", "plus",
]);

const tokenize = (text: string): string[] =>
  normalizeQuery(text)
    .split(/\s+/)
    .filter((t) => t.length > 0);

/**
 * Tokens a title adds that are neither asked for nor merely descriptive.
 *
 * The seller's name is excluded: "Otofly iPhone 18 Pro Silicone Case" from
 * otofly.co should be charged for "silicone" and "case", not for being sold
 * by its own maker — every listing names its seller.
 */
function extraneousTokens(titleTokens: string[], queryTokens: Set<string>, sourceTokens: Set<string>): string[] {
  const out: string[] = [];
  for (const token of titleTokens) {
    if (queryTokens.has(token)) continue;
    if (QUALIFIERS.has(token)) continue;
    if (SPEC_PATTERN.test(token)) continue;
    if (MODEL_CODE.test(token)) continue;
    if (sourceTokens.has(token)) continue;
    if (token.length <= 1) continue;
    out.push(token);
  }
  return out;
}

/**
 * Split prices into cohorts at their largest proportional gap.
 *
 * Proportional rather than absolute, because the gap between a phone and its
 * case is the same *shape* as the gap between a laptop and its sleeve while
 * being a wildly different number of rupees. A gap only counts as a boundary
 * if the dearer side is several times the cheaper one; without that, a set of
 * genuine storage variants would be split in half.
 */
function cohortBoundary(pricesAscending: number[]): number | null {
  if (pricesAscending.length < 3) return null;

  /**
   * Scanned from the TOP down, taking the first significant gap.
   *
   * Not the largest gap anywhere, which is what this did at first and which
   * is wrong whenever results come in more than two tiers. A capture holding
   * a case at ₹2,699, a battery at ₹17,999, housing panels at ₹32,999 and
   * phones at ₹1,63,568 has its widest gap between the case and the
   * battery — so "largest gap" drew the line there and called the batteries
   * and panels products.
   *
   * Working down from the dearest isolates the top cluster, which is the
   * boundary that actually matters: whatever else is going on underneath, a
   * product and the things sold for it separate at the first real step down
   * from the top.
   */
  for (let i = pricesAscending.length - 1; i > 0; i--) {
    const upper = pricesAscending[i]!;
    const lower = pricesAscending[i - 1]!;
    if (lower <= 0) continue;
    // Threefold. Below that it is a price range, not two kinds of object.
    if (upper / lower >= 3) return upper;
  }
  return null;
}

export type RelevanceInput = {
  title: string;
  priceMinor: number | null;
  /** The store, so its own name is not held against the listing. */
  source?: string | null;
};

/**
 * Rank and classify one provider response against the query that produced it.
 *
 * Returns every result, scored. Nothing is dropped here — the caller decides
 * what to show and what to price from, and a filter that silently discarded
 * rows would make a thin result set indistinguishable from a bad one.
 */
export function scoreResults<T extends RelevanceInput>(query: string, items: T[]): ScoredResult<T>[] {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0 || items.length === 0) {
    return items.map((item) => ({
      item,
      relevance: "plausible" as const,
      score: 0.5,
      coverage: 0,
      extraneous: [],
      reason: "No query tokens to judge against.",
    }));
  }

  /* --------------------------------------------- pass one: title structure */

  const measured = items.map((item) => {
    const titleTokens = tokenize(item.title);
    const present = new Set(titleTokens);
    const sourceTokens = new Set(tokenize(item.source ?? ""));

    let matched = 0;
    for (const token of queryTokens) if (present.has(token)) matched++;
    const coverage = matched / queryTokens.size;
    const extraneous = extraneousTokens(titleTokens, queryTokens, sourceTokens);

    return { item, coverage, extraneous };
  });

  /* ------------------------------------- pass two: which cohort is the product */

  const prices = measured
    .map((m) => m.item.priceMinor)
    .filter((p): p is number => p != null && p > 0)
    .sort((a, b) => a - b);

  const boundary = cohortBoundary(prices);

  /**
   * Which side of the gap holds the thing that was asked for.
   *
   * THE QUERY DECIDES, not the price.
   *
   * An earlier version picked the cohort with the fewest extraneous tokens,
   * on the theory that a product's title is tidier than an accessory's. It
   * is not: "HP Pavilion 15 Laptop Intel Core i5 16GB" carries more spare
   * words than "Laptop Sleeve for HP Pavilion 15", so the sleeve won and the
   * laptops were thrown away.
   *
   * What actually separates them is which words the USER supplied that only
   * one cohort uses. Tokens shared by every result say nothing — searching
   * "iphone 18 pro" when both phones and cases say "iphone 18 pro" leaves no
   * preference, and the product is then the dearer cohort, because an
   * accessory is not sold for more than the thing it attaches to.
   *
   * But add one word — "iphone 18 pro case" — and "case" appears throughout
   * the cheap cohort and nowhere in the expensive one. The user has named
   * the cohort they want, and the rule follows them rather than the money.
   * That is what makes this invert without any notion of what a case is.
   */
  let productCohortIsUpper = true;
  if (boundary != null) {
    const upper = measured.filter((m) => (m.item.priceMinor ?? 0) >= boundary);
    const lower = measured.filter((m) => (m.item.priceMinor ?? 0) < boundary);

    /** Query tokens that are not simply everywhere. */
    const discriminating = [...queryTokens].filter((token) => {
      const hits = measured.filter((m) => tokenize(m.item.title).includes(token)).length;
      return hits > 0 && hits < measured.length;
    });

    if (discriminating.length > 0 && upper.length > 0 && lower.length > 0) {
      const share = (rows: typeof measured) =>
        rows.reduce((total, row) => {
          const tokens = new Set(tokenize(row.item.title));
          return total + discriminating.filter((t) => tokens.has(t)).length / discriminating.length;
        }, 0) / rows.length;

      const upperShare = share(upper);
      const lowerShare = share(lower);
      /**
       * A clear preference only; a near-tie falls back to the dearer cohort.
       *
       * Ten points on a nought-to-one scale. Wide enough that one oddly
       * worded title cannot flip the whole result set, narrow enough to
       * catch a real preference — "iphone 18 pro case" separates the cohorts
       * by 0.2, and "iphone 18 pro" by 0.2 the other way, so anything much
       * above this would fail to invert at all.
       */
      if (Math.abs(upperShare - lowerShare) >= 0.15) productCohortIsUpper = upperShare > lowerShare;
    }
  }

  const inProductCohort = (priceMinor: number | null): boolean => {
    if (boundary == null || priceMinor == null) return true;
    return productCohortIsUpper ? priceMinor >= boundary : priceMinor < boundary;
  };

  /* ------------------------------------------------- pass three: classify */

  return measured.map(({ item, coverage, extraneous }) => {
    const cohort = inProductCohort(item.priceMinor);

    let relevance: Relevance;
    let reason: string;

    if (coverage < 0.6) {
      relevance = "irrelevant";
      reason = `Accounts for only ${Math.round(coverage * 100)}% of the query.`;
    } else if (!cohort && extraneous.length > 0) {
      /**
       * Both signals agree: priced like a different class of object, and the
       * title names something the query did not ask for. Either alone is not
       * enough — a discounted product is cheap without being an accessory,
       * and a long title is not an accessory either.
       */
      relevance = "accessory";
      reason = `Priced outside the product's range and describes "${extraneous.slice(0, 3).join(" ")}".`;
    } else if (extraneous.length > queryTokens.size || (extraneous.length >= 3 && coverage < 1)) {
      /**
       * The title is more about something else than about the query.
       *
       * Scaled against the query rather than a fixed count, which is what
       * makes it hold at both ends. "Apple iPhone 18 Pro Max Full Housing
       * Body Panel" answers a three-word query with six words of its own —
       * it is a spare part, and it slipped through an earlier fixed
       * threshold because it covered the query completely and happened to be
       * the dearest thing in the capture, so neither the coverage nor the
       * price signal caught it.
       *
       * Meanwhile "JETech Magnetic Matte Case for iPhone 18 Pro" adds three
       * words to a four-word query — fewer than were asked for — so someone
       * searching "iphone 18 pro case" still gets it. A longer, more
       * specific query earns more latitude, which is the right way round.
       */
      relevance = "accessory";
      reason = `Title is mostly about something else: "${extraneous.slice(0, 3).join(" ")}".`;
    } else if (coverage === 1 && extraneous.length <= 1 && cohort) {
      relevance = "strong";
      reason = "Matches the whole query and adds nothing beyond specification.";
    } else {
      relevance = "plausible";
      reason = extraneous.length
        ? `Matches the query but also mentions "${extraneous.slice(0, 2).join(" ")}".`
        : "Matches most of the query.";
    }

    // Ranking only. Coverage dominates; extraneous tokens and being outside
    // the product cohort both push a result down.
    const score = Math.max(
      0,
      Math.min(1, coverage - extraneous.length * 0.12 - (cohort ? 0 : 0.35))
    );

    return { item, relevance, score, coverage, extraneous, reason };
  });
}

/** The results worth treating as the product — for display and for pricing. */
export function productMatches<T extends RelevanceInput>(query: string, items: T[]): T[] {
  return scoreResults(query, items)
    .filter((r) => r.relevance === "strong" || r.relevance === "plausible")
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}
