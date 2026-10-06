import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SRC, codeOf, rel, reachableFrom, shortestPathTo, sourceFiles } from "./helpers/moduleGraph.js";

/**
 * THE FRONTEND NO LONGER OWNS THE DATASET — enforced, not intended.
 *
 * `src/data` holds a complete generated marketplace: 1,172 products, 354,940
 * price observations, every listing, offer, seller and promotion. The
 * application used to read it directly, and every screen's numbers were
 * computed in the browser from it.
 *
 * They now come from the API. The dataset survives on disk for two honest
 * reasons — it is the oracle the parity fixtures are generated from, and it
 * is the source the backend seed is exported from — and that is a useful
 * thing to keep and a dangerous thing to leave reachable. One import from a
 * page restores a second source of truth that would agree with the backend
 * for a while and then drift.
 *
 * The central check is REACHABILITY, not text. A grep for `src/data` in the
 * pages directory would have passed throughout the migration while the
 * dashboard pulled the entire catalogue in through `api/dashboardService` →
 * `utils/demoSet` → `data/products`. Three hops, no page mentioning the
 * dataset, the whole thing in the bundle.
 *
 * What this does NOT ban: the dataset's files existing, the generator scripts
 * reading them, or `src/utils` oracles importing them. Those are not shipped
 * to a browser, and the reachability check is what proves it.
 */

const ENTRY = join(SRC, "main.jsx");

/** A module belonging to the bundled dataset. */
const isDataset = (relative) => relative.startsWith("data/");

/**
 * The layers that are the application. None of them may name the dataset,
 * however indirectly — and, unlike the reachability check, this also catches
 * a component that is not routed yet and so reaches nothing.
 */
const APPLICATION_LAYERS = ["pages/", "components/", "api/", "state/"];

const files = sourceFiles();
const reachable = [...reachableFrom(ENTRY)].map(rel);

