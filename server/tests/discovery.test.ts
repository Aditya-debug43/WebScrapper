import "./helpers/env.js";

import { strict as assert } from "node:assert";
import { after, before, beforeEach, describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { createDiscoveryTestApp, signIn, bearer, type Harness } from "./helpers/harness.js";
import { normalizeQuery } from "../src/ingestion/queryKey.js";
import { tierFor, CAPTURE_TIERS } from "../src/modules/discovery/capture.scheduler.js";
import { validateVerdict, AIProviderError, type AIProvider, type PricingEvidence } from "../src/ai/index.js";
import { ProviderError, type MarketOfferBatch, type MarketOfferProvider } from "../src/ingestion/types.js";

/**
 * REAL-DATA DISCOVERY
 * ===================
 *
 * The behaviour this phase exists for: a user can find a product that has
 * never been in our database, follow it, and start accumulating genuine price
 * history — without the system inventing anything, and without one provider
 * call per user per day.
 *
 * The provider is a counting stub rather than SerpApi. A live call costs
 * money, needs a key and returns something different every run, so nothing
 * could be asserted exactly. What the stub makes testable is the thing that
 * actually matters here: HOW MANY TIMES the provider is asked.
 */

/** A provider that counts its calls and returns a fixed market. */
class CountingProvider implements MarketOfferProvider {
  readonly name = "serpapi";
  calls = 0;
  queries: string[] = [];
  failNext = false;
  /** Resolve manually, to hold a call open and test coalescing. */
  gate: (() => void) | null = null;

  constructor(private readonly offerCount = 5) {}

  async search(query: { query: string }): Promise<MarketOfferBatch> {
    this.calls++;
    this.queries.push(query.query);

    if (this.gate) {
      await new Promise<void>((resolve) => {
        this.gate = resolve;
      });
    }
    if (this.failNext) {
      this.failNext = false;
      throw new ProviderError(this.name, "upstream exploded", "unavailable", true);
    }

    const stores = ["Amazon.in", "Flipkart", "Croma", "Vijay Sales", "Reliance Digital"];
    const raw = {
      shopping_results: Array.from({ length: this.offerCount }, (_, i) => ({
        /**
         * Every listing shares one title so they resolve to ONE canonical
         * product across several stores — which is what a market snapshot
         * for a single product actually looks like.
         */
        title: query.query,
        source: stores[i % stores.length],
        price: `₹${70000 + i * 1000}`,
        extracted_price: 70000 + i * 1000,
        product_id: `ext_${i}`,
        product_link: `https://store.test/${i}`,
        thumbnail: `https://serpapi.test/images/${i}.jpg`,
        rating: 4.2,
        reviews: 100 + i,
        delivery: "Free delivery",
      })),
    };

    /**
     * Normalised by the PRODUCTION parser rather than hand-built.
     *
     * A stub that returned pre-normalised offers would skip the very code
     * that turns a provider response into our own vocabulary, so the tests
     * would pass over a parser that had stopped working.
     */
    const { normaliseSerpResponse } = await import("../src/ingestion/providers/serpapi.provider.js");
    return normaliseSerpResponse(
      raw,
      query.query,
      `https://serpapi.test/search?q=${encodeURIComponent(query.query)}`,
      "INR",
      this.name
    );
  }
}

/** An AI provider that can be made to misbehave on demand. */
class StubAI implements AIProvider {
  readonly name = "stub";
  readonly model = "stub-1";
  available = true;
  calls = 0;
  mode: "ok" | "throw" | "garbage" = "ok";
  lastEvidence: PricingEvidence | null = null;

  async recommend(evidence: PricingEvidence) {
    this.calls++;
    this.lastEvidence = evidence;
    if (this.mode === "throw") throw new AIProviderError(this.name, "model is down", "unavailable", true);
    if (this.mode === "garbage") {
      // Inside its own range but an order of magnitude off the market.
      throw new AIProviderError(this.name, "Rejected output: outside the plausible corridor.", "malformed", false);
    }
    const median = evidence.market.medianMinor;
    return {
      recommendedPriceMinor: Math.round(median * 0.97),
      rangeMinMinor: Math.round(median * 0.9),
      rangeMaxMinor: Math.round(median * 1.05),
      confidence: "medium" as const,
      reasoning: "Positioned just under the observed median.",
      warnings: [],
    };
  }
}

let h: Harness;
let provider: CountingProvider;
let ai: StubAI;
let token: string;

/**
 * A distinct source address per call.
 *
 * The routes are rate-limited per IP, so without this one test's traffic
 * eats the next test's budget and failures appear in whichever test happens
 * to run thirty-first. `signIn` already does the same thing for the same
 * reason.
 */
let callIp = 0;
const api = async (method: string, url: string, payload?: unknown, as = token) => {
  callIp++;
  const res = await h.app.inject({
    method: method as "GET",
    url: `/api/v1${url}`,
    payload,
    headers: bearer(as),
    remoteAddress: `10.100.${Math.floor(callIp / 256) % 256}.${callIp % 256}`,
  });
  return { status: res.statusCode, body: res.json() as any };
};

before(async () => {
  provider = new CountingProvider();
  ai = new StubAI();
  h = await createDiscoveryTestApp({ marketProvider: provider, aiProvider: ai });
  const session = await signIn(h, "discovery@example.com");
  token = session.token;
});
after(async () => {
  await h.close();
});
beforeEach(() => {
  provider.calls = 0;
  provider.queries = [];
  // A failure armed by one test must not fire inside the next one.
  provider.failNext = false;
  ai.calls = 0;
  ai.mode = "ok";
});

/* ========================================================== query identity */

describe("equivalent queries are one market question", () => {
  test("formatting collapses, meaning does not", () => {
    assert.equal(normalizeQuery("iPhone 17 256 GB"), normalizeQuery("iphone 17 256gb"));
    assert.equal(normalizeQuery("  iPhone   17  256GB "), normalizeQuery("iphone 17 256gb"));

    // The bug this project already paid for once: a number attached to a
    // model is meaning, not noise.
    assert.notEqual(normalizeQuery("iphone 13"), normalizeQuery("iphone 15"));
    assert.notEqual(normalizeQuery("iphone 15 128gb"), normalizeQuery("iphone 15 256gb"));
    assert.notEqual(normalizeQuery("iphone 15 pro"), normalizeQuery("iphone 15 pro max"));
  });
});

/* ================================================================== search */

describe("search finds what the database has never held", () => {
  /** THE ACCEPTANCE SCENARIO. */
  test("iPhone 18 is not in the catalogue, and search returns real results anyway", async () => {
    const before = (await h.db.execute(
      sql`select count(*)::int as n from products where canonical_name ilike '%iphone 18%'`
    )) as unknown as { rows: { n: number }[] };
    assert.equal(before.rows[0]!.n, 0, "the premise: nothing in products matches");

    const { status, body } = await api("GET", "/search?q=iPhone%2018");
    assert.equal(status, 200);
    assert.ok(body.data.results.length > 0, "the market answered even though the catalogue could not");
    assert.equal(provider.calls, 1);
  });

  test("results carry the real fields, and no invented ones", async () => {
    const { body } = await api("GET", "/search?q=real%20fields%20probe");
    const [first] = body.data.results;

    assert.ok(first.title);
    assert.ok(first.source);
    assert.ok(first.priceMinor > 0);
    assert.equal(first.currency, "INR");
    assert.ok(first.thumbnailUrl, "an image the provider actually returned");
    assert.ok(first.ref, "a server-resolvable reference");
    // Not reported by this provider, and so not fabricated.
    assert.equal(first.inStock, null);
  });

  test("searching creates no product", async () => {
    const before = (await h.db.execute(sql`select count(*)::int as n from products`)) as unknown as {
      rows: { n: number }[];
    };
    await api("GET", "/search?q=creates%20nothing%20probe");
    const after = (await h.db.execute(sql`select count(*)::int as n from products`)) as unknown as {
      rows: { n: number }[];
    };
    assert.equal(after.rows[0]!.n, before.rows[0]!.n, "a query is a question, not an intention to keep something");
  });

  test("the capture is persisted with its body, so it can be re-read", async () => {
    await api("GET", "/search?q=provenance%20probe");
    const rows = (await h.db.execute(sql`
      select cr.normalized_query, rd.body is not null as "hasBody"
        from capture_runs cr join raw_documents rd on rd.capture_run_id = cr.id
       where cr.source_query = 'provenance probe'
    `)) as unknown as { rows: Array<{ normalized_query: string; hasBody: boolean }> };

    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]!.hasBody, true, "the body was hashed and discarded before 0008");
    assert.equal(rows.rows[0]!.normalized_query, "provenance probe");
  });

  test("a provider failure is reported as one, never as an empty market", async () => {
    provider.failNext = true;
    const { status, body } = await api("GET", "/search?q=doomed%20query");
    assert.equal(status, 503);
    assert.equal(body.error.code, "MARKET_DATA_UNAVAILABLE");

    const runs = (await h.db.execute(
      sql`select run_status from capture_runs where source_query = 'doomed query'`
    )) as unknown as { rows: { run_status: string }[] };
    assert.equal(runs.rows[0]!.run_status, "failed", "recorded, not silently dropped");
  });
});

