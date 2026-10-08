import "./helpers/env.js";

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { clusterCatalogIds } from "../src/ingestion/cluster.js";
import {
  distribution,
  positionOf,
  segmentByCondition,
  structure,
  trend,
} from "../src/modules/market/competition.js";
import { normaliseProductMarket, parsePriceRange, parseShipping } from "../src/ingestion/providers/serpapi.market.js";
import { deterministicPrice } from "../src/modules/pricing/deterministic.js";
import { plausibleMrp } from "../src/ingestion/providers/serpapi.provider.js";
import { ProviderError } from "../src/ingestion/types.js";

/**
 * THE COMPETITIVE MARKET
 * ======================
 *
 * The three pieces the price recommendation now rests on, tested where they
 * can be tested exactly: the adapter that reads one catalogue id's sellers,
 * the clustering that decides which catalogue ids are the same product, and
 * the analysis that turns a set of sellers into a position.
 *
 * All three are pure given their input, so these are arithmetic and string
 * tests rather than integration tests. The integration path — search,
 * cluster, open, persist, recommend — is covered in `discovery.test.ts`
 * against a counting stub.
 */

/* ========================================================== the adapter */

describe("one catalogue id's sellers", () => {
  /** The real response shape, trimmed. Field names are the provider's. */
  const response = {
    product_results: {
      title: "Sony WH-1000XM5 Wireless Headphones",
      brand: "Sony",
      thumbnails: ["https://img.test/a.jpg", "https://img.test/b.jpg"],
      price_range: "₹24,550-₹31,990",
      product_attributes: [
        { name: "colour", value: "Black" },
        { name: "connectivity", value: "Bluetooth" },
        { name: "broken", value: "" },
      ],
      more_options: [{ title: "Sony WH-1000XM5 Silver" }, { title: "" }],
      price_insights: { price_history: true, price_tracking_available: true },
      stores_next_page_token: "a-token-that-yields-nothing",
      stores: [
        {
          name: "Amazon.in",
          merchant_id: "141020976",
          link: "https://amazon.test/p",
          title: "Sony WH-1000XM5 Black",
          price: "₹28,765",
          extracted_price: 28_765,
          extracted_total: 28_765,
          shipping: "Free",
          rating: 4.4,
          reviews: 12_033,
          details_and_offers: ["In stock online", "Free delivery by Fri"],
        },
        {
          name: "Excess2Sell",
          merchant_id: "5348309716",
          link: "https://e2s.test/p",
          price: "₹24,550",
          extracted_price: 24_550,
          shipping: "₹240",
          details_and_offers: ["Refurbished", "Out of stock"],
        },
        {
          // No merchant id, no shipping statement: both legitimately absent.
          name: "Variety Infotech",
          price: "₹26,990",
          extracted_price: 26_990,
          shipping: "Delivery by Tue",
        },
      ],
    },
  };

  const market = normaliseProductMarket(response, "pid_1", "https://provider.test/p", "INR");

  test("every seller is kept, with the merchant id that gives it identity", () => {
    assert.equal(market.sellers.length, 3);
    assert.deepEqual(
      market.sellers.map((s) => s.sellerExternalId),
      ["141020976", "5348309716", null],
      "a missing merchant id travels as null rather than being invented"
    );
  });

  test("prices are integer minor units", () => {
    assert.equal(market.sellers[0]!.priceMinor, 2_876_500);
    assert.equal(market.sellers[1]!.priceMinor, 2_455_000);
  });

  test("shipping is zero only when the provider said free", () => {
    assert.equal(parseShipping("Free").minor, 0, "stated free is a stated zero");
    assert.equal(parseShipping("₹240").minor, 24_000);
    assert.equal(
      parseShipping("Delivery by Tue").minor,
      null,
      "a delivery promise is not a cost, and guessing zero would understate every landed price"
    );
    assert.equal(parseShipping(undefined).minor, null);
  });

  test("the landed price never mixes a real figure with a guessed one", () => {
    // Stated total.
    assert.equal(market.sellers[0]!.totalMinor, 2_876_500);
    // No total, but shipping WAS stated: price plus shipping is honest.
    assert.equal(market.sellers[1]!.totalMinor, 2_455_000 + 24_000);
    // Shipping unstated: falls back to the price rather than inventing a total.
    assert.equal(market.sellers[2]!.totalMinor, 2_699_000);
  });

  test("stock and condition come only from what the seller stated", () => {
    assert.equal(market.sellers[0]!.inStock, true);
    assert.equal(market.sellers[0]!.condition, null, "nothing said, so nothing claimed");
    assert.equal(market.sellers[1]!.inStock, false);
    assert.equal(market.sellers[1]!.condition, "refurbished");
    assert.equal(market.sellers[2]!.inStock, null, "silence is not 'in stock'");
  });

  /**
   * THE FINDING THAT CHANGED THE ARCHITECTURE.
   *
   * An earlier design read `price_insights` as a year of per-seller history
   * and was going to show a price chart on the day a product was first seen.
   * The field is two booleans. There is no series, so there is nothing to
   * import, and every historical price in this system has to be one it
   * observed itself.
   */
  test("the provider supplies no price history, and none is manufactured", () => {
    assert.equal(
      (market as Record<string, unknown>).priceHistory,
      undefined,
      "there is no history field, because there is no history to put in it"
    );
    assert.equal(market.priceTrackingAvailable, true, "only the capability flag, which is all it reports");
  });

  /** The token is returned and yields nothing, so the claim is not made. */
  test("no 'more sellers available' claim is made from an unusable token", () => {
    assert.equal((market as Record<string, unknown>).moreSellersAvailable, undefined);
  });

  test("the stated range is parsed, as evidence about coverage", () => {
    assert.equal(market.priceRangeLowMinor, 2_455_000);
    assert.equal(market.priceRangeHighMinor, 3_199_000);
    assert.deepEqual(parsePriceRange(undefined), { lowMinor: null, highMinor: null });
    assert.deepEqual(parsePriceRange("not a range"), { lowMinor: null, highMinor: null });
  });

  test("empty attributes and titles are dropped, not stored blank", () => {
    assert.equal(market.attributes.length, 2);
    assert.deepEqual(market.relatedTitles, ["Sony WH-1000XM5 Silver"]);
  });

  test("a response with no product_results is an error, not an empty market", () => {
    assert.throws(
      () => normaliseProductMarket({}, "pid_x", "u", "INR"),
      (e: unknown) => e instanceof ProviderError && e.kind === "malformed"
    );
    assert.throws(
      () => normaliseProductMarket({ error: "no results" }, "pid_x", "u", "INR"),
      (e: unknown) => e instanceof ProviderError
    );
  });

  test("a product with no stores is an empty seller list, not a failure", () => {
    const empty = normaliseProductMarket({ product_results: { title: "x" } }, "pid_y", "u", "INR");
    assert.deepEqual(empty.sellers, []);
    assert.equal(empty.title, "x");
  });
});

