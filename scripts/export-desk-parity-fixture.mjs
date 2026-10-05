import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * DEFAULT DESK PARITY FIXTURE
 * ===========================
 *
 * The dashboard's default product set is moving from the bundled dataset to
 * the backend. The browser chose it with `utils/demoSet.js`, which profiled
 * all 1,172 products on reach, capture depth and competitive density and then
 * filled a stratified quota; the backend now does the same from SQL in
 * `modules/dashboard/defaultSet.ts`.
 *
 * "Ported" only means something if the two agree, so this records what the
 * BROWSER chose, and `server/tests/desk-parity.test.ts` asks the backend to
 * choose from the same catalogue and compares.
 *
 * It runs on the frontend side because the engine's modules use Vite-style
 * extensionless imports the backend test runner cannot resolve.
 *
 * WHAT IS COMPARED
 * ----------------
 * The chosen ids IN ORDER, each product's expected evidence tier, and the
 * structural profile the tier is derived from — marketplace reach, cadence
 * and candidate count. The order matters: the selection is deliberately
 * deterministic so the desk does not reshuffle between reloads, and a port
 * that returns the same twelve products in a different order has lost that
 * property.
 *
 * The fixture is checked in. A diff in it is a change to which products the
 * desk opens on, which should never be quiet.
 *
 *   node scripts/export-desk-parity-fixture.mjs
 */

const OUT = resolve(import.meta.dirname, "..", "server", "tests", "fixtures", "desk-parity.json");

const server = await createServer({
  configFile: false,
  root: resolve(import.meta.dirname, ".."),
  logLevel: "error",
  server: { middlewareMode: true },
});

try {
  const demoSet = await server.ssrLoadModule("/src/utils/demoSet.js");

  const chosen = demoSet.selectDemoSet();
  const profiles = demoSet.buildProfiles();

  const fixture = {
    generatedBy: "scripts/export-desk-parity-fixture.mjs",
    note: "What the browser's demoSet chose. The backend must agree.",
    catalogueSize: profiles.length,
    tierCounts: profiles.reduce((acc, p) => {
      acc[p.expectedTier] = (acc[p.expectedTier] ?? 0) + 1;
      return acc;
    }, {}),
    /** In order. The selection is deterministic and the order is part of it. */
    selected: chosen.map((p) => ({
      id: p.id,
      expectedTier: p.expectedTier,
      departmentId: p.departmentId,
      productTypeId: p.productTypeId,
      marketplaceCount: p.marketplaceCount,
      candidateCount: p.candidateCount,
      cadenceDays: p.cadenceDays,
      observationCount: p.observationCount,
      pointsPerOffer: p.pointsPerOffer,
      priceMinor: p.priceMinor,
    })),
    /**
     * A sample of profiles OUTSIDE the chosen set, so the comparison covers
     * the profiling itself rather than only the twelve that survived it. A
     * port could agree on the winners while scoring everything else wrongly.
     */
    profileSample: profiles
      .slice()
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .filter((_, i) => i % 97 === 0)
      .map((p) => ({
        id: p.id,
        expectedTier: p.expectedTier,
        marketplaceCount: p.marketplaceCount,
        candidateCount: p.candidateCount,
        typePopulation: p.typePopulation,
        cadenceDays: p.cadenceDays,
        pointsPerOffer: p.pointsPerOffer,
        priceMinor: p.priceMinor,
        observationCount: p.observationCount,
      })),
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(fixture, null, 2) + "\n", "utf8");

  console.log(`wrote ${OUT}`);
  console.log(`  catalogue profiled: ${fixture.catalogueSize}`);
  console.log(`  tiers: ${JSON.stringify(fixture.tierCounts)}`);
  console.log(`  selected: ${fixture.selected.length}`);
  console.log(`  profile sample: ${fixture.profileSample.length}`);
} finally {
  await server.close();
}