/* ================================================= the call-minimisation */

describe("one market question costs one provider call", () => {
  test("a repeated search inside the freshness window costs nothing", async () => {
    await api("GET", "/search?q=repeat%20probe");
    assert.equal(provider.calls, 1);

    const { body } = await api("GET", "/search?q=repeat%20probe");
    assert.equal(provider.calls, 1, "the second search reused the stored capture");
    assert.equal(body.data.reused, true);
  });

  test("differently-spelled equivalent queries share one call", async () => {
    await api("GET", "/search?q=Galaxy%20S25%20256%20GB");
    await api("GET", "/search?q=galaxy%20s25%20256gb");
    assert.equal(provider.calls, 1, "same market question, one call");
  });

  test("concurrent identical searches coalesce into one call", async () => {
    // Hold the provider open so every caller misses the stored snapshot.
    provider.gate = () => {};
    const inFlight = Array.from({ length: 10 }, () => api("GET", "/search?q=stampede%20probe"));

    await new Promise((r) => setTimeout(r, 50));
    const release = provider.gate;
    provider.gate = null;
    if (typeof release === "function") release();

    const results = await Promise.all(inFlight);
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(provider.calls, 1, "ten simultaneous askers, one provider call");
  });

  /** The requirement in its strongest form. */
  test("fifty users tracking one product do not cost fifty calls", async () => {
    const { body } = await api("GET", "/search?q=crowd%20favourite");
    const ref = body.data.results[0].ref;
    const callsAfterSearch = provider.calls;

    for (let i = 0; i < 50; i++) {
      const session = await signIn(h, `crowd${i}@example.com`);
      const res = await api("POST", "/tracked", { ref }, session.token);
      assert.equal(res.status, 201);
    }

    assert.equal(provider.calls, callsAfterSearch, "fifty followers, no additional provider call");

    const trackers = (await h.db.execute(
      sql`select tracker_count from products where canonical_query = ${normalizeQuery(body.data.results[0].title)}`
    )) as unknown as { rows: { tracker_count: number }[] };
    assert.equal(trackers.rows[0]!.tracker_count, 50, "but all fifty are recorded as following it");
  });
});