/* ======================================================== the clustering */

describe("one product, many catalogue ids", () => {
  /** The live shape: the same headphones under four ids, plus noise. */
  const candidates = [
    { title: "Sony WH-1000XM5 Wireless Noise Cancelling Headphones", priceMinor: 2_876_500, source: "Amazon.in", externalProductId: "id_a" },
    { title: "Sony WH-1000XM5 Headphones Black", priceMinor: 2_699_000, source: "Flipkart", externalProductId: "id_b" },
    { title: "Sony WH-1000XM5 Bluetooth Wireless Headphone", priceMinor: 2_455_000, source: "JioMart", externalProductId: "id_c" },
    { title: "Sony WH-1000XM4 Wireless Headphones", priceMinor: 1_999_000, source: "Croma", externalProductId: "id_old" },
    { title: "Carry Case for Sony WH-1000XM5", priceMinor: 99_900, source: "Amazon.in", externalProductId: "id_case" },
    { title: "Replacement Ear Pads for Sony WH-1000XM5", priceMinor: 49_900, source: "Flipkart", externalProductId: "id_pads" },
  ];

  test("siblings of the chosen product are clustered with it", () => {
    const cluster = clusterCatalogIds("sony wh-1000xm5", candidates, { anchorExternalProductId: "id_a", limit: 4 });
    assert.ok(cluster);
    assert.equal(cluster.anchor.externalProductId, "id_a");

    const ids = cluster.members.map((m) => m.externalProductId);
    assert.ok(ids.includes("id_b"), "a differently-worded listing of the same product joins");
    assert.ok(ids.includes("id_c"), "and so does a third");
    assert.equal(cluster.members.length, 3, "three ids to open, where one was opened before");
  });

  /** The error that would be worse than the one being fixed. */
  test("a different model is never clustered in", () => {
    const cluster = clusterCatalogIds("sony wh-1000xm5", candidates, { anchorExternalProductId: "id_a", limit: 6 })!;
    assert.ok(
      !cluster.members.some((m) => m.externalProductId === "id_old"),
      "wh-1000xm4 is a different product however much else the title shares"
    );
    assert.ok(cluster.rejected.some((r) => r.externalProductId === "id_old"), "and the refusal is recorded");
  });

  test("accessories are never clustered in", () => {
    const cluster = clusterCatalogIds("sony wh-1000xm5", candidates, { anchorExternalProductId: "id_a", limit: 6 })!;
    const ids = cluster.members.map((m) => m.externalProductId);
    assert.ok(!ids.includes("id_case"));
    assert.ok(!ids.includes("id_pads"));
  });

  test("a contradicted specification is a different product", () => {
    const withCapacities = [
      { title: "Galaxy S24 Ultra 256GB", priceMinor: 11_999_900, source: "Amazon.in", externalProductId: "s24_256" },
      { title: "Galaxy S24 Ultra 512GB", priceMinor: 13_499_900, source: "Flipkart", externalProductId: "s24_512" },
      { title: "Galaxy S24 Ultra", priceMinor: 12_100_000, source: "Croma", externalProductId: "s24_plain" },
    ];
    const cluster = clusterCatalogIds("galaxy s24 ultra 256gb", withCapacities, {
      anchorExternalProductId: "s24_256",
      limit: 5,
    })!;
    const ids = cluster.members.map((m) => m.externalProductId);

    assert.ok(!ids.includes("s24_512"), "512GB contradicts 256GB, so it is a different product");
    assert.ok(
      ids.includes("s24_plain"),
      "a title that states no capacity does not contradict one — store titles abbreviate constantly"
    );
  });

  /**
   * EACH GUARD, ON ITS OWN.
   *
   * The two exclusions overlap on ordinary data — a carry case is both
   * classified an accessory AND priced a tenth of the product — so a test
   * using one proves nothing about the other. Mutation testing showed it:
   * either guard could be deleted and every clustering test still passed,
   * because the survivor caught the same rows.
   *
   * These two cases are built so that exactly one guard can reject them.
   */
  test("the price-class guard alone excludes a row the titles accept", () => {
    /**
     * A listing whose title the relevance layer is happy with — same model
     * code, no accessory wording — priced a tenth of the product. A data
     * error, a per-unit price on a bulk listing, or a bait listing; whatever
     * it is, it is not this product's market.
     */
    const withMispriced = [
      { title: "Sony WH-1000XM5 Black", priceMinor: 2_699_000, source: "Flipkart", externalProductId: "real" },
      { title: "Sony WH-1000XM5 Silver", priceMinor: 2_750_000, source: "Amazon.in", externalProductId: "real2" },
      { title: "Sony WH-1000XM5 Blue", priceMinor: 210_000, source: "DealsRUs", externalProductId: "mispriced" },
    ];
    const cluster = clusterCatalogIds("sony wh-1000xm5", withMispriced, {
      anchorExternalProductId: "real",
      limit: 5,
    })!;

    assert.ok(
      !cluster.members.some((m) => m.externalProductId === "mispriced"),
      "a tenth of the product's price is a different class of object, whatever the title says"
    );
    assert.ok(
      cluster.rejected.some((r) => r.externalProductId === "mispriced" && /x from the anchor/.test(r.reason)),
      "and the reason names the price, not the title"
    );
    assert.ok(cluster.members.some((m) => m.externalProductId === "real2"), "the genuine sibling is unaffected");
  });

  test("the near-parity rule alone excludes an accessory the price guard accepts", () => {
    /**
     * A premium case at 40% of the product's price. Inside the 3x price
     * band, so the price guard lets it through; it is the near-parity
     * requirement on an accessory-classified row that keeps it out.
     */
    const withPremiumCase = [
      { title: "Sony WH-1000XM5 Black", priceMinor: 2_699_000, source: "Flipkart", externalProductId: "real" },
      { title: "Sony WH-1000XM5 Silver", priceMinor: 2_750_000, source: "Amazon.in", externalProductId: "real2" },
      {
        title: "Premium Leather Carry Case Pouch Cover for Sony WH-1000XM5",
        priceMinor: 1_080_000,
        source: "Amazon.in",
        externalProductId: "premium_case",
      },
    ];
    const cluster = clusterCatalogIds("sony wh-1000xm5", withPremiumCase, {
      anchorExternalProductId: "real",
      limit: 5,
    })!;

    const rejection = cluster.rejected.find((r) => r.externalProductId === "premium_case");
    assert.ok(rejection, "an expensive accessory is still an accessory");
    assert.match(rejection.reason, /accessory/, "and it is the title signal that rejected it");
  });

  test("the spend is bounded by the limit", () => {
    const two = clusterCatalogIds("sony wh-1000xm5", candidates, { anchorExternalProductId: "id_a", limit: 2 })!;
    assert.equal(two.members.length, 2, "one call per member, so the limit is the budget");
    assert.equal(two.members[0]!.externalProductId, "id_a", "the anchor is always opened");

    const one = clusterCatalogIds("sony wh-1000xm5", candidates, { anchorExternalProductId: "id_a", limit: 1 })!;
    assert.deepEqual(one.members.map((m) => m.externalProductId), ["id_a"]);
  });

  test("the anchor leads even when a sibling scores higher", () => {
    const cluster = clusterCatalogIds("sony wh-1000xm5", candidates, { anchorExternalProductId: "id_c", limit: 4 })!;
    assert.equal(cluster.members[0]!.externalProductId, "id_c");
    assert.equal(cluster.anchor.confidence, 1);
  });

  test("with no anchor given, the best-matching candidate becomes one", () => {
    const cluster = clusterCatalogIds("sony wh-1000xm5", candidates, { limit: 3 })!;
    assert.equal(cluster.anchor.externalProductId, "id_b", "the tidiest full match, not an accessory and not the XM4");
    assert.equal(cluster.anchor.reason, "highest-scoring result for the query");
  });

  /**
   * A DESCRIPTIVE LISTING OF THE REAL PRODUCT IS STILL THE REAL PRODUCT.
   *
   * The relevance layer is deliberately strict about titles that spend more
   * words on something other than the query, because a spare part does
   * exactly that and was once offered as the product itself. The cost is
   * that a retailer's own wording — "Sony WH-1000XM5 Wireless Noise
   * Cancelling Headphones" against a two-word query — reads the same way.
   *
   * Clustering overrides it, but only on evidence relevance does not have:
   * every one of the anchor's model codes present, and near-parity pricing.
   */
  test("a wordy listing at the product's price is admitted, at lower confidence", () => {
    const wordy = [
      { title: "Sony WH-1000XM5 Black", priceMinor: 2_699_000, source: "Flipkart", externalProductId: "tidy" },
      {
        title: "Sony WH-1000XM5 Wireless Bluetooth Noise Cancelling Over Ear Headphones",
        priceMinor: 2_750_000,
        source: "Amazon.in",
        externalProductId: "wordy",
      },
      { title: "Carry Case for Sony WH-1000XM5 Hard Shell", priceMinor: 99_900, source: "Amazon.in", externalProductId: "case" },
    ];
    const cluster = clusterCatalogIds("sony wh-1000xm5", wordy, { anchorExternalProductId: "tidy", limit: 4 })!;
    const member = cluster.members.find((m) => m.externalProductId === "wordy");

    assert.ok(member, "the same headphones at the same price must not be dropped for being described");
    assert.ok(member.confidence <= 0.6, "but admitted against the title signal, so held at lower confidence");
    assert.ok(
      !cluster.members.some((m) => m.externalProductId === "case"),
      "while the accessory, which is not near parity, stays out"
    );
  });

  /**
   * THE LIVE FAILURE THAT PRODUCED THIS RULE.
   *
   * A search for "sony wh-1000xm5" returned 38 rows and not one of them was
   * the headphones: 32 skins at Rs 2,322 from a single vendor, two carrying
   * cases, a replacement headband and a WH-1000XM6. Anchoring on the highest
   * scorer spent four provider calls building a product that was a sticker,
   * with a one-seller "market" behind it.
   *
   * The skins score `plausible` — they contain every query word and sit in
   * their own price cohort, which is all a title can tell us. A capture with
   * no human choice behind it must decline rather than take the best of a
   * bad set.
   */
  test("an automatic capture refuses when nothing is confidently the product", () => {
    const noProduct = [
      { title: "Sony WH-1000XM5 Custom Skin", priceMinor: 232_200, source: "Slickwraps", externalProductId: "skin_1" },
      { title: "Sony WH-1000XM5 Stone Series Skins", priceMinor: 232_200, source: "Slickwraps", externalProductId: "skin_2" },
      { title: "Sony WH-1000XM5 Marble Series Skins", priceMinor: 232_200, source: "Slickwraps", externalProductId: "skin_3" },
      { title: "WH1000XM6/S Best Wireless Noise Canceling Headphones", priceMinor: 8_131_300, source: "Sony", externalProductId: "xm6" },
      { title: "kwmobile Headphone Case for Over-Ear Headphones", priceMinor: 325_200, source: "Amazon.in", externalProductId: "case" },
    ];

    assert.equal(
      clusterCatalogIds("sony wh-1000xm5", noProduct),
      null,
      "no anchor, so no provider call is spent and the caller reports that it could not identify the product"
    );
  });

  /** A human click is a judgement, and this function follows it. */
  test("a user's own choice is honoured even when it scores only plausible", () => {
    const noProduct = [
      { title: "Sony WH-1000XM5 Custom Skin", priceMinor: 232_200, source: "Slickwraps", externalProductId: "skin_1" },
      { title: "Sony WH-1000XM5 Stone Series Skins", priceMinor: 232_200, source: "Slickwraps", externalProductId: "skin_2" },
    ];
    const cluster = clusterCatalogIds("sony wh-1000xm5", noProduct, { anchorExternalProductId: "skin_1" })!;
    assert.ok(cluster, "the user decided; this is not the place to overrule them");
    assert.equal(cluster.anchor.externalProductId, "skin_1");
    assert.equal(cluster.anchor.reason, "chosen by the user");
  });

  test("rows with no catalogue id or no price cannot be clustered", () => {
    assert.equal(
      clusterCatalogIds("anything", [{ title: "x", priceMinor: 100, source: null, externalProductId: null }]),
      null
    );
    assert.equal(
      clusterCatalogIds("anything", [{ title: "x", priceMinor: null, source: null, externalProductId: "id" }]),
      null
    );
    assert.equal(clusterCatalogIds("anything", []), null);
  });

  test("every member carries a reason, so a thin cluster is explainable", () => {
    const cluster = clusterCatalogIds("sony wh-1000xm5", candidates, { anchorExternalProductId: "id_a", limit: 4 })!;
    for (const member of cluster.members) {
      assert.ok(member.reason.length > 0, `${member.externalProductId} has no stated reason`);
      assert.ok(member.confidence > 0 && member.confidence <= 1);
    }
    for (const rejection of cluster.rejected) {
      assert.ok(rejection.reason.length > 0);
    }
  });
});

