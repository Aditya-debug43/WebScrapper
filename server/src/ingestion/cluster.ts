import { normalizeQuery } from "./queryKey.js";
import { scoreResults, type RelevanceInput } from "./relevance.js";

/**
 * ONE PRODUCT, MANY CATALOGUE IDS
 * ===============================
 *
 * The provider publishes the same physical product under several catalogue
 * ids, and each id exposes only two or three of its sellers. This is not an
 * occasional quirk — it is the normal shape of the response. Measured live:
 *
 *   "sony wh-1000xm5"  →  28 rows carrying the model code
 *     id A → Amazon.in, Flipkart, Tata CLiQ
 *     id B → Amazon.in, Myntra, myG
 *     id C → Excess2Sell, JioMart
 *     id D → Computech, Variety Infotech, ADS Store
 *
 *   one id  →  3 sellers
 *   four ids → 10 sellers
 *
 * So the difference between "a market" and "a third of a market" is whether
 * the sibling ids get opened. That is what this file decides.
 *
 * THE RISK IT MUST NOT TAKE is the opposite error. Merging a 128GB phone with
 * a 256GB one, or a phone with its own case, would produce a wider market made
 * of the wrong product — a more confident wrong answer than the narrow one it
 * replaced. So membership requires AGREEMENT on the things that distinguish
 * products, not merely similarity:
 *
 *   MODEL CODES must match exactly. A title claiming wh-1000xm4 is not this
 *   product however much else it shares.
 *
 *   SPEC VALUES must not contradict. 256gb against 128gb is a different
 *   product; 256gb against silence is the same product described loosely.
 *
 *   PRICE must be in the same class. A genuine duplicate listing of a 27,000
 *   rupee product is not priced at 999, and the thing that is priced at 999 is
 *   an accessory for it.
 *
 * None of these rules name a brand, a category or a product type. They read
 * the structure of the anchor title and compare candidates against it, so the
 * same code clusters air conditioners, shoes and laptops.
 */

/** A candidate the provider returned: a catalogue id and what it was called. */
export type ClusterCandidate = RelevanceInput & {
  /** The provider's catalogue id. Rows without one cannot be opened. */
  externalProductId: string | null;
};

export type ClusterMember<T> = {
  item: T;
  externalProductId: string;
  /** 0..1 — how strongly this id is believed to be the anchor's product. */
  confidence: number;
  reason: string;
};

export type ProductCluster<T> = {
  /** The id the product's identity is taken from. */
  anchor: ClusterMember<T>;
  /** The anchor first, then siblings in the order worth spending calls on. */
  members: ClusterMember<T>[];
  /** Candidates rejected, with the reason — so a thin cluster is explainable. */
  rejected: Array<{ externalProductId: string; title: string; reason: string }>;
};

/**
 * How far apart two prices may be and still be the same product.
 *
 * Deliberately wide. Legitimate spreads on one product are large — the live
 * headphone market ran 24,550 to 31,990, and a stale or grey-import listing
 * can sit well outside even that. The job here is to exclude a different CLASS
 * of object, which differs by a factor of ten, not to police a spread.
 */
const PRICE_RATIO_LIMIT = 3;

/**
 * How close to the anchor a WORDY listing must trade to be admitted anyway.
 *
 * The relevance layer judges a title on how much of it is about something
 * other than the query, and it is deliberately strict there: a spare part
 * covers the whole query, can be the dearest thing in a capture, and was
 * once offered as the product itself. The cost of that strictness is that a
 * retailer's descriptive listing of the real product — "Sony WH-1000XM5
 * Wireless Noise Cancelling Headphones" against the query "sony wh-1000xm5"
 * — trips the same rule.
 *
 * Clustering can afford to be less strict because it knows something
 * relevance does not: what the anchor is. A listing that carries every one
 * of the anchor's model codes, contradicts none of its specifications, and
 * trades within a third of its price is that product, whatever its title
 * does with the remaining words. A premium accessory does not satisfy all
 * three — the carry case is a twenty-eighth of the price, and even an
 * expensive one is nowhere near parity with the thing it attaches to.
 *
 * Narrower than `PRICE_RATIO_LIMIT` on purpose: this overrides a negative
 * signal, so it asks for near-parity rather than merely the same class.
 */
