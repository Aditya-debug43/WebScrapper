import { env } from "../../config/env.js";
import { ProviderError, type MarketSellerOffer, type ProductMarket } from "../types.js";

/**
 * ONE CATALOGUE ID'S SELLERS
 * ==========================
 *
 * The capability the pricing system needed and was never asking for.
 *
 * A shopping search returns one row per CATALOGUE ID — not one row per seller.
 * Each row shows a single representative store and price, which is why
 * treating a search row as "the market" produced a market of one. But every
 * row carries a catalogue id, and this endpoint turns that id into the list of
 * stores actually selling it, each with a merchant id, a price, shipping, a
 * total, a rating and its own stock notes.
 *
 * WHAT THIS ENDPOINT DOES NOT GIVE, VERIFIED AGAINST THE LIVE API:
 *
 *   NO PRICE HISTORY. `price_insights` is two booleans — the provider is
 *   telling us it *has* a chart, not giving us the series. There is no
 *   per-seller history to import, so every historical price in this system is
 *   one this system observed. An earlier design here assumed otherwise and
 *   would have shipped a chart built on data the provider never sends.
 *
 *   NO RELIABLE SELLER PAGINATION. A next-page token is returned, and
 *   following it yielded zero stores. "More sellers available" is therefore
 *   not modelled: a flag that is wrong whenever it is set is worse than none.
 *
 * Coverage comes from somewhere else instead, and it is measured rather than
 * hoped for: one product is published under SEVERAL catalogue ids, each
 * exposing a different two or three stores. Opening four ids for one pair of
 * headphones returned ten distinct sellers where one id returned three. The
 * clustering that exploits this lives in `cluster.ts`; this file only ever
 * answers for one id.
 *
 * This file and the search adapter are the ONLY two places that know this
 * provider's field names. Everything above them sees `ProductMarket`.
 */

const ENDPOINT = "https://serpapi.com/search.json";

/** The provider's shapes, named as it names them, used only in this file. */
type SerpStore = {
  position?: number;
  name?: string;
  link?: string;
  title?: string;
  rating?: number;
  reviews?: number;
  price?: string;
  extracted_price?: number;
  total?: string;
  extracted_total?: number;
  shipping?: string;
  merchant_id?: string;
  details_and_offers?: Array<string | { text?: string }>;
};

type SerpProductResponse = {
  error?: string;
  product_results?: {
    title?: string;
    brand?: string;
    thumbnails?: string[];
    price_range?: string;
    stores?: SerpStore[];
    product_attributes?: Array<{ name?: string; value?: string }>;
    more_options?: Array<{ title?: string }>;
    price_insights?: { price_history?: boolean; price_tracking_available?: boolean };
  };
};

const toMinor = (major: number | null | undefined): number | null =>
  major == null || !Number.isFinite(major) ? null : Math.round(major * 100);

/** Everything that is not a digit or a decimal point. */
const NON_NUMERIC = /[^0-9.]/g;

/**
 * Shipping from the word the provider uses for it.
 *
 * "Free" is a stated zero. A figure is that figure. Anything else — "Delivery
 * by Tue" — says nothing about cost, and guessing zero there would understate
 * the landed price of every seller that merely promises a date.
 */
export function parseShipping(text: string | undefined): { minor: number | null; note: string | null } {
  if (!text) return { minor: null, note: null };
  const note = text.trim();
  if (/free/i.test(note)) return { minor: 0, note };
  const figure = note.replace(NON_NUMERIC, "");
  if (!figure) return { minor: null, note };
  const value = Number(figure);
  return { minor: Number.isFinite(value) ? Math.round(value * 100) : null, note };
}

/** Stock and condition from the seller's own notes, where it states them. */
function readNotes(details: SerpStore["details_and_offers"]): {
  notes: string[];
  inStock: boolean | null;
  condition: MarketSellerOffer["condition"];
} {
  const notes = (details ?? [])
    .map((d) => (typeof d === "string" ? d : d?.text))
    .filter((d): d is string => Boolean(d));

  const joined = notes.join(" ").toLowerCase();
  const inStock = /in stock/.test(joined)
    ? true
    : /out of stock|sold out|unavailable|preorder|pre-order/.test(joined)
      ? false
      : null;
  const condition: MarketSellerOffer["condition"] = /refurbish|renewed/.test(joined)
    ? "refurbished"
    : /\bused\b|pre-owned|preowned/.test(joined)
      ? "used"
      : null;

  return { notes, inStock, condition };
}

/**
 * The stated market range, e.g. "Rs 1,02,999-Rs 1,19,900".
 *
 * Worth parsing because it is often WIDER than the stores returned, which is
 * the provider admitting it knows of sellers it did not list. That makes it
 * evidence about coverage rather than a price to recommend, and it is used as
 * such — never as a substitute for an observed seller price.
 */