/* ========================================================== the analysis */

describe("competition analysis", () => {
  const seller = (
    name: string,
    priceMinor: number,
    marketplace = name,
    inStock = true
  ) => ({
    sellerId: `slr_${name}`,
    sellerName: name,
    marketplaceId: `mp_${marketplace}`,
    marketplaceName: marketplace,
    priceMinor,
    landedMinor: priceMinor,
    shippingMinor: 0,
    inStock,
    rating: null,
    reviewCount: null,
    url: null,
    condition: "new" as const,
  });

  const market = [
    seller("Excess2Sell", 2_455_000),
    seller("Tata CLiQ", 2_649_000),
    seller("Computech", 2_699_900),
    seller("Variety", 2_699_000),
    seller("Myntra", 2_719_900),
    seller("Amazon.in", 2_876_500),
    seller("myG", 3_199_000),
  ];

  test("the distribution is computed over sellers, not over search rows", () => {
    const d = distribution(market)!;
    assert.equal(d.sellerCount, 7);
    assert.equal(d.marketplaceCount, 7);
    assert.equal(d.inStockCount, 7);
    assert.equal(d.lowMinor, 2_455_000);
    assert.equal(d.highMinor, 3_199_000);
    assert.equal(d.medianMinor, 2_699_900, "the middle seller, not the middle of the range");
  });

  /**
   * Quantiles interpolate between order statistics, so they land on
   * fractions. A fraction of a paisa is not a price and cannot be stored in
   * an integer column — the first version of this code wrote `default` into
   * three not-null columns and failed at the insert rather than at the
   * arithmetic.
   *
   * The prices below are chosen so the interpolation is genuinely fractional:
   * with four values one apart, p25 falls three-quarters of the way between
   * the first two.
   */
  test("every quantile is an integer number of minor units", () => {
    const awkward = [seller("A", 100), seller("B", 101), seller("C", 102), seller("D", 103)];
    const d = distribution(awkward)!;

    for (const [name, value] of Object.entries({
      low: d.lowMinor,
      p25: d.p25Minor,
      median: d.medianMinor,
      p75: d.p75Minor,
      high: d.highMinor,
      mean: d.meanMinor,
    })) {
      assert.equal(Number.isInteger(value), true, `${name} = ${value} is not a whole number of paise`);
    }

    // 100.75 un-rounded; the point of the test is that it is not 100.75.
    assert.equal(d.p25Minor, 101);
    assert.ok(d.lowMinor <= d.p25Minor && d.p25Minor <= d.medianMinor);
    assert.ok(d.medianMinor <= d.p75Minor && d.p75Minor <= d.highMinor);
  });

  test("an empty market has no distribution rather than a zeroed one", () => {
    assert.equal(distribution([]), null);
    assert.equal(structure([]), null);
    assert.equal(positionOf(100, []), null);
  });

  test("marketplace count counts marketplaces, not sellers", () => {
    const twoStores = [
      seller("Shop A", 1000, "Amazon.in"),
      seller("Shop B", 1100, "Amazon.in"),
      seller("Shop C", 1200, "Flipkart"),
    ];
    const d = distribution(twoStores)!;
    assert.equal(d.sellerCount, 3);
    assert.equal(d.marketplaceCount, 2, "three sellers on two marketplaces is a narrower market than it looks");
  });

  /* ------------------------------------------------------------ structure */

  test("a lone cheap seller is distinguished from a crowded floor", () => {
    const outlier = structure([
      seller("Grey Import", 2_000_000),
      seller("Amazon.in", 2_700_000),
      seller("Flipkart", 2_710_000),
      seller("Croma", 2_720_000),
    ])!;
    assert.equal(outlier.floorMinor, 2_000_000);
    assert.equal(outlier.secondFloorMinor, 2_700_000);
    assert.equal(outlier.floorGapMinor, 700_000, "a wide gap: the floor is one seller, not the market");
    assert.equal(outlier.atFloorCount, 1);

    const crowded = structure([
      seller("Amazon.in", 2_700_000),
      seller("Flipkart", 2_700_000),
      seller("Croma", 2_710_000),
      seller("myG", 3_100_000),
    ])!;
    assert.equal(crowded.atFloorCount, 3, "three sellers within 2% of the floor: contested");
    assert.ok(crowded.floorGapMinor! < 100_000);
  });

  test("out-of-stock sellers are set aside while any seller is in stock", () => {
    const s = structure([
      seller("Cheap but gone", 1_000_000, "Amazon.in", false),
      seller("Available", 2_700_000, "Flipkart", true),
      seller("Also available", 2_800_000, "Croma", true),
    ])!;
    assert.equal(s.floorMinor, 2_700_000, "a price nobody can buy at is not the market floor");
    assert.equal(s.cheapest.sellerName, "Available");
  });

  test("when nothing is in stock the market is still described", () => {
    const s = structure([
      seller("Gone", 1_000_000, "Amazon.in", false),
      seller("Also gone", 1_200_000, "Flipkart", false),
    ])!;
    assert.equal(s.floorMinor, 1_000_000, "reporting nothing would be less useful than reporting the last prices");
  });

  test("clustering says whether price is a lever at all", () => {
    const tight = structure([
      seller("A", 1_000_000),
      seller("B", 1_010_000),
      seller("C", 1_005_000),
      seller("D", 995_000),
    ])!;
    assert.equal(tight.clustering, 1, "everyone within 5% of the median: price is not the differentiator");

    const spread = structure([
      seller("A", 1_000_000),
      seller("B", 2_000_000),
      seller("C", 3_000_000),
      seller("D", 4_000_000),
    ])!;
    assert.ok(spread.clustering < 0.5, "a wide market leaves room to position");
  });

  /* ------------------------------------------------------------- position */

  test("a price is placed among the sellers it would compete with", () => {
    // Sorted: 24,550 / 26,490 / 26,990 / 26,999 / 27,199 / 28,765 / 31,990
    const p = positionOf(2_700_000, market)!;
    assert.equal(p.rank, 5, "four sellers are cheaper");
    assert.equal(p.of, 8, "seven of them plus me");
    assert.equal(p.undercuts, 3, "and three are dearer");
    assert.equal(p.premiumOverLowPct, 10, "10% above the cheapest");
    assert.equal(p.vsMedianPct, 0, "100 paise above a median of 26,999 rounds to no difference at all");
  });

  test("the cheapest possible price ranks first and undercuts everyone", () => {
    const p = positionOf(1, market)!;
    assert.equal(p.rank, 1);
    assert.equal(p.undercuts, 7);
    assert.equal(p.percentile, 0);
  });

  test("a price above everyone undercuts nobody", () => {
    const p = positionOf(9_999_999, market)!;
    assert.equal(p.rank, 8);
    assert.equal(p.undercuts, 0);
    assert.equal(p.percentile, 100);
  });

  /* ------------------------------------------------------------ condition */

  /**
   * FOUND AGAINST LIVE DATA, and the kind of error that is worse for being
   * plausible.
   *
   * A capture for "apple iphone 16 pro 256gb" returned six sellers: a
   * RENEWED unit at Rs 89,999, a USED one at Rs 1,08,399, and four selling
   * new stock between Rs 1,14,999 and Rs 1,47,227. Pooled into one
   * distribution, the market's floor became the refurbished price and its
   * spread 50%, and the analysis then reasoned about "the cheapest seller"
   * as though somebody listing a new phone could match it.
   *
   * They are not competitors. Condition partitions the market before any
   * statistic is taken from it.
   */
  test("a new listing is not priced against refurbished stock", () => {
    const mixed = [
      { ...seller("GudFast", 8_999_900), condition: "renewed" as const },
      { ...seller("EMI Snapmint", 10_839_900), condition: "used" as const },
      seller("93mobiles", 11_499_900),
      seller("GOT IT", 11_499_900),
      seller("Nuevo Gadgets", 14_490_000),
      seller("desertcart", 14_722_700),
    ];

    const segmented = segmentByCondition(mixed)!;
    assert.equal(segmented.primaryCondition, "new");
    assert.equal(segmented.primary.length, 4, "only the new-stock sellers are the market");

    const d = distribution(segmented.primary)!;
    assert.equal(d.lowMinor, 11_499_900, "the floor is the cheapest NEW price, not the refurbished one");
    assert.ok(d.spreadPct < 30, `spread ${d.spreadPct}% — pooling conditions inflated it to about 50%`);

    /** And nothing is thrown away: the other markets are reported. */
    assert.deepEqual(
      segmented.secondary.map((g) => [g.condition, g.offers.length]),
      [["renewed", 1], ["used", 1]]
    );
  });

  test("a product sold only refurbished still has a market", () => {
    const refurbOnly = [
      { ...seller("A", 8_999_900), condition: "renewed" as const },
      { ...seller("B", 9_200_000), condition: "renewed" as const },
    ];
    const segmented = segmentByCondition(refurbOnly)!;
    assert.equal(segmented.primaryCondition, "renewed", "refusing would be less useful than saying which market it is");
    assert.equal(segmented.primary.length, 2);
    assert.deepEqual(segmented.secondary, []);
  });

  test("an empty market has no segmentation rather than an empty one", () => {
    assert.equal(segmentByCondition([]), null);
  });

  /* ---------------------------------------------------------------- trend */

  test("one capture is never a trend", () => {
    assert.equal(trend([{ capturedOn: "2026-10-01", medianMinor: 2_700_000, sellerCount: 7 }]), null);
    assert.equal(trend([]), null);
  });

  test("a trend reports the span its own captures actually cover", () => {
    const t = trend([
      { capturedOn: "2026-10-01", medianMinor: 2_700_000, sellerCount: 7 },
      { capturedOn: "2026-10-04", medianMinor: 2_600_000, sellerCount: 7 },
      { capturedOn: "2026-10-08", medianMinor: 2_500_000, sellerCount: 8 },
    ])!;
    assert.equal(t.points, 3, "three captures, not eight days");
    assert.equal(t.spanDays, 7);
    assert.equal(t.direction, "falling");
    assert.ok(t.changePct < -7 && t.changePct > -8);
    assert.equal(t.comparable, true);
  });

  /**
   * The failure mode the per-product aggregate exists to make visible: a
   * median that moved because the population changed, not because anyone
   * changed a price.
   */
  test("a move computed over a changed seller population is flagged", () => {
    const t = trend([
      { capturedOn: "2026-10-01", medianMinor: 2_700_000, sellerCount: 12 },
      { capturedOn: "2026-10-05", medianMinor: 3_300_000, sellerCount: 3 },
    ])!;
    assert.equal(t.direction, "rising");
    assert.equal(t.minSellerCount, 3);
    assert.equal(t.maxSellerCount, 12);
    assert.equal(t.comparable, false, "nine of twelve sellers vanished; this is not a price movement");
  });

  test("a trivial move is flat rather than a direction", () => {
    const t = trend([
      { capturedOn: "2026-10-01", medianMinor: 2_700_000, sellerCount: 7 },
      { capturedOn: "2026-10-02", medianMinor: 2_705_000, sellerCount: 7 },
    ])!;
    assert.equal(t.direction, "flat", "0.2% is the median shuffling between adjacent sellers");
  });

  test("points given out of order are ordered before being read", () => {
    const t = trend([
      { capturedOn: "2026-10-08", medianMinor: 2_500_000, sellerCount: 7 },
      { capturedOn: "2026-10-01", medianMinor: 2_700_000, sellerCount: 7 },
    ])!;
    assert.equal(t.direction, "falling", "first to last by DATE, not by array position");
    assert.equal(t.spanDays, 7);
  });
});

