import "./helpers/env.js";

import { strict as assert } from "node:assert";
import { after, before, beforeEach, describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { createDiscoveryTestApp, signIn, bearer, type Harness } from "./helpers/harness.js";
import { normalizeQuery } from "../src/ingestion/queryKey.js";
import { tierFor, CAPTURE_TIERS } from "../src/modules/discovery/capture.scheduler.js";
import { validateVerdict, AIProviderError, type AIProvider, type PricingEvidence } from "../src/ai/index.js";
import {
  ProviderError,
  type MarketOfferBatch,
  type MarketOfferProvider,
  type ProductMarketProvider,
} from "../src/ingestion/types.js";

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

/** `Brand New Widget` → `brand-new-widget`, the stub's catalogue namespace. */
const slugId = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

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
        /**
         * Catalogue ids are SCOPED TO THE PRODUCT, as the provider's are.
         * A fixed `ext_0` shared across queries made every query resolve to
         * one product, which hid real identity bugs behind a stub artefact.
         */
        product_id: `${slugId(query.query)}_${i}`,
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

/**
 * A PRODUCT-MARKET PROVIDER THAT COUNTS ITS CALLS.
 *
 * Mirrors the live endpoint's actual behaviour, which is the whole reason the
 * clustering exists: ONE catalogue id returns only two or three stores, and
 * DIFFERENT ids return different ones, overlapping partially. A stub that
 * returned all ten sellers for every id would make the fan-out look
 * unnecessary and would let a regression that stopped clustering pass.
 *
 * The store lists below are shifted per catalogue id so that the union across
 * four ids is strictly larger than any single id — the measured property the
 * architecture depends on.
 */
class CountingMarketProvider implements ProductMarketProvider {
  readonly name = "serpapi";
  calls = 0;
  ids: string[] = [];
  failNext = false;
  /** Stores available, in merchant-id order. */
  private readonly stores = [
    { name: "Amazon.in", merchant: "141020976", price: 70000 },
    { name: "Flipkart", merchant: "687512769", price: 70500 },
    { name: "Croma", merchant: "525733885", price: 71200 },
    { name: "Vijay Sales", merchant: "9705343", price: 69800 },
    { name: "Reliance Digital", merchant: "123032650", price: 72400 },
    { name: "Tata CLiQ", merchant: "388119669", price: 70900 },
    { name: "JioMart", merchant: "542431472", price: 71800 },
    { name: "Excess2Sell", merchant: "5348309716", price: 68900 },
  ];

  constructor(private readonly storesPerId = 3) {}

  /**
   * Catalogue ids listed here answer as a DIFFERENT product: same wording,
   * different screen size. Nothing in a store listing title separates an
   * iPhone 15 from an iPhone 15 Plus, so the attributes are the only thing
   * that can, and this is how that path gets exercised.
   */
  variantIds = new Set<string>();

  /** Milliseconds each call takes, so overlap can be observed. */
  latencyMs = 0;
  /** The most calls that were ever in flight at once. */
  peakConcurrency = 0;
  private inFlight = 0;

  async fetchProduct(externalProductId: string, opts: { currency?: string } = {}) {
    this.calls++;
    this.ids.push(externalProductId);

    this.inFlight++;
    this.peakConcurrency = Math.max(this.peakConcurrency, this.inFlight);
    try {
      if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    } finally {
      this.inFlight--;
    }

    if (this.failNext) {
      this.failNext = false;
      throw new ProviderError(this.name, "product endpoint exploded", "unavailable", true);
    }

    /** A stable per-id window into the store list, so ids overlap but differ. */
    const seed = [...externalProductId].reduce((a, c) => a + c.charCodeAt(0), 0);
    const picked = Array.from({ length: this.storesPerId }, (_, i) => this.stores[(seed + i * 2) % this.stores.length]!);

    /**
     * The title is derived from the catalogue id's namespace, so every
     * sibling id of one product reports the SAME title — which is what makes
     * them clusterable — while different products report different ones.
     */
    const namespace = externalProductId.replace(/_d+$/, "");
    const title = namespace.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

    const raw = {
      product_results: {
        title,
        brand: "TestCo",
        thumbnails: ["https://serpapi.test/p.jpg"],
        price_range: "₹68,900-₹72,400",
        product_attributes: [
          { name: "storage capacity", value: "256 GB" },
          { name: "brand", value: "TestCo" },
          { name: "screen size", value: this.variantIds.has(externalProductId) ? "6.7 inches" : "6.1 inches" },
        ],
        price_insights: { price_history: true, price_tracking_available: true },
        stores: picked.map((s, i) => ({
          position: i + 1,
          name: s.name,
          merchant_id: s.merchant,
          link: `https://${s.name.toLowerCase().replace(/[^a-z]/g, "")}.test/p`,
          title: `Test Phone 12 Pro 256GB (${s.name})`,
          price: `₹${s.price}`,
          extracted_price: s.price,
          total: `₹${s.price}`,
          extracted_total: s.price,
          shipping: "Free",
          rating: 4.1,
          reviews: 200 + i,
          details_and_offers: ["In stock online", "Free delivery"],
        })),
      },
    };

    /**
     * Normalised by the PRODUCTION parser, for the same reason the search
     * stub is: a hand-built `ProductMarket` would skip the code that turns a
     * provider response into our vocabulary.
     */
    const { normaliseProductMarket } = await import("../src/ingestion/providers/serpapi.market.js");
    return normaliseProductMarket(
      raw,
      externalProductId,
      `https://serpapi.test/product?id=${externalProductId}`,
      opts.currency ?? "INR",
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
let marketProvider: CountingMarketProvider;
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
  marketProvider = new CountingMarketProvider();
  ai = new StubAI();
  h = await createDiscoveryTestApp({
    marketProvider: provider,
    productMarketProvider: marketProvider,
    aiProvider: ai,
  });
  const session = await signIn(h, "discovery@example.com");
  token = session.token;
});
after(async () => {
  await h.close();
});
beforeEach(() => {
  provider.calls = 0;
  provider.queries = [];
  marketProvider.calls = 0;
  marketProvider.ids = [];
  marketProvider.variantIds.clear();
  marketProvider.latencyMs = 0;
  marketProvider.peakConcurrency = 0;
  // A failure armed by one test must not fire inside the next one.
  provider.failNext = false;
  marketProvider.failNext = false;
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

  /**
   * THE CATALOGUE IDS ARE OPENED TOGETHER, NOT ONE AFTER ANOTHER.
   *
   * This is a correctness property rather than a performance one, and it was
   * found in production the expensive way. The calls are independent, so
   * running them in sequence made a capture cost the SUM of them: about 8
   * seconds per call from that host, four ids plus the search, 34 seconds
   * total. API Gateway allows an integration 29.
   *
   * The user saw a 503 while the server carried on and wrote the market
   * correctly half a minute later — the worst shape a failure can take,
   * because the interface said it failed and the database said it had not.
   *
   * Asserted on observed overlap rather than on elapsed time: a wall-clock
   * assertion would be flaky on a loaded machine, while "more than one call
   * was in flight at once" is exactly the claim and cannot be satisfied by a
   * sequential implementation however fast the machine is.
   */
  test("a capture opens its catalogue ids concurrently", async () => {
    marketProvider.latencyMs = 60;

    const { body: search } = await api("GET", "/search?q=concurrency%20probe%20phone");
    const { status } = await api("POST", "/tracked", { ref: search.data.results[0].ref });
    assert.equal(status, 201);

    assert.ok(marketProvider.calls > 1, `only ${marketProvider.calls} id(s) were opened`);
    assert.ok(
      marketProvider.peakConcurrency > 1,
      `calls never overlapped (peak ${marketProvider.peakConcurrency}) — the ids are being opened one at a time, ` +
        "which makes a capture cost the sum of its calls rather than the slowest of them"
    );
    assert.equal(
      marketProvider.peakConcurrency,
      marketProvider.calls,
      "every id should go out together; a lower peak means something is still serialising them"
    );
  });

  /** The requirement in its strongest form. */
  test("fifty users tracking one product do not cost fifty calls", async () => {
    const { body } = await api("GET", "/search?q=crowd%20favourite");
    const ref = body.data.results[0].ref;

    const first = await api("POST", "/tracked", { ref });
    assert.equal(first.status, 201);
    const productId = first.body.data.product.id;

    /**
     * Baseline taken AFTER the first follower, because the first one is the
     * capture: it opens the product's market and legitimately costs calls.
     * The claim being tested is that the forty-nine after it cost nothing.
     */
    const searchCalls = provider.calls;
    const productCalls = marketProvider.calls;

    for (let i = 0; i < 49; i++) {
      const session = await signIn(h, `crowd${i}@example.com`);
      const res = await api("POST", "/tracked", { ref }, session.token);
      assert.equal(res.status, 201);
      assert.equal(res.body.data.product.id, productId, "all of them follow the same product");
    }

    assert.equal(provider.calls, searchCalls, "forty-nine more followers, no additional search call");
    assert.equal(marketProvider.calls, productCalls, "and no additional market call either");

    const trackers = (await h.db.execute(
      sql`select tracker_count from products where id = ${productId}`
    )) as unknown as { rows: { tracker_count: number }[] };
    assert.equal(trackers.rows[0]!.tracker_count, 50, "but all fifty are recorded as following it");
  });
});

/* ================================================================ tracking */

describe("tracking a live result", () => {
  /**
   * THE DEFECT THIS REDESIGN EXISTS TO REMOVE.
   *
   * The previous version of this test asserted exactly ONE observation after
   * tracking, and it passed — because tracking recorded the single listing
   * the user had clicked. That single row was then the entire "market" every
   * screen and the price recommendation worked from.
   *
   * Following a product now means following its COMPETITION, so the
   * assertion is inverted: several sellers, on several marketplaces, each a
   * real timestamped observation. A regression that went back to storing the
   * clicked listing would fail here rather than passing quietly.
   */
  test("creates the product, its competing sellers and the relationship", async () => {
    const { body: search } = await api("GET", "/search?q=brand%20new%20widget");
    const result = search.data.results[0];

    const { status, body } = await api("POST", "/tracked", { ref: result.ref });
    assert.equal(status, 201, JSON.stringify(body).slice(0, 400));
    assert.equal(body.data.product.created, true);

    const productId = body.data.product.id;
    const product = (await h.db.execute(
      sql`select origin, canonical_query, external_product_id, tracker_count
            from products where id = ${productId}`
    )) as unknown as {
      rows: Array<{ origin: string; canonical_query: string; external_product_id: string | null; tracker_count: number }>;
    };
    assert.equal(product.rows[0]!.origin, "live", "marked live, so the cleanup can tell it apart from seed");
    assert.equal(product.rows[0]!.tracker_count, 1);
    assert.ok(
      product.rows[0]!.external_product_id,
      "the provider's catalogue id is stored — without it the market cannot be re-opened"
    );

    /** More than one seller, which is the whole point. */
    assert.ok(body.data.market.sellers >= 3, `only ${body.data.market.sellers} seller(s) stored`);
    assert.ok(body.data.market.marketplaces >= 3, "across several marketplaces");
    assert.ok(body.data.market.catalogIdsOpened > 1, "assembled from more than one catalogue id");

    const stored = (await h.db.execute(sql`
      select count(*)::int as observations,
             count(distinct o.seller_id)::int as sellers,
             count(distinct l.marketplace_id)::int as marketplaces
        from price_observations po
        join offers o   on o.id = po.offer_id
        join listings l on l.id = o.listing_id
       where l.product_id = ${productId}
    `)) as unknown as { rows: Array<{ observations: number; sellers: number; marketplaces: number }> };

    assert.equal(stored.rows[0]!.observations, body.data.market.sellers, "one observation per competing seller");
    assert.equal(stored.rows[0]!.sellers, body.data.market.sellers);
    assert.ok(stored.rows[0]!.marketplaces >= 3, "and they are genuinely on different marketplaces");

    /** The day's competitive aggregate exists, so a trend can start. */
    const snap = (await h.db.execute(sql`
      select seller_count, marketplace_count, low_minor, median_minor, high_minor
        from product_market_snapshots where product_id = ${productId}
    `)) as unknown as {
      rows: Array<{ seller_count: number; marketplace_count: number; low_minor: number; median_minor: number; high_minor: number }>;
    };
    assert.equal(snap.rows.length, 1, "one competitive picture per product per day");
    assert.equal(snap.rows[0]!.seller_count, body.data.market.sellers);
    assert.ok(snap.rows[0]!.low_minor <= snap.rows[0]!.median_minor);
    assert.ok(snap.rows[0]!.median_minor <= snap.rows[0]!.high_minor);
  });

  /**
   * A NEAR-IDENTICAL VARIANT IS A DIFFERENT PRODUCT.
   *
   * The failure this guards against is invisible by construction. Clustering
   * works from store listing titles, and nothing in "iPhone 15" against
   * "iPhone 15 Plus" tells them apart: one ordinary English word, which no
   * pattern can distinguish from a retailer's descriptive padding. Measured
   * on the recorded fixtures, clustering "iPhone 15 128GB" admitted the Plus
   * AND the Pro — three different phones pooled into one market and priced
   * as one product, with a spread that looked like a market opportunity.
   *
   * The provider's structured attributes settle it: the two disagree on
   * screen size as a matter of catalogue record. So every opened id is
   * checked against the anchor's attributes AFTER fetching, when that better
   * evidence is in hand, and a disagreement on any shared attribute removes
   * the id and records why.
   */
  test("a sibling catalogue id that is really a different variant is discarded", async () => {
    const { body: search } = await api("GET", "/search?q=variant%20probe%20phone");

    /** Half the catalogue ids will answer as a 6.7-inch model. */
    const ids = search.data.results.map((r: any) => r.externalId).filter(Boolean);
    assert.ok(ids.length >= 4, "the fixture must offer several catalogue ids to cluster");
    for (const id of ids.slice(2)) marketProvider.variantIds.add(id);

    const { status, body } = await api("POST", "/tracked", { ref: search.data.results[0].ref });
    assert.equal(status, 201, JSON.stringify(body).slice(0, 300));

    const productId = body.data.product.id;
    const market = await api("GET", `/products/${productId}/market`);

    /**
     * Only the ids agreeing with the anchor on screen size contributed, so
     * the market is narrower than the number of ids opened — and that is the
     * correct market rather than a wider wrong one.
     */
    const contributing = (await h.db.execute(
      sql`select count(*)::int n from product_catalog_ids
            where product_id = ${productId} and coalesce(seller_count, 0) > 0`
    )) as unknown as { rows: Array<{ n: number }> };

    assert.ok(
      contributing.rows[0]!.n < body.data.market.catalogIdsOpened,
      "at least one opened id was discarded for being a different variant"
    );
    assert.ok(market.body.data.sellers.length > 0, "and the product still has its own market");
    assert.equal(
      market.body.data.product.catalogIdCount >= 1,
      true,
      "the discarded ids keep their row, with the reason, rather than vanishing"
    );
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
  /**
   * One CAPTURE is one history point, however many sellers it found.
   *
   * The distinction matters: a capture that found ten sellers has not
   * observed ten days of history, and counting sellers as history points
   * would make a product look like it had a trend on the day it was first
   * tracked. The per-seller prices are held separately, and the history a
   * trend is drawn from counts captures.
   */
  test("a freshly tracked product has one history point, however many sellers", async () => {
    const { body: search } = await api("GET", "/search?q=history%20probe%20one");
    const { body } = await api("POST", "/tracked", { ref: search.data.results[0].ref });

    assert.ok(body.data.market.sellers > 1, "it did find several sellers");

    const rec = await api("GET", `/products/${body.data.product.id}/market-recommendation`);
    assert.equal(rec.body.data.history.observationCount, 1, "but that is one capture, not several days");
    assert.equal(rec.body.data.history.changePct, null, "one point is a level, not a movement");
    assert.equal(rec.body.data.history.volatilityPct, null);
    assert.equal(rec.body.data.history.trend, null, "and no trend is claimed from it");
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
    assert.ok(body.data.market.sellerCount >= 3, "argued against real competing sellers");
    assert.ok(body.data.market.marketplaceCount >= 3, "on several marketplaces");
    assert.ok(Array.isArray(body.data.market.sellers), "and the sellers themselves are returned with the price");
    assert.equal(
      body.data.market.sellers.length,
      body.data.market.sellerCount,
      "the figure and the list it was computed from agree"
    );
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

  /**
   * A product genuinely sold by one shop.
   *
   * The thinness that matters is now at the SELLER level, not the search
   * level: a query can return forty rows and the product still have one
   * seller. So the stub returns a single store per catalogue id and no
   * siblings to cluster, which is what a real obscure item looks like.
   */
  test("too thin a market refuses instead of inventing a number", async () => {
    const thinMarket = new CountingMarketProvider(1);
    const thinApp = await createDiscoveryTestApp({
      marketProvider: new CountingProvider(1),
      productMarketProvider: thinMarket,
      aiProvider: new StubAI(),
    });
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
      const trackedBody = tracked.json() as any;
      assert.equal(tracked.statusCode, 201, JSON.stringify(trackedBody).slice(0, 300));
      assert.equal(trackedBody.data.market.sellers, 1, "one shop sells it, and that is recorded honestly");

      const rec = await thinApp.app.inject({
        method: "GET",
        url: `/api/v1/products/${trackedBody.data.product.id}/market-recommendation`,
        headers: bearer(session.token),
      });

      const body = rec.json() as any;
      assert.equal(body.data.available, false);
      assert.equal(body.data.reason, "insufficient_competitive_evidence");
      assert.equal(body.data.recommendedPriceMinor, undefined, "no number is offered at all");
      assert.equal(body.data.evidence.sellerCount, 1, "and it says exactly how thin the evidence was");
      assert.match(body.data.message, /at least 3/, "including what would have been enough");
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

  /**
   * The product endpoint for that contaminated search.
   *
   * Each catalogue id answers for what it actually is: the accessory ids
   * return accessory sellers at accessory prices, the phone ids return phone
   * sellers. That is the honest stub, and it is what makes the test
   * meaningful — if the clustering opened an accessory's id, accessory prices
   * really would be written into the phone's market, exactly as happened in
   * production.
   */
  class ContaminatedMarketProvider implements ProductMarketProvider {
    readonly name = "serpapi";
    opened: string[] = [];

    async fetchProduct(externalProductId: string, opts: { currency?: string } = {}) {
      this.opened.push(externalProductId);

      const index = Number(externalProductId.replace("acc_", ""));
      const isAccessory = index < 4;
      const base = isAccessory ? [1_899, 1_501, 958] : [179_900, 182_900, 176_500];
      const title = isAccessory ? "Apple iPhone 18 Pro Max Silicone Case" : "Apple iPhone 18 Pro Max";

      const { normaliseProductMarket } = await import("../src/ingestion/providers/serpapi.market.js");
      return normaliseProductMarket(
        {
          product_results: {
            title,
            brand: "Apple",
            stores: base.map((price, i) => ({
              name: ["Amazon.in", "Flipkart", "Croma"][i],
              merchant_id: `m${index}${i}`,
              link: `https://store.test/${externalProductId}/${i}`,
              title,
              price: `Rs${price}`,
              extracted_price: price,
              extracted_total: price,
              shipping: "Free",
              details_and_offers: ["In stock online"],
            })),
          },
        },
        externalProductId,
        "https://serpapi.test/p",
        opts.currency ?? "INR",
        this.name
      );
    }
  }

  test("the phone is priced against phones, not against cases", async () => {
    const marketStub = new ContaminatedMarketProvider();
    const app = await createDiscoveryTestApp({
      marketProvider: new ContaminatedProvider(),
      productMarketProvider: marketStub,
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

      /**
       * THE STRONGER GUARANTEE.
       *
       * The old architecture fetched everything and then filtered prices,
       * which meant correctness depended on a judgement made after the data
       * was in hand. Identity is now settled BEFORE any price is read: an
       * accessory's catalogue id is never opened at all, so an accessory
       * price has no path into this product's market. Asserting on which ids
       * were opened tests that directly, rather than testing the cleanup.
       */
      const accessoryIdsOpened = marketStub.opened.filter((id) => Number(id.replace("acc_", "")) < 4);
      assert.deepEqual(accessoryIdsOpened, [], "no accessory catalogue id was opened at all");
      assert.ok(marketStub.opened.length >= 2, "and the phone's sibling listings were");

      assert.equal(data.available, true);
      assert.ok(data.market.sellerCount >= 3, "argued against several phone sellers");

      // The assertion that would have caught the original Rs 6,040.
      assert.ok(
        data.recommendedPriceMinor > 10_000_000,
        `recommended ${data.recommendedPriceMinor} — a phone must not be priced against its own cases`
      );
      assert.ok(
        data.market.medianMinor >= 17_650_000 && data.market.medianMinor <= 18_290_000,
        `median ${data.market.medianMinor} must be a phone price`
      );
      assert.ok(data.market.lowMinor > 10_000_000, "and so must the market floor");
    } finally {
      await app.close();
    }
  });

  test("an accessory price never enters the product's history", async () => {
    const marketStub = new ContaminatedMarketProvider();
    const app = await createDiscoveryTestApp({
      marketProvider: new ContaminatedProvider(),
      productMarketProvider: marketStub,
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
      const { MarketRepository } = await import("../src/modules/market/market.repository.js");
      const { MarketService } = await import("../src/modules/market/market.service.js");
      const { SnapshotService } = await import("../src/ingestion/snapshot.service.js");

      const snapshots = new SnapshotService(app.db, new ContaminatedProvider());
      const scheduler = new CaptureScheduler(
        new MarketService(new MarketRepository(app.db), snapshots, marketStub),
        snapshots,
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

/* ========================================== a live product is a real product */

describe("a tracked live product can actually be opened", () => {
  /**
   * THE BUG THIS EXISTS FOR.
   *
   * Tracking worked, the dashboard listed the product, and clicking it said
   * "No product with id prod_live_…" — about a row that was in the table the
   * whole time. `findProduct` INNER JOINed brands, categories and product
   * types, which is correct for a seeded product and fatal for a discovered
   * one: migration 0009 made those nullable precisely because a marketplace
   * title does not state them, so all three joins failed and the row vanished.
   *
   * The fix is in the read model. Inventing a brand to satisfy a join would
   * have put a fabricated fact on the product page.
   */
  test("the id the dashboard shows is the id the product API resolves", async () => {
    const { body: search } = await api("GET", "/search?q=openable%20widget");
    const { body: tracked } = await api("POST", "/tracked", { ref: search.data.results[0].ref });
    const productId = tracked.data.product.id;

    const desk = await api("GET", "/tracked");
    const row = desk.body.data.find((t: any) => t.productId === productId);
    assert.ok(row, "the dashboard must list the product it just created");

    // The same id, through the product endpoint the page actually calls.
    const detail = await api("GET", `/products/${productId}`);
    assert.equal(detail.status, 200, `the product page could not load it: ${JSON.stringify(detail.body).slice(0, 200)}`);
    assert.equal(detail.body.data.id, productId);
  });

  test("it loads with no brand, category or product type", async () => {
    const { body: search } = await api("GET", "/search?q=taxonomyless%20widget");
    const { body: tracked } = await api("POST", "/tracked", { ref: search.data.results[0].ref });

    const stored = (await h.db.execute(sql`
      select brand_id, category_id, product_type_id from products where id = ${tracked.data.product.id}
    `)) as unknown as { rows: Array<{ brand_id: null; category_id: null; product_type_id: null }> };
    const row = stored.rows[0]!;
    assert.equal(row.brand_id, null, "the premise: a live product genuinely has no taxonomy");
    assert.equal(row.category_id, null);
    assert.equal(row.product_type_id, null);

    const { status, body } = await api("GET", `/products/${tracked.data.product.id}`);
    assert.equal(status, 200);

    // Reported as absent, never invented.
    assert.equal(body.data.brand, null);
    assert.equal(body.data.category, null);
    assert.equal(body.data.productType, null);
    // And the real fields it does have are present.
    assert.ok(body.data.canonicalName);
    assert.deepEqual(body.data.categoryPath, []);
    assert.deepEqual(body.data.attributeDefinitions, []);
  });

  /**
   * That a SEEDED product still loads with its taxonomy is asserted where
   * there is a catalogue to assert it against — `catalogue.test.ts` checks
   * `brand.name === "Dove"` on the product detail of a seeded row. This
   * harness deliberately seeds nothing, so repeating it here would only have
   * proven that an absent product is absent.
   */

  test("its price history is whatever was really observed", async () => {
    const { body: search } = await api("GET", "/search?q=history%20openable");
    const { body: tracked } = await api("POST", "/tracked", { ref: search.data.results[0].ref });

    const rec = await api("GET", `/products/${tracked.data.product.id}/market-recommendation`);
    assert.equal(rec.status, 200);
    // One capture, one observation — not a manufactured month of history.
    assert.equal(rec.body.data.history.observationCount, 1);
    assert.equal(rec.body.data.history.changePct, null);
  });
});