/* ================================================================ tracking */

describe("tracking a live result", () => {
  test("creates the product, the observation and the relationship", async () => {
    const { body: search } = await api("GET", "/search?q=brand%20new%20widget");
    const result = search.data.results[0];

    const { status, body } = await api("POST", "/tracked", { ref: result.ref });
    assert.equal(status, 201, JSON.stringify(body).slice(0, 400));
    assert.equal(body.data.product.created, true);

    const product = (await h.db.execute(
      sql`select origin, canonical_query, tracker_count from products where id = ${body.data.product.id}`
    )) as unknown as { rows: Array<{ origin: string; canonical_query: string; tracker_count: number }> };
    assert.equal(product.rows[0]!.origin, "live", "marked live, so the cleanup can tell it apart from seed");
    assert.equal(product.rows[0]!.tracker_count, 1);

    // The first price arrives immediately — the user chose a result that
    // already carried one, so waiting for the scheduler would be perverse.
    const obs = (await h.db.execute(sql`
      select count(*)::int as n from price_observations po
        join offers o on o.id = po.offer_id
        join listings l on l.id = o.listing_id
       where l.product_id = ${body.data.product.id}
    `)) as unknown as { rows: { n: number }[] };
    assert.equal(obs.rows[0]!.n, 1);
  });

  test("the same result tracked twice resolves to one product", async () => {
    const { body: search } = await api("GET", "/search?q=idempotent%20widget");
    const ref = search.data.results[0].ref;

    const first = await api("POST", "/tracked", { ref });
    const second = await api("POST", "/tracked", { ref });
    assert.equal(first.body.data.product.id, second.body.data.product.id);
    assert.equal(second.body.data.product.created, false, "reused, not duplicated");
  });

  test("the browser cannot invent a product to track", async () => {
    const forged = await api("POST", "/tracked", { ref: "bm9wZQ.notarealmac0000000000" });
    assert.equal(forged.status, 404, "an unsigned reference resolves to nothing");
  });

  test("tracking is user-specific", async () => {
    const other = await signIn(h, "someone-else@example.com");
    const { body: search } = await api("GET", "/search?q=private%20widget");
    await api("POST", "/tracked", { ref: search.data.results[0].ref });

    const mine = await api("GET", "/tracked");
    const theirs = await api("GET", "/tracked", undefined, other.token);

    assert.ok(mine.body.data.some((t: any) => t.searchQuery === "private widget"));
    assert.ok(
      !theirs.body.data.some((t: any) => t.searchQuery === "private widget"),
      "one person following something does not enrol everybody"
    );
  });

  test("a user cannot stop someone else's tracking", async () => {
    const other = await signIn(h, "intruder@example.com");
    const { body: search } = await api("GET", "/search?q=guarded%20widget");
    const tracked = await api("POST", "/tracked", { ref: search.data.results[0].ref });

    const attempt = await api("DELETE", `/tracked/${tracked.body.data.tracking.id}`, undefined, other.token);
    assert.equal(attempt.status, 404, "scoped by user, so another's id is simply not found");
  });

  test("tracking endpoints require a session", async () => {
    for (const [method, url, payload] of [
      ["GET", "/search?q=anything", undefined],
      ["GET", "/tracked", undefined],
      // A well-shaped body, so the schema passes and AUTH is what refuses.
      ["POST", "/tracked", { ref: "not-a-real-reference" }],
    ] as const) {
      const res = await h.app.inject({ method: method as "GET", url: `/api/v1${url}`, payload });
      assert.equal(res.statusCode, 401, `${method} ${url}`);
    }
  });
});