const WORDY_LISTING_RATIO = 1.5;

/** Model and configuration codes: xm5, i5, rtx4060, 15-eg3020na, a17. */
const MODEL_CODE = /^[a-z]{1,4}\d+[a-z0-9-]*$|^\d+[a-z]+[a-z0-9-]*$/i;

/**
 * A measured quantity with its unit: 256gb, 1.5ton, 6.3inch, 5000mah.
 *
 * Captured as (number, unit) so two values of the SAME unit can be compared.
 * Comparing across units would be meaningless — a 5-star rating and a 5-litre
 * capacity share a number and nothing else.
 */
const SPEC_VALUE = /^(\d+(?:\.\d+)?)(gb|tb|mb|ml|mm|cm|kg|g|l|w|wh|mah|inch|in|hz|ton|star|seater|cu|ft)$/i;

const tokenize = (text: string): string[] => normalizeQuery(text).split(/\s+/).filter(Boolean);

/** The structural claims a title makes about which product it is. */
type Signature = {
  modelCodes: Set<string>;
  /** unit → the values claimed for it. */
  specs: Map<string, Set<string>>;
};

function signatureOf(title: string): Signature {
  const modelCodes = new Set<string>();
  const specs = new Map<string, Set<string>>();

  for (const token of tokenize(title)) {
    const spec = SPEC_VALUE.exec(token);
    if (spec?.[1] && spec[2]) {
      const unit = spec[2].toLowerCase();
      const values = specs.get(unit) ?? new Set<string>();
      values.add(spec[1]);
      specs.set(unit, values);
      continue;
    }
    // A pure number is ambiguous — a model number, a size, a pack count — so
    // it is not treated as either kind of claim.
    if (MODEL_CODE.test(token) && /\d/.test(token) && /[a-z]/i.test(token)) {
      modelCodes.add(token.toLowerCase());
    }
  }

  return { modelCodes, specs };
}

/**
 * Does the candidate agree with the anchor about which product this is?
 *
 * Returns a confidence and a reason, or null when it disagrees. Agreement is
 * asymmetric on purpose: a candidate may be SILENT about something the anchor
 * states — store titles are abbreviated constantly — but it may not CONTRADICT
 * it. "Sony WH-1000XM5" is the same product as "Sony WH-1000XM5 Wireless
 * Headphones Silver 30hr"; "Sony WH-1000XM4" is not.
 */
function agreement(anchor: Signature, candidate: Signature): { confidence: number; reason: string } | null {
  /* ------------------------------------------------------------ model codes */

  if (anchor.modelCodes.size > 0) {
    const shared = [...anchor.modelCodes].filter((code) => candidate.modelCodes.has(code));
    if (shared.length === 0) {
      return null;
    }
    /**
     * A candidate carrying a model code the anchor does not is a DIFFERENT
     * configuration of the same line — wh-1000xm5 plus some other code. It
     * is kept, at lower confidence, because store titles routinely append
     * codes of their own (a bundle SKU, a region code) and discarding on that
     * basis loses real sellers. The confidence is what stops it being trusted
     * as much as an exact agreement.
     */
    const extra = [...candidate.modelCodes].filter((code) => !anchor.modelCodes.has(code));
    const base = shared.length / anchor.modelCodes.size;

    const specVerdict = specAgreement(anchor, candidate);
    if (!specVerdict) return null;

    return {
      confidence: Math.min(1, base * specVerdict.factor * (extra.length > 0 ? 0.85 : 1)),
      reason:
        `model ${shared.join(", ")} matches` +
        (extra.length ? `, also carries ${extra.join(", ")}` : "") +
        (specVerdict.note ? `; ${specVerdict.note}` : ""),
    };
  }

  /* ------------------------------------------------ no model code to go on */

  const specVerdict = specAgreement(anchor, candidate);
  if (!specVerdict) return null;

  /**
   * Without a model code, identity rests on specs and on the relevance score
   * the caller already computed. Confidence is capped below an exact model
   * match because that is genuinely weaker evidence — "LG 1.5 Ton 5 Star
   * Split AC" names no model, and two such titles may be two different units.
   */
  return {
    confidence: Math.min(0.75, 0.5 * specVerdict.factor + (anchor.specs.size > 0 ? 0.25 : 0)),
    reason: specVerdict.note || "no model code in either title; matched on wording",
  };
}

