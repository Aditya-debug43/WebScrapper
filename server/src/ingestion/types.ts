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

  /**
   * Product image, as the PROVIDER hosts it where it offers one.
   *
   * Null when the provider gave none — a search result with no image shows no
   * image. A placeholder drawn from anywhere else would be the interface
   * inventing a fact about the product, which is the one thing this pipeline
   * exists to prevent.
   */
  thumbnailUrl: string | null;
  /** Further images where the source carried a gallery. Usually empty. */
  thumbnailUrls: string[];

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

/* ========================================================================== */
/*  THE COMPETITIVE MARKET                                                    */
/* ========================================================================== */

/**
 * A SELLER'S OFFER FOR ONE CANONICAL PRODUCT.
 *
 * The entity the whole pricing system was missing. A search result is one
 * store's listing; this is one SELLER among many for a product that has an
 * identity of its own — which is what "who am I competing with, and at what
 * price?" actually requires.
 *
 * `sellerExternalId` is the provider's own merchant identifier. It is what
 * makes a seller the same seller across captures, so a price series can be
 * attributed to Croma rather than to "whatever was in row three last time".
 * Matching sellers by display name would merge every store that renamed
 * itself and split every one that appears under two spellings.
 */
export type MarketSellerOffer = {
  /** Stable per-merchant identity from the provider. Null where it gives none. */
  sellerExternalId: string | null;
  sellerName: string;
  /** The seller's own listing title — often states the exact configuration. */
  listingTitle: string | null;
  url: string | null;

  /** Integer minor units. `totalMinor` includes shipping where the provider states it. */
  priceMinor: number | null;
  totalMinor: number | null;
  shippingMinor: number | null;
  shippingNote: string | null;
  currency: string;

  rating: number | null;
  reviewCount: number | null;
  /** `null` where the provider does not say, which is not the same as false. */
  inStock: boolean | null;
  condition: "new" | "refurbished" | "used" | null;
  /** "In stock online", "Free 7-day returns" — kept verbatim, not parsed. */
  notes: string[];
};

/**
 * ONE CATALOGUE ID'S MARKET, AS THE PROVIDER SEES IT.
 *
 * NOTE WHAT IS ABSENT: there is no price history here, because the provider
 * does not supply one. It reports only that it *has* a chart. So every
 * historical price in this system is a price this system observed and
 * timestamped itself, and a trend is only ever as old as our own capture
 * record. That is a real limitation and it is better stated in the type than
 * discovered later by a reader of a chart.
 *
 * There is also no "more sellers available" flag. The provider returns a
 * pagination token for its store list and following it yields nothing, so the
 * flag would be wrong exactly when it mattered. Breadth of coverage comes from
 * clustering a product's several catalogue ids instead — see `cluster.ts`.
 */
export type ProductMarket = {
  provider: string;
  /** The provider's catalogue identity for the product. */
  externalProductId: string;
  title: string;
  brand: string | null;
  thumbnailUrl: string | null;
  /** Structured specifications — storage capacity, RAM, screen size. */
  attributes: Array<{ name: string; value: string }>;
  /** Every seller the provider returned for this catalogue id. */
  sellers: MarketSellerOffer[];

  /**
   * The range the provider states for this product, where it states one.
   *
   * Often WIDER than the sellers it listed, which is the provider admitting
   * it knows of offers it did not return. Treated as evidence about coverage,
   * never as a price to recommend.
   */
  priceRangeLowMinor: number | null;
  priceRangeHighMinor: number | null;
  /** The provider tracks this product's price. A capability, not a series. */
  priceTrackingAvailable: boolean;

  /** Related products and configurations, for variant resolution. */
  relatedTitles: string[];
  fetchedAt: string;
  /** The untouched response, for the provenance store. */
  raw: unknown;
  requestUrl: string;
};

/**
 * A SOURCE OF COMPETITIVE MARKET DATA FOR ONE CATALOGUE ID.
 *
 * Separate port from `MarketOfferProvider` because the two answer different
 * questions. That one asks "what matches these words?" and returns a list of
 * different products. This one asks "who sells THIS product, and for how
 * much?" and returns one product's sellers. Conflating them is precisely the
 * mistake that made a text search stand in for a competitive market.
 */
export type ProductMarketProvider = {
  readonly name: string;
  fetchProduct(externalProductId: string, opts?: { country?: string; currency?: string }): Promise<ProductMarket>;
};