describe("the browser does not carry the dataset", () => {
  it("finds the source tree, the entry point, and the dataset it is checking", () => {
    // Every assertion below passes vacuously if the traversal found nothing.
    expect(existsSync(ENTRY)).toBe(true);
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((f) => rel(f) === "data/products.js")).toBe(true);
    expect(reachable.length).toBeGreaterThan(30);
    expect(reachable).toContain("App.jsx");
    expect(reachable).toContain("api/http.js");
  });

  /**
   * THE ONE THAT MATTERS.
   *
   * If this fails it prints the exact import chain, because "the dataset is
   * in the bundle" without the route is a day of bisecting.
   */
  it("nothing reachable from the application entry point imports the dataset", () => {
    const offenders = reachable.filter(isDataset);
    const chain = offenders.length ? shortestPathTo(ENTRY, isDataset) : null;

    expect(
      offenders,
      chain
        ? `the dataset is back in the bundle, via:\n  ${chain.join("\n    -> ")}`
        : "the dataset is reachable from the application"
    ).toEqual([]);
  });

  it("no page, component, service or store imports the dataset directly", () => {
    const violations = [];
    for (const file of files) {
      const relative = rel(file);
      if (!APPLICATION_LAYERS.some((layer) => relative.startsWith(layer))) continue;
      const code = codeOf(file);
      if (/\bfrom\s+["'][^"']*\/data\/[^"']+["']/.test(code)) violations.push(relative);
    }

    expect(
      violations.sort(),
      `these belong to the application and must ask the API instead:\n  ${violations.join("\n  ")}`
    ).toEqual([]);
  });

  /**
   * THE FALLBACK BAN.
   *
   * A service that catches an API failure and serves bundled data instead is
   * the worst outcome available here: the screen looks healthy, the numbers
   * are real-looking, and nothing says the backend is down. An outage must
   * surface as an outage.
   */
  it("no API service can fall back to bundled data, because none can reach it", () => {
    const services = files.filter((f) => rel(f).startsWith("api/"));
    expect(services.length).toBeGreaterThan(5);

    const violations = [];
    for (const service of services) {
      const reachedByService = [...reachableFrom(service)].map(rel).filter(isDataset);
      if (reachedByService.length) violations.push(`${rel(service)} reaches ${reachedByService.join(", ")}`);
    }

    expect(violations, `an API client with a local dataset behind it:\n  ${violations.join("\n  ")}`).toEqual([]);
  });

  it("every API service talks to the backend through the one transport", () => {
    /**
     * `http.js` is where the base URL, the bearer token and the error
     * envelope live. A service that fetched directly would bypass all three,
     * and would be the natural place for a quiet fallback to reappear.
     */
    // The transport itself. `api/client.js` used to be exempt too — it held
    // `mockDelay` and a `request()` superseded by `http.js` — and was deleted
    // in Phase 9 once nothing imported it.
    const exempt = new Set(["api/http.js"]);

    const offenders = [];
    for (const file of files.filter((f) => rel(f).startsWith("api/"))) {
      const relative = rel(file);
      if (exempt.has(relative)) continue;
      const code = codeOf(file);
      const callsApi = /\bapiRequest\s*\(/.test(code);
      const reExportsOnly = !/\bexport\s+(async\s+)?function\b/.test(code);
      if (!callsApi && !reExportsOnly) offenders.push(relative);
    }

    expect(offenders, `these define service functions but never call the API:\n  ${offenders.join("\n  ")}`).toEqual(
      []
    );
  });

  /**
   * THERE IS NO DEFAULT DESK ANY MORE.
   *
   * This assertion has been rewritten twice, each time weakening a claim
   * that turned out to be too generous. First the browser chose twelve
   * products by profiling all 1,172 bundled ones. Then the backend chose
   * them — better, but still a list nobody had asked for. Now the desk is
   * what the signed-in user actually follows, and `api/dashboardService.js`
   * is gone entirely.
   */
  it("the desk is what this user follows, not a default set", () => {
    expect(
      existsSync(join(SRC, "api", "dashboardService.js")),
      "the service that served a default desk should no longer exist"
    ).toBe(false);

    const discovery = codeOf(join(SRC, "api", "discoveryService.js"));
    expect(discovery).toMatch(/apiRequest\(/);
    expect(discovery).toMatch(/\/tracked/);

    const state = codeOf(join(SRC, "state", "AppStateContext.jsx"));
    expect(state, "no default desk may be seeded in the browser").not.toContain("DEFAULT_TRACKED_PRODUCT_IDS");
    expect(state, "and none may be computed there either").not.toContain("demoSet");
    expect(state, "the list comes from the server").toContain("getTracked");

    /**
     * And nowhere ELSE either.
     *
     * A mutation test caught this gap: checking only `AppStateContext` let a
     * hardcoded list reappear in the API client one file away, where it would
     * have been just as wrong and rather harder to notice.
     */
    const violations = [];
    for (const file of files) {
      const relative = rel(file);
      if (!relative.startsWith("api/") && !relative.startsWith("state/")) continue;
      const code = codeOf(file);
      if (/DEFAULT_TRACKED_PRODUCT_IDS/.test(code)) violations.push(`${relative} declares a default desk`);
      // A literal list of product ids is a seeded desk whatever it is called.
      if (/\[\s*["']prod_[^"']*["']\s*(,|\])/.test(code)) violations.push(`${relative} hardcodes product ids`);
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  /**
   * Search must not be able to answer from a local table.
   *
   * The failure this prevents is specific: a catalogue that filters bundled
   * products returns zero for anything it was not seeded with, which is how
   * "iPhone 18" returned nothing while the provider would have answered.
   */
  it("discovery asks the market, and has no local catalogue to fall back to", () => {
    const page = codeOf(join(SRC, "pages", "Catalogue.jsx"));
    expect(page).toContain("searchMarket");
    expect(page, "no bundled product list may be consulted").not.toMatch(/from\s+["'][^"']*\/data\//);

    const discovery = codeOf(join(SRC, "api", "discoveryService.js"));
    expect(discovery).toMatch(/\/search/);
    expect(discovery).not.toMatch(/from\s+["'][^"']*\/data\//);
  });

  it("the provenance screen reads provenance, and has nothing to invent it from", () => {
    const service = codeOf(join(SRC, "api", "dataSourcesService.js"));

    expect(service).toMatch(/apiRequest\(/);
    expect(service).toMatch(/\/sources/);
    expect(service).not.toContain("captureRuns");
    expect(service).not.toContain("rejectedRecords");
  });
});
