import { env } from "../../config/env.js";
import { ProviderError, type MarketOffer, type MarketOfferBatch, type MarketOfferProvider, type MarketQuery } from "../types.js";

/**
 * SERPAPI — GOOGLE SHOPPING
 * =========================
 *
 * **This is the only file in the project that may mention a SerpApi field
 * name.** `extracted_price`, `shopping_results`, `product_link` appear here
 * and nowhere else; everything downstream sees `MarketOffer`. That is the
 * whole point of the port, and it is worth defending in review: the day this
 * provider is replaced, this file is deleted and nothing else changes.
 *
 * ── What Google Shopping actually gives you ───────────────────────────
 * A merchant name and a price, not a seller and an offer. "Flipkart ₹23,499"
 * says which STORE is selling at that price; it does not say which of
 * Flipkart's sellers. The entity model this project uses distinguishes the
 * two, so the ingestion service records a single storefront seller per store
 * and marks it as such. That is a limitation of the source, recorded rather
 * than papered over.
 *
 * Fields are also inconsistent between results — rating and reviews are
 * frequently absent, `old_price` only appears on discounted items. Every one
 * of them is read defensively and travels as null when missing.
 */

const ENDPOINT = "https://serpapi.com/search.json";

/** SerpApi's shape, named exactly as they name it, and used only below. */
type SerpShoppingResult = {
  position?: number;
  title?: string;
  product_id?: string;
  product_link?: string;
  link?: string;
  source?: string;
  price?: string;
  extracted_price?: number;
  old_price?: string;
  extracted_old_price?: number;
  rating?: number;
  reviews?: number;
  delivery?: string;
  snippet?: string;
  extensions?: string[];
  second_hand_condition?: string;
  /**
   * SerpApi rehosts the store's image on its own CDN and returns that URL
   * here. Preferred over anything the store serves directly: the store's own
   * URL frequently blocks hotlinking or expires, and a broken image in a
   * price comparison reads as a broken product.
   */
  thumbnail?: string;
  /** Occasionally several, when the source carries a gallery. */
  thumbnails?: string[];
};

type SerpResponse = {
  shopping_results?: SerpShoppingResult[];
  error?: string;
  search_metadata?: Record<string, unknown>;
};

/**
 * Metadata fields that carry a capability token, stripped before the response
 * is stored.
 *
 * Verified against a real capture: the provider does NOT echo the API key
 * back — it is absent from `search_parameters`. But the metadata links to the
 * stored copy of this search, and each of those URLs embeds a token granting
 * access to it. The whole response goes into `raw_documents` and from there
 * into every backup, so these would outlive the search by years while
 * contributing nothing: re-parsing needs the results, not the links back to
 * the vendor's copy of them.
 */
const CREDENTIAL_BEARING_METADATA = ["json_endpoint", "markdown_endpoint", "raw_html_file"];

/** The response as it should be persisted — results intact, tokens gone. */
function redactForStorage(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const clone = { ...(body as Record<string, unknown>) };
  const metadata = clone["search_metadata"];
  if (metadata && typeof metadata === "object") {
    const scrubbed = { ...(metadata as Record<string, unknown>) };
    for (const field of CREDENTIAL_BEARING_METADATA) {
      if (field in scrubbed) scrubbed[field] = "[redacted]";
    }
    clone["search_metadata"] = scrubbed;
  }
  return clone;
}

/** Rupees (or any major unit) to integer minor units. */
function toMinor(major: number | null | undefined): number | null {
  if (major == null || !Number.isFinite(major)) return null;
  return Math.round(major * 100);
}

/**
 * The delivery string into a shipping fee.
 *
 * "Free delivery" is a real zero. Anything with a number is that number.
 * Anything else — "Delivery by Tue", "Get it tomorrow" — says nothing about
 * cost, and returns null rather than guessing zero. Treating an unknown
 * shipping fee as free would quietly understate every landed price that
 * carries one.
 */