/** Specs must not contradict. Silence is agreement; a different value is not. */
function specAgreement(anchor: Signature, candidate: Signature): { factor: number; note: string } | null {
  let confirmed = 0;
  const notes: string[] = [];

  for (const [unit, anchorValues] of anchor.specs) {
    const candidateValues = candidate.specs.get(unit);
    if (!candidateValues || candidateValues.size === 0) continue; // silent
    const overlap = [...anchorValues].some((v) => candidateValues.has(v));
    if (!overlap) {
      return null; // states a different value for something the anchor states
    }
    confirmed++;
    notes.push(`${[...anchorValues].join("/")}${unit} confirmed`);
  }

  if (anchor.specs.size === 0) return { factor: 1, note: "" };
  /**
   * Confirmation raises confidence; silence leaves it alone. A candidate that
   * confirms every stated spec is as good as the anchor; one that confirms
   * none is plausible but unverified, which is what 0.8 says.
   */
  return { factor: 0.8 + 0.2 * (confirmed / anchor.specs.size), note: notes.join(", ") };
}

/**
 * Build the cluster of catalogue ids to open for one product.
 *
 * `anchorExternalProductId` is the id the user's chosen result resolved to.
 * Omit it and the highest-scoring relevant candidate becomes the anchor, which
 * is what an automatic refresh does.
 *
 * `limit` bounds the provider spend. Members are ordered so that truncating
 * the list keeps the ids most likely to be the same product AND most likely to
 * add sellers — not merely the provider's own ordering.
 */
