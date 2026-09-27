import { createServer } from "vite";
import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * MIGRATION TOOL — export the in-memory dataset to NDJSON for the backend seed.
 *
 * The dataset is not a file. It is the OUTPUT OF A PROGRAM: ~1,100 hand-written
 * seed rows expanded by a seeded PRNG at module load into ~390,000 rows. It has
 * to be materialised before it can be loaded into PostgreSQL.
 *
 * Those generator modules use Vite-style extensionless imports, which plain
 * Node cannot resolve — so this boots Vite in middleware mode and uses its own
 * resolver via `ssrLoadModule`. That is the entire reason this script exists
 * rather than the seed importing the modules directly.
 *
 * Keeping export and seed as two steps means the server has no build-time
 * dependency on the frontend source tree, and each half can be run and
 * inspected on its own.
 *
 * THIS FILE HAS A FINITE LIFE. Once the database is the source of truth, the
 * generators and this exporter are deleted together — they are not maintained
 * alongside the schema.
 *
 *   node scripts/export-dataset.mjs [--out ../server/seed-data]
 */

const argOut = process.argv.indexOf("--out");
const OUT_DIR = resolve(argOut > -1 ? process.argv[argOut + 1] : "server/seed-data");

/** One NDJSON line per row — streamed, because one table has 354,940 of them. */
async function writeNdjson(name, rows) {
  const file = join(OUT_DIR, `${name}.ndjson`);
  const stream = createWriteStream(file, { encoding: "utf8" });
  let n = 0;
  for (const row of rows) {
    if (!stream.write(`${JSON.stringify(row)}\n`)) {
      await new Promise((r) => stream.once("drain", r));
    }
    n++;
  }
  await new Promise((r) => stream.end(r));
  return n;
}

async function main() {
  console.log("· booting Vite to resolve the data modules");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
  });

  try {
    const load = (p) => vite.ssrLoadModule(p);
    const [
      categoriesMod,
      brandsMod,
      attrMod,
      productsMod,
      marketplacesMod,
      listingsMod,
      sellersMod,
      offersMod,
      observationsMod,
      reviewsMod,
      promotionsMod,
      feeRulesMod,
      sellerInputsMod,
      dataSourcesMod,
    ] = await Promise.all([
      load("/src/data/categories.js"),
      load("/src/data/brands.js"),
      load("/src/data/attributeDefinitions.js"),
      load("/src/data/products.js"),
      load("/src/data/marketplaces.js"),
      load("/src/data/listings.js"),
      load("/src/data/sellers.js"),
      load("/src/data/offers.js"),
      load("/src/data/priceObservations.js"),
      load("/src/data/reviewSnapshots.js"),
      load("/src/data/promotions.js"),
      load("/src/data/feeRules.js"),
      load("/src/data/sellerInputs.js"),
      load("/src/data/dataSources.js"),
    ]);

    await rm(OUT_DIR, { recursive: true, force: true });
    await mkdir(OUT_DIR, { recursive: true });

    /**
     * `availabilityClass` is derived in the frontend by `classOf(promotionType)`
     * and decides whether a discount may move the comparison price. It is
     * resolved here and stored as a real column, so the rule is enforced by the
     * schema rather than by whichever consumer remembers to apply it.
     */
    const { classOf } = promotionsMod;
    const promotions = promotionsMod.promotions.map((p) => ({
      ...p,
      availabilityClass: classOf(p.promotionType),
    }));

    // Load order is FK order — the seed replays it exactly.
    const tables = [
      ["categories", categoriesMod.categories],
      ["product_types", categoriesMod.productTypes],
      ["brands", brandsMod.brands],
      ["attribute_definitions", attrMod.attributeDefinitions],
      ["products", productsMod.products],
      ["marketplaces", marketplacesMod.marketplaces],
      ["marketplace_categories", categoriesMod.marketplaceCategories],
      ["listings", listingsMod.listings],
      ["sellers", sellersMod.sellers],
      ["seller_rating_snapshots", sellersMod.sellerRatingSnapshots],
      ["offers", offersMod.offers],
      ["price_observations", observationsMod.priceObservations],
      ["review_snapshots", reviewsMod.reviewSnapshots],
      ["promotions", promotions],
      ["fee_rules", feeRulesMod.feeRules],
      ["seller_cost_inputs", sellerInputsMod.sellerCostInputs],
      ["capture_runs", dataSourcesMod.captureRuns],
      ["raw_documents", dataSourcesMod.rawDocuments],
      ["rejected_records", dataSourcesMod.rejectedRecords],
      ["field_coverage", dataSourcesMod.fieldCoverage],
    ];

    const manifest = { exportedAt: new Date().toISOString(), order: [], counts: {} };

    for (const [name, rows] of tables) {
      if (!Array.isArray(rows)) throw new Error(`${name}: expected an array, got ${typeof rows}`);
      const n = await writeNdjson(name, rows);
      manifest.order.push(name);
      manifest.counts[name] = n;
      console.log(`  ✓ ${name.padEnd(26)} ${n.toLocaleString("en-IN").padStart(9)}`);
    }

    await writeFile(join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    const total = Object.values(manifest.counts).reduce((a, b) => a + b, 0);
    console.log(`\n· ${total.toLocaleString("en-IN")} rows across ${manifest.order.length} tables → ${OUT_DIR}`);
  } finally {
    await vite.close();
  }
}

main().catch((err) => {
  console.error("\nExport failed:\n", err);
  process.exit(1);
});