function parseDelivery(delivery: string | undefined): { feeMinor: number | null; note: string | null } {
  if (!delivery) return { feeMinor: null, note: null };
  const note = delivery.trim();
  if (/free/i.test(note)) return { feeMinor: 0, note };
  const amount = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)/i.exec(note);
  if (amount) {
    const value = Number(amount[1]!.replace(/,/g, ""));
    return { feeMinor: Number.isFinite(value) ? Math.round(value * 100) : null, note };
  }
  return { feeMinor: null, note };
}

/** Google surfaces condition inconsistently; only map what is unambiguous. */
function parseCondition(result: SerpShoppingResult): MarketOffer["condition"] {
  const text = `${result.second_hand_condition ?? ""} ${(result.extensions ?? []).join(" ")}`.toLowerCase();
  if (/refurbish|renewed/.test(text)) return "refurbished";
  if (/\bused\b|pre-owned|second hand/.test(text)) return "used";
  if (/\bnew\b/.test(text)) return "new";
  return null;
}

/**
 * Stock, only where the source is explicit.
 *
 * Google Shopping mostly lists buyable items, so absence of an out-of-stock
 * marker is weak evidence of availability rather than a statement of it —
 * hence null, not true. The price ladder treats a null as unknown and the
 * analysis layer excludes unknown-stock offers from in-stock statistics,
 * which is the conservative reading.
 */
/**
 * A printed maximum that is below the price being charged is not a maximum.
 *
 * Exported so the rule can be tested on its own: it is a one-line comparison,
 * and the reason it exists — two real rows that every other check accepted —
 * is worth pinning down where it cannot drift.
 */
export function plausibleMrp(mrpMinor: number | null, priceMinor: number | null): number | null {
  if (mrpMinor == null || mrpMinor <= 0) return null;
  if (priceMinor != null && mrpMinor < priceMinor) return null;
  return mrpMinor;
}

function parseStock(result: SerpShoppingResult): boolean | null {
  const text = `${result.snippet ?? ""} ${(result.extensions ?? []).join(" ")}`.toLowerCase();
  if (/out of stock|sold out|unavailable/.test(text)) return false;
  if (/in stock/.test(text)) return true;
  return null;
}

export class SerpApiProvider implements MarketOfferProvider {
  readonly name = "serpapi";

  constructor(
    private readonly apiKey: string = env.SERPAPI_KEY ?? "",
    private readonly timeoutMs: number = env.MARKET_DATA_TIMEOUT_MS
  ) {}

  async search(query: MarketQuery): Promise<MarketOfferBatch> {
    if (!this.apiKey) {
      throw new ProviderError(this.name, "No SERPAPI_KEY is configured.", "auth", false);
    }

    const params = new URLSearchParams({
      engine: "google_shopping",
      q: query.query,
      api_key: this.apiKey,
      gl: (query.country ?? env.MARKET_DATA_COUNTRY).toLowerCase(),
      hl: "en",
      num: String(Math.min(query.limit ?? 40, 100)),
    });

    /**
     * The URL recorded as the document's source has the key REMOVED. It is
     * written to the database and read by whoever debugs a bad capture, and
     * a credential in a provenance record is a credential in a backup.
     */
    const requestUrl = `${ENDPOINT}?${new URLSearchParams({ ...Object.fromEntries(params), api_key: "REDACTED" })}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${ENDPOINT}?${params}`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
    } catch (cause) {
      const aborted = (cause as Error)?.name === "AbortError";
      throw new ProviderError(
        this.name,
        aborted ? `Timed out after ${this.timeoutMs}ms` : `Network failure: ${(cause as Error).message}`,
        aborted ? "timeout" : "unavailable",
        true
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // 429 and 5xx are worth repeating; 401/403 mean the key is wrong and
      // repeating will only burn the next request too.
      const retryable = response.status === 429 || response.status >= 500;
      const kind = response.status === 429 ? "quota" : response.status === 401 || response.status === 403 ? "auth" : "http";
      throw new ProviderError(this.name, `HTTP ${response.status}`, kind, retryable, response.status);
    }

    let body: SerpResponse;
    const text = await response.text();
    try {
      body = JSON.parse(text) as SerpResponse;
    } catch {
      throw new ProviderError(this.name, "Response was not JSON", "malformed", false);
    }

    // SerpApi answers 200 with an `error` string for several real failures,
    // including an exhausted plan, so the status code alone is not enough.
    if (body.error) {
      const quota = /run out|exceeded|limit/i.test(body.error);
      throw new ProviderError(this.name, body.error, quota ? "quota" : "http", quota, 200);
    }

    return normaliseSerpResponse(body, query.query, requestUrl, query.currency ?? env.MARKET_DATA_CURRENCY, this.name);
  }
}

