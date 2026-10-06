import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { SRC, codeOf, reachableFrom, sourceFiles } from "./helpers/moduleGraph.js";

/**
 * THE BROWSER NO LONGER DECIDES A PRICE — enforced, not intended.
 *
 * Phase 7 made the backend the source of truth for the recommendation. The
 * browser engine survives as the oracle the backend is measured against, and
 * that is a useful thing to keep and a dangerous thing to leave reachable: one
 * import from a component would quietly restore a second pricing
 * implementation, which would agree with the backend for a while and then
 * drift — exactly as the product-strength weights drifted unnoticed between
 * Phases 5 and 7.
 *
 * Two checks, deliberately narrow enough to be true and broad enough to matter:
 *
 *   1. Nothing in the application imports `buildRecommendation`. That function
 *      IS the pricing decision.
 *   2. Nothing REACHABLE from the recommendation page imports any pricing
 *      module, however indirectly.
 *
 * It is not a ban on the engine's file existing, and not a ban on other screens
 * using its helpers. `getCurrentEffectivePrice` and `PRICE_BASIS` are shared
 * vocabulary about one captured observation and decide nothing; the
 * cross-marketplace analysis is still client-side because migrating it is a
 * later phase's work, not this one's.
 */

/** Modules that decide a price or build the set a price is argued from. */
const PRICING_MODULES = ["pricingEngine", "hedonicModel", "competitiveSet", "crossMarketplaceAnalysis"];

const files = sourceFiles(SRC);
const RECOMMENDATION_PAGE = join(SRC, "pages", "PricingRecommendation.jsx");
const ANALYSIS_PAGE = join(SRC, "pages", "CrossMarketplaceAnalysis.jsx");