/* ============================================================ the scheduler */

describe("capture frequency follows demand", () => {
  test("the ladder is deterministic", () => {
    const now = new Date("2026-10-05T12:00:00Z");
    const hoursAgo = (n: number) => new Date(now.getTime() - n * 3_600_000);

    assert.equal(tierFor({ trackerCount: 9, lastInterestAt: hoursAgo(300), now }).name, CAPTURE_TIERS.keen.name);
    assert.equal(tierFor({ trackerCount: 1, lastInterestAt: hoursAgo(2), now }).name, CAPTURE_TIERS.keen.name);
    assert.equal(tierFor({ trackerCount: 1, lastInterestAt: hoursAgo(200), now }).name, CAPTURE_TIERS.followed.name);
    assert.equal(tierFor({ trackerCount: 0, lastInterestAt: hoursAgo(48), now }).name, CAPTURE_TIERS.browsed.name);
  });

  /** The largest saving available: not calling about things nobody wants. */
  test("a product nobody follows or has opened is never captured", () => {
    const now = new Date("2026-10-05T12:00:00Z");
    const tier = tierFor({ trackerCount: 0, lastInterestAt: new Date(now.getTime() - 40 * 86_400_000), now });
    assert.equal(tier.name, CAPTURE_TIERS.cold.name);
    assert.equal(tier.intervalHours, 0, "zero means no scheduled call at all");
  });
});

