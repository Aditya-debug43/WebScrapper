import "./helpers/env.js";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { createTestApp, type Harness, type Json } from "./helpers/harness.js";
import { brands, categories, marketplaces, products } from "../src/db/schema.js";

/**
 * Catalogue APIs, run against the REAL dataset loaded into an isolated
 * in-memory PostgreSQL — so "the count agrees with the seeded database" is a
 * genuine assertion rather than a tautology against a fixture invented to
 * satisfy it.
 *
 * These check returned records and metadata, not status codes: that page two
 * holds different rows from page one, that a filter actually narrows, that a
 * sort actually orders.
 */

let h: Harness;
let totalProducts = 0;

before(async () => {
  h = await createTestApp({ seedCatalogue: true });
  const [row] = await h.db.select({ n: sql<number>`count(*)::int` }).from(products);
  totalProducts = row!.n;
});
after(async () => {
  await h.close();
});

const get = (url: string) => h.app.inject({ method: "GET", url, remoteAddress: "10.150.0.1" });

describe("PROD — product list", () => {
  it("PROD-01 / PROD-12: returns database-backed products and a total that matches the table", async () => {
    const res = await get("/api/v1/products");
    assert.equal(res.statusCode, 200);
    const body = res.json() as Json;

    assert.ok(Array.isArray(body["data"]));
    assert.ok(body["data"].length > 0);
    assert.equal(body["pagination"].total, totalProducts, "PROD-12: total equals the seeded row count");
    assert.equal(totalProducts, 1172, "the Phase 2 baseline product count");

    // Shaped, not raw rows: relations are expanded and nothing internal leaks.
    const first = body["data"][0];
    for (const key of ["id", "canonicalName", "brand", "category", "productType", "marketplaceCount"]) {
      assert.ok(key in first, `missing ${key}`);
    }
    assert.equal(typeof first.brand.name, "string");
    assert.equal(first.specifications, undefined, "list rows omit the spec document");
  });

  it("PROD-02 / PROD-03: pagination returns distinct pages with correct metadata", async () => {
    const p1 = (await get("/api/v1/products?page=1&pageSize=20")).json() as Json;
    const p2 = (await get("/api/v1/products?page=2&pageSize=20")).json() as Json;

    assert.equal(p1["data"].length, 20, "PROD-03: pageSize is respected");
    assert.equal(p2["data"].length, 20);

    const ids1 = new Set(p1["data"].map((p: Json) => p["id"]));
    const ids2 = p2["data"].map((p: Json) => p["id"]);
    assert.ok(
      ids2.every((id: string) => !ids1.has(id)),
      "PROD-02: page 2 must not repeat any record from page 1"
    );

    assert.deepEqual(
      {
        page: p2["pagination"].page,
        pageSize: p2["pagination"].pageSize,
        total: p2["pagination"].total,
        hasPrevious: p2["pagination"].hasPrevious,
        hasNext: p2["pagination"].hasNext,
      },
      {
        page: 2,
        pageSize: 20,
        total: totalProducts,
        hasPrevious: true,
        hasNext: true,
      }
    );
    assert.equal(p1["pagination"].totalPages, Math.ceil(totalProducts / 20));
    assert.equal(p1["pagination"].hasPrevious, false, "page 1 has no previous");

    // The last page is short and reports no next.
    const lastPage = p1["pagination"].totalPages;
    const last = (await get(`/api/v1/products?page=${lastPage}&pageSize=20`)).json() as Json;
    assert.equal(last["pagination"].hasNext, false);
    assert.ok(last["data"].length > 0 && last["data"].length <= 20);
  });

  it("PROD-04: search narrows to matching products and every row actually matches", async () => {
    const res = await get("/api/v1/products?search=shampoo&pageSize=50");
    assert.equal(res.statusCode, 200);
    const body = res.json() as Json;

    assert.ok(body["pagination"].total > 0, "the dataset contains shampoos");
    assert.ok(body["pagination"].total < totalProducts, "search must narrow the set");
    for (const p of body["data"]) {
      const haystack = `${p["canonicalName"]} ${p["modelName"]}`.toLowerCase();
      assert.ok(haystack.includes("shampoo"), `"${p["canonicalName"]}" does not match the term`);
    }

    // A term that cannot match returns an empty page rather than an error.
    const none = (await get("/api/v1/products?search=zzzznotathing")).json() as Json;
    assert.equal(none["pagination"].total, 0);
    assert.deepEqual(none["data"], []);
  });

  it("PROD-04b: a wildcard in the search term is matched literally, not as SQL", async () => {
    // '%' would match everything if it reached LIKE unescaped as a pattern.
    const res = await get("/api/v1/products?search=%25");
    assert.equal(res.statusCode, 200);
    const body = res.json() as Json;
    assert.ok(
      body["pagination"].total < totalProducts,
      "a literal percent sign must not behave as a wildcard"
    );
  });

  it("PROD-05: category filtering returns only that category", async () => {
    const [cat] = await h.db
      .select({ id: categories.id })
      .from(categories)
      .where(sql`exists (select 1 from ${products} p where p.category_id = ${categories.id})`)
      .limit(1);

    const res = await get(`/api/v1/products?category=${cat!.id}&pageSize=50`);
    const body = res.json() as Json;
    assert.ok(body["pagination"].total > 0);
    for (const p of body["data"]) assert.equal(p["category"].id, cat!.id);

    const [expected] = await h.db
      .select({ n: sql<number>`count(*)::int` })
      .from(products)
      .where(sql`${products.categoryId} = ${cat!.id}`);
    assert.equal(body["pagination"].total, expected!.n, "total matches a direct count");
  });

  it("PROD-06: brand filtering returns only that brand", async () => {
    const [brand] = await h.db
      .select({ id: brands.id })
      .from(brands)
      .where(sql`exists (select 1 from ${products} p where p.brand_id = ${brands.id})`)
      .limit(1);

    const body = (await get(`/api/v1/products?brand=${brand!.id}&pageSize=50`)).json() as Json;
    assert.ok(body["pagination"].total > 0);
    for (const p of body["data"]) assert.equal(p["brand"].id, brand!.id);
  });

  it("PROD-06b: marketplace filtering returns each product once, not once per listing", async () => {
    const [mp] = await h.db.select({ id: marketplaces.id }).from(marketplaces).limit(1);
    const body = (await get(`/api/v1/products?marketplace=${mp!.id}&pageSize=100`)).json() as Json;
    assert.ok(body["pagination"].total > 0);
    const ids = body["data"].map((p: Json) => p["id"]);
    assert.equal(new Set(ids).size, ids.length, "a semi-join must not duplicate products");
  });

  it("PROD-07: sorting orders the records and is stable across pages", async () => {
    const asc = (await get("/api/v1/products?sort=name_asc&pageSize=30")).json() as Json;
    const names = asc["data"].map((p: Json) => p["canonicalName"] as string);
    assert.deepEqual(
      names,
      [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), "en")),
      "ascending by name, folded for case"
    );

    const desc = (await get("/api/v1/products?sort=name_desc&pageSize=30")).json() as Json;
    const descNames = desc["data"].map((p: Json) => p["canonicalName"] as string);
    assert.notDeepEqual(descNames, names, "descending differs from ascending");
    assert.equal(
      descNames[0],
      [...descNames].sort((a, b) => b.toLowerCase().localeCompare(a.toLowerCase(), "en"))[0]
    );

    // A sort with ties needs a deterministic tiebreak or rows repeat across
    // pages; check two adjacent pages share nothing.
    const n1 = (await get("/api/v1/products?sort=newest&page=1&pageSize=25")).json() as Json;
    const n2 = (await get("/api/v1/products?sort=newest&page=2&pageSize=25")).json() as Json;
    const s1 = new Set(n1["data"].map((p: Json) => p["id"]));
    assert.ok(
      n2["data"].every((p: Json) => !s1.has(p["id"])),
      "newest sort must be stable enough not to repeat rows across pages"
    );
  });

  it("PROD-08: invalid pagination is rejected", async () => {
    for (const q of ["page=0", "page=-1", "pageSize=0", "pageSize=101", "page=abc", "pageSize=9999"]) {
      const res = await get(`/api/v1/products?${q}`);
      assert.equal(res.statusCode, 400, q);
      assert.equal((res.json() as Json)["error"].code, "VALIDATION_FAILED");
    }
  });

  it("PROD-09: invalid filter parameters are rejected rather than silently ignored", async () => {
    const unknownSort = await get("/api/v1/products?sort=cheapest");
    assert.equal(unknownSort.statusCode, 400, "sort is a closed set");

    const unknownParam = await get("/api/v1/products?colour=red");
    assert.equal(unknownParam.statusCode, 400, "an unknown query parameter is a client bug, not a no-op");

    // A well-formed id that does not exist is a 400 with field detail, not an
    // empty page — an empty page would hide the client's mistake.
    const ghost = await get("/api/v1/products?category=cat_does_not_exist");
    assert.equal(ghost.statusCode, 400);
    const body = ghost.json() as Json;
    assert.equal(body["error"].code, "VALIDATION_FAILED");
    assert.equal(body["error"].details[0].field, "category");
  });
});

