/**
 * MARKET DATA INGESTION — the port
 * ================================
 *
 * One question the rest of the backend is allowed to ask: *what is this
 * product selling for right now, out there?* Everything about who answers it
 * — SerpApi today, a marketplace API tomorrow, a recorded fixture in tests —
 * lives behind this file and nowhere else.
 *
 * The rule that makes a provider replaceable is narrow and strict: **no
 * provider's field names may appear outside its own adapter.** Nothing in the
 * recommendation engine, the competitor service or the analysis layer should
 * ever learn what one particular vendor happens to call its price field. If
 * that leaks, swapping the vendor stops being an adapter change and becomes a
 * refactor.
 *
 * This is enforced, not merely requested: `tests/ingestion.test.ts` reads the
 * backend source and fails if a provider's vocabulary appears anywhere but
 * its own adapter — including in a comment such as this one, which is why
 * the rule is stated here in words rather than by example.
 *
 * This is the same shape as the email port (`src/email/`): a type, a factory
 * that reads one environment variable, and callers that hold the interface
 * and never the implementation.
 */

/** What a caller asks for. Deliberately small — a query and a market. */
export type MarketQuery = {
  /** The search text, e.g. "POCO X6 Pro 8GB 256GB". */
  query: string;
  /** ISO-3166 country for the market being searched. */
  country?: string;
  /** Currency the caller expects prices in; providers may ignore it. */
  currency?: string;
  /** Upper bound on results. A provider may return fewer. */
  limit?: number;
};

/**
 * ONE OFFER, PROVIDER-INDEPENDENT.
 *
 * Deliberately close to what this project already models — money in integer
 * minor units, a raw title kept exactly as the source wrote it, a seller name
 * rather than a resolved seller — so that persisting one is a mapping rather
 * than a translation.
 *
 * Every field except `rawTitle`, `sourceName` and `provider` is nullable, and
 * that is not laziness: shopping results are famously partial. A result with
 * no rating is normal, and a parser that insists on one will throw away good
 * price data. What must never happen is a missing field being *filled in* —
 * absent is absent, and it travels as null all the way to the database.
 */
export type MarketOffer = {
  /**
   * The title exactly as the source wrote it, unmodified. This is the input
   * to product matching and the evidence for a human reviewing a match, so
   * cleaning it here would destroy the only record of what was actually seen.
   */
  rawTitle: string;
  /** The store, as the provider names it: "Flipkart", "Croma", "Vijay Sales". */
  sourceName: string;
  /** The provider's own identifier for this result, where it gives one. */
  externalId: string | null;
  /** Link to the offer. */
  url: string | null;

  /** Integer minor units — paise for INR. The project's standing convention. */
  priceMinor: number | null;
  /** Printed/list price where the source shows one it is discounting from. */
  mrpMinor: number | null;
  /** Delivery cost. `0` means stated-free; `null` means not stated. */
  shippingFeeMinor: number | null;
  currency: string;

  rating: number | null;
  reviewCount: number | null;

  /** `null` when the source does not say — which is not the same as false. */
  inStock: boolean | null;
  condition: "new" | "refurbished" | "used" | null;
  /** The delivery promise as written, e.g. "Free delivery by Tue, 14 Oct". */
  deliveryNote: string | null;

  /** Which adapter produced this. Recorded on everything it writes. */
  provider: string;
  /** When the provider observed it, ISO-8601. */
  observedAt: string;

  /**
   * The provider's own object for this result, untouched.
   *
   * Normalisation is lossy by design and improves over time; this is what
   * makes that safe. It is written to the raw-document store rather than kept
   * in a column, so a parser fixed next month can be re-run over what was
   * actually received instead of over what we understood at the time.
   */
  raw: unknown;
};

/** One provider call: its offers, and an honest account of how it went. */
export type MarketOfferBatch = {
  provider: string;
  query: string;
  offers: MarketOffer[];
  /** The whole response, for the raw-document store. */
  raw: unknown;
  /** Where it came from, for `raw_documents.source_url`. */
  requestUrl: string;
  fetchedAt: string;
  /**
   * Results the adapter received but could not normalise — a row with no
   * title, an unparseable price. Counted and reported rather than dropped,
   * because silent attrition in an ingestion pipeline is invisible until the
   * numbers are wrong.
   */
  skipped: Array<{ reason: string; raw: unknown }>;
};

/**
 * A source of market offers.
 *
 * Implementations: `serpapi` (live), `fixture` (recorded responses, for tests
 * and for development without spending quota). Adding a provider means adding
 * a file here and one line in the factory.
 */
export type MarketOfferProvider = {
  /** Stable identifier, stored on every row this provider's data produces. */
  readonly name: string;
  /**
   * Fetch current offers. Throws `ProviderError` for anything that went
   * wrong at the provider; an empty `offers` array is a successful call that
   * found nothing, which is a different and perfectly normal outcome.
   */
  search(query: MarketQuery): Promise<MarketOfferBatch>;
};

/**
 * A provider failed.
 *
 * Carries `retryable` so a caller can distinguish "try again later" from
 * "this will never work" — a 429 or a timeout is worth repeating, a bad API
 * key is not. The ingestion service turns either into a recorded `failed`
 * capture run rather than an exception reaching a user.
 */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly kind: "timeout" | "http" | "quota" | "auth" | "malformed" | "unavailable",
    readonly retryable: boolean,
    readonly status?: number
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}
