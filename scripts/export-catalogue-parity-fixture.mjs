import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * CATALOGUE PARITY FIXTURE
 * ========================
 *
 * The catalogue page is moving from the bundled dataset to the backend. "Moved"
 * only means anything if the two agree, so this records what the BROWSER
 * engine answers for a set of queries chosen to exercise every facet group,
 * and `server/tests/catalogue-parity.test.ts` asks the backend the same ones.
 *
 * It runs on the frontend side because the engine's modules use Vite-style
 * extensionless imports the backend test runner cannot resolve.
 *
 * WHAT IS COMPARED
 * ----------------
 * Result ids and their order, totals, every facet group's options and counts,
 * the derived price buckets, and the navigation context. Those are the whole
 * observable contract of the screen.
 *
 * ONE KNOWN, DELIBERATE DIFFERENCE: ordering ties.
 *
 * The browser sorts a complete array and never paginates, so equal rows keep
 * whatever order the summary index was built in. The backend paginates, where
 * an unstable tie serves a row twice or skips it, so it breaks ties by product
 * id. The parity test therefore compares result SETS for every sort, and
 * compares exact ORDER only where the sort key is unique across the result.
 *
 * The fixture is checked in. A diff in it is a change to catalogue behaviour,
 * which should never be quiet.
 *
 *   node scripts/export-catalogue-parity-fixture.mjs
 */

const OUT = resolve("server/tests/fixtures/catalogue-parity.json");

/**
 * Queries chosen to exercise the engine, not to look tidy.
 *
 * Each names the branch it is there for, so a case that stops covering it is
 * visible rather than merely still passing.
 */
/**
 * EVERY CASE IS SCOPED TO ONE PRODUCT TYPE, deliberately.
 *
 * Facet counts are over the whole scope, so the backend test has to hold every
 * product in that scope WITH its offers, observations, reviews and promotions.
 * Seeding all 1,172 products' observations into an in-memory database to assert
 * on 20 took minutes — a test nobody would run, which is worse than a narrower
 * test that runs every time.
 *
 * `ptype_smartphone` is the right scope to narrow to: 20 products across 13
 * brands and 3 marketplaces, with range, enum AND boolean spec attributes, so
 * every facet group and every sort is still exercised.
 *
 * What this cannot cover — subtree resolution across a category tree, and
 * catalogue-wide pagination — does not need price data, and is covered by
 * `server/tests/catalogue.test.ts` against the cheap catalogue-only seed.
 */
const SCOPE = { categoryId: "cat_smartphones", productTypeId: "ptype_smartphone" };

const CASES = [
  { name: "the whole scope, default sort", query: { categoryId: SCOPE.categoryId } },
  { name: "by product type — unlocks spec facets", query: { productTypeId: SCOPE.productTypeId } },
  { name: "free-text search within scope", query: { categoryId: SCOPE.categoryId, query: "iphone" } },
  { name: "search matching nothing", query: { categoryId: SCOPE.categoryId, query: "zzzzznothing" } },
  { name: "search with a LIKE metacharacter", query: { categoryId: SCOPE.categoryId, query: "100%" } },
  { name: "brand filter", query: { categoryId: SCOPE.categoryId, brandIds: ["brand_apple"] } },
  { name: "two brands — counts must not collapse to the selection", query: { categoryId: SCOPE.categoryId, brandIds: ["brand_apple", "brand_samsung"] } },
  { name: "rating threshold", query: { categoryId: SCOPE.categoryId, ratingId: "r4" } },
  { name: "in-stock only", query: { categoryId: SCOPE.categoryId, inStockOnly: true } },
  { name: "marketplace filter", query: { categoryId: SCOPE.categoryId, marketplaceIds: ["mp_flipkart"] } },
  { name: "price bucket filter", query: { categoryId: SCOPE.categoryId, priceBucketIds: ["p_25000_50000"] } },
  { name: "spec RANGE filter — the selection is a bucket label, not a raw value", query: { productTypeId: SCOPE.productTypeId, specFilters: { storage_gb: ["128 GB"] } } },
  { name: "spec BOOLEAN filter", query: { productTypeId: SCOPE.productTypeId, specFilters: { has_5g: ["true"] } } },
  { name: "spec ENUM filter", query: { productTypeId: SCOPE.productTypeId, specFilters: { refresh_rate_hz: ["120"] } } },
  { name: "brand + rating + in-stock together", query: { categoryId: SCOPE.categoryId, brandIds: ["brand_apple"], ratingId: "r4", inStockOnly: true } },
  { name: "sort price ascending", query: { categoryId: SCOPE.categoryId, sort: "price_asc" } },
  { name: "sort price descending", query: { categoryId: SCOPE.categoryId, sort: "price_desc" } },
  { name: "sort by rating", query: { categoryId: SCOPE.categoryId, sort: "rating" } },
  { name: "sort by review count", query: { categoryId: SCOPE.categoryId, sort: "reviews" } },
  { name: "sort by recency", query: { categoryId: SCOPE.categoryId, sort: "recent" } },
];

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

try {
  const catalogue = await vite.ssrLoadModule("/src/api/catalogueService.js");

  const cases = [];
  for (const c of CASES) {
    const r = await catalogue.getCatalogue(c.query);

    cases.push({
      name: c.name,
      query: c.query,

      /** Order as the engine produced it, plus the set for tie-tolerant comparison. */
      resultIds: r.results.map((s) => s.product.id),
      total: r.total,
      scopeTotal: r.scopeTotal,
      resolvedProductType: r.resolvedProductType ?? null,

      /** Per-row numbers, so a price or rating drift is caught, not just membership. */
      rows: r.results.slice(0, 12).map((s) => ({
        productId: s.product.id,
        minPriceMinor: s.minPriceMinor,
        maxPriceMinor: s.maxPriceMinor,
        rating: s.rating,
        reviewCount: s.reviewCount,
        inStock: s.inStock,
        listingCount: s.listingCount,
        offerCount: s.offerCount,
        marketplaceIds: [...s.marketplaceIds].sort(),
      })),

      facets: {
        brand: r.facets.brand,
        price: r.facets.price,
        rating: r.facets.rating,
        marketplace: r.facets.marketplace,
        availability: r.facets.availability,
        specs: r.facets.specs.map((f) => ({
          key: f.key,
          label: f.label,
          filterType: f.filterType,
          options: f.options,
        })),
      },

      navigation: {
        breadcrumbIds: r.breadcrumb.map((b) => b.id),
        childCategoryIds: r.childCategories.map((c2) => c2.id),
        productTypeIdsInScope: r.productTypesInScope.map((p) => p.id),
      },
    });
  }

  const payload = {
    generatedBy: "scripts/export-catalogue-parity-fixture.mjs",
    note:
      "What the BROWSER catalogue engine answers. server/tests/catalogue-parity.test.ts " +
      "asserts the backend agrees. Ordering ties are compared as sets — see the header " +
      "of the exporter for why.",
    caseCount: cases.length,
    cases,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`wrote ${OUT}`);
  for (const c of cases) {
    console.log(
      `  ${c.name.padEnd(52)} results ${String(c.total).padStart(5)}  scope ${String(c.scopeTotal).padStart(5)}  ` +
        `facets b${c.facets.brand.length}/p${c.facets.price.length}/r${c.facets.rating.length}/m${c.facets.marketplace.length}/s${c.facets.specs.length}`
    );
  }
} finally {
  await vite.close();
}
