import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The catalogue and product services — what they ask for, and what they
 * refuse to invent.
 *
 * These two modules used to BE the catalogue: they imported the bundled
 * dataset and computed prices, ratings and facets in the browser. They are now
 * clients, and the properties worth pinning are the ones a screenshot cannot
 * show — that the query is built correctly, that absent values stay absent,
 * and above all that a failure is allowed to fail.
 */

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../src/api/http", () => ({ apiRequest: mocks.apiRequest }));

const { getCatalogue, presentCatalogue, SORT_OPTIONS } = await import("../src/api/catalogueService");
const { getProductDetail, presentProductDetail } = await import("../src/api/productsService");

/** A minimal well-formed catalogue envelope. */
const catalogueBody = {
  data: [
    {
      product: { id: "prod_a", canonicalName: "A", brand: { id: "brand_a", name: "Alpha" } },
      minPriceMinor: 100000,
      maxPriceMinor: 120000,
      marketplaces: [{ id: "mp_flipkart", name: "Flipkart", brandColor: "#2874f0" }],
      marketplaceIds: ["mp_flipkart"],
      keySpecs: [{ key: "ram_gb", label: "RAM", value: 8, unit: "GB", dataType: "integer" }],
      listingCount: 1,
      offerCount: 2,
      rating: 4.3,
      reviewCount: 120,
      inStock: true,
    },
  ],
  pagination: { page: 1, pageSize: 48, total: 1, totalPages: 1 },
  facets: { brand: [], price: [], rating: [], marketplace: [], availability: [], specs: [] },
  priceBuckets: [],
  meta: { scopeTotal: 1, resolvedProductTypeId: null, breadcrumb: [], childCategories: [], productTypesInScope: [] },
};

beforeEach(() => {
  mocks.apiRequest.mockReset();
  mocks.apiRequest.mockImplementation(async () => catalogueBody);
});

/** The query string of the single request the catalogue made. */
const lastQuery = () => new URLSearchParams(mocks.apiRequest.mock.calls[0][0].split("?")[1]);

describe("the catalogue request", () => {
  it("asks the catalogue endpoint, not a product list", async () => {
    await getCatalogue({});
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    expect(mocks.apiRequest.mock.calls[0][0]).toMatch(/^\/catalogue\?/);
  });

  it("sends every filter group the sidebar can set", async () => {
    await getCatalogue({
      categoryId: "cat_smartphones",
      productTypeId: "ptype_smartphone",
      query: "  iphone  ",
      brandIds: ["brand_apple", "brand_samsung"],
      priceBucketIds: ["p_0_500"],
      ratingId: "r4",
      marketplaceIds: ["mp_flipkart"],
      inStockOnly: true,
      specFilters: { storage_gb: ["128 GB"], ram_gb: ["8", "12"] },
      sort: "price_asc",
    });

    const q = lastQuery();
    expect(q.get("category")).toBe("cat_smartphones");
    expect(q.get("productType")).toBe("ptype_smartphone");
    expect(q.get("search")).toBe("iphone");
    expect(q.get("brands")).toBe("brand_apple,brand_samsung");
    expect(q.get("prices")).toBe("p_0_500");
    expect(q.get("rating")).toBe("r4");
    expect(q.get("marketplaces")).toBe("mp_flipkart");
    expect(q.get("inStock")).toBe("true");
    expect(q.get("sort")).toBe("price_asc");
    expect(q.get("specs")).toBe("storage_gb:128 GB;ram_gb:8,12");
  });

  it("omits filters that are not set, rather than sending empty ones", async () => {
    await getCatalogue({});
    const q = lastQuery();
    for (const key of ["category", "productType", "search", "brands", "prices", "rating", "marketplaces", "specs"]) {
      expect(q.has(key), `${key} should be absent`).toBe(false);
    }
    // `inStock=false` is the default and carries no information either.
    expect(q.has("inStock")).toBe(false);
  });

  it("offers exactly the sorts the endpoint accepts", () => {
    expect(SORT_OPTIONS.map((o) => o.value)).toEqual([
      "relevance",
      "price_asc",
      "price_desc",
      "rating",
      "reviews",
      "recent",
    ]);
  });
});

