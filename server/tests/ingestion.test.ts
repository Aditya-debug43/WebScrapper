import "./helpers/env.js";

process.env["MARKET_DATA_PROVIDER"] = "fixture";
process.env["MARKET_DATA_FIXTURE_DIR"] = "./fixtures/market-data";

import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { createAnalysisTestApp, bearer, signIn, type Harness } from "./helpers/harness.js";
import {
  captureRuns,
  listings,
  marketplaces,
  offers,
  priceObservations,
  rawDocuments,
  rejectedRecords,
  sellers,
} from "../src/db/schema.js";
import { FixtureProvider } from "../src/ingestion/providers/fixture.provider.js";
import { IngestionService } from "../src/ingestion/ingestion.service.js";
import { matchProduct, MATCH_CONFIDENCE_FLOOR, extractVariant, type MatchCandidate } from "../src/ingestion/matching.js";
import { SerpApiProvider } from "../src/ingestion/providers/serpapi.provider.js";
import { ProviderError } from "../src/ingestion/types.js";

/**
 * MARKET DATA INGESTION
 * =====================
 *
 * The properties under test are the ones that make this pipeline trustworthy
 * rather than merely functional:
 *
 *   - a provider failure never becomes an empty result
 *   - an uncertain match is refused, not guessed
 *   - re-ingesting the same data twice changes nothing
 *   - no SerpApi field name escapes the adapter
 *
 * It runs entirely on recorded responses, so it needs no API key and spends
 * no quota — through the SAME normaliser the live provider uses, so what it
 * exercises is production code.
 */

let h: Harness;

/** `prod_iphone_15_128` exists in the catalogue; its peers come with it. */
before(async () => {
  h = await createAnalysisTestApp(["prod_iphone_15_128"]);
});

after(async () => {
  await h.close();
});

/**
 * The service under test, wired to recorded responses.
 *
 * Constructed per call rather than once, because `createMarketOfferProvider()`
 * reads the environment at construction time and a test that shared one
 * instance would hide a factory that ignored its configuration.
 */
const service = () => new IngestionService(h.db, new FixtureProvider("./fixtures/market-data"));

/* ========================================================================= */
/* The port                                                                   */
/* ========================================================================= */

