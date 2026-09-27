import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { env } from "../config/env.js";
import { createDb, type Db } from "../db/client.js";
import * as t from "../db/schema.js";

/**
 * Loads the exported NDJSON into PostgreSQL, in foreign-key order.
 *
 * Two rules shape this file:
 *
 * 1. **Explicit transforms, no magic mapping.** Every table declares how its
 *    JSON row becomes a database row. A generic camelCase-to-snake_case
 *    reflector would look shorter and would quietly drop or mistype a field
 *    the day the shapes diverge — on a 390,000-row load that is exactly the
 *    silent relationship loss the migration is supposed to prevent.
 *
 * 2. **Streamed and batched.** One table has 354,940 rows; reading it into an
 *    array first is avoidable memory pressure, so rows are read line by line
 *    and flushed in batches.
 */

const SEED_DIR = resolve(env.SEED_DATA_DIR);
const BATCH = env.SEED_BATCH_SIZE;

type Row = Record<string, any>;

/** ISO string → Date for timestamptz columns; null stays null. */
const ts = (v: unknown) => (v == null ? null : new Date(String(v)));

/**
 * Table load order is foreign-key order. Each entry names the Drizzle table
 * and the transform from an exported row to an insertable one.
 */
const LOADERS: Array<{ file: string; table: any; map: (r: Row) => Row }> = [
  {
    file: "categories",
    table: t.categories,
    map: (r) => ({ id: r.id, parentId: r.parentId ?? null, level: r.level, name: r.name, path: r.path }),
  },
  {
    file: "product_types",
    table: t.productTypes,
    map: (r) => ({ id: r.id, categoryId: r.categoryId, name: r.name, schemaVersion: r.schemaVersion }),
  },
  {
    file: "brands",
    table: t.brands,
    map: (r) => ({
      id: r.id,
      name: r.name,
      tier: r.tier,
      parentCompany: r.parentCompany ?? null,
      aliasNames: r.aliasNames ?? [],
    }),
  },
  {
    file: "attribute_definitions",
    table: t.attributeDefinitions,
    map: (r) => ({
      id: r.id,
      productTypeId: r.productTypeId,
      schemaVersion: r.schemaVersion,
      attributeKey: r.attributeKey,
      displayName: r.displayName,
      dataType: r.dataType,
      unit: r.unit ?? null,
      isRequired: r.isRequired ?? false,
      isPricingRelevant: r.isPricingRelevant ?? false,
      isFilterable: r.isFilterable ?? false,
      filterType: r.filterType ?? null,
      buckets: r.buckets ?? null,
      higherIsBetter: r.higherIsBetter ?? null,
    }),
  },
  {
    file: "products",
    table: t.products,
    map: (r) => ({
      id: r.id,
      parentProductId: r.parentProductId ?? null,
      isPurchasable: r.isPurchasable ?? true,
      brandId: r.brandId,
      categoryId: r.categoryId,
      productTypeId: r.productTypeId,
      canonicalName: r.canonicalName,
      modelName: r.modelName,
      variantAxes: r.variantAxes ?? null,
      specSchemaVersion: r.specSchemaVersion,
      specifications: r.specifications ?? {},
      identifiers: r.identifiers ?? null,
      lifecycleStatus: r.lifecycleStatus ?? "active",
      firstSeenAt: r.firstSeenAt ?? null,
    }),
  },
  {
    file: "marketplaces",
    table: t.marketplaces,
    map: (r) => ({
      id: r.id,
      name: r.name,
      countryCode: r.countryCode,
      defaultCurrency: r.defaultCurrency,
      websiteDomain: r.websiteDomain,
      isActive: r.isActive ?? true,
      brandColor: r.brandColor ?? null,
      marketplaceType: r.marketplaceType,
      categoryAffinity: r.categoryAffinity ?? [],
    }),
  },
  {
    file: "marketplace_categories",
    table: t.marketplaceCategories,
    map: (r) => ({
      id: r.id,
      marketplaceId: r.marketplaceId,
      externalNodeId: r.externalNodeId,
      rawPath: r.rawPath,
      mappedCategoryId: r.mappedCategoryId ?? null,
      mappingConfidence: r.mappingConfidence ?? null,
      mappedBy: r.mappedBy ?? null,
    }),
  },
  {
    file: "listings",
    table: t.listings,
    map: (r) => ({
      id: r.id,
      productId: r.productId,
      marketplaceId: r.marketplaceId,
      externalListingId: r.externalListingId,
      listingUrl: r.listingUrl ?? null,
      marketplaceCategoryId: r.marketplaceCategoryId ?? null,
      rawTitle: r.rawTitle ?? null,
      marketplaceBrandText: r.marketplaceBrandText ?? null,
      matchStatus: r.matchStatus,
      matchConfidence: r.matchConfidence ?? null,
      listingStatus: r.listingStatus ?? "active",
      firstSeenAt: r.firstSeenAt ?? null,
      lastSeenAt: r.lastSeenAt ?? null,
    }),
  },
  {
    file: "sellers",
    table: t.sellers,
    map: (r) => ({
      id: r.id,
      marketplaceId: r.marketplaceId,
      externalSellerId: r.externalSellerId,
      name: r.name,
      sellerType: r.sellerType,
      defaultFulfilmentType: r.defaultFulfilmentType,
      sellerGroupId: r.sellerGroupId ?? null,
      sellerTier: r.sellerTier ?? null,
      maxOffers: r.maxOffers ?? null,
      onboardedAt: r.onboardedAt ?? null,
    }),
  },
  {
    file: "seller_rating_snapshots",
    table: t.sellerRatingSnapshots,
    map: (r) => ({
      id: r.id,
      sellerId: r.sellerId,
      capturedAt: r.capturedAt,
      rating: r.rating ?? null,
      ratingCount: r.ratingCount ?? null,
    }),
  },
  {
    file: "offers",
    table: t.offers,
    map: (r) => ({
      id: r.id,
      listingId: r.listingId,
      sellerId: r.sellerId,
      itemCondition: r.itemCondition ?? "new",
      offerStatus: r.offerStatus ?? "active",
      firstSeenAt: r.firstSeenAt ?? null,
    }),
  },
  {
    file: "price_observations",
    table: t.priceObservations,
    map: (r) => ({
      id: r.id,
      offerId: r.offerId,
      observedAt: r.observedAt,
      recordedAt: ts(r.recordedAt),
      mrpMinor: r.mrpMinor ?? null,
      sellingPriceMinor: r.sellingPriceMinor,
      shippingFeeMinor: r.shippingFeeMinor ?? 0,
      currencyCode: r.currencyCode ?? "INR",
      isInStock: r.isInStock,
      isBuyboxWinner: r.isBuyboxWinner ?? false,
      saleLabel: r.saleLabel ?? null,
      // Soft pointer, not a foreign key — see the schema note.
      rawDocumentId: r.rawDocumentId ?? null,
      parserVersion: r.parserVersion ?? null,
    }),
  },
  {
    file: "review_snapshots",
    table: t.reviewSnapshots,
    map: (r) => ({
      id: r.id,
      listingId: r.listingId,
      capturedAt: r.capturedAt,
      averageRating: r.averageRating ?? null,
      ratingCount: r.ratingCount ?? null,
      reviewCount: r.reviewCount ?? null,
      ratingDistribution: r.ratingDistribution ?? null,
    }),
  },
  {
    file: "promotions",
    table: t.promotions,
    map: (r) => ({
      id: r.id,
      offerId: r.offerId,
      promotionType: r.promotionType,
      availabilityClass: r.availabilityClass,
      label: r.label,
      terms: r.terms ?? null,
      eligibility: r.eligibility ?? null,
      discountValueMinor: r.discountValueMinor ?? 0,
      validFrom: r.validFrom ?? null,
      validTo: r.validTo ?? null,
    }),
  },
  {
    file: "fee_rules",
    table: t.feeRules,
    map: (r) => ({
      id: r.id,
      marketplaceId: r.marketplaceId,
      categoryId: r.categoryId ?? null,
      priceSlabMin: r.priceSlabMin ?? null,
      priceSlabMax: r.priceSlabMax ?? null,
      referralPct: r.referralPct,
      fixedClosingFee: r.fixedClosingFee ?? 0,
      shippingFeeBasis: r.shippingFeeBasis ?? null,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo ?? null,
      isCurrent: r.isCurrent ?? true,
    }),
  },
  {
    file: "seller_cost_inputs",
    table: t.sellerCostInputs,
    // No user exists yet, so cost is loaded unattributed. The column is
    // nullable precisely so these three rows survive until Phase 3.
    map: (r) => ({
      userId: null,
      productId: r.productId,
      costPriceMinor: r.costPriceMinor,
      enteredAt: r.enteredAt,
      note: r.note ?? null,
    }),
  },
  {
    file: "capture_runs",
    table: t.captureRuns,
    map: (r) => ({
      id: r.id,
      marketplaceId: r.marketplaceId,
      startedAt: ts(r.startedAt),
      finishedAt: ts(r.finishedAt),
      runStatus: r.runStatus,
      parserVersion: r.parserVersion ?? null,
      pagesAttempted: r.pagesAttempted ?? null,
      pagesSucceeded: r.pagesSucceeded ?? null,
      notes: r.notes ?? null,
    }),
  },
  {
    file: "raw_documents",
    table: t.rawDocuments,
    map: (r) => ({
      id: r.id,
      captureRunId: r.captureRunId ?? null,
      sourceUrl: r.sourceUrl,
      httpStatus: r.httpStatus ?? null,
      fetchedAt: ts(r.fetchedAt),
      contentHash: r.contentHash ?? null,
      storagePath: r.storagePath ?? null,
    }),
  },
  {
    file: "rejected_records",
    table: t.rejectedRecords,
    map: (r) => ({
      id: r.id,
      rawDocumentId: r.rawDocumentId ?? null,
      targetEntity: r.targetEntity,
      rejectionReason: r.rejectionReason,
      capturedAt: ts(r.capturedAt),
    }),
  },
  {
    file: "field_coverage",
    table: t.fieldCoverage,
    map: (r) => ({ marketplaceId: r.marketplaceId, field: r.field, coveragePct: r.coveragePct }),
  },
];