describe("the catalogue never invents a value", () => {
  /**
   * The old browser engine always had a number because it computed one. With
   * real provider data, missing prices and ratings are routine — a product
   * with no captured in-stock offer genuinely has no price — and printing ₹0
   * or 4.0★ would be a claim the data does not support.
   */
  it("passes a null price and a null rating through untouched", () => {
    const view = presentCatalogue({
      ...catalogueBody,
      data: [{ ...catalogueBody.data[0], minPriceMinor: null, maxPriceMinor: null, rating: null, reviewCount: 0, inStock: false }],
    });
    const row = view.results[0];
    expect(row.minPriceMinor).toBeNull();
    expect(row.maxPriceMinor).toBeNull();
    expect(row.rating).toBeNull();
    expect(row.inStock).toBe(false);
  });

  it("survives an envelope with nothing in it", () => {
    const view = presentCatalogue(undefined);
    expect(view.results).toEqual([]);
    expect(view.total).toBe(0);
    expect(view.facets.brand).toEqual([]);
    expect(view.breadcrumb).toEqual([]);
  });

  it("carries each marketplace's own name and colour, not just its id", () => {
    const view = presentCatalogue(catalogueBody);
    expect(view.results[0].marketplaces).toEqual([
      { id: "mp_flipkart", name: "Flipkart", brandColor: "#2874f0" },
    ]);
  });

  it("keeps facet groups in the order the backend returned them", () => {
    const marketplace = [
      { id: "mp_flipkart", label: "Flipkart", count: 1 },
      { id: "mp_amazon_in", label: "Amazon.in", count: 9 },
    ];
    const view = presentCatalogue({ ...catalogueBody, facets: { ...catalogueBody.facets, marketplace } });
    expect(view.facets.marketplace).toEqual(marketplace);
  });
});

describe("a failure is allowed to fail", () => {
  /**
   * THE POINT OF THE WHOLE MIGRATION.
   *
   * Falling back to the bundled dataset would make an outage look like a
   * working catalogue showing stale invented data, and would restore the two
   * competing sources of truth this work removes. The error must reach the
   * screen.
   */
  it("propagates an API error instead of substituting local data", async () => {
    mocks.apiRequest.mockImplementation(async () => {
      throw new Error("API down");
    });
    await expect(getCatalogue({})).rejects.toThrow("API down");
  });
});

describe("the product overview", () => {
  const detailBody = {
    data: {
      id: "prod_a",
      canonicalName: "Apple iPhone 15 (128GB) — Blue",
      modelName: "iPhone 15",
      brand: { id: "brand_apple", name: "Apple", tier: "premium" },
      category: { id: "cat_smartphones", name: "Smartphones", path: "electronics/x/smartphones" },
      productType: { id: "ptype_smartphone", name: "Smartphone" },
      categoryPath: [{ id: "cat_electronics", name: "Electronics", level: 1 }],
      attributeDefinitions: [{ attributeKey: "ram_gb", displayName: "RAM", dataType: "integer", unit: "GB" }],
      specifications: { ram_gb: 6 },
      variantSiblings: [],
      marketplaceCount: 3,
    },
  };
  const marketplacesBody = {
    data: [
      {
        marketplace: { id: "mp_disc_x", name: "myG", brandColor: null },
        listing: { id: "lst_1" },
        coverage: { listingCount: 1 },
        availability: { status: "in_stock" },
        rating: { average: null, reviewCount: null },
        currentPrice: { effectiveMinor: 5990000 },
      },
    ],
  };

  it("fetches identity and marketplace presence as two requests", async () => {
    mocks.apiRequest.mockImplementation(async (path) =>
      path.includes("/marketplaces") ? marketplacesBody : detailBody
    );
    await getProductDetail("prod_a");
    const paths = mocks.apiRequest.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(["/products/prod_a", "/products/prod_a/marketplaces"]);
  });

  it("shows a discovered marketplace with no brand colour, rather than dropping it", () => {
    const view = presentProductDetail(detailBody, marketplacesBody);
    expect(view.listings).toHaveLength(1);
    expect(view.listings[0].marketplace.name).toBe("myG");
    expect(view.listings[0].currentPriceMinor).toBe(5990000);
    expect(view.listings[0].rating).toBeNull();
  });

  /**
   * A product listed nowhere and a lookup that failed look identical on
   * screen and mean opposite things, so the view-model keeps them apart —
   * the same distinction the ingestion layer refuses to blur.
   */
  it("distinguishes 'listed nowhere' from 'could not ask'", () => {
    const nowhere = presentProductDetail(detailBody, { data: [] });
    expect(nowhere.listings).toEqual([]);
    expect(nowhere.marketplacesUnavailable).toBe(false);

    const failed = presentProductDetail(detailBody, null);
    expect(failed.listings).toEqual([]);
    expect(failed.marketplacesUnavailable).toBe(true);
  });

  it("keeps the page when marketplace presence fails, because identity is the page", async () => {
    mocks.apiRequest.mockImplementation(async (path) => {
      if (path.includes("/marketplaces")) throw new Error("coverage unavailable");
      return detailBody;
    });
    const view = await getProductDetail("prod_a");
    expect(view.product.canonicalName).toBe("Apple iPhone 15 (128GB) — Blue");
    expect(view.marketplacesUnavailable).toBe(true);
  });

  it("fails the page when identity fails, because there is nothing to show", async () => {
    mocks.apiRequest.mockImplementation(async (path) => {
      if (path.includes("/marketplaces")) return marketplacesBody;
      throw new Error("product unavailable");
    });
    await expect(getProductDetail("prod_a")).rejects.toThrow("product unavailable");
  });

  it("returns null for a product the backend does not have", () => {
    expect(presentProductDetail(undefined, null)).toBeNull();
  });
});
