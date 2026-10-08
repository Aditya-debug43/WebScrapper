import { env } from "../../config/env.js";
import { AIProviderError, validateVerdict, type AIPricingVerdict, type AIProvider, type PricingEvidence } from "../types.js";

/**
 * One adapter, three providers.
 *
 * Gemini, OpenAI and Anthropic differ in URL, auth header and where the text
 * sits in the response — and agree on everything that matters here: send a
 * prompt, get JSON back. Three files that differed by a header name would be
 * three places to fix the same bug, so the differences live in one table and
 * the logic is shared.
 *
 * This file is the ONLY place in the codebase that knows any of their names.
 */

type Shape = {
  url: (model: string) => string;
  headers: (key: string) => Record<string, string>;
  body: (model: string, prompt: string) => unknown;
  extractText: (json: unknown) => string | null;
};

const SHAPES: Record<string, Shape> = {
  gemini: {
    url: (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    headers: (key) => ({ "content-type": "application/json", "x-goog-api-key": key }),
    body: (_model, prompt) => ({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }),
    extractText: (json) =>
      (json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })?.candidates?.[0]?.content
        ?.parts?.[0]?.text ?? null,
  },
  openai: {
    url: () => "https://api.openai.com/v1/chat/completions",
    headers: (key) => ({ "content-type": "application/json", authorization: `Bearer ${key}` }),
    body: (model, prompt) => ({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
    extractText: (json) =>
      (json as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content ?? null,
  },
  anthropic: {
    url: () => "https://api.anthropic.com/v1/messages",
    headers: (key) => ({
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
    body: (model, prompt) => ({
      model,
      max_tokens: 1024,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
    extractText: (json) =>
      (json as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? null,
  },
};

/**
 * The instruction.
 *
 * Two things it must achieve: a strictly-shaped answer, and a model that
 * stays inside the evidence. The second is the important one — the standing
 * temptation is for a model to price from what it remembers rather than from
 * what it was shown, and a remembered price is exactly what the capture
 * pipeline exists to replace.
 */
function buildPrompt(evidence: PricingEvidence): string {
  const money = (minor: number) => (minor / 100).toFixed(2);
  const lines: string[] = [];

  lines.push(
    "You are a pricing analyst. Recommend a selling price using ONLY the evidence below.",
    "",
    "Rules:",
    "- Use only the figures given. Do not use anything you recall about this product.",
    "- You are not being asked what this product costs. You are being asked what it should be priced at, given this market.",
    "- If the evidence is too thin to support a view, say so in `warnings` and set confidence to low.",
    "- Reply with JSON only, matching this shape exactly:",
    '  {"recommendedPriceMinor":<integer minor units>,"rangeMinMinor":<integer>,"rangeMaxMinor":<integer>,' +
      '"confidence":"low"|"medium"|"high","reasoning":"<one short paragraph>","warnings":["..."]}',
    "- All prices are integer MINOR units (paise). 79990000 means 799,900.00.",
    "",
    `Product: ${evidence.product.name}`
  );

  if (evidence.product.brand) lines.push(`Brand: ${evidence.product.brand}`);
  if (evidence.product.category) lines.push(`Category: ${evidence.product.category}`);

  lines.push(
    "",
    `Current market, captured ${evidence.market.capturedAt}:`,
    `  offers: ${evidence.market.offerCount} across ${evidence.market.marketplaceCount} marketplace(s)`,
    `  low ${money(evidence.market.minMinor)} / median ${money(evidence.market.medianMinor)} / high ${money(evidence.market.maxMinor)} ${evidence.currency}`
  );

  for (const o of evidence.market.offers) {
    const who = o.seller && o.seller !== o.marketplace ? `${o.seller} on ${o.marketplace}` : o.marketplace;
    const bits = [`${who}: ${money(o.priceMinor)}`];
    if (o.shippingFeeMinor != null) bits.push(`+${money(o.shippingFeeMinor)} shipping`);
    if (o.mrpMinor != null) bits.push(`MRP ${money(o.mrpMinor)}`);
    if (o.rating != null) bits.push(`${o.rating} stars${o.reviewCount != null ? ` (${o.reviewCount})` : ""}`);
    if (o.inStock === false) bits.push("out of stock");
    lines.push(`  - ${bits.join(", ")}`);
  }

  /**
   * The structure, spelled out.
   *
   * A median alone cannot distinguish a defended price floor from a lone
   * outlier, and those call for opposite decisions. Stating the shape stops
   * the model having to guess at it from a truncated list of offers.
   */
  if (evidence.competition) {
    const c = evidence.competition;
    lines.push(
      "",
      "Competitive structure:",
      `  cheapest ${money(c.floorMinor)}${c.secondFloorMinor != null ? `, next cheapest ${money(c.secondFloorMinor)}` : ""}` +
        `${c.floorGapMinor != null ? ` (gap ${money(c.floorGapMinor)})` : ""}`,
      `  sellers within 2% of the cheapest: ${c.atFloorCount}`,
      `  share of sellers within 5% of the median: ${(c.clustering * 100).toFixed(0)}%`,
      `  spread high-to-low: ${c.spreadPct.toFixed(1)}% of the median`,
      `  confirmed in stock: ${c.inStockCount} of ${evidence.market.offerCount}`,
      "",
      "Read that structure before answering. A crowded floor means a price there will be matched;",
      "a lone cheap seller well below the rest is an outlier, not the market."
    );
  } else {
    lines.push(
      "",
      "Competitive structure: too few sellers to establish one. Treat the figures above as indicative only."
    );
  }

  if (evidence.history) {
    const h = evidence.history;
    lines.push(
      "",
      `Observed history — ${h.observationCount} real observation(s), ${h.firstObservedAt} to ${h.lastObservedAt}:`,
      `  median ${money(h.medianMinor)}, range ${money(h.minMinor)}–${money(h.maxMinor)}`,
      h.changePct != null ? `  change first to last: ${h.changePct.toFixed(1)}%` : "  change: not established",
      h.volatilityPct != null ? `  volatility: ${h.volatilityPct.toFixed(1)}%` : "  volatility: not established",
      h.comparable === false
        ? "  CAUTION: the number of sellers changed materially across this window, so part of that movement describes who was counted rather than what was charged."
        : ""
    );
  } else {
    lines.push(
      "",
      "Observed history: none yet. This product has only just been tracked, so judge from the current market alone and do not infer a trend."
    );
  }

  // Conditional lines above push "" when they have nothing to say.
  return lines.filter((line, i) => line !== "" || lines[i - 1] !== "").join("\n");
}

export class HttpJsonAIProvider implements AIProvider {
  readonly name: string;
  readonly model: string;
  readonly available: boolean;
  private readonly shape: Shape;

  constructor(provider: "gemini" | "openai" | "anthropic") {
    this.name = provider;
    this.model = env.AI_MODEL;
    this.shape = SHAPES[provider]!;
    this.available = Boolean(env.AI_API_KEY);
  }

  async recommend(evidence: PricingEvidence): Promise<AIPricingVerdict> {
    if (!env.AI_API_KEY) {
      throw new AIProviderError(this.name, `${this.name} is selected but AI_API_KEY is not set.`, "auth", false);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(this.shape.url(this.model), {
        method: "POST",
        headers: this.shape.headers(env.AI_API_KEY),
        body: JSON.stringify(this.shape.body(this.model, buildPrompt(evidence))),
        signal: controller.signal,
      });
    } catch (cause) {
      const timedOut = (cause as Error)?.name === "AbortError";
      throw new AIProviderError(
        this.name,
        timedOut ? `No answer within ${env.AI_TIMEOUT_MS}ms.` : `Could not reach ${this.name}.`,
        timedOut ? "timeout" : "unavailable",
        true
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const kind = response.status === 429 ? "quota" : response.status === 401 || response.status === 403 ? "auth" : "unavailable";
      // The body may carry the key back in an error echo, so it is not logged.
      throw new AIProviderError(this.name, `${this.name} returned ${response.status}.`, kind, kind === "quota");
    }

    const text = this.shape.extractText(await response.json());
    if (!text) throw new AIProviderError(this.name, "Response carried no text.", "malformed", false);

    let parsed: unknown;
    try {
      // Models occasionally wrap JSON in a fenced block despite instructions.
      parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
    } catch {
      throw new AIProviderError(this.name, "Response was not JSON.", "malformed", false);
    }

    const verdict = validateVerdict(parsed, {
      minMinor: evidence.market.minMinor,
      maxMinor: evidence.market.maxMinor,
    });
    if ("error" in verdict) {
      throw new AIProviderError(this.name, `Rejected output: ${verdict.error}.`, "malformed", false);
    }
    return verdict;
  }
}
