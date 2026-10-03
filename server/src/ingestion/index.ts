import { env } from "../config/env.js";
import { ProviderError, type MarketOfferProvider, type MarketQuery } from "./types.js";
import { SerpApiProvider } from "./providers/serpapi.provider.js";
import { FixtureProvider } from "./providers/fixture.provider.js";

export type { MarketOffer, MarketOfferBatch, MarketOfferProvider, MarketQuery } from "./types.js";
export { ProviderError } from "./types.js";
export { SerpApiProvider, normaliseSerpResponse } from "./providers/serpapi.provider.js";
export { FixtureProvider } from "./providers/fixture.provider.js";

/**
 * A provider that answers every question by refusing.
 *
 * `MARKET_DATA_PROVIDER=none` is the default, which means the common case is
 * a deployment with no key configured. The tempting implementation is to
 * return zero offers — and it would be wrong, because zero offers is a claim
 * about the market ("nobody sells this") rather than about the configuration
 * ("we did not look"). Downstream, those two produce very different
 * recommendations from identical-looking data.
 *
 * So it throws, the capture run records `failed` with the reason, and the
 * route answers 503. Nothing downstream ever sees a fabricated empty market.
 */
class DisabledProvider implements MarketOfferProvider {
  readonly name = "none";

  async search(_query: MarketQuery): Promise<never> {
    throw new ProviderError(
      this.name,
      "Market data ingestion is disabled (MARKET_DATA_PROVIDER=none).",
      "unavailable",
      false
    );
  }
}

/**
 * The one place that decides who answers.
 *
 * Mirrors `createEmailAdapter()` exactly, and for the same reason: callers
 * hold `MarketOfferProvider` and never an implementation, so adding a
 * marketplace's own API later is a new file plus one `case` — not a change
 * to the ingestion service, the matcher, or anything downstream of them.
 */
export function createMarketOfferProvider(): MarketOfferProvider {
  switch (env.MARKET_DATA_PROVIDER) {
    case "serpapi":
      return new SerpApiProvider();
    case "fixture":
      return new FixtureProvider();
    case "none":
    default:
      return new DisabledProvider();
  }
}
