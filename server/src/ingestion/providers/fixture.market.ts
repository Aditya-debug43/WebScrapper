import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env } from "../../config/env.js";
import { ProviderError, type ProductMarket, type ProductMarketProvider } from "../types.js";
import { normaliseProductMarket } from "./serpapi.market.js";

/**
 * RECORDED SELLER LISTS
 * =====================
 *
 * The product-market counterpart to `fixture.provider.ts`, and it exists for
 * the same three reasons: tests that run offline and free, development that
 * does not spend quota, and a response that once broke the parser kept as a
 * file so it cannot break it silently again.
 *
 * It matters more here than for search. A competitive capture costs one call
 * PER CATALOGUE ID — four or five per product — so a test suite that reached
 * the network would be the most expensive thing in the repository, and the
 * clustering logic it needs to exercise is precisely the part that fans out.
 *
 * Fixtures are keyed by catalogue id, which is what the provider is asked
 * for. It reuses the production normaliser rather than reimplementing it: a
 * fixture provider with its own parser tests the fixture parser, not the code
 * that runs in production.
 */
export class FixtureMarketProvider implements ProductMarketProvider {
  readonly name = "fixture";

  constructor(private readonly dir: string = resolve(env.MARKET_DATA_FIXTURE_DIR, "products")) {}

  async fetchProduct(externalProductId: string, opts: { currency?: string } = {}): Promise<ProductMarket> {
    const path = join(this.dir, `${externalProductId}.json`);

    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      /**
       * A missing fixture is `unavailable`, not a product with no sellers.
       * Returning an empty seller list would look like "nobody sells this",
       * which is a claim about the market rather than about the test setup —
       * and it would quietly turn a missing file into a refusal to price.
       */
      throw new ProviderError(this.name, `No recorded product response at ${path}`, "unavailable", false);
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ProviderError(this.name, `Recorded product response at ${path} is not JSON`, "malformed", false);
    }

    return normaliseProductMarket(
      body,
      externalProductId,
      `fixture://${path}`,
      opts.currency ?? env.MARKET_DATA_CURRENCY,
      this.name
    );
  }
}
