import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The marketplace, listing and workspace services.
 *
 * Stage 3 moved these three off the bundled dataset. What is pinned here is
 * what a screenshot cannot show: which endpoints are called and in what order,
 * that a listing address resolves its own product, and that absent commercial
 * data stays absent rather than becoming zero.
 */

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../src/api/http", () => ({ apiRequest: mocks.apiRequest }));

const { getMarketplaceComparison, presentMarketplaceComparison, getListingDetail, presentListingDetail } =
  await import("../src/api/listingsService");
const { getWorkspaceContext } = await import("../src/api/workspaceService");
const { getMarketplaceDirectory, resetMarketplaceDirectory } = await import("../src/api/marketplacesService");

/** A curated platform and a discovered one, side by side. */
const marketplacesBody = {
  data: [
    {
      marketplace: { id: "mp_amazon_in", name: "Amazon.in", brandColor: "#ff9900" },
      listing: { id: "lst_az", matchStatus: "human_confirmed", matchConfidence: 0.99 },
      coverage: { listingCount: 1, sellerCount: 2, offerCount: 2 },
      availability: { status: "in_stock" },
      currentPrice: {
        effectiveMinor: 7446000,
        landedMinor: 7446000,
        sellingPriceMinor: 7446000,
        mrpMinor: 7990000,
        shipping: { minMinor: 0, isFree: true },
      },
      rating: { average: 4.6, reviewCount: 6700 },
      reviewVelocity: 95.5,
      feeRule: { referralPct: 7, fixedClosingFee: 0, isCategoryDefault: false },
      netRealisation: { netRealisationMinor: 6828600, totalFeesMinor: 617400 },
      cheapestOffer: {
        id: "off_1",
        effectiveMinor: 7446000,
        seller: { id: "s1", name: "Appario Retail Pvt Ltd" },
        activePromotions: [{ id: "p1", label: "Exchange bonus" }],
      },
    },
    {
      marketplace: { id: "mp_disc_x", name: "myG", brandColor: null },
      listing: { id: "lst_myg", matchStatus: "auto_matched", matchConfidence: 0.95 },
      coverage: { listingCount: 1, sellerCount: 1, offerCount: 1 },
      availability: { status: "in_stock" },
      currentPrice: {
        effectiveMinor: 5990000,
        landedMinor: 5990000,
        sellingPriceMinor: 5990000,
        mrpMinor: null,
        shipping: { minMinor: 0, isFree: true },
      },
      rating: null,
      reviewVelocity: null,
      feeRule: null,
      netRealisation: null,
      cheapestOffer: {
        id: "off_2",
        effectiveMinor: 5990000,
        seller: { id: "s2", name: "myG (storefront)" },
        activePromotions: [],
      },
    },
  ],
  meta: { productId: "prod_a", referenceDate: "2026-10-03" },
};

beforeEach(() => {
  mocks.apiRequest.mockReset();
  resetMarketplaceDirectory();
});

