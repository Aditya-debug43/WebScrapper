import "./helpers/env.js";

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createTestApp, type Harness } from "./helpers/harness.js";

/**
 * CATALOGUE PARITY
 * ================
 *
 * The catalogue page is moving from the bundled browser dataset to the
 * backend. The migration is only safe if the two answer the same questions the
 * same way, so this asks the backend every query the browser engine was asked
 * in `scripts/export-catalogue-parity-fixture.mjs` and compares the answers.
 *
 * The fixture is the ORACLE, not the implementation: it was produced by the
 * engine that is being replaced, from the same dataset the backend is seeded
 * with. A disagreement means the port changed behaviour.
 *
 * ── The one tolerated difference ──────────────────────────────────────────
 * Ordering ties. The browser sorts a complete array and never paginates, so
 * equal rows keep the order the summary index was built in — an artefact, not
 * a decision. The backend paginates, where an unstable tie serves a row twice
 * or skips it, so it breaks ties by product id.
 *
 * So result MEMBERSHIP is compared exactly for every case, and result ORDER is
 * compared only where the sort key is unique across the results. That is a
 * narrower claim, honestly stated, rather than a comparison rigged to pass.
 */

const FIXTURE = fileURLToPath(new URL("./fixtures/catalogue-parity.json", import.meta.url));

type Case = {
  name: string;
  query: Record<string, unknown>;
  resultIds: string[];
  total: number;
  scopeTotal: number;
  resolvedProductType: string | null;
  rows: Array<{
    productId: string;
    minPriceMinor: number | null;
    maxPriceMinor: number | null;
    rating: number | null;
    reviewCount: number;
    inStock: boolean;
    listingCount: number;
    offerCount: number;
    marketplaceIds: string[];
  }>;
  facets: {
    brand: Array<{ id: string; label: string; count: number }>;
    price: Array<{ id: string; label: string; count: number }>;
    rating: Array<{ id: string; label: string; count: number }>;
    marketplace: Array<{ id: string; label: string; count: number }>;
    availability: Array<{ id: string; label: string; count: number }>;
    specs: Array<{ key: string; label: string; filterType: string; options: Array<{ id: string; label: string; count: number }> }>;
  };
  navigation: { breadcrumbIds: string[]; childCategoryIds: string[]; productTypeIdsInScope: string[] };
};

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: Case[] };

let h: Harness;

/**
 * Every smartphone, with its complete graph — offers, observations, reviews
 * and promotions.
 *
 * Facet counts are computed over the whole scope, so the scope has to be
 * present in full or every count is wrong and every assertion passes for the
 * wrong reason. `includeProductTypePeers` loads exactly the 20 products of
 * `ptype_smartphone`, which is the scope the fixture's cases are written
 * against.
 *
 * Narrowed deliberately: seeding all 1,172 products' 354,940 observations into
 * an in-memory database to assert on 20 took minutes, and a test nobody runs
 * is worse than a narrower test that runs every time. Catalogue-wide scoping
 * and pagination are covered separately, against the cheap catalogue seed,
 * because neither needs price data.
 */
before(async () => {
  h = await createTestApp({ marketplaceProducts: ["prod_iphone_15_128"], includeProductTypePeers: true });
});
after(async () => {
  await h.close();
});

/** The engine's query object as a `/catalogue` querystring. */
function toQuery(q: Record<string, any>, page: number): string {
  const p = new URLSearchParams();
  p.set("page", String(page));
  p.set("pageSize", "100");
  if (q.categoryId) p.set("category", q.categoryId);
  if (q.productTypeId) p.set("productType", q.productTypeId);
  if (q.query) p.set("search", q.query);
  if (q.brandIds?.length) p.set("brands", q.brandIds.join(","));
  if (q.priceBucketIds?.length) p.set("prices", q.priceBucketIds.join(","));
  if (q.ratingId) p.set("rating", q.ratingId);
  if (q.marketplaceIds?.length) p.set("marketplaces", q.marketplaceIds.join(","));
  if (q.inStockOnly) p.set("inStock", "true");
  if (q.specFilters && Object.keys(q.specFilters).length) {
    p.set(
      "specs",
      Object.entries(q.specFilters)
        .map(([k, v]) => `${k}:${(v as string[]).join(",")}`)
        .join(";")
    );
  }
  if (q.sort) p.set("sort", q.sort);
  return p.toString();
}

/**
 * Every page of a query, concatenated.
 *
 * The engine returns its whole result set at once; the API is paginated at
 * 100. Walking the pages is not a workaround but a stronger test: if
 * pagination ever double-serves or skips a row, the concatenation will not
 * match the engine's set, and the duplicate check below says so directly.
 */