/* ========================================================= price history */

describe("history is only what was really captured", () => {
  test("a freshly tracked product has exactly one observation", async () => {
    const { body: search } = await api("GET", "/search?q=history%20probe%20one");
    const { body } = await api("POST", "/tracked", { ref: search.data.results[0].ref });

    const rec = await api("GET", `/products/${body.data.product.id}/market-recommendation`);
    assert.equal(rec.body.data.history.observationCount, 1);
    assert.equal(rec.body.data.history.changePct, null, "one point is a level, not a movement");
    assert.equal(rec.body.data.history.volatilityPct, null);
  });

  test("a failed capture adds nothing and destroys nothing", async () => {
    const { body: search } = await api("GET", "/search?q=resilient%20probe");
    const { body } = await api("POST", "/tracked", { ref: search.data.results[0].ref });
    const productId = body.data.product.id;

    const countObs = async () => {
      const r = (await h.db.execute(sql`
        select count(*)::int as n from price_observations po
          join offers o on o.id = po.offer_id
          join listings l on l.id = o.listing_id
         where l.product_id = ${productId}
      `)) as unknown as { rows: { n: number }[] };
      return r.rows[0]!.n;
    };

    const before = await countObs();
    provider.failNext = true;
    // A query never captured before, so the provider really is reached.
    const failed = await api("GET", "/search?q=never%20seen%20before%20query");
    assert.equal(failed.status, 503, "the provider really did fail");
    assert.equal(await countObs(), before, "a provider outage must leave yesterday's history exactly as it was");
  });
});

/* =============================================== cold-start recommendation */

describe("a price can be recommended with no history at all", () => {
  let productId: string;

  before(async () => {
    const { body: search } = await api("GET", "/search?q=cold%20start%20phone");
    const { body } = await api("POST", "/tracked", { ref: search.data.results[0].ref });
    productId = body.data.product.id;
  });

  test("zero-history products still get a recommendation, from the current market", async () => {
    const { status, body } = await api("GET", `/products/${productId}/market-recommendation`);
    assert.equal(status, 200);
    assert.equal(body.data.available, true);
    assert.equal(body.data.mode, "cold_start");
    assert.ok(body.data.recommendedPriceMinor > 0);
    assert.ok(body.data.market.offerCount >= 3, "argued against real offers");
    assert.ok(
      body.data.warnings.some((w: string) => /history/i.test(w)),
      "and it says that is what it did"
    );
  });

  test("it reuses the snapshot rather than buying another call", async () => {
    provider.calls = 0;
    await api("GET", `/products/${productId}/market-recommendation`);
    assert.equal(provider.calls, 0, "the market was already fresh");
  });

  test("the AI sees summarised evidence, never a raw provider response", async () => {
    await api("GET", `/products/${productId}/market-recommendation`);
    const evidence = ai.lastEvidence!;
    assert.ok(evidence.market.offers.length > 0);
    assert.ok(evidence.market.medianMinor > 0);
    assert.equal(JSON.stringify(evidence).includes("shopping_results"), false, "no provider vocabulary reaches the model");
  });

  test("an AI failure yields the deterministic price, labelled as such", async () => {
    ai.mode = "throw";
    const { body } = await api("GET", `/products/${productId}/market-recommendation?refresh=false`);

    assert.equal(body.data.available, true);
    assert.equal(body.data.method, "deterministic", "never presented as an AI judgement");
    assert.ok(body.data.aiError);
    assert.ok(body.data.warnings.some((w: string) => /deterministic/i.test(w)));
  });

  test("too thin a market refuses instead of inventing a number", async () => {
    const thin = new CountingProvider(1);
    const thinApp = await createDiscoveryTestApp({ marketProvider: thin, aiProvider: new StubAI() });
    try {
      const session = await signIn(thinApp, "thin@example.com");
      const search = await thinApp.app.inject({
        method: "GET",
        url: "/api/v1/search?q=obscure%20item",
        headers: bearer(session.token),
      });
      const tracked = await thinApp.app.inject({
        method: "POST",
        url: "/api/v1/tracked",
        payload: { ref: search.json().data.results[0].ref },
        headers: bearer(session.token),
      });
      const rec = await thinApp.app.inject({
        method: "GET",
        url: `/api/v1/products/${tracked.json().data.product.id}/market-recommendation`,
        headers: bearer(session.token),
      });

      const body = rec.json() as any;
      assert.equal(body.data.available, false);
      assert.equal(body.data.reason, "insufficient_market_evidence");
      assert.equal(body.data.recommendedPriceMinor, undefined, "no number is offered at all");
    } finally {
      await thinApp.close();
    }
  });
});