describe("the marketplace comparison", () => {
  it("asks the product's marketplaces endpoint", async () => {
    mocks.apiRequest.mockImplementation(async () => marketplacesBody);
    await getMarketplaceComparison("prod_a");
    expect(mocks.apiRequest.mock.calls[0][0]).toBe("/products/prod_a/marketplaces");
  });

  it("ranks on the effective price and reports the real spread", () => {
    const view = presentMarketplaceComparison(marketplacesBody);
    expect(view.cheapestAcross).toBe(5990000);
    expect(view.priceGapMinor).toBe(7446000 - 5990000);
  });

  /**
   * The discovered platform has no fee rule, so its margin is unknown. The
   * table must render that as unknown — a zero would read as "this platform
   * takes the entire sale", which is a specific and wrong claim.
   */
  it("leaves an uncaptured fee rule as an unknown margin, not a zero one", () => {
    const [amazon, myg] = presentMarketplaceComparison(marketplacesBody).listingRows;
    expect(amazon.netRealization.netRealizationMinor).toBe(6828600);
    expect(myg.netRealization).toBeNull();
    expect(myg.feeRule).toBeNull();
    expect(myg.rating).toBeNull();
    expect(myg.reviewVelocity).toBeNull();
  });

  it("omits the MRP rung when the source never gave one", () => {
    const [, myg] = presentMarketplaceComparison(marketplacesBody).listingRows;
    expect(myg.cheapestOffer.layers.mrpMinor).toBeNull();
    expect(myg.cheapestOffer.layers.discountFromMrpPct).toBeNull();
  });

  it("names the seller behind the price, from the response", () => {
    const [amazon] = presentMarketplaceComparison(marketplacesBody).listingRows;
    expect(amazon.cheapestOffer.seller.name).toBe("Appario Retail Pvt Ltd");
    expect(amazon.cheapestOffer.activePromotions).toHaveLength(1);
  });

  it("survives a product listed nowhere", () => {
    const view = presentMarketplaceComparison({ data: [], meta: {} });
    expect(view.listingRows).toEqual([]);
    expect(view.cheapestAcross).toBeNull();
    expect(view.priceGapMinor).toBe(0);
  });
});

describe("the listing detail", () => {
  const listingBody = {
    data: {
      listing: { id: "lst_myg", rawTitle: "Apple iPhone 15 | 128GB | Black", matchConfidence: 0.95 },
      product: { id: "prod_a", canonicalName: "Apple iPhone 15 (128GB) — Blue" },
      marketplace: { id: "mp_disc_x", name: "myG", isDiscovered: true },
      offers: [
        {
          id: "off_2",
          seller: { id: "s2", name: "myG (storefront)", type: "marketplace_owned", fulfilment: "self_ship", rating: null, ratingCount: null },
          condition: "new",
          status: "active",
          isInStock: true,
          isBuyboxWinner: false,
          price: {
            mrpMinor: null,
            sellingPriceMinor: 5990000,
            shippingFeeMinor: 0,
            landedMinor: 5990000,
            universalDiscountMinor: 0,
            universalEffectiveMinor: 5990000,
            conditionalDiscountMinor: 0,
            conditionalBestMinor: 5990000,
          },
          activePromotions: [],
        },
      ],
      rating: null,
      reviewVelocity: null,
    },
  };

  it("is reached by listing id and resolves its own product", async () => {
    mocks.apiRequest.mockImplementation(async () => listingBody);
    const view = await getListingDetail("lst_myg");
    expect(mocks.apiRequest.mock.calls[0][0]).toBe("/listings/lst_myg");
    expect(view.product.id).toBe("prod_a");
  });

  it("shows no stars for a seller with no rating history", () => {
    const view = presentListingDetail(listingBody);
    expect(view.offers[0].sellerRating).toBeNull();
    expect(view.offers[0].seller.name).toBe("myG (storefront)");
  });

  /**
   * The ladder omits rungs the data does not support. A listing whose source
   * published no MRP shows no MRP line, rather than one reading zero.
   */
  it("drops ladder rungs with no value, and keeps a free-shipping line", () => {
    const ladder = presentListingDetail(listingBody).offers[0].ladder;
    const keys = ladder.map((r) => r.key);
    expect(keys).not.toContain("mrp");
    expect(keys).toContain("shipping");
    expect(ladder.find((r) => r.key === "shipping").zeroLabel).toBe("Free");
    // No discount was applied, so no discount rung and no "best case" rung.
    expect(keys).not.toContain("universal");
    expect(keys).not.toContain("conditionalBest");
  });

  it("returns null for a listing the backend does not have", () => {
    expect(presentListingDetail(undefined)).toBeNull();
  });
});