describe("provider isolation", () => {
  test("a missing recording is an error, not an empty market", async () => {
    const provider = new FixtureProvider("./fixtures/market-data");
    await assert.rejects(
      () => provider.search({ query: "a product nobody has ever recorded" }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.kind, "unavailable");
        assert.equal(error.retryable, false);
        return true;
      },
      "zero offers would be a claim about the market; this is a claim about the setup"
    );
  });

  test("the normalised offer carries no provider field names", async () => {
    const provider = new FixtureProvider("./fixtures/market-data");
    const batch = await provider.search({ query: "synthetic edge cases", currency: "INR" });

    const [offer] = batch.offers;
    assert.ok(offer);
    const keys = Object.keys(offer).filter((k) => k !== "raw");
    for (const leaked of ["extracted_price", "shopping_results", "product_link", "old_price", "second_hand_condition"]) {
      assert.ok(!keys.includes(leaked), `${leaked} escaped the adapter`);
    }
    assert.deepEqual(
      keys.sort(),
      [
        "condition", "currency", "deliveryNote", "externalId", "inStock", "mrpMinor", "observedAt",
        "priceMinor", "provider", "rating", "rawTitle", "reviewCount", "shippingFeeMinor", "sourceName", "url",
      ].sort()
    );
  });

  test("prices arrive as integer minor units", async () => {
    const batch = await new FixtureProvider("./fixtures/market-data").search({ query: "synthetic edge cases" });
    const flipkart = batch.offers.find((o) => o.sourceName === "Flipkart");
    assert.equal(flipkart?.priceMinor, 6_599_900, "₹65,999.00 is 6599900 paise");
    assert.equal(flipkart?.mrpMinor, 7_990_000);
  });

  test("delivery: free is zero, a figure is that figure, a promise is unknown", async () => {
    const batch = await new FixtureProvider("./fixtures/market-data").search({ query: "synthetic edge cases" });
    const by = (source: string) => batch.offers.find((o) => o.sourceName === source);

    assert.equal(by("Flipkart")?.shippingFeeMinor, 0, '"Free delivery" is a stated zero');
    assert.equal(by("Amazon.in")?.shippingFeeMinor, 4_900, '"₹49 delivery" is 4900 paise');
    assert.equal(
      by("Croma")?.shippingFeeMinor,
      null,
      '"Delivery by Tue" says nothing about cost — guessing zero would understate every landed price'
    );
  });

  test("stock and condition are read only where the source is explicit", async () => {
    const batch = await new FixtureProvider("./fixtures/market-data").search({ query: "synthetic edge cases" });
    assert.equal(batch.offers.find((o) => o.sourceName === "Vijay Sales")?.inStock, false);
    assert.equal(batch.offers.find((o) => o.sourceName === "Croma")?.inStock, null, "unstated is not false");
    assert.equal(batch.offers.find((o) => o.externalId === "fx_apple_15_128_renewed")?.condition, "refurbished");
  });

  test("unreadable results are reported, not dropped", async () => {
    const batch = await new FixtureProvider("./fixtures/market-data").search({ query: "synthetic malformed results" });
    assert.equal(batch.offers.length, 1, "only one of the four results is usable");
    assert.equal(batch.skipped.length, 3);
    assert.deepEqual(
      batch.skipped.map((s) => s.reason).sort(),
      ["no source/store", "no title", "no usable price (Check in store)"].sort()
    );
  });

  /**
   * Exercises the LIVE adapter's own URL construction, with `fetch` stubbed.
   *
   * Passing a pre-redacted URL into the normaliser would prove nothing — the
   * redaction happens where the URL is built, and that is the code that has
   * to be tested. The key below is a throwaway string that never leaves the
   * process; no request is made.
   */
  test("the live adapter strips the API key from the URL it records", async () => {
    const realFetch = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ shopping_results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    try {
      const secret = "test-only-not-a-real-key-000";
      const batch = await new SerpApiProvider(secret, 5000).search({ query: "synthetic edge cases" });

      assert.ok(seen[0]?.includes(`api_key=${secret}`), "the real request must carry the key");
      assert.ok(
        !batch.requestUrl.includes(secret),
        "the URL written to raw_documents must not — a credential in a provenance record is a credential in a backup"
      );
      assert.match(batch.requestUrl, /api_key=REDACTED/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("a provider HTTP failure is classified, not swallowed", async () => {
    const realFetch = globalThis.fetch;
    const cases: Array<[number, string, boolean]> = [
      [429, "quota", true],
      [401, "auth", false],
      [500, "http", true],
    ];
    try {
      for (const [status, kind, retryable] of cases) {
        globalThis.fetch = (async () => new Response("", { status })) as typeof globalThis.fetch;
        await assert.rejects(
          () => new SerpApiProvider("test-only-not-a-real-key-000", 5000).search({ query: "x" }),
          (error: unknown) => {
            assert.ok(error instanceof ProviderError);
            assert.equal(error.kind, kind, `HTTP ${status}`);
            assert.equal(error.retryable, retryable);
            return true;
          }
        );
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("a 200 response carrying an error string is still a failure", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Your account has run out of searches." }), {
        status: 200,
      })) as typeof globalThis.fetch;
    try {
      await assert.rejects(
        () => new SerpApiProvider("test-only-not-a-real-key-000", 5000).search({ query: "x" }),
        (error: unknown) => {
          assert.ok(error instanceof ProviderError);
          assert.equal(error.kind, "quota", "an exhausted plan arrives as HTTP 200");
          return true;
        }
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("no key configured is an auth error before any request is made", async () => {
    await assert.rejects(
      () => new SerpApiProvider("", 5000).search({ query: "x" }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.kind, "auth");
        assert.equal(error.retryable, false);
        return true;
      }
    );
  });
});

/* ========================================================================= */
/* Matching                                                                   */
/* ========================================================================= */

describe("matching refuses rather than guesses", () => {
  const candidate = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
    productId: "prod_x",
    canonicalName: "Apple iPhone 15 (128GB) — Blue",
    modelName: "iPhone 15",
    brandName: "Apple",
    brandAliases: [],
    specifications: { ram_gb: 6, storage_gb: 128 },
    variantAxes: { storage: "128GB", colour: "Blue" },
    ...over,
  });

  test("the exact variant matches", () => {
    const v = matchProduct("Apple iPhone 15 (128 GB) - Blue", [candidate()]);
    assert.equal(v.status, "auto_matched");
    assert.ok(v.confidence >= MATCH_CONFIDENCE_FLOOR);
  });

  test("a different storage tier is refused however similar the text", () => {
    const v = matchProduct("Apple iPhone 15 (256 GB) - Blue", [candidate()]);
    assert.equal(v.status, "unmatched", "one token apart, and a different product");
    assert.match(v.reason, /different configuration/);
  });

  test("a different RAM tier is refused", () => {
    const v = matchProduct("POCO X6 Pro 5G 12GB 256GB", [
      candidate({ productId: "prod_poco", canonicalName: "POCO X6 Pro (8GB RAM, 256GB)", modelName: "X6 Pro", brandName: "POCO", specifications: { ram_gb: 8, storage_gb: 256 }, variantAxes: null }),
    ]);
    assert.equal(v.status, "unmatched");
  });

  test("two indistinguishable candidates produce no match", () => {
    const v = matchProduct("Apple iPhone 15", [
      candidate({ productId: "prod_a", canonicalName: "Apple iPhone 15", specifications: null, variantAxes: null }),
      candidate({ productId: "prod_b", canonicalName: "Apple iPhone 15", specifications: null, variantAxes: null }),
    ]);
    assert.equal(v.status, "unmatched");
    assert.match(v.reason, /too close to separate/);
  });

  test("an empty catalogue matches nothing", () => {
    assert.equal(matchProduct("Apple iPhone 15 128GB", []).status, "unmatched");
  });

  test("brand aliases are honoured — stores write Poco, not Xiaomi", () => {
    const aliased = candidate({
      productId: "prod_poco",
      canonicalName: "POCO M6 5G (6GB RAM, 128GB)",
      modelName: "M6 5G",
      brandName: "Xiaomi",
      brandAliases: ["POCO", "Redmi"],
      specifications: { ram_gb: 6, storage_gb: 128 },
      variantAxes: null,
    });
    const withAlias = matchProduct("POCO M6 5G 6GB 128GB", [aliased]);
    const withoutAlias = matchProduct("POCO M6 5G 6GB 128GB", [{ ...aliased, brandAliases: [] }]);

    /**
     * Asserted on the reason rather than the score: this candidate matches so
     * strongly that both readings clamp at 1.0, and a score comparison would
     * therefore pass or fail for reasons unrelated to aliases.
     */
    assert.match(withAlias.reason, /brand present/, '"POCO" is a Xiaomi alias and is right there in the title');
    assert.match(withoutAlias.reason, /brand absent/, "without the alias the title looks brandless");
  });

  test("a missing brand costs confidence but does not disqualify", () => {
    const weak = matchProduct("iPhone 15 128GB Blue", [candidate({ brandAliases: [] })]);
    const strong = matchProduct("Apple iPhone 15 128GB Blue", [candidate({ brandAliases: [] })]);
    assert.ok(strong.confidence >= weak.confidence);
    assert.equal(strong.status, "auto_matched");
  });

  test("variant extraction reads RAM and storage by magnitude", () => {
    assert.deepEqual(
      { ...extractVariant("POCO X6 Pro 5G 8GB 256GB Racing Grey"), modelTokens: undefined },
      { storageGb: 256, ramGb: 8, colour: "grey", modelTokens: undefined }
    );
    assert.equal(extractVariant("iPhone 15 Pro Max 1TB").storageGb, 1024);
    assert.equal(extractVariant("Apple iPhone 15 (128GB)").ramGb, null, "a single capacity is storage, not RAM");
  });
});

/* ========================================================================= */
/* End to end                                                                 */
/* ========================================================================= */

describe("ingestion end to end", () => {
  test("a known product is matched, persisted, and traceable", async () => {
    const summary = await service().ingestQuery("synthetic edge cases", { force: true });

    assert.equal(summary.provider, "fixture");
    assert.equal(summary.offersReceived, 6);
    assert.ok(summary.offersMatched >= 4, `matched ${summary.offersMatched} of 6`);
    assert.equal(summary.observationsWritten, summary.offersMatched);
    assert.equal(summary.source, "provider");

    // The 256GB result must NOT have been snapped onto the 128GB product.
    assert.ok(summary.offersUnmatched >= 1);
    const wrongVariant = await h.db
      .select({ reason: rejectedRecords.rejectionReason })
      .from(rejectedRecords)
      .where(eq(rejectedRecords.targetEntity, "listing"));
    assert.ok(
      wrongVariant.some((r) => /256 GB|storage 128≠256/.test(r.reason)),
      "the wrong-variant offer must be recorded as rejected with its reason"
    );

    /**
     * Every observation THIS ingestion wrote points back at the raw document
     * it came from. Scoped to this capture run — the seeded dataset carries
     * its own provenance from its own parser, and asserting over the whole
     * table would be asserting about the fixture.
     */
    const docs = await h.db
      .select({ id: rawDocuments.id, url: rawDocuments.sourceUrl })
      .from(rawDocuments)
      .where(eq(rawDocuments.captureRunId, summary.captureRunId!));
    assert.equal(docs.length, 1, "one provider response, one raw document");
    assert.ok(!/api_key=(?!REDACTED)/.test(docs[0]!.url), "no credential in a provenance record");

    const obs = await h.db
      .select({ parser: priceObservations.parserVersion })
      .from(priceObservations)
      .where(eq(priceObservations.rawDocumentId, docs[0]!.id));
    assert.equal(obs.length, summary.observationsWritten);
    assert.ok(obs.every((o) => o.parser === "market-data-v1"), "stamped so a parser change is traceable afterwards");
  });

  test("the capture run records an honest status and counts", async () => {
    const [run] = await h.db
      .select()
      .from(captureRuns)
      .where(eq(captureRuns.sourceQuery, "synthetic edge cases"))
      .orderBy(sql`${captureRuns.startedAt} desc`)
      .limit(1);

    assert.ok(run);
    assert.equal(run.provider, "fixture");
    assert.equal(run.marketplaceId, null, "one provider call spans several stores");
    assert.equal(run.runStatus, "partial", "some results were usable and some were not — that is partial, not success");
    assert.ok(run.finishedAt);
    assert.match(run.notes ?? "", /coverage shipping \d+% stock \d+% mrp \d+%/);
  });

  test("a store outside the curated six is recorded as discovered", async () => {
    const [croma] = await h.db
      .select({ id: marketplaces.id, isDiscovered: marketplaces.isDiscovered, type: marketplaces.marketplaceType })
      .from(marketplaces)
      .where(sql`lower(${marketplaces.name}) = 'croma'`);

    assert.ok(croma, "Croma appears in the response and must not be silently dropped");
    assert.equal(croma.isDiscovered, true, "it must not be mistaken for a curated marketplace");
    assert.equal(croma.type, "unclassified");

    const curated = await h.db
      .select({ n: sql<number>`count(*)` })
      .from(marketplaces)
      .where(eq(marketplaces.isDiscovered, false));
    assert.equal(Number(curated[0]!.n), 6, "the curated set is untouched");
  });

  test("offers are attributed to a storefront seller, not an invented one", async () => {
    const rows = await h.db
      .select({ name: sellers.name, external: sellers.externalSellerId })
      .from(sellers)
      .where(eq(sellers.externalSellerId, "storefront"));
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((r) => /\(storefront\)$/.test(r.name)), "the limitation of the source is visible in the data");
  });

  test("re-ingesting the same data writes nothing new", async () => {
    const before = {
      listings: Number((await h.db.select({ n: sql<number>`count(*)` }).from(listings))[0]!.n),
      offers: Number((await h.db.select({ n: sql<number>`count(*)` }).from(offers))[0]!.n),
      observations: Number((await h.db.select({ n: sql<number>`count(*)` }).from(priceObservations))[0]!.n),
    };

    const summary = await service().ingestQuery("synthetic edge cases", { force: true });
    assert.equal(summary.observationsWritten, 0, "one observation per offer per day; a repeat is a no-op");

    const after = {
      listings: Number((await h.db.select({ n: sql<number>`count(*)` }).from(listings))[0]!.n),
      offers: Number((await h.db.select({ n: sql<number>`count(*)` }).from(offers))[0]!.n),
      observations: Number((await h.db.select({ n: sql<number>`count(*)` }).from(priceObservations))[0]!.n),
    };
    assert.deepEqual(after, before, "ingestion must be idempotent within a day");
  });

  test("the freshness window prevents a second provider call", async () => {
    const summary = await service().ingestQuery("synthetic edge cases");
    assert.equal(summary.status, "reused");
    assert.equal(summary.source, "cache");
    assert.equal(summary.offersReceived, 0, "nothing was fetched");
    assert.match(summary.message, /freshness window/);
  });

  test("a product absent from the catalogue produces no listings at all", async () => {
    const listingsBefore = Number((await h.db.select({ n: sql<number>`count(*)` }).from(listings))[0]!.n);

    const summary = await service().ingestQuery("synthetic absent product", { force: true });

    assert.equal(summary.offersReceived, 3);
    assert.equal(summary.offersMatched, 0, "the POCO X6 Pro is not in this catalogue — nothing may be guessed");
    assert.equal(summary.offersUnmatched, 3);
    assert.equal(summary.observationsWritten, 0);

    const listingsAfter = Number((await h.db.select({ n: sql<number>`count(*)` }).from(listings))[0]!.n);
    assert.equal(listingsAfter, listingsBefore, "an unmatched offer must never become a listing");

    const rejected = await h.db
      .select({ reason: rejectedRecords.rejectionReason })
      .from(rejectedRecords)
      .where(sql`${rejectedRecords.rejectionReason} like '%POCO X6 Pro%'`);
    assert.equal(rejected.length, 3, "all three are kept with their reasons, not dropped");
  });

  test("a provider failure is a failure, never an empty result", async () => {
    const failing = new IngestionService(h.db, {
      name: "fixture",
      async search() {
        throw new ProviderError("fixture", "HTTP 429", "quota", true, 429);
      },
    });

    await assert.rejects(() => failing.ingestQuery("a query that will fail", { force: true }), ProviderError);

    const [run] = await h.db
      .select()
      .from(captureRuns)
      .where(eq(captureRuns.sourceQuery, "a query that will fail"))
      .limit(1);
    assert.ok(run);
    assert.equal(run.runStatus, "failed");
    assert.match(run.notes ?? "", /quota 429.*retryable/);
  });

  test("a human-confirmed match is never overwritten by the machine", async () => {
    /**
     * Deliberately the listing this ingestion DOES touch — the iPhone 15 on
     * Flipkart, which appears in the fixture. Picking any auto-matched row
     * would pass without testing anything, because the seeded catalogue is
     * full of listings this query never revisits.
     */
    const [listing] = await h.db
      .select({ id: listings.id, matchStatus: listings.matchStatus })
      .from(listings)
      .where(and(eq(listings.productId, "prod_iphone_15_128"), eq(listings.marketplaceId, "mp_flipkart")))
      .limit(1);
    assert.ok(listing, "the fixture must reach this listing or the test proves nothing");

    await h.db
      .update(listings)
      .set({ matchStatus: "human_confirmed", matchConfidence: 1, rawTitle: "CONFIRMED BY A PERSON" })
      .where(eq(listings.id, listing.id));

    await service().ingestQuery("synthetic edge cases", { force: true });

    const [after] = await h.db
      .select({ status: listings.matchStatus, title: listings.rawTitle })
      .from(listings)
      .where(eq(listings.id, listing.id));
    assert.equal(after?.status, "human_confirmed");
    assert.equal(after?.title, "CONFIRMED BY A PERSON", "a later auto-match must not overrule a person");
  });
});

/* ========================================================================= */
/* HTTP surface                                                               */
/* ========================================================================= */

describe("the ingestion route", () => {
  test("is authenticated", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/ingestion/search",
      payload: { query: "synthetic edge cases" },
    });
    assert.equal(res.statusCode, 401, "every call can spend a metered request");
  });

  test("rejects a query that is too short or malformed", async () => {
    const token = (await signIn(h, "seller@mulya.test")).token;
    for (const payload of [{ query: "x" }, { query: "ok", unexpected: true }, {}]) {
      const res = await h.app.inject({
        method: "POST",
        url: "/api/v1/ingestion/search",
        headers: bearer(token),
        payload,
      });
      assert.equal(res.statusCode, 400, `${JSON.stringify(payload)} should be refused by schema`);
    }
  });
});

