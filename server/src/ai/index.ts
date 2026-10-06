import { env } from "../config/env.js";
import { AIProviderError, type AIProvider, type PricingEvidence } from "./types.js";
import { HttpJsonAIProvider } from "./providers/httpJson.provider.js";

export * from "./types.js";
export { HttpJsonAIProvider } from "./providers/httpJson.provider.js";

/**
 * The adapter that does nothing, and says so.
 *
 * `AI_PROVIDER=none` is the DEFAULT, which makes the common case — no key
 * configured — a clearly reported "no AI available" rather than a confusing
 * failure at the first request. The deterministic pricing engine is
 * unaffected and still produces a recommendation; it is simply labelled as
 * what it is.
 */
class DisabledAIProvider implements AIProvider {
  readonly name = "none";
  readonly model = "none";
  readonly available = false;

  async recommend(_evidence: PricingEvidence): Promise<never> {
    throw new AIProviderError("none", "No AI provider is configured (AI_PROVIDER=none).", "disabled", false);
  }
}

/**
 * The one place a concrete AI provider is named.
 *
 * Same shape as `createEmailAdapter()` and `createMarketOfferProvider()`.
 * Adding a provider is a new adapter file plus one `case` — not a change
 * anywhere in the pricing engine, which is the requirement: the final
 * provider has not been chosen, and switching must not be a rewrite.
 *
 * Gemini, OpenAI and Anthropic all expose a chat-completions-shaped HTTP API
 * that takes a prompt and returns JSON, so all three are served by one
 * configurable adapter rather than three near-identical files. A provider
 * that genuinely does not fit gets its own.
 */
export function createAIProvider(): AIProvider {
  switch (env.AI_PROVIDER) {
    case "gemini":
    case "openai":
    case "anthropic":
      return new HttpJsonAIProvider(env.AI_PROVIDER);
    case "none":
    default:
      return new DisabledAIProvider();
  }
}