/* ============================================= the deterministic engine */

describe("the deterministic price", () => {
  const dist = (over: Partial<ReturnType<typeof baseline>> = {}) => ({ ...baseline(), ...over });

  function baseline() {
    return {
      sellerCount: 6,
      marketplaceCount: 6,
      inStockCount: 6,
      lowMinor: 2_455_000,
      p25Minor: 2_600_000,
      medianMinor: 2_700_000,
      p75Minor: 2_880_000,
      highMinor: 3_199_000,
      meanMinor: 2_750_000,
      spreadPct: 27.6,
    };
  }

  const loneFloor = {
    floorMinor: 2_455_000,
    secondFloorMinor: 2_700_000,
    floorGapMinor: 245_000,
    atFloorCount: 1,
    clustering: 0.4,
  };

  const crowdedFloor = {
    floorMinor: 2_455_000,
    secondFloorMinor: 2_460_000,
    floorGapMinor: 5_000,
    atFloorCount: 5,
    clustering: 0.8,
  };

  test("it positions just under the median when nothing special is happening", () => {
    const v = deterministicPrice(dist(), loneFloor, null);
    assert.equal(v.recommendedMinor, Math.round(2_700_000 * 0.98));
    assert.ok(v.factors.some((f) => /2% under the median/.test(f)));
  });

  /** A price there will be matched, so the engine declines to go there. */
  test("a contested floor lifts the target above the pack", () => {
    const tight = dist({ medianMinor: 2_470_000, p25Minor: 2_600_000 });
    const v = deterministicPrice(tight, crowdedFloor, null);

    assert.ok(v.recommendedMinor >= tight.p25Minor, "it sits above the contested floor");
    assert.ok(v.factors.some((f) => /that floor is contested/.test(f)));
    assert.equal(v.atFloor, false);
  });

  test("a lone cheap seller is named as an outlier rather than chased", () => {
    const v = deterministicPrice(dist(), loneFloor, null);
    assert.ok(
      v.factors.some((f) => /treated as an outlier/.test(f)),
      "the gap is 10% of the floor, so the second cheapest is the effective one"
    );
    assert.ok(v.recommendedMinor > loneFloor.floorMinor, "and the target is not dragged down to it");
  });

  test("real history is blended in, and says so", () => {
    const v = deterministicPrice(dist(), loneFloor, { observationCount: 9, medianMinor: 2_500_000 });
    const noHistory = deterministicPrice(dist(), loneFloor, null);

    assert.ok(v.recommendedMinor < noHistory.recommendedMinor, "a lower observed median pulls the target down");
    assert.ok(v.factors.some((f) => /Blended with an observed median/.test(f)));
  });

  test("too little history is ignored rather than weighted", () => {
    const thin = deterministicPrice(dist(), loneFloor, { observationCount: 2, medianMinor: 1_000_000 });
    const none = deterministicPrice(dist(), loneFloor, null);
    assert.equal(thin.recommendedMinor, none.recommendedMinor, "two captures describe the sampling, not the product");
  });

  /**
   * THE GUARANTEE THAT SURVIVED A MUTATION.
   *
   * Deleting this guard left every test green, because reaching it needs an
   * observed history well below the current market — a product whose price
   * has risen since it was first captured. Without it the system advises a
   * seller to undercut a price that nobody is currently charging, which no
   * evidence supports.
   */
  test("it never recommends below the cheapest real offer", () => {
    const v = deterministicPrice(dist(), loneFloor, { observationCount: 20, medianMinor: 500_000 });

    assert.ok(
      v.recommendedMinor >= dist().lowMinor,
      `recommended ${v.recommendedMinor}, below the market floor of ${dist().lowMinor}`
    );
    assert.equal(v.recommendedMinor, dist().lowMinor);
    assert.ok(v.factors.some((f) => /below the market floor would not be defensible/.test(f)));
  });

  test("the range always contains the recommendation", () => {
    for (const history of [null, { observationCount: 20, medianMinor: 500_000 }, { observationCount: 9, medianMinor: 9_000_000 }]) {
      for (const struct of [loneFloor, crowdedFloor]) {
        const v = deterministicPrice(dist(), struct, history);
        assert.ok(
          v.rangeMinMinor <= v.recommendedMinor && v.recommendedMinor <= v.rangeMaxMinor,
          `${v.rangeMinMinor} .. ${v.recommendedMinor} .. ${v.rangeMaxMinor}`
        );
      }
    }
  });

  /** Breadth of evidence, not tidiness of the answer. */
  test("confidence follows how much of the market was seen", () => {
    assert.equal(deterministicPrice(dist({ marketplaceCount: 2, sellerCount: 2 }), loneFloor, null).confidence, "low");
    assert.equal(deterministicPrice(dist({ marketplaceCount: 3, sellerCount: 3 }), loneFloor, null).confidence, "medium");
    assert.equal(
      deterministicPrice(dist({ marketplaceCount: 6, sellerCount: 6 }), loneFloor, null).confidence,
      "medium",
      "a wide market with no history is still only medium — one capture is one capture"
    );
    assert.equal(
      deterministicPrice(dist({ marketplaceCount: 6, sellerCount: 6 }), loneFloor, { observationCount: 9, medianMinor: 2_700_000 })
        .confidence,
      "high"
    );
  });

  test("every adjustment states its reason", () => {
    const v = deterministicPrice(dist(), crowdedFloor, { observationCount: 9, medianMinor: 2_500_000 });
    assert.ok(v.factors.length >= 3);
    for (const f of v.factors) assert.ok(f.length > 20, `"${f}" is not an explanation`);
  });
});