export function clusterCatalogIds<T extends ClusterCandidate>(
  query: string,
  candidates: T[],
  opts: { anchorExternalProductId?: string | null; limit?: number } = {}
): ProductCluster<T> | null {
  const limit = Math.max(1, opts.limit ?? 4);

  const withIds = candidates.filter(
    (c): c is T & { externalProductId: string } => Boolean(c.externalProductId) && c.priceMinor != null && c.priceMinor > 0
  );
  if (withIds.length === 0) return null;

  /**
   * Score everything against the query first, reusing the one definition of
   * relevance this system has. Identity must not be decided one way for
   * display and another for clustering — that is how a product gets shown as
   * a phone and priced as a case.
   */
  const scored = scoreResults(query, withIds);
  const byId = new Map(scored.map((s) => [s.item.externalProductId, s]));

  /* ----------------------------------------------------------- the anchor */

  const wanted = opts.anchorExternalProductId ? byId.get(opts.anchorExternalProductId) : undefined;

  /**
   * WITH NO HUMAN CHOICE, THE BAR IS HIGHER.
   *
   * A user who clicks a result has made a judgement, and this function
   * follows it. An automatic capture has made no judgement, so it must not
   * settle for the best of a bad set — and a bad set is a real, frequent
   * outcome, not a hypothetical.
   *
   * Live example that produced this rule. A search for "sony wh-1000xm5"
   * returned 38 rows and NOT ONE of them was the headphones: 32 skins at
   * ₹2,322 from a single vendor, two carrying cases, a replacement headband,
   * and a WH-1000XM6. Taking the highest scorer anchored the whole capture on
   * "Sony WH-1000XM5 Stone Series Skins" — four provider calls spent to
   * create a product that was a sticker, with a one-seller "market" behind
   * it.
   *
   * The skins scored `plausible`, never `strong`: they match every word of
   * the query and sit in their own price cohort, which is as much as a title
   * can tell us. Requiring `strong` for an unsupervised anchor turns that
   * near-miss into a refusal, which is the right answer when the provider
   * returned nothing that is confidently the product.
   *
   * It costs nothing in the common path: a product this system already holds
   * is refreshed from its stored catalogue ids and never reaches this
   * function at all.
   */
  const anchorScored = wanted ?? scored.filter((s) => s.relevance === "strong").sort((a, b) => b.score - a.score)[0];

  if (!anchorScored) return null;

  const anchorSignature = signatureOf(anchorScored.item.title);
  const anchorPrice = anchorScored.item.priceMinor!;

  const anchor: ClusterMember<T> = {
    item: anchorScored.item,
    externalProductId: anchorScored.item.externalProductId,
    confidence: 1,
    reason: wanted ? "chosen by the user" : "highest-scoring result for the query",
  };

  /* --------------------------------------------------------- the siblings */

  const members: ClusterMember<T>[] = [];
  const rejected: ProductCluster<T>["rejected"] = [];
  const seen = new Set([anchor.externalProductId]);

  for (const s of scored) {
    const id = s.item.externalProductId;
    if (seen.has(id)) continue;
    seen.add(id);

    const note = (reason: string) => rejected.push({ externalProductId: id, title: s.item.title, reason });

    if (s.relevance === "irrelevant") {
      note("relevance: irrelevant");
      continue;
    }

    const price = s.item.priceMinor!;
    const ratio = price > anchorPrice ? price / anchorPrice : anchorPrice / price;
    if (ratio > PRICE_RATIO_LIMIT) {
      note(`priced ${ratio.toFixed(1)}x from the anchor — a different class of object`);
      continue;
    }

    const verdict = agreement(anchorSignature, signatureOf(s.item.title));
    if (!verdict) {
      note("contradicts the anchor's model code or specification");
      continue;
    }

    /**
     * An accessory classification is overridden only by near-parity pricing
     * AND complete model agreement — see `WORDY_LISTING_RATIO`. Anything
     * short of both is left rejected, because admitting an accessory into a
     * product's market writes its price into that product's history, and an
     * observation cannot be told apart from a real one afterwards.
     */
    if (s.relevance === "accessory") {
      const exactModelMatch =
        anchorSignature.modelCodes.size > 0 &&
        [...anchorSignature.modelCodes].every((code) => signatureOf(s.item.title).modelCodes.has(code));

      if (!exactModelMatch || ratio > WORDY_LISTING_RATIO) {
        note(
          `relevance: accessory (priced ${ratio.toFixed(1)}x from the anchor` +
            `${exactModelMatch ? "" : ", and does not carry its model code"})`
        );
        continue;
      }
      members.push({
        item: s.item,
        externalProductId: id,
        /**
         * Capped well below an uncontested match. The title did read as
         * something else; this is the structural evidence outvoting it, not
         * agreeing with it, and a later reviewer should be able to see that.
         */
        confidence: Number(Math.min(0.6, verdict.confidence).toFixed(3)),
        reason: `${verdict.reason}; wordy title, admitted on near-parity pricing`,
      });
      continue;
    }

    /**
     * Price distance discounts confidence a little, so that when two
     * candidates are equally well matched on wording the one trading nearer
     * the anchor is opened first. It never rescues or rejects on its own.
     */
    const priceFactor = 1 - Math.min(0.2, (ratio - 1) / (PRICE_RATIO_LIMIT - 1) * 0.2);
    members.push({
      item: s.item,
      externalProductId: id,
      confidence: Number((verdict.confidence * priceFactor).toFixed(3)),
      reason: verdict.reason,
    });
  }

  members.sort((a, b) => b.confidence - a.confidence);

  return {
    anchor,
    members: [anchor, ...members].slice(0, limit),
    rejected,
  };
}