const ask = async (c: Case) => {
  const first = await h.app.inject({ method: "GET", url: `/api/v1/catalogue?${toQuery(c.query, 1)}` });
  assert.equal(first.statusCode, 200, `${c.name}: ${first.body.slice(0, 200)}`);
  const body = first.json();

  const rows = [...body.data];
  for (let page = 2; page <= body.pagination.totalPages; page += 1) {
    const next = await h.app.inject({ method: "GET", url: `/api/v1/catalogue?${toQuery(c.query, page)}` });
    assert.equal(next.statusCode, 200, `${c.name} page ${page}: ${next.body.slice(0, 200)}`);
    rows.push(...next.json().data);
  }

  const ids = rows.map((r: any) => r.product.id);
  assert.equal(new Set(ids).size, ids.length, `${c.name}: pagination served a product twice`);

  return { ...body, data: rows };
};

describe("catalogue parity — the backend answers what the engine answered", () => {
  for (const c of fixture.cases) {
    test(c.name, async () => {
      const body = await ask(c);

      /* ---------------------------------------------------- scope and totals */

      assert.equal(body.meta.scopeTotal, c.scopeTotal, "scope size");
      assert.equal(body.pagination.total, c.total, "result count");
      assert.equal(body.meta.resolvedProductTypeId, c.resolvedProductType, "resolved product type");

      /* -------------------------------------------------------- membership */

      const got = body.data.map((r: any) => r.product.id);
      assert.deepEqual([...got].sort(), [...c.resultIds].sort(), "result membership");

      /* ------------------------------------------------------------ ordering */

      /**
       * Compared only where the sort key separates every row. Where it does
       * not, the engine's order is an artefact of its index and asserting on
       * it would be asserting on nothing.
       */
      const sort = (c.query.sort as string) ?? "relevance";
      const keyFor = (row: any): number | string | null => {
        switch (sort) {
          case "price_asc":
          case "price_desc":
            return row.minPriceMinor;
          case "rating":
            return row.rating;
          case "recent":
            return row.product?.firstSeenAt ?? null;
          default:
            return row.reviewCount;
        }
      };
      const keys = body.data.map(keyFor);
      const unique = new Set(keys.map((k: unknown) => String(k))).size === keys.length;
      if (unique && keys.length > 1) {
        assert.deepEqual(got, c.resultIds, `order for sort=${sort} (keys are unique, so order is defined)`);
      }

      /* ------------------------------------------------------- per-row values */

      const byId = new Map(body.data.map((r: any) => [r.product.id, r]));
      for (const expected of c.rows) {
        const actual = byId.get(expected.productId);
        assert.ok(actual, `${expected.productId} missing from backend results`);
        assert.equal(actual.minPriceMinor, expected.minPriceMinor, `${expected.productId} minPrice`);
        assert.equal(actual.maxPriceMinor, expected.maxPriceMinor, `${expected.productId} maxPrice`);
        assert.equal(actual.rating, expected.rating, `${expected.productId} rating`);
        assert.equal(actual.reviewCount, expected.reviewCount, `${expected.productId} reviewCount`);
        assert.equal(actual.inStock, expected.inStock, `${expected.productId} inStock`);
        assert.equal(actual.listingCount, expected.listingCount, `${expected.productId} listingCount`);
        assert.equal(actual.offerCount, expected.offerCount, `${expected.productId} offerCount`);
        assert.deepEqual(
          [...actual.marketplaceIds].sort(),
          expected.marketplaceIds,
          `${expected.productId} marketplaceIds`
        );
      }

      /* ---------------------------------------------------------------- facets */

      for (const group of ["brand", "price", "rating", "marketplace", "availability"] as const) {
        assert.deepEqual(
          body.facets[group],
          c.facets[group],
          `${group} facet — options, labels, counts and order`
        );
      }

      assert.deepEqual(
        body.facets.specs,
        c.facets.specs,
        "spec facets — including range buckets in registry order"
      );

      /* ------------------------------------------------------------ navigation */

      assert.deepEqual(body.meta.breadcrumb.map((b: any) => b.id), c.navigation.breadcrumbIds, "breadcrumb");
      assert.deepEqual(
        body.meta.childCategories.map((x: any) => x.id),
        c.navigation.childCategoryIds,
        "child categories"
      );
      assert.deepEqual(
        body.meta.productTypesInScope.map((x: any) => x.id),
        c.navigation.productTypeIdsInScope,
        "product types in scope"
      );
    });
  }
});
