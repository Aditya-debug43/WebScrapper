/**
 * PRODUCT MATCHING — deliberately reluctant
 * =========================================
 *
 * "POCO X6 Pro 5G 8GB 256GB Racing Grey" and "Xiaomi Poco X6 Pro 256 GB Grey
 * 8GB RAM" are the same product. "POCO X6 Pro 8GB 256GB" and "POCO X6 Pro
 * 12GB 512GB" are not, and they differ by two tokens out of eight.
 *
 * That asymmetry decides the whole design. String similarity alone rates the
 * second pair as a near-identical match, which is exactly backwards: the
 * tokens it treats as noise are the ones that carry the variant. So this does
 * not score titles. It extracts the attributes that distinguish variants and
 * treats a disagreement on any of them as disqualifying, however similar the
 * rest of the text.
 *
 *   A WRONG MATCH IS WORSE THAN A MISSING ONE.
 *
 * A missing match costs one offer. A wrong one silently prices a product
 * against a different product's market, and every number downstream inherits
 * the error while looking perfectly reasonable. The schema already agrees:
 * `listings.product_id` is NOT NULL, so an unmatched offer cannot be written
 * as a listing at all — it goes to `rejected_records` with its reason and its
 * raw payload, where a human can confirm it later.
 *
 * `match_status` and `match_confidence` already exist on `listings` and
 * already feed the evidence score, so a low-confidence match is not merely
 * recorded — it visibly weakens the recommendation built on it.
 */

/** The attributes that make two similar-sounding titles different products. */
export type VariantAttributes = {
  storageGb: number | null;
  ramGb: number | null;
  /** Normalised: "15 Pro Max", "x6 pro". */
  modelTokens: string[];
  colour: string | null;
};

export type MatchCandidate = {
  productId: string;
  canonicalName: string;
  /** `products.model_name` — "iPhone 13", without the variant decoration. */
  modelName: string | null;
  brandName: string | null;
  /**
   * `brands.alias_names`, which the schema introduces as "alternate spellings
   * seen in marketplace titles, used by listing matching". Load-bearing: a
   * Poco listing rarely says Xiaomi, and a brand judged absent costs score.
   */
  brandAliases: string[];
  /** `products.specifications` — `{ ram_gb: 8, storage_gb: 256, ... }`. */
  specifications: Record<string, unknown> | null;
  /** `products.variant_axes` — `{ storage: "256GB", colour: "Midnight" }`. */
  variantAxes: Record<string, string> | null;
};

export type MatchVerdict =
  | { status: "auto_matched"; productId: string; confidence: number; reason: string }
  | { status: "unmatched"; confidence: number; reason: string };

/**
 * Only accept above this. Chosen to sit above "same brand and model family"
 * and below "same brand, model AND every variant attribute agrees", so a
 * match needs the distinguishing attributes to line up, not just the prose.
 */
export const MATCH_CONFIDENCE_FLOOR = 0.82;

const STOPWORDS = new Set([
  "the", "and", "with", "for", "new", "latest", "offer", "best", "price", "buy", "online",
  "5g", "4g", "dual", "sim", "smartphone", "mobile", "phone", "gb", "ram", "rom", "storage",
]);

/** Capacity in GB, understanding TB. Returns the largest sensible reading. */
function capacities(text: string): number[] {
  const found: number[] = [];
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(gb|tb)\b/gi)) {
    const value = Number(m[1]);
    if (!Number.isFinite(value)) continue;
    found.push(m[2]!.toLowerCase() === "tb" ? value * 1024 : value);
  }
  return found;
}

const COLOURS = [
  "black", "white", "blue", "grey", "gray", "silver", "gold", "green", "red", "purple",
  "pink", "yellow", "orange", "titanium", "graphite", "midnight", "starlight", "lavender",
];

/**
 * RAM and storage from a title.
 *
 * "8GB 256GB" is unambiguous by magnitude: consumer RAM is small and storage
 * is large, so the smaller of two capacities is RAM. An explicit "8GB RAM"
 * overrides the heuristic. A single capacity is storage, because a phone
 * advertised with one number is advertised by its storage.
 */