describe("PROD — product detail", () => {
  it("PROD-11: returns identity and specs, and omits prices, offers and reviews", async () => {
    const res = await get("/api/v1/products/prod_dove_hair_fall");
    assert.equal(res.statusCode, 200);
    const p = (res.json() as Json)["data"];

    assert.equal(p.id, "prod_dove_hair_fall");
    assert.equal(p.brand.name, "Dove");
    assert.ok(p.category.path.length > 0);
    assert.equal(typeof p.specifications, "object");
    assert.equal(p.marketplaceCount, 6, "the Phase 2 golden record: six listings");

    // Explicitly out of scope for a detail response.
    for (const forbidden of ["offers", "priceObservations", "prices", "reviews", "competitors", "recommendation"]) {
      assert.equal(p[forbidden], undefined, `detail must not embed ${forbidden}`);
    }
  });

  it("returns variant siblings for a product in a family", async () => {
    const [variant] = await h.db
      .select({ id: products.id })
      .from(products)
      .where(sql`${products.parentProductId} is not null`)
      .limit(1);

    const p = ((await get(`/api/v1/products/${variant!.id}`)).json() as Json)["data"];
    assert.ok(p.parentProductId, "the variant knows its family");
    assert.ok(Array.isArray(p.variantSiblings));
    assert.ok(
      p.variantSiblings.every((s: Json) => s["id"] !== variant!.id),
      "a product is not its own sibling"
    );
  });

  it("PROD-10: an unknown id returns the standard not-found response", async () => {
    const res = await get("/api/v1/products/prod_definitely_not_real");
    assert.equal(res.statusCode, 404);
    const body = res.json() as Json;
    assert.equal(body["error"].code, "NOT_FOUND");
    assert.ok(!body["error"].message.includes("select"), "no SQL in the message");
  });
});

