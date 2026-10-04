import "./helpers/env.js";

import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import { createTestApp, type Harness } from "./helpers/harness.js";

/**
 * THE CATALOGUE ENDPOINT'S OWN BEHAVIOUR
 * ======================================
 *
 * Parity (`catalogue-parity.test.ts`) proves the backend agrees with the engine
 * it replaces, but it is scoped to one product type because facet counts need
 * every price in scope. The questions that do NOT need price data — category
 * subtree resolution, pagination across the whole catalogue, validation, empty
 * states — are answered here instead, against the cheap catalogue-only seed.
 *
 * Splitting them is what keeps both suites fast enough to actually run.
 */

let h: Harness;

before(async () => {
  h = await createTestApp({ seedCatalogue: true });
});
after(async () => {
  await h.close();
});

const get = async (query: string) => {
  const res = await h.app.inject({ method: "GET", url: `/api/v1/catalogue?${query}` });
  return { status: res.statusCode, body: res.statusCode === 200 ? res.json() : res.json() };
};

describe("category scope resolves down the tree", () => {
  /**
   * THE BUG THIS EXISTS FOR.
   *
   * Products hang off leaf categories. A department filter written as exact
   * equality returns nothing, and the screen then shows an empty catalogue
   * while the sidebar claims hundreds of products — a failure that looks like
   * missing data rather than a wrong query.
   */
  test("a department includes products from its leaf categories", async () => {
    const dept = await get("category=cat_electronics&pageSize=1");
    assert.equal(dept.status, 200);
    assert.ok(
      dept.body.pagination.total > 50,
      `a department must not be empty — got ${dept.body.pagination.total}`
    );

    const leaf = await get("category=cat_smartphones&pageSize=1");
    assert.ok(
      leaf.body.pagination.total > 0 && leaf.body.pagination.total < dept.body.pagination.total,
      "a leaf is a strict subset of its department"
    );
  });

  test("the subtree is the node plus its descendants, nothing else", async () => {
    const all = await get("pageSize=1");
    const dept = await get("category=cat_electronics&pageSize=1");
    assert.ok(dept.body.pagination.total < all.body.pagination.total, "a department is not the catalogue");
  });

  test("breadcrumbs resolve root-first", async () => {
    const { body } = await get("category=cat_smartphones&pageSize=1");
    const names = body.meta.breadcrumb.map((b: any) => b.name);
    assert.ok(names.length >= 2, `expected an ancestry, got ${JSON.stringify(names)}`);
    assert.equal(names[names.length - 1], "Smartphones", "the node itself ends the breadcrumb");
    const levels = body.meta.breadcrumb.map((b: any) => b.level);
    assert.deepEqual(levels, [...levels].sort((a: number, b: number) => a - b), "root first");
  });

  test("departments keep their taxonomy order, not alphabetical", async () => {
    const { body } = await get("pageSize=1");
    const names = body.meta.childCategories.map((c: any) => c.name);
    assert.equal(names[0], "Electronics", "the merchandising order leads with Electronics");
    assert.notDeepEqual(names, [...names].sort(), "an alphabetical list would start with Automotive");
  });
});

describe("pagination is exhaustive and non-overlapping", () => {
  /**
   * Walks every page of the whole catalogue and checks the union against the
   * reported total. A sort without a stable tiebreak passes a single-page test
   * and fails this one, which is the only reason to write it.
   */
  test("every product appears exactly once across all pages", async () => {
    const first = await get("pageSize=100&sort=reviews");
    const total = first.body.pagination.total;
    const seen = new Set<string>(first.body.data.map((r: any) => r.product.id));

    for (let page = 2; page <= first.body.pagination.totalPages; page += 1) {
      const next = await get(`pageSize=100&sort=reviews&page=${page}`);
      for (const row of next.body.data) {
        assert.ok(!seen.has(row.product.id), `${row.product.id} served on two pages`);
        seen.add(row.product.id);
      }
    }

    assert.equal(seen.size, total, "pages must cover the result set exactly");
  });

  test("a page beyond the end is empty, not an error", async () => {
    const { status, body } = await get("pageSize=100&page=999");
    assert.equal(status, 200);
    assert.deepEqual(body.data, []);
    assert.ok(body.pagination.total > 0, "the total still describes the result set");
  });
});

describe("filters are validated, not silently ignored", () => {
  test("an unknown category is a 400, not an empty page", async () => {
    const { status, body } = await get("category=cat_does_not_exist");
    assert.equal(status, 400, "an empty page would hide a client bug");
    assert.equal(body.error.code, "VALIDATION_FAILED");
  });

  test("an unknown product type is a 400", async () => {
    const { status } = await get("productType=ptype_imaginary");
    assert.equal(status, 400);
  });

  test("an unknown sort is refused by schema", async () => {
    const { status } = await get("sort=by_vibes");
    assert.equal(status, 400);
  });

  test("pageSize cannot be used to request the whole table", async () => {
    const { status } = await get("pageSize=100000");
    assert.equal(status, 400);
  });

  test("an unknown query parameter is refused rather than ignored", async () => {
    const { status } = await get("categoryy=cat_electronics");
    assert.equal(status, 400, "a typo in a filter name must fail loudly");
  });

  /**
   * An unknown spec KEY is tolerated where an unknown category is not, and the
   * asymmetry is deliberate: spec keys come from the attribute registry and a
   * bookmarked URL can outlive one. Refusing would turn an old link into a
   * broken catalogue; ignoring it shows the unfiltered scope.
   */
  test("an unknown spec key is ignored, so a stale bookmark still loads", async () => {
    const { status, body } = await get("productType=ptype_smartphone&specs=no_such_key:7");
    assert.equal(status, 200);
    assert.ok(body.pagination.total > 0);
  });
});

describe("empty and sparse results stay honest", () => {
  test("a search matching nothing returns no rows and no facets", async () => {
    const { status, body } = await get("search=zzzznothingmatchesthis");
    assert.equal(status, 200);
    assert.deepEqual(body.data, []);
    assert.equal(body.pagination.total, 0);
    assert.equal(body.meta.scopeTotal, 0);
    assert.deepEqual(body.facets.brand, [], "no products means no brands to offer");
    assert.deepEqual(body.facets.price, []);
  });

  test("a LIKE metacharacter is matched literally, not as a wildcard", async () => {
    const all = await get("pageSize=1");
    const pct = await get("search=%25&pageSize=1");
    assert.equal(pct.status, 200);
    assert.ok(
      pct.body.pagination.total < all.body.pagination.total,
      "'%' must not return the entire catalogue"
    );
  });

  /**
   * With no observations seeded, every price and rating is absent. The rows
   * must say so rather than substituting zero — a card reading "₹0" or "4.0★"
   * for a product with no data is inventing evidence, and with live provider
   * data these gaps are routine.
   */
  test("absent prices and ratings are null, never zero", async () => {
    const { body } = await get("category=cat_smartphones&pageSize=20");
    assert.ok(body.data.length > 0);
    for (const row of body.data) {
      assert.equal(row.minPriceMinor, null, `${row.product.id} should have no price in this fixture`);
      assert.equal(row.rating, null, `${row.product.id} should have no rating in this fixture`);
      assert.equal(row.inStock, false, "unknown stock is not in-stock");
    }
  });

  test("the in-stock facet is offered even when nothing is in stock", async () => {
    const { body } = await get("category=cat_smartphones&pageSize=1");
    assert.equal(body.facets.availability.length, 1, "the toggle explains why the count is zero");
    assert.equal(body.facets.availability[0].count, 0);
  });
});