/* ========================================================================= */
/* The containment guard                                                      */
/* ========================================================================= */

/**
 * THE RULE THAT MAKES THE PROVIDER REPLACEABLE.
 *
 * A comment saying "SerpApi field names live only in the adapter" is a hope.
 * This is the enforcement: it reads the backend source and fails if any
 * provider-specific identifier appears outside the one file entitled to it.
 *
 * Without this, isolation decays the ordinary way — someone needs a field the
 * port does not carry, reaches past it once "just here", and the next person
 * copies the pattern. By then swapping providers is a refactor rather than a
 * configuration change, which is exactly the coupling this design exists to
 * prevent.
 */
describe("SerpApi stays inside its adapter", () => {
  /** Vocabulary that belongs to the provider's response, not to this system. */
  const PROVIDER_FIELDS = [
    "shopping_results",
    "extracted_price",
    "extracted_old_price",
    "product_link",
    "second_hand_condition",
    "search_metadata",
    "serpapi.com",
  ];

  /** The single file allowed to know them, plus the test asserting all this. */
  const PERMITTED = ["src/ingestion/providers/serpapi.provider.ts"];

  test("no provider field name appears anywhere else in src/", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const walk = async (dir: string): Promise<string[]> => {
      const entries = await readdir(dir, { withFileTypes: true });
      const out: string[] = [];
      for (const entry of entries) {
        const path = join(dir, entry.name).split("\\").join("/");
        if (entry.isDirectory()) out.push(...(await walk(path)));
        else if (entry.name.endsWith(".ts")) out.push(path);
      }
      return out;
    };

    const files = await walk("src");
    assert.ok(files.length > 20, "the walk must actually find the backend source");

    const violations: string[] = [];
    for (const file of files) {
      if (PERMITTED.some((p) => file.endsWith(p))) continue;
      const source = await readFile(file, "utf8");
      for (const field of PROVIDER_FIELDS) {
        if (source.includes(field)) violations.push(`${file} mentions "${field}"`);
      }
    }

    assert.deepEqual(
      violations,
      [],
      "A provider's response shape must not leak past its adapter — if it has, the port is no longer doing its job"
    );
  });

  test("only the factory names a concrete provider", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const walk = async (dir: string): Promise<string[]> => {
      const entries = await readdir(dir, { withFileTypes: true });
      const out: string[] = [];
      for (const entry of entries) {
        const path = join(dir, entry.name).split("\\").join("/");
        if (entry.isDirectory()) out.push(...(await walk(path)));
        else if (entry.name.endsWith(".ts")) out.push(path);
      }
      return out;
    };

    /**
     * `new SerpApiProvider(...)` may be written in exactly one place. Anywhere
     * else is a caller that has chosen its provider instead of being given
     * one, which is how a swappable port quietly stops being swappable.
     */
    const allowed = ["src/ingestion/index.ts"];
    const offenders: string[] = [];
    for (const file of await walk("src")) {
      if (allowed.some((a) => file.endsWith(a))) continue;
      const source = await readFile(file, "utf8");
      if (/new\s+SerpApiProvider\s*\(/.test(source)) offenders.push(file);
    }
    assert.deepEqual(offenders, [], "a concrete provider may only be constructed by the factory");
  });

  test("the pricing, analysis and catalogue layers do not import the ingestion adapter", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const module of [
      "src/modules/pricing/pricing.service.ts",
      "src/modules/analysis/analysis.service.ts",
      "src/modules/analysis/competitor.service.ts",
      "src/modules/catalogue/catalogue.service.ts",
    ]) {
      const source = await readFile(module, "utf8");
      assert.ok(
        !source.includes("ingestion/providers"),
        `${module} must read observations from the database, not from a provider`
      );
    }
  });
});