/* ================================================ accessories are not rivals */

describe("a product is not priced against its own accessories", () => {
  /**
   * THE BUG THIS EXISTS FOR, FOUND AGAINST LIVE DATA.
   *
   * A real search for "Apple iPhone 18 Pro Max" returned 39 offers, most of
   * them skins and cases sharing the product's name:
   *
   *     ₹958     iPhone 18 Pro Max Camera Bar Artist Series Skins
   *     ₹1,899   Apple iPhone 18 Pro Max Silicone Case with MagSafe
   *     ₹2,39,899  the actual phone
   *
   * The median of that set is about ₹6,900, and the first recommendation this
   * system produced was ₹6,040 for a flagship phone — confident, specific and
   * completely wrong, which is worse than refusing. Text cannot separate
   * them: every accessory title genuinely contains the product name.
   */
  class ContaminatedProvider implements MarketOfferProvider {
    readonly name = "serpapi";
    async search(query: { query: string }): Promise<MarketOfferBatch> {
      // Four accessories, three real phones — accessories in the majority,
      // exactly as the live search returned them.
      const rows = [
        { title: `${query.query} Silicone Case`, price: 1_899, source: "Amazon.in" },
        { title: `${query.query} Skins & Wraps`, price: 1_300, source: "Flipkart" },
        { title: `${query.query} Camera Bar Skins`, price: 958, source: "Croma" },
        { title: `${query.query} MagSafe Case`, price: 1_501, source: "Vijay Sales" },
        { title: query.query, price: 179_900, source: "Vijay Sales" },
        { title: query.query, price: 182_900, source: "Amazon.in" },
        { title: query.query, price: 176_500, source: "Flipkart" },
      ];
      const raw = {
        shopping_results: rows.map((r, i) => ({
          title: r.title,
          source: r.source,
          price: `₹${r.price}`,
          extracted_price: r.price,
          product_id: `acc_${i}`,
          product_link: `https://store.test/acc/${i}`,
        })),
      };
      const { normaliseSerpResponse } = await import("../src/ingestion/providers/serpapi.provider.js");
      return normaliseSerpResponse(raw, query.query, "https://serpapi.test/c", "INR", this.name);
    }
  }

  test("the phone is priced against phones, not against cases", async () => {
    const app = await createDiscoveryTestApp({
      marketProvider: new ContaminatedProvider(),
      aiProvider: new StubAI(),
    });
    try {
      const session = await signIn(app, "contaminated@example.com");
      const search = await app.app.inject({
        method: "GET",
        url: "/api/v1/search?q=Apple%20iPhone%2018%20Pro%20Max",
        headers: bearer(session.token),
      });

      // The real phone, which is what a user would click.
      const phone = (search.json() as any).data.results.find((r: any) => r.priceMinor === 17_990_000);
      assert.ok(phone, "the fixture must contain the phone itself");

      const tracked = await app.app.inject({
        method: "POST",
        url: "/api/v1/tracked",
        payload: { ref: phone.ref },
        headers: bearer(session.token),
      });
      const productId = (tracked.json() as any).data.product.id;

      const rec = await app.app.inject({
        method: "GET",
        url: `/api/v1/products/${productId}/market-recommendation`,
        headers: bearer(session.token),
      });
      const data = (rec.json() as any).data;

      assert.equal(data.available, true);
      assert.equal(data.market.offerCount, 3, "only the three phones counted as competitors");
      assert.equal(data.market.excludedAsDifferentProduct, 4, "the four accessories were excluded and reported");

      // The assertion that would have caught the original ₹6,040.
      assert.ok(
        data.recommendedPriceMinor > 10_000_000,
        `recommended ${data.recommendedPriceMinor} — a phone must not be priced against its own cases`
      );
      assert.ok(data.market.medianMinor >= 17_650_000 && data.market.medianMinor <= 18_290_000);
    } finally {
      await app.close();
    }
  });

  test("an accessory price never enters the product's history", async () => {
    const app = await createDiscoveryTestApp({
      marketProvider: new ContaminatedProvider(),
      aiProvider: new StubAI(),
    });
    try {
      const session = await signIn(app, "history-clean@example.com");
      const search = await app.app.inject({
        method: "GET",
        url: "/api/v1/search?q=Apple%20iPhone%2018%20Pro%20Max",
        headers: bearer(session.token),
      });
      const phone = (search.json() as any).data.results.find((r: any) => r.priceMinor === 17_990_000);
      const tracked = await app.app.inject({
        method: "POST",
        url: "/api/v1/tracked",
        payload: { ref: phone.ref },
        headers: bearer(session.token),
      });
      const productId = (tracked.json() as any).data.product.id;

      const { CaptureScheduler } = await import("../src/modules/discovery/capture.scheduler.js");
      const { DiscoveryRepository } = await import("../src/modules/discovery/discovery.repository.js");
      const { SnapshotService } = await import("../src/ingestion/snapshot.service.js");

      const scheduler = new CaptureScheduler(
        new DiscoveryRepository(app.db),
        new SnapshotService(app.db, new ContaminatedProvider()),
        app.db
      );
      // Force it due, then sweep.
      await app.db.execute(sql`update products set next_capture_at = now() - interval '1 hour' where id = ${productId}`);
      await scheduler.sweep({ limit: 10, maxAgeSeconds: 0 });

      const observed = (await app.db.execute(sql`
        select min(po.selling_price_minor)::int as "min"
          from price_observations po
          join offers o on o.id = po.offer_id
          join listings l on l.id = o.listing_id
         where l.product_id = ${productId}
      `)) as unknown as { rows: Array<{ min: number }> };

      assert.ok(
        observed.rows[0]!.min > 10_000_000,
        `cheapest recorded ${observed.rows[0]!.min} — a case price in the history would corrupt it permanently`
      );
    } finally {
      await app.close();
    }
  });
});