export function extractVariant(title: string): VariantAttributes {
  const text = title.toLowerCase();

  const explicitRam = /(\d+)\s*gb\s*(?:ram|memory)/i.exec(text);
  const explicitStorage = /(\d+)\s*(gb|tb)\s*(?:rom|storage|internal)/i.exec(text);

  let ramGb: number | null = explicitRam ? Number(explicitRam[1]) : null;
  let storageGb: number | null = explicitStorage
    ? Number(explicitStorage[1]) * (explicitStorage[2]!.toLowerCase() === "tb" ? 1024 : 1)
    : null;

  if (ramGb == null || storageGb == null) {
    const all = [...new Set(capacities(text))].sort((a, b) => a - b);
    if (all.length >= 2) {
      ramGb ??= all[0]!;
      storageGb ??= all[all.length - 1]!;
    } else if (all.length === 1) {
      storageGb ??= all[0]!;
    }
  }

  const colour = COLOURS.find((c) => new RegExp(`\\b${c}\\b`).test(text)) ?? null;

  const modelTokens = text
    .replace(/\(.*?\)/g, " ")
    .split(/[^a-z0-9+]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+(gb|tb)?$/.test(t));

  return { storageGb, ramGb, modelTokens, colour: colour === "gray" ? "grey" : colour };
}

/** A single variant-axis value like `"256GB"` or `"8 GB"` → `256` / `8`. */
function soleCapacity(axis: string | undefined): number | null {
  if (!axis) return null;
  const found = capacities(axis);
  return found.length === 1 ? found[0]! : null;
}

const numeric = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Jaccard overlap of two token sets. */
function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * Match one incoming title against the catalogue.
 *
 * Two hard gates, then a score:
 *
 *   1. A variant attribute present on BOTH sides and disagreeing is fatal.
 *      256 GB is not 512 GB, and no amount of textual similarity makes it so.
 *      An attribute missing on one side is not evidence either way, so it
 *      neither disqualifies nor contributes.
 *   2. The brand, if the catalogue knows one, must appear in the title.
 *      Stores habitually omit it ("Poco X6 Pro" for a Xiaomi product), so a
 *      missing brand only costs confidence; a DIFFERENT brand is fatal and
 *      is caught by the model-token overlap below.
 *
 * Everything surviving both is scored on model-token overlap, lifted where
 * the variant attributes positively agree. Only the best candidate is
 * considered, and only if it clears the floor AND beats the runner-up
 * clearly: two candidates scoring alike means the title does not distinguish
 * them, which is precisely when guessing is most expensive.
 */
