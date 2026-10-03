import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env } from "../../config/env.js";
import { ProviderError, type MarketOfferBatch, type MarketOfferProvider, type MarketQuery } from "../types.js";
import { normaliseSerpResponse } from "./serpapi.provider.js";

/**
 * RECORDED RESPONSES
 * ==================
 *
 * The second provider, and the one that proves the port is real: it answers
 * the same question from a file instead of the network.
 *
 * It exists for three jobs, all of which a live provider does badly:
 *
 *   TESTS        deterministic, offline, and free. An ingestion suite that
 *                needs an API key and burns quota is a suite nobody runs.
 *   DEVELOPMENT  work on matching and persistence without spending requests
 *                on a metered plan.
 *   REGRESSION   a response that once broke the parser is kept as a file, so
 *                it can never break it silently again.
 *
 * It deliberately reuses the SerpApi adapter's own normalisation rather than
 * reimplementing it. A fixture provider with its own parser would test the
 * fixture parser, which is not the code that runs in production.
 */
export class FixtureProvider implements MarketOfferProvider {
  readonly name = "fixture";

  constructor(private readonly dir: string = resolve(env.MARKET_DATA_FIXTURE_DIR)) {}

  /** `POCO X6 Pro 8GB 256GB` → `poco-x6-pro-8gb-256gb.json` */
  static slug(query: string): string {
    return query
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  async search(query: MarketQuery): Promise<MarketOfferBatch> {
    const path = join(this.dir, `${FixtureProvider.slug(query.query)}.json`);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      /**
       * A missing fixture is `unavailable`, not an empty result. Returning
       * zero offers would look like "this product is sold nowhere", which is
       * a claim about the market rather than about the test setup.
       */
      throw new ProviderError(this.name, `No recorded response at ${path}`, "unavailable", false);
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ProviderError(this.name, `Recorded response at ${path} is not JSON`, "malformed", false);
    }

    // Same normalisation, same edge cases, same bugs — which is the point.
    return normaliseSerpResponse(body, query.query, `fixture://${path}`, query.currency ?? env.MARKET_DATA_CURRENCY, this.name);
  }
}
