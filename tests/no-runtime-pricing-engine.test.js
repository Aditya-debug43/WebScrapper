import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

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

const SRC = resolve(__dirname, "..", "src");

/** Modules that decide a price or build the set a price is argued from. */
const PRICING_MODULES = ["pricingEngine", "hedonicModel", "competitiveSet", "crossMarketplaceAnalysis"];

/** Comments quote these names legitimately; only real code counts. */
function codeOf(file) {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.(jsx?|tsx?)$/.test(entry)) found.push(full);
  }
  return found;
}

/** Relative-path imports from one file, resolved to real files on disk. */
function localImports(file) {
  const code = codeOf(file);
  const specifiers = [];
  for (const pattern of [/\bfrom\s+["'](\.[^"']+)["']/g, /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g]) {
    let match;
    while ((match = pattern.exec(code)) !== null) specifiers.push(match[1]);
  }

  const resolved = [];
  for (const specifier of specifiers) {
    const base = resolve(dirname(file), specifier);
    const candidate = [base, `${base}.js`, `${base}.jsx`, join(base, "index.js"), join(base, "index.jsx")].find(
      (p) => existsSync(p) && statSync(p).isFile()
    );
    if (candidate) resolved.push(candidate);
  }
  return resolved;
}

const files = sourceFiles(SRC);
const RECOMMENDATION_PAGE = join(SRC, "pages", "PricingRecommendation.jsx");
const ANALYSIS_PAGE = join(SRC, "pages", "CrossMarketplaceAnalysis.jsx");

/** Everything the recommendation page pulls in, transitively. */
function reachableFrom(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of localImports(file)) if (!seen.has(next)) queue.push(next);
  }
  return seen;
}

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

    // The walk really does reach the page's own parts.
    expect(reachable).toContain("api/analysisService.js");
    expect(reachable).toContain("utils/analysisPresenter.js");
    expect(reachable).toContain("utils/storeSignals.js");
    expect(reachable).toContain("api/http.js");

    const offenders = reachable.filter((rel) => PRICING_MODULES.some((m) => rel === `utils/${m}.js`));
    expect(offenders, `the analysis page reaches a pricing module: ${offenders.join(", ")}`).toEqual([]);
  });

  it("neither page reaches the engine through the observation windows", () => {
    /**
     * The subtle route, and the one a text search would miss:
     * `observationWindows` imported the engine for its statistics, so any
     * screen that merely named a horizon pulled the pricing engine in behind
     * it. The vocabulary and the statistics are separate modules now.
     */
    const vocabulary = codeOf(join(SRC, "utils", "observationWindows.js"));
    expect(vocabulary).not.toContain('from "./pricingEngine"');

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
    expect(reachable).toContain("api/recommendationService.js");
    expect(reachable).toContain("utils/recommendationPresenter.js");
    expect(reachable).toContain("components/recommendation/RecommendationPanel.jsx");
    expect(reachable).toContain("api/http.js");

    const offenders = reachable.filter((rel) => PRICING_MODULES.some((m) => rel === `utils/${m}.js`));
    expect(
      offenders,
      `the recommendation page reaches a pricing module:\n  ${offenders.join("\n  ")}`
    ).toEqual([]);
  });

  it("the service reaches the backend, and the page asks the service", () => {
    const page = codeOf(RECOMMENDATION_PAGE);
    const service = codeOf(join(SRC, "api", "recommendationService.js"));

    expect(page).toMatch(/getRecommendation\(/);
    expect(service).toMatch(/apiRequest\(/);
    expect(service).toMatch(/\/recommendation/);
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