/* ========================================================================= */
/* Real captured responses                                                    */
/* ========================================================================= */

/**
 * RECORDED FROM LIVE SERPAPI, NOT HAND-WRITTEN.
 *
 * The synthetic fixtures above are engineered: every edge case is there
 * because someone put it there. These three are what Google Shopping actually
 * returned for three real Indian-market queries, and they are a different
 * kind of evidence — nobody chose what is in them.
 *
 * They immediately found two defects the engineered fixtures could not,
 * because both needed a catalogue neighbour to expose them:
 *
 *   1. Model numbers were being stripped as if they were capacities, so
 *      "iPhone 13" and "iPhone 15" tokenised identically. Colour words were
 *      accidentally doing the model number's job.
 *   2. A title stating no capacity scored as a perfect match against a
 *      product that states one, so "Apple iPhone 15" would have been filed
 *      under the 128GB row despite possibly being the 256GB or 512GB.
 *
 * Both are pinned below. The capability tokens in `search_metadata` are
 * redacted in these files exactly as the adapter redacts them before storage.
 */
describe("real SerpApi captures", () => {
  /**
   * The real catalogue, loaded the way ingestion loads it. Matching real
   * titles against hand-written candidates would test the candidates.
   */
  let realCandidates: MatchCandidate[] = [];

  before(async () => {
    realCandidates = await new (await import("../src/ingestion/ingestion.repository.js")).IngestionRepository(
      h.db
    ).loadMatchCandidates();
  });

  test("the adapter parses a real response without losing results", async () => {
    const batch = await new FixtureProvider("./fixtures/market-data").search({ query: "iPhone 15 128GB" });
    assert.equal(batch.offers.length, 40, "all 40 real results normalise");
    assert.equal(batch.skipped.length, 0);
    assert.ok(batch.offers.every((o) => o.priceMinor && o.priceMinor > 0));
    assert.ok(batch.offers.every((o) => o.rawTitle.length > 0 && o.sourceName.length > 0));
  });

  /**
   * Real responses carried no `old_price`, no `extensions` and no `snippet`,
   * so MRP and stock are simply absent. Asserted rather than glossed over:
   * the adapter must report that honestly as null instead of inventing a
   * figure, and the capture-run coverage is what makes the gap visible.
   */
  test("absent fields are absent, not invented", async () => {
    const batch = await new FixtureProvider("./fixtures/market-data").search({ query: "iPhone 15 128GB" });
    assert.equal(batch.offers.filter((o) => o.mrpMinor != null).length, 0, "Google Shopping gave no list price");
    assert.equal(batch.offers.filter((o) => o.inStock != null).length, 0, "no stock marker in the real response");
    assert.ok(
      batch.offers.some((o) => o.shippingFeeMinor === null),
      "some results state no delivery terms, and that must survive as null"
    );
    assert.ok(batch.offers.some((o) => o.condition === "refurbished" || o.condition === "used"));
  });

  test("the capability tokens are redacted in what gets stored", async () => {
    const batch = await new FixtureProvider("./fixtures/market-data").search({ query: "iPhone 15 128GB" });
    const stored = JSON.stringify(batch.raw);

    /**
     * The three endpoint fields embed an ACCESS TOKEN, in the path shape
     * `/searches/<token>/<id>.json`, and each grants a reader the stored copy
     * of this search. Those are the ones that must not reach the database.
     *
     * Result-level `source_icon` and `serpapi_thumbnail` URLs also point at
     * serpapi.com, but their shape is `/searches/<search-id>/images/...` —
     * the search id, not the token. They are image assets and grant nothing,
     * so they stay. Asserting on the domain alone would conflate the two and
     * force the fixture to be mangled for no security gain.
     */
    for (const field of ["json_endpoint", "markdown_endpoint", "raw_html_file"]) {
      assert.match(stored, new RegExp(`"${field}":\\s*"\\[redacted\\]"`), `${field} must be scrubbed`);
    }
    assert.ok(
      !/serpapi\.com\/searches\/[A-Za-z0-9_-]{30,}\//.test(stored),
      "no long access token in any stored URL"
    );
    assert.ok(!/api_key/.test(stored), "the provider does not echo the key, and nothing adds it");
  });

  /** REGRESSION 1 — model numbers must survive tokenising. */
  test("iPhone 13 and iPhone 15 are not the same product", () => {
    const thirteen = extractVariant("Apple iPhone 13 (128GB) — Midnight").modelTokens;
    const fifteen = extractVariant("Apple iPhone 15 (128GB) — Blue").modelTokens;
    assert.ok(thirteen.includes("13"), "the model number is identity, not a capacity");
    assert.ok(fifteen.includes("15"));
    assert.notDeepEqual(thirteen, fifteen);

    const v = matchProduct("Apple iPhone 15 | 128GB | Black", realCandidates);
    assert.equal(v.status, "auto_matched", "a real listing agreeing on model and storage must match");
    assert.equal(v.productId, "prod_iphone_15_128");
    assert.ok(v.confidence < 1, "the colour differs from the catalogue row, and that should show");
  });

  /** REGRESSION 2 — silence about capacity is not agreement about capacity. */
  test("a title stating no capacity does not match a product that states one", () => {
    const v = matchProduct("Apple iPhone 15", realCandidates);
    assert.equal(v.status, "unmatched", "this could equally be the 256GB or the 512GB");
    assert.match(v.reason, /states no capacity/);
  });

  test("conservative on real titles: near-misses are all refused", () => {
    const mustNotMatch = [
      "Apple iPhone 15 Plus",
      "Apple iPhone 15 Pro Max 1TB",
      "Apple iPhone 16",
      "Refurbished Apple iPhone 15 Plus Blue by Cashify",
      "Samsung Galaxy S24 Fe 5g (128 Gb) (8 Gb Ram)",
      "Samsung Galaxy S26 5G (Black, 256 GB) (12 GB RAM)",
      "Poco X7 Pro 5g (obsidian Black, 256 Gb, 6550 Mah)",
      "Poco X8 Pro (black, 256 Gb, 6500 Mah)",
      "POCO X6 Pro 12GB RAM, 512GB Storage (Any Color)",
    ];
    for (const title of mustNotMatch) {
      const v = matchProduct(title, realCandidates);
      assert.equal(v.status, "unmatched", `"${title}" matched ${JSON.stringify(v)}`);
    }
  });

  /**
   * The honest headline from the live run: of 95 real offers across three
   * queries, exactly one corresponds to a product this catalogue carries.
   * That is the correct answer — the catalogue holds no POCO X6 Pro and no
   * Galaxy S24 at all — and pinning it means a future change that starts
   * matching more has to justify itself rather than look like progress.
   */
  test("95 real offers yield exactly one match against this catalogue", async () => {
    const provider = new FixtureProvider("./fixtures/market-data");
    let total = 0;
    let matched = 0;
    const hits: string[] = [];
    for (const query of ["iPhone 15 128GB", "Samsung Galaxy S24 256GB", "POCO X6 Pro 8GB 256GB"]) {
      const batch = await provider.search({ query });
      total += batch.offers.length;
      for (const offer of batch.offers) {
        const v = matchProduct(offer.rawTitle, realCandidates);
        if (v.status === "auto_matched") {
          matched += 1;
          hits.push(`${offer.sourceName}: ${offer.rawTitle} -> ${v.productId}`);
        }
      }
    }
    assert.equal(total, 95);
    assert.deepEqual(hits, ["myG: Apple iPhone 15 | 128GB | Black -> prod_iphone_15_128"]);
    assert.equal(matched, 1);
  });
});