export function parsePriceRange(text: string | undefined): { lowMinor: number | null; highMinor: number | null } {
  if (!text) return { lowMinor: null, highMinor: null };
  const figures = text
    .split(/\s*[-–—]\s*/)
    .map((part) => Number(part.replace(NON_NUMERIC, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (figures.length === 0) return { lowMinor: null, highMinor: null };
  return { lowMinor: toMinor(Math.min(...figures)), highMinor: toMinor(Math.max(...figures)) };
}

/**
 * Turn one product response into a provider-independent market.
 *
 * Exported so a stored response can be re-read through the production parser
 * later — the same contract the search adapter keeps.
 */
export function normaliseProductMarket(
  body: unknown,
  externalProductId: string,
  requestUrl: string,
  fallbackCurrency: string,
  provider = "serpapi"
): ProductMarket {
  const response = body as SerpProductResponse;
  if (response?.error) {
    throw new ProviderError(provider, response.error, "malformed", false);
  }

  const p = response?.product_results;
  if (!p) {
    throw new ProviderError(provider, "Product response carried no product_results.", "malformed", false);
  }

  const range = parsePriceRange(p.price_range);

  const sellers: MarketSellerOffer[] = (p.stores ?? []).map((store) => {
    const shipping = parseShipping(store.shipping);
    const { notes, inStock, condition } = readNotes(store.details_and_offers);
    const priceMinor = toMinor(store.extracted_price);
    const totalMinor = toMinor(store.extracted_total);
    return {
      /**
       * The merchant id, where given. This is what makes a seller the SAME
       * seller next week, and the same seller across catalogue ids — the live
       * data shows one store recurring under two ids with one merchant id,
       * which is the only reason the clustering can deduplicate. Matching on
       * display name would merge every store that renamed itself and split
       * every one that appears under two spellings.
       */
      sellerExternalId: store.merchant_id ?? null,
      sellerName: store.name?.trim() || "Unknown seller",
      listingTitle: store.title ?? null,
      url: store.link ?? null,
      priceMinor,
      /**
       * Landed price where the provider states one, or price plus a STATED
       * shipping cost. Never price plus a guessed one: a comparison of landed
       * prices in which some are guesses is not a comparison.
       */
      totalMinor:
        totalMinor ?? (priceMinor != null && shipping.minor != null ? priceMinor + shipping.minor : priceMinor),
      shippingMinor: shipping.minor,
      shippingNote: shipping.note,
      currency: fallbackCurrency,
      rating: typeof store.rating === "number" ? store.rating : null,
      reviewCount: typeof store.reviews === "number" ? store.reviews : null,
      inStock,
      condition,
      notes,
    };
  });

  return {
    provider,
    externalProductId,
    title: p.title?.trim() ?? "",
    brand: p.brand?.trim() || null,
    thumbnailUrl: p.thumbnails?.[0] ?? null,
    attributes: (p.product_attributes ?? [])
      .filter((a): a is { name: string; value: string } => Boolean(a?.name && a?.value))
      .map((a) => ({ name: a.name, value: a.value })),
    sellers,
    priceRangeLowMinor: range.lowMinor,
    priceRangeHighMinor: range.highMinor,
    /**
     * The provider says it tracks this product's price. Surfaced as the
     * capability flag it is, and never read as data — there is no series
     * behind it.
     */
    priceTrackingAvailable: Boolean(p.price_insights?.price_tracking_available),
    relatedTitles: (p.more_options ?? []).map((o) => o.title).filter((t): t is string => Boolean(t)),
    fetchedAt: new Date().toISOString(),
    raw: body,
    requestUrl,
  };
}

/** Fetches one catalogue id's sellers. Throws `ProviderError`; never half-answers. */
export class SerpApiMarketProvider {
  readonly name = "serpapi";

  constructor(
    private readonly apiKey: string = env.SERPAPI_KEY ?? "",
    private readonly timeoutMs: number = env.MARKET_DATA_TIMEOUT_MS
  ) {}

  async fetchProduct(
    externalProductId: string,
    opts: { country?: string; currency?: string } = {}
  ): Promise<ProductMarket> {
    if (!this.apiKey) {
      throw new ProviderError(this.name, "SERPAPI_KEY is not configured.", "auth", false);
    }

    const params = new URLSearchParams({
      engine: "google_product",
      product_id: externalProductId,
      api_key: this.apiKey,
      gl: opts.country ?? env.MARKET_DATA_COUNTRY,
      hl: "en",
      // Ask for the seller list rather than the editorial page.
      offers: "1",
    });

    // Recorded without the key, exactly as the search adapter does.
    const requestUrl = `${ENDPOINT}?${new URLSearchParams({
      ...Object.fromEntries(params),
      api_key: "REDACTED",
    })}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${ENDPOINT}?${params}`, { signal: controller.signal });
    } catch (cause) {
      const timedOut = (cause as Error)?.name === "AbortError";
      throw new ProviderError(
        this.name,
        timedOut ? `No answer within ${this.timeoutMs}ms.` : "Could not reach the provider.",
        timedOut ? "timeout" : "unavailable",
        true
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const kind =
        response.status === 429 ? "quota" : response.status === 401 || response.status === 403 ? "auth" : "http";
      throw new ProviderError(this.name, `Provider returned ${response.status}.`, kind, kind === "quota");
    }

    return normaliseProductMarket(
      await response.json(),
      externalProductId,
      requestUrl,
      opts.currency ?? env.MARKET_DATA_CURRENCY,
      this.name
    );
  }
}