export function matchProduct(rawTitle: string, candidates: MatchCandidate[]): MatchVerdict {
  const incoming = extractVariant(rawTitle);
  const title = rawTitle.toLowerCase();

  const scored: Array<{ candidate: MatchCandidate; score: number; note: string }> = [];
  /**
   * Candidates thrown out by the variant gates whose model text otherwise
   * looked right. This is the difference between "we have never heard of this
   * product" and "we carry this product, but not this configuration" — the
   * second is a catalogue gap worth acting on, and a rejection reason that
   * does not distinguish them wastes the reviewer's time.
   */
  const variantNearMisses: string[] = [];

  for (const candidate of candidates) {
    const specs = candidate.specifications ?? {};
    const axes = candidate.variantAxes ?? {};
    const candidateVariant = extractVariant(`${candidate.canonicalName} ${candidate.modelName ?? ""}`);

    /**
     * Three sources for the same fact, most structured first. `specifications`
     * is validated against `attribute_definitions`; `variant_axes` is what
     * distinguishes siblings; the canonical name is the fallback. A family
     * node ("Samsung Galaxy M14 5G") has none of them, which is correct — it
     * states nothing, so it disqualifies nothing.
     */
    const storage = numeric(specs.storage_gb) ?? soleCapacity(axes.storage) ?? candidateVariant.storageGb;
    const ram = numeric(specs.ram_gb) ?? soleCapacity(axes.ram) ?? candidateVariant.ramGb;

    // Gate 1 — a stated disagreement on a variant attribute.
    const storageClash = storage != null && incoming.storageGb != null && storage !== incoming.storageGb;
    const ramClash = ram != null && incoming.ramGb != null && ram !== incoming.ramGb;
    if (storageClash || ramClash) {
      if (overlap(incoming.modelTokens, candidateVariant.modelTokens) >= 0.5) {
        variantNearMisses.push(
          `${candidate.productId} (${storageClash ? `storage ${storage}≠${incoming.storageGb}` : `ram ${ram}≠${incoming.ramGb}`})`
        );
      }
      continue;
    }

    const tokenScore = overlap(incoming.modelTokens, candidateVariant.modelTokens);
    let score = tokenScore;

    /**
     * Gate 2 — brand. Checked against the aliases too, because stores write
     * "Poco X6 Pro" for a Xiaomi product and "realme" in lower case. A brand
     * nowhere in the title is a mild penalty, not a disqualification; a
     * genuinely different brand fails on token overlap instead.
     */
    const brandForms = [candidate.brandName, ...candidate.brandAliases]
      .filter((b): b is string => Boolean(b))
      .map((b) => b.toLowerCase());
    const brandPresent = brandForms.some((b) => title.includes(b));
    if (brandForms.length > 0 && !brandPresent) score -= 0.08;

    // Positive agreement on a distinguishing attribute is real evidence.
    if (storage != null && incoming.storageGb === storage) score += 0.1;
    if (ram != null && incoming.ramGb === ram) score += 0.06;
    const candidateColour = (axes.colour ?? axes.color)?.toLowerCase() ?? candidateVariant.colour;
    if (incoming.colour && candidateColour?.includes(incoming.colour)) score += 0.02;

    scored.push({
      candidate,
      score: Math.max(0, Math.min(1, score)),
      note: `tokens ${tokenScore.toFixed(2)}${
        brandForms.length ? (brandPresent ? ", brand present" : ", brand absent from title") : ""
      }`,
    });
  }

  /** "we carry this, not in this size" — appended where it applies. */
  const gapNote = variantNearMisses.length
    ? ` Catalogue gap: same model, different configuration — ${variantNearMisses.slice(0, 3).join("; ")}.`
    : "";

  if (scored.length === 0) {
    return {
      status: "unmatched",
      confidence: 0,
      reason:
        `No catalogue product survives the variant gates for "${rawTitle}" ` +
        `(ram ${incoming.ramGb ?? "?"}GB, storage ${incoming.storageGb ?? "?"}GB).${gapNote}`,
    };
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const runnerUp = scored[1];

  if (best.score < MATCH_CONFIDENCE_FLOOR) {
    return {
      status: "unmatched",
      confidence: Math.round(best.score * 1000) / 1000,
      reason:
        `Best candidate ${best.candidate.productId} scored ${best.score.toFixed(2)}, ` +
        `below the ${MATCH_CONFIDENCE_FLOOR} floor (${best.note}).${gapNote}`,
    };
  }

  /**
   * Two candidates scoring within a hair of each other means the title does
   * not actually distinguish them — the usual cause being a listing that
   * omits the storage tier. Picking the higher score would be picking a
   * coin-flip, so neither is accepted.
   */
  if (runnerUp && best.score - runnerUp.score < 0.05) {
    return {
      status: "unmatched",
      confidence: Math.round(best.score * 1000) / 1000,
      reason: `Ambiguous: ${best.candidate.productId} (${best.score.toFixed(2)}) and ${runnerUp.candidate.productId} (${runnerUp.score.toFixed(2)}) are too close to separate.`,
    };
  }

  return {
    status: "auto_matched",
    productId: best.candidate.productId,
    confidence: Math.round(best.score * 1000) / 1000,
    reason: `Matched ${best.candidate.productId} at ${best.score.toFixed(2)} (${best.note}).`,
  };
}