describe("CAT / BRAND / MARKET", () => {
  it("CAT-01: categories return real rows with product counts, and can be scoped", async () => {
    const all = (await get("/api/v1/categories")).json() as Json;
    const [{ n }] = await h.db.select({ n: sql<number>`count(*)::int` }).from(categories);
    assert.equal(all["data"].length, n);
    assert.equal(n, 179, "the Phase 2 baseline category count");

    const roots = (await get("/api/v1/categories?parent=root")).json() as Json;
    assert.ok(roots["data"].length > 0 && roots["data"].length < n, "departments are a subset");
    for (const c of roots["data"]) assert.equal(c["parentId"], null);

    const byLevel = (await get("/api/v1/categories?level=1")).json() as Json;
    for (const c of byLevel["data"]) assert.equal(c["level"], 1);
  });

  it("CAT-02: category detail includes ancestry, children and product types", async () => {
    const [child] = await h.db
      .select({ id: categories.id })
      .from(categories)
      .where(sql`${categories.parentId} is not null`)
      .limit(1);

    const res = await get(`/api/v1/categories/${child!.id}`);
    assert.equal(res.statusCode, 200);
    const c = (res.json() as Json)["data"];
    assert.equal(c.id, child!.id);
    assert.ok(Array.isArray(c.ancestors));
    assert.ok(Array.isArray(c.children));
    assert.ok(Array.isArray(c.productTypes));
    assert.equal(typeof c.productCount, "number");

    const missing = await get("/api/v1/categories/cat_nope");
    assert.equal(missing.statusCode, 404);
  });

  it("BRAND-01: brands paginate, search and carry product counts", async () => {
    const [{ n }] = await h.db.select({ n: sql<number>`count(*)::int` }).from(brands);
    const page = (await get("/api/v1/brands?page=1&pageSize=10")).json() as Json;
    assert.equal(page["data"].length, 10);
    assert.equal(page["pagination"].total, n);
    assert.equal(n, 314, "the Phase 2 baseline brand count");
    assert.equal(typeof page["data"][0].productCount, "number");

    const searched = (await get("/api/v1/brands?search=sam")).json() as Json;
    assert.ok(searched["pagination"].total > 0);
    for (const b of searched["data"]) {
      assert.ok(b["name"].toLowerCase().includes("sam"), `${b["name"]} does not match`);
    }
  });

  it("MARKET-01 / MARKET-02: the six marketplaces are returned and match Phase 2", async () => {
    const res = await get("/api/v1/marketplaces");
    assert.equal(res.statusCode, 200);
    const data = (res.json() as Json)["data"] as Json[];

    assert.equal(data.length, 6, "MARKET-01: exactly six marketplaces");

    const [{ n }] = await h.db.select({ n: sql<number>`count(*)::int` }).from(marketplaces);
    assert.equal(data.length, n, "MARKET-02: consistent with the database");

    const ids = data.map((m) => m["id"]).sort();
    assert.deepEqual(ids, [
      "mp_ajio",
      "mp_amazon_in",
      "mp_flipkart",
      "mp_meesho",
      "mp_myntra",
      "mp_nykaa",
    ]);

    for (const m of data) {
      assert.equal(typeof m["listingCount"], "number");
      assert.ok(m["listingCount"] > 0, `${m["name"]} should carry listings`);
      assert.equal(m["categoryAffinity"], undefined, "internal routing config is not exposed");
    }
  });
});