describe("the browser does not decide a price", () => {
  it("finds the source tree and the entry point it is checking", () => {
    // A traversal bug would make every assertion below pass vacuously.
    expect(files.length).toBeGreaterThan(40);
    expect(existsSync(RECOMMENDATION_PAGE)).toBe(true);
    expect(files.some((f) => f.endsWith(join("utils", "pricingEngine.js")))).toBe(true);
  });

  it("nothing reachable from the ANALYSIS page imports a pricing module", () => {
    /**
     * Phase 8's acceptance criterion. The analysis screen used to run the
     * whole engine — `buildCrossMarketplaceAnalysis` calls
     * `buildRecommendation` — and reached it a second way through the
     * observation-window statistics. Both routes are gone: the analysis comes
     * from the API, and the window vocabulary was split from the window
     * statistics so naming a horizon no longer drags the engine in.
     */
    const reachable = [...reachableFrom(ANALYSIS_PAGE)].map((f) => relative(SRC, f).replace(/\\/g, "/"));

    /**
     * The walk really does reach the page's own parts.
     *
     * `utils/storeSignals.js` used to be named here. It no longer is because
     * the page no longer reaches it: the non-price parameters are computed by
     * the backend and arrive inside the analysis response, so the browser holds
     * no second copy of those thresholds. The window DEFINITIONS took its place
     * in this list — they are the page's own, and pure.
     */
    expect(reachable).toContain("api/analysisService.js");
    expect(reachable).toContain("utils/analysisPresenter.js");
    expect(reachable).toContain("utils/observationWindowDefs.js");
    expect(reachable).toContain("api/marketplacesService.js");
    expect(reachable).toContain("api/http.js");

    const offenders = reachable.filter((rel) => PRICING_MODULES.some((m) => rel === `utils/${m}.js`));
    expect(offenders, `the analysis page reaches a pricing module: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the route through the observation windows is gone, not merely unused", () => {
    /**
     * The subtle route, and the one a text search would have missed:
     * `observationWindows` imported the engine for its statistics, so any
     * screen that merely named a horizon pulled the pricing engine in behind
     * it.
     *
     * Phase 9 closed it permanently. The vocabulary was split into
     * `observationWindowDefs.js`, which is pure, and the two dataset-reading
     * halves — `observationWindows.js` and `observationWindowStats.js` —
     * were deleted once the backend owned the statistics. The assertion is
     * now about ABSENCE rather than about their contents, which is a
     * stronger claim than the one it replaces.
     */
    expect(existsSync(join(SRC, "utils", "observationWindows.js"))).toBe(false);
    expect(existsSync(join(SRC, "utils", "observationWindowStats.js"))).toBe(false);

    const definitions = codeOf(join(SRC, "utils", "observationWindowDefs.js"));
    expect(definitions, "the surviving vocabulary must stay pure").not.toMatch(/from\s+["']\.[^"']*\/data\//);
    expect(definitions).not.toContain("pricingEngine");

    for (const entry of [RECOMMENDATION_PAGE, ANALYSIS_PAGE]) {
      const reachable = [...reachableFrom(entry)].map((f) => relative(SRC, f).replace(/\\/g, "/"));
      expect(reachable, `${relative(SRC, entry)} reaches the window statistics`).not.toContain(
        "utils/observationWindowStats.js"
      );
    }
  });

  it("only the one known caller still invokes buildRecommendation", () => {
    /**
     * `buildRecommendation` IS the pricing decision, and after Phase 7 exactly
     * one module still calls it: the cross-marketplace analysis, which builds
     * its findings on top of a recommendation and still runs in the browser.
     *
     * That is the Phase 5 SCREEN migration, not this phase's: the backend
     * already serves `/products/:id/analysis` with 115 parity assertions
     * behind it, and the page has simply not been repointed yet. It is listed
     * here rather than waved through, so the count can go down and never up —
     * a second caller appearing fails this test.
     */
    const ALLOWED = ["utils/crossMarketplaceAnalysis.js", "utils/pricingEngine.js"];
    // Phase 8 note: `crossMarketplaceAnalysis` is no longer reachable from any
    // page. It survives as the analysis oracle the backend is measured
    // against, exactly as `pricingEngine` does for the recommendation.
    const callers = files
      .filter((f) => /\bbuildRecommendation\b/.test(codeOf(f)))
      .map((f) => relative(SRC, f).replace(/\\/g, "/"))
      .sort();

    expect(callers, `a new module is pricing in the browser:\n  ${callers.join("\n  ")}`).toEqual(ALLOWED);
  });

  it("nothing reachable from the recommendation page imports a pricing module", () => {
    const reachable = [...reachableFrom(RECOMMENDATION_PAGE)].map((f) => relative(SRC, f).replace(/\\/g, "/"));

    // The page really does reach its own parts, or the walk found nothing.
    // Phase 10: the page asks `discoveryService` for a market-evidence price.
    // `recommendationService` served the catalogue-comparable engine and is
    // no longer on this path.
    expect(reachable).toContain("api/discoveryService.js");
    expect(reachable).toContain("api/http.js");
    expect(reachable).toContain("utils/money.js");

    const offenders = reachable.filter((rel) => PRICING_MODULES.some((m) => rel === `utils/${m}.js`));
    expect(
      offenders,
      `the recommendation page reaches a pricing module:\n  ${offenders.join("\n  ")}`
    ).toEqual([]);
  });

  it("the service reaches the backend, and the page asks the service", () => {
    const page = codeOf(RECOMMENDATION_PAGE);
    const service = codeOf(join(SRC, "api", "discoveryService.js"));

    expect(page).toMatch(/getMarketRecommendation\(/);
    expect(service).toMatch(/apiRequest\(/);
    expect(service).toMatch(/market-recommendation/);
    // The price is argued from real market evidence, so the page must not
    // reach for a bundled dataset to fill any gap in it.
    expect(page).not.toMatch(/from\s+["'][^"']*\/data\//);
  });

  it("the presenter formats and does not calculate", () => {
    /**
     * The presenter turns the API's figures into sentences, which makes it the
     * one place a derivation could hide comfortably. These are the operations
     * that would mean it had started deciding something rather than describing
     * it — and it may read the policy the backend sends, but never keep its own
     * copy of one.
     */
    const presenter = codeOf(join(SRC, "utils", "recommendationPresenter.js"));
    for (const banned of ["buildRecommendation", "fitHedonicModel", "computeBreakEvenPriceMinor", "snapWithin"]) {
      expect(presenter, `the presenter must not use ${banned}`).not.toContain(banned);
    }
    expect(presenter).not.toMatch(/\bCOMPETITOR_POLICY\b|\bPRICING_POLICY\b/);
  });
});