/**
 * Provider JSON to `MarketOffer[]`.
 *
 * A result is kept only if it has a title, a store and a usable price —
 * those three are what make it an offer. Anything else missing is recorded as
 * null. Anything failing those three is reported in `skipped` with a reason
 * rather than silently dropped, so a parser that starts quietly losing half
 * its input is visible in the capture run's counts.
 *
 * Exported because the fixture provider replays recorded responses through
 * exactly this function. A fixture with its own parser would test the fixture
 * parser rather than the one that runs in production.
 */
export function normaliseSerpResponse(
  body: unknown,
  query: string,
  requestUrl: string,
  currency: string,
  provider = "serpapi"
): MarketOfferBatch {
  const response = body as SerpResponse;
  const fetchedAt = new Date().toISOString();
  const offers: MarketOffer[] = [];
  const skipped: MarketOfferBatch["skipped"] = [];

  for (const result of response.shopping_results ?? []) {
    const rawTitle = result.title?.trim();
    const sourceName = result.source?.trim();
    const priceMinor = toMinor(result.extracted_price);

    if (!rawTitle) {
      skipped.push({ reason: "no title", raw: result });
      continue;
    }
    if (!sourceName) {
      skipped.push({ reason: "no source/store", raw: result });
      continue;
    }
    if (priceMinor == null || priceMinor <= 0) {
      skipped.push({ reason: `no usable price (${result.price ?? "absent"})`, raw: result });
      continue;
    }

    const delivery = parseDelivery(result.delivery);
    offers.push({
      rawTitle,
      sourceName,
      externalId: result.product_id ?? null,
      url: result.product_link ?? result.link ?? null,
      priceMinor,
      /**
       * An MRP below the selling price is not an MRP.
       *
       * A printed maximum is a legal ceiling in India, so a figure beneath
       * what the item is selling for is a misparse — the provider's
       * "old price" field occasionally carries something else entirely.
       * Production had two of them: a curtain listed at ₹1,160 with an
       * "MRP" of ₹20, and another at ₹724 with ₹50. Both passed every
       * parser check, because each number is individually plausible; only
       * their relationship is impossible.
       *
       * Stored as null — not known — which is the truth. Clamping it up to
       * the selling price would invent a ceiling, and keeping it would feed
       * a 5,700% discount into anything that renders one.
       */
      mrpMinor: plausibleMrp(toMinor(result.extracted_old_price), priceMinor),
      shippingFeeMinor: delivery.feeMinor,
      currency,
      rating: typeof result.rating === "number" ? result.rating : null,
      reviewCount: typeof result.reviews === "number" ? result.reviews : null,
      inStock: parseStock(result),
      condition: parseCondition(result),
      deliveryNote: delivery.note,
      thumbnailUrl: typeof result.thumbnail === "string" && result.thumbnail ? result.thumbnail : null,
      thumbnailUrls: Array.isArray(result.thumbnails)
        ? result.thumbnails.filter((t): t is string => typeof t === "string" && t.length > 0)
        : [],
      provider,
      observedAt: fetchedAt,
      raw: result,
    });
  }

  return { provider, query, offers, raw: redactForStorage(body), requestUrl, fetchedAt, skipped };
}