/* ======================================== a printed maximum below the price */

describe("an MRP beneath the selling price is a misparse", () => {
  /**
   * FOUND IN PRODUCTION, by the verification script rather than by anything
   * in the request path.
   *
   * Two captured rows: a curtain selling at ₹1,160 with an "MRP" of ₹20, and
   * another at ₹724 with ₹50. Every individual number is plausible, which is
   * why the parser accepted them — only the RELATIONSHIP between them is
   * impossible. A printed maximum is a legal ceiling in India; nothing can be
   * sold above it, so a figure beneath the selling price is not one.
   *
   * Left alone, it feeds a 5,700% discount into anything that renders one.
   */
  test("a maximum below the price is dropped, not clamped", () => {
    assert.equal(plausibleMrp(2_000, 116_000), null, "₹20 against ₹1,160 is not a ceiling");
    assert.equal(plausibleMrp(5_000, 72_400), null);
  });

  test("a real maximum survives untouched", () => {
    assert.equal(plausibleMrp(150_000, 116_000), 150_000);
    assert.equal(plausibleMrp(116_000, 116_000), 116_000, "equal is legal — sold at the printed price");
  });

  test("absent stays absent, and is never inferred from the price", () => {
    assert.equal(plausibleMrp(null, 116_000), null);
    assert.equal(plausibleMrp(0, 116_000), null, "zero is not a ceiling either");
    assert.equal(plausibleMrp(-100, 116_000), null);
  });

  test("with no price to compare against, the figure is taken as given", () => {
    assert.equal(plausibleMrp(150_000, null), 150_000, "nothing contradicts it, so nothing rejects it");
  });
});