/* ============================================================ AI contract */

describe("the AI layer is swappable and cannot smuggle nonsense through", () => {
  test("output outside the plausible corridor is rejected", () => {
    const bounds = { minMinor: 70_000, maxMinor: 80_000 };
    const wild = validateVerdict(
      { recommendedPriceMinor: 5_000_000, rangeMinMinor: 1, rangeMaxMinor: 9_000_000, confidence: "high", reasoning: "x" },
      bounds
    );
    assert.ok("error" in wild, "a misplaced decimal point is malformed output, not an opinion");
  });

  test("a price outside its own range is rejected", () => {
    const out = validateVerdict(
      { recommendedPriceMinor: 90_000, rangeMinMinor: 70_000, rangeMaxMinor: 80_000, confidence: "low", reasoning: "x" },
      { minMinor: 70_000, maxMinor: 80_000 }
    );
    assert.ok("error" in out);
  });

  test("a well-formed verdict passes", () => {
    const ok = validateVerdict(
      { recommendedPriceMinor: 75_000, rangeMinMinor: 70_000, rangeMaxMinor: 80_000, confidence: "medium", reasoning: "sound", warnings: [] },
      { minMinor: 70_000, maxMinor: 80_000 }
    );
    assert.ok(!("error" in ok));
  });

  test("the pricing engine never names a provider", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("src/modules/pricing/marketPricing.service.ts", "utf8");
    for (const vendor of ["openai", "gemini", "anthropic", "api.openai.com", "generativelanguage"]) {
      assert.ok(!source.toLowerCase().includes(vendor), `${vendor} leaked into the pricing engine`);
    }
  });
});