async function loadTable(db: Db, loader: (typeof LOADERS)[number]) {
  const path = join(SEED_DIR, `${loader.file}.ndjson`);
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });

  let batch: Row[] = [];
  let inserted = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    await db.insert(loader.table).values(batch);
    inserted += batch.length;
    batch = [];
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    batch.push(loader.map(JSON.parse(line)));
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  return inserted;
}

async function main() {
  const manifestRaw = await readFile(join(SEED_DIR, "manifest.json"), "utf8").catch(() => null);
  if (!manifestRaw) {
    throw new Error(
      `No manifest at ${SEED_DIR}. Run \`node scripts/export-dataset.mjs\` from the repository root first.`
    );
  }
  const manifest = JSON.parse(manifestRaw) as { counts: Record<string, number>; exportedAt: string };

  const conn = await createDb();
  console.log(`· driver ${conn.driver}, batch ${BATCH}, export from ${manifest.exportedAt}`);

  const started = Date.now();
  const mismatches: string[] = [];

  try {
    /**
     * A seed is a load, not an append: running it twice must produce the same
     * database, not a primary-key collision. One TRUNCATE ... CASCADE over
     * every seeded table is both faster than per-table DELETE and immune to
     * foreign-key ordering.
     *
     * `users` and `tracked_products` are excluded — they hold real account
     * data once Phase 3 exists, and a data reload must not sign everybody out.
     */
    const seeded = LOADERS.map((l) => `"${l.file}"`).join(", ");
    console.log("· truncating seeded tables");
    await conn.exec(`truncate table ${seeded} restart identity cascade;`);

    for (const loader of LOADERS) {
      const t0 = Date.now();
      const inserted = await loadTable(conn.db, loader);
      const expected = manifest.counts[loader.file];
      const ok = expected === undefined || expected === inserted;
      if (!ok) mismatches.push(`${loader.file}: exported ${expected}, inserted ${inserted}`);
      console.log(
        `  ${ok ? "✓" : "✗"} ${loader.file.padEnd(26)} ${inserted.toLocaleString("en-IN").padStart(9)}  ${((Date.now() - t0) / 1000).toFixed(1)}s`
      );
    }
  } finally {
    await conn.close();
  }

  console.log(`\n· finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (mismatches.length) {
    console.error(`\nRow-count mismatches:\n${mismatches.map((m) => `  - ${m}`).join("\n")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nSeed failed:\n", err);
  process.exit(1);
});