/* ========================================================================= */
/* The blast radius of a provider outage                                      */
/* ========================================================================= */

/**
 * SERPAPI GOING DOWN MUST NOT TAKE THE PRODUCT WITH IT.
 *
 * Market data is an input to the pricing intelligence, not a dependency of
 * it: every number the application serves is computed from observations
 * already in the database. A provider outage should therefore cost exactly
 * one thing — the ability to add NEW observations — and nothing else.
 *
 * Worth asserting rather than assuming, because the failure mode is quiet.
 * An ingestion call wired too deeply into a request path would turn a vendor
 * incident into an outage, and nobody discovers that until the vendor has
 * one.
 */
describe("the backend survives a dead provider", () => {
  test("every read endpoint still answers while ingestion is failing", async () => {
    const dead = new IngestionService(h.db, {
      name: "serpapi",
      async search() {
        throw new ProviderError("serpapi", "connect ETIMEDOUT", "timeout", true);
      },
    });

    await assert.rejects(() => dead.ingestQuery("anything at all", { force: true }), ProviderError);

    for (const url of [
      "/api/v1/products/prod_iphone_15_128",
      "/api/v1/products/prod_iphone_15_128/marketplaces",
      "/api/v1/products/prod_iphone_15_128/price-history?window=7d",
      "/api/v1/marketplaces",
      "/health",
    ]) {
      const res = await h.app.inject({ method: "GET", url });
      assert.ok(
        res.statusCode < 500,
        `${url} returned ${res.statusCode} while the market-data provider was down`
      );
    }
  });

  test("an authenticated ingestion request answers 503, not a fabricated empty result", async () => {
    const token = (await signIn(h, "seller@mulya.test")).token;
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/ingestion/search",
      headers: bearer(token),
      payload: { query: "a query with no provider configured" },
    });

    /**
     * The harness runs with MARKET_DATA_PROVIDER=fixture, so this exercises
     * the "no recording" path — which is deliberately an `unavailable`
     * ProviderError rather than zero offers, for exactly the reason the 503
     * exists: a caller must be able to tell "we could not look" from
     * "nobody sells this".
     */
    assert.equal(res.statusCode, 503);
    const body = res.json();
    assert.equal(body.error, "market_data_unavailable");
    assert.equal(typeof body.retryable, "boolean");
    assert.ok(!("offers" in body), "a failure must not be dressed up as a result");
  });
});