describe("the workspace context", () => {
  const detail = { data: { id: "prod_a", canonicalName: "A", brand: { id: "b", name: "Apple" }, category: { id: "c" } } };
  const listings = { data: [{ id: "lst_1" }, { id: "lst_2" }, { id: "lst_3" }] };

  it("takes the product route in two parallel requests", async () => {
    mocks.apiRequest.mockImplementation(async (path) => (path.includes("/listings") ? listings : detail));
    const ctx = await getWorkspaceContext({ productId: "prod_a" });
    expect(mocks.apiRequest.mock.calls.map((c) => c[0])).toEqual([
      "/products/prod_a",
      "/products/prod_a/listings?pageSize=100",
    ]);
    expect(ctx.listingCount).toBe(3);
    expect(ctx.defaultListingId).toBe("lst_1");
  });

  /**
   * The reason `/listings/:id` had to exist. A listing address does not name
   * its product, and the browser used to resolve it against its own copy of
   * the listing table.
   */
  it("resolves the product from a listing address first", async () => {
    mocks.apiRequest.mockImplementation(async (path) => {
      if (path === "/listings/lst_2") return { data: { product: { id: "prod_a" }, listing: { id: "lst_2" } } };
      return path.includes("/listings?") ? listings : detail;
    });

    const ctx = await getWorkspaceContext({ listingId: "lst_2" });
    expect(mocks.apiRequest.mock.calls[0][0]).toBe("/listings/lst_2");
    expect(ctx.productId).toBe("prod_a");
    // The address named a listing, so the tabs open on that one.
    expect(ctx.defaultListingId).toBe("lst_2");
  });

  it("offers no listing tabs for a product with no listings", async () => {
    mocks.apiRequest.mockImplementation(async (path) => (path.includes("/listings") ? { data: [] } : detail));
    const ctx = await getWorkspaceContext({ productId: "prod_a" });
    expect(ctx.listingCount).toBe(0);
    expect(ctx.defaultListingId).toBeNull();
  });

  it("returns null for an unknown identifier", async () => {
    mocks.apiRequest.mockImplementation(async () => ({ data: null }));
    expect(await getWorkspaceContext({ productId: "nope" })).toBeNull();
  });

  it("keeps the chrome when listings fail but identity loads", async () => {
    mocks.apiRequest.mockImplementation(async (path) => {
      if (path.includes("/listings")) throw new Error("listings unavailable");
      return detail;
    });
    const ctx = await getWorkspaceContext({ productId: "prod_a" });
    expect(ctx.product.canonicalName).toBe("A");
    expect(ctx.listingsUnavailable).toBe(true);
  });
});

describe("the marketplace directory", () => {
  const body = {
    data: [
      { id: "mp_flipkart", name: "Flipkart", brandColor: "#2874f0", marketplaceType: "horizontal", isDiscovered: false },
      { id: "mp_disc_x", name: "myG", brandColor: null, marketplaceType: "unclassified", isDiscovered: true },
    ],
  };

  it("includes stores discovered by a provider", async () => {
    mocks.apiRequest.mockImplementation(async () => body);
    const dir = await getMarketplaceDirectory();
    expect(dir.get("mp_disc_x")).toEqual({
      id: "mp_disc_x",
      name: "myG",
      brandColor: null,
      type: "unclassified",
      isDiscovered: true,
    });
  });

  it("fetches once and shares the result", async () => {
    mocks.apiRequest.mockImplementation(async () => body);
    const [a, b] = await Promise.all([getMarketplaceDirectory(), getMarketplaceDirectory()]);
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  /**
   * A failure must not be cached. Caching it would turn one bad moment into a
   * whole session with no marketplace names in it.
   */
  it("retries after a failure rather than caching it", async () => {
    mocks.apiRequest.mockImplementationOnce(async () => {
      throw new Error("down");
    });
    await expect(getMarketplaceDirectory()).rejects.toThrow("down");

    mocks.apiRequest.mockImplementation(async () => body);
    const dir = await getMarketplaceDirectory();
    expect(dir.get("mp_flipkart").name).toBe("Flipkart");
    expect(mocks.apiRequest).toHaveBeenCalledTimes(2);
  });
});
