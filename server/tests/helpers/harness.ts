import { readFile, readdir } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { buildApp, type BuiltApp } from "../../src/app.js";
import { MemoryEmailAdapter, type EmailAdapter } from "../../src/email/index.js";
import { schema } from "../../src/db/schema.js";
import * as t from "../../src/db/schema.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "..", "drizzle");
const SEED_DIR = join(HERE, "..", "..", "seed-data");

/**
 * Every test run gets its own PostgreSQL.
 *
 * `new PGlite()` with no path is a real PostgreSQL 17 engine held entirely in
 * memory — so tests are isolated from each other and from the development
 * database by construction, not by remembering to clean up. Nothing a test
 * writes can reach real data, which is what makes the destructive
 * authentication tests safe to run.
 */
export type Harness = BuiltApp & { email: MemoryEmailAdapter };

export type SeedOptions = {
  /** Phase 3's read APIs: taxonomy, products, marketplaces, listings. */
  seedCatalogue?: boolean;
  /**
   * Phase 4's read APIs: the FULL entity graph for these products — every
   * seller, offer, price observation, review snapshot, seller rating and
   * promotion attached to them.
   */
  marketplaceProducts?: string[];
  /**
   * Phase 5: also pull in every product sharing a product type with those,
   * because the analysis engine's competitor candidates are exactly those
   * peers. Without them a competitive set would be empty and every parity
   * assertion would pass for the wrong reason.
   */
  includeProductTypePeers?: boolean;
};

export async function createTestApp(opts: SeedOptions = {}): Promise<Harness> {
  const email = new MemoryEmailAdapter();
  const built = await bootstrap(email, opts);
  return { ...built, email };
}

/**
 * An application holding the complete entity graph for a few products.
 *
 * Scoped to named products rather than loading everything, because the
 * observation file alone is 134 MB and 354,940 rows. Every Phase 4 endpoint
 * is product-scoped, so a product-scoped fixture exercises each of them
 * while a test run stays in seconds.
 *
 * Nothing is filtered WITHIN the graph: for the products it covers this is
 * the complete, unmodified dataset, which is what lets a test assert an
 * exact count rather than merely a shape.
 */
export async function createMarketplaceTestApp(productIds: string[]): Promise<Harness> {
  const email = new MemoryEmailAdapter();
  const built = await bootstrap(email, { marketplaceProducts: productIds });
  return { ...built, email };
}

/**
 * The same graph, expanded to every product sharing a product type with the
 * ones named.
 *
 * The analysis engine's competitor candidates are exactly the other products
 * of the same type, so a fixture holding only the target would find no
 * competitors and every parity assertion would pass vacuously. The expansion
 * is bounded — the largest product type in this dataset holds 29 products.
 */
export async function createAnalysisTestApp(productIds: string[]): Promise<Harness> {
  const email = new MemoryEmailAdapter();
  const built = await bootstrap(email, { marketplaceProducts: productIds, includeProductTypePeers: true });
  return { ...built, email };
}

/**
 * The same application, wired to a specific email adapter.
 *
 * Exists so a test can drive a transport that FAILS. Delivery could not fail
 * before SMTP — memory and console always succeed — so the failure path had
 * no way to be exercised through the real HTTP surface until now.
 */
export async function createTestAppWith(email: EmailAdapter, opts: SeedOptions = {}): Promise<BuiltApp> {
  return bootstrap(email, opts);
}

async function bootstrap(email: EmailAdapter, opts: SeedOptions): Promise<BuiltApp> {
  const client = new PGlite();
  await client.waitReady;
  const db = drizzle(client, { schema });

  // The same .sql files that run in production, applied the same way.
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
      await client.exec(statement);
    }
  }

  if (opts.seedCatalogue) await seedCatalogue(db);
  if (opts.marketplaceProducts?.length) {
    await seedMarketplaceGraph(db, opts.marketplaceProducts, opts.includeProductTypePeers ?? false);
  }

  return buildApp({ db, email, closeDb: async () => client.close() });
}

/**
 * Loads the catalogue tables the Phase 3 read APIs actually serve.
 *
 * Price observations, reviews and promotions are skipped on purpose: they are
 * 370,000 of the 390,000 rows, no Phase 3 endpoint reads them, and paying 55
 * seconds per test run for data nothing under test touches would make the
 * suite something people avoid running.
 */
function requireDataset() {
  if (!existsSync(join(SEED_DIR, "manifest.json"))) {
    throw new Error(
      `No dataset at ${SEED_DIR}.\n` +
        `Run this once from the repository root:\n\n    node scripts/export-dataset.mjs\n`
    );
  }
}

/** Column maps, one per table, shared by both seeders. */
const MAP = {
  categories: (r: any) => ({ id: r.id, parentId: r.parentId ?? null, level: r.level, name: r.name, path: r.path }),
  productTypes: (r: any) => ({ id: r.id, categoryId: r.categoryId, name: r.name, schemaVersion: r.schemaVersion }),
  brands: (r: any) => ({
    id: r.id, name: r.name, tier: r.tier, parentCompany: r.parentCompany ?? null, aliasNames: r.aliasNames ?? [],
  }),
  products: (r: any) => ({
    id: r.id, parentProductId: r.parentProductId ?? null, isPurchasable: r.isPurchasable ?? true,
    brandId: r.brandId, categoryId: r.categoryId, productTypeId: r.productTypeId,
    canonicalName: r.canonicalName, modelName: r.modelName, variantAxes: r.variantAxes ?? null,
    specSchemaVersion: r.specSchemaVersion ?? null, specifications: r.specifications ?? {},
    identifiers: r.identifiers ?? null, lifecycleStatus: r.lifecycleStatus ?? "active",
    firstSeenAt: r.firstSeenAt ?? null,
  }),
  marketplaces: (r: any) => ({
    id: r.id, name: r.name, countryCode: r.countryCode, defaultCurrency: r.defaultCurrency,
    websiteDomain: r.websiteDomain, isActive: r.isActive ?? true, brandColor: r.brandColor ?? null,
    marketplaceType: r.marketplaceType, categoryAffinity: r.categoryAffinity ?? [],
  }),
  marketplaceCategories: (r: any) => ({
    id: r.id, marketplaceId: r.marketplaceId, externalNodeId: r.externalNodeId, rawPath: r.rawPath,
    mappedCategoryId: r.mappedCategoryId ?? null, mappingConfidence: r.mappingConfidence ?? null,
    mappedBy: r.mappedBy ?? null,
  }),
  attributeDefinitions: (r: any) => ({
    id: r.id, productTypeId: r.productTypeId, schemaVersion: r.schemaVersion,
    attributeKey: r.attributeKey, displayName: r.displayName, dataType: r.dataType, unit: r.unit ?? null,
    isRequired: r.isRequired ?? false, isPricingRelevant: r.isPricingRelevant ?? false,
    isFilterable: r.isFilterable ?? false, filterType: r.filterType ?? null,
    buckets: r.buckets ?? null, higherIsBetter: r.higherIsBetter ?? null,
  }),
  feeRules: (r: any) => ({
    id: r.id, marketplaceId: r.marketplaceId, categoryId: r.categoryId ?? null,
    priceSlabMin: r.priceSlabMin ?? null, priceSlabMax: r.priceSlabMax ?? null,
    referralPct: r.referralPct, fixedClosingFee: r.fixedClosingFee ?? 0,
    shippingFeeBasis: r.shippingFeeBasis ?? null, effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo ?? null, isCurrent: r.isCurrent ?? true,
  }),
  sellerCostInputs: (r: any) => ({
    productId: r.productId, costPriceMinor: r.costPriceMinor,
    enteredAt: r.enteredAt, note: r.note ?? null,
  }),
  listings: (r: any) => ({
    id: r.id, productId: r.productId, marketplaceId: r.marketplaceId,
    externalListingId: r.externalListingId, listingUrl: r.listingUrl ?? null,
    marketplaceCategoryId: r.marketplaceCategoryId ?? null, rawTitle: r.rawTitle ?? null,
    marketplaceBrandText: r.marketplaceBrandText ?? null, matchStatus: r.matchStatus,
    matchConfidence: r.matchConfidence ?? null, listingStatus: r.listingStatus ?? "active",
    firstSeenAt: r.firstSeenAt ?? null, lastSeenAt: r.lastSeenAt ?? null,
  }),
  sellers: (r: any) => ({
    id: r.id, marketplaceId: r.marketplaceId, externalSellerId: r.externalSellerId, name: r.name,
    sellerType: r.sellerType, defaultFulfilmentType: r.defaultFulfilmentType,
    sellerGroupId: r.sellerGroupId ?? null, sellerTier: r.sellerTier ?? null,
    maxOffers: r.maxOffers ?? null, onboardedAt: r.onboardedAt ?? null,
  }),
  sellerRatingSnapshots: (r: any) => ({
    id: r.id, sellerId: r.sellerId, capturedAt: r.capturedAt, rating: r.rating ?? null,
    ratingCount: r.ratingCount ?? null,
  }),
  offers: (r: any) => ({
    id: r.id, listingId: r.listingId, sellerId: r.sellerId, itemCondition: r.itemCondition ?? "new",
    offerStatus: r.offerStatus ?? "active", firstSeenAt: r.firstSeenAt ?? null,
  }),
  priceObservations: (r: any) => ({
    id: r.id, offerId: r.offerId, observedAt: r.observedAt, recordedAt: new Date(r.recordedAt),
    mrpMinor: r.mrpMinor ?? null, sellingPriceMinor: r.sellingPriceMinor,
    shippingFeeMinor: r.shippingFeeMinor ?? 0, currencyCode: r.currencyCode ?? "INR",
    isInStock: r.isInStock, isBuyboxWinner: r.isBuyboxWinner ?? false, saleLabel: r.saleLabel ?? null,
    rawDocumentId: r.rawDocumentId ?? null, parserVersion: r.parserVersion ?? null,
  }),
  reviewSnapshots: (r: any) => ({
    id: r.id, listingId: r.listingId, capturedAt: r.capturedAt, averageRating: r.averageRating ?? null,
    ratingCount: r.ratingCount ?? null, reviewCount: r.reviewCount ?? null,
    ratingDistribution: r.ratingDistribution ?? null,
  }),
  promotions: (r: any) => ({
    id: r.id, offerId: r.offerId, promotionType: r.promotionType, availabilityClass: r.availabilityClass,
    label: r.label, terms: r.terms ?? null, eligibility: r.eligibility ?? null,
    discountValueMinor: r.discountValueMinor ?? 0, validFrom: r.validFrom ?? null, validTo: r.validTo ?? null,
  }),
};

/**
 * Stream one NDJSON file into a table.
 *
 * `keep` filters parsed rows. `prefilter` works on the RAW LINE and runs
 * first — for the 134 MB observation file, JSON.parse on every line is most
 * of the cost, and skipping it for the 99% that miss turns a minute into a
 * couple of seconds.
 */
async function load(
  db: ReturnType<typeof drizzle>,
  file: string,
  table: unknown,
  map: (r: any) => any,
  opts: { batchSize?: number; keep?: (r: any) => boolean; prefilter?: (line: string) => boolean } = {}
) {
  const batchSize = opts.batchSize ?? 2000;
  const rl = createInterface({
    input: createReadStream(join(SEED_DIR, `${file}.ndjson`), { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let batch: any[] = [];
  const flush = async () => {
    if (!batch.length) return;
    await (db as any).insert(table).values(batch);
    batch = [];
  };
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (opts.prefilter && !opts.prefilter(line)) continue;
    const row = JSON.parse(line);
    if (opts.keep && !opts.keep(row)) continue;
    batch.push(map(row));
    if (batch.length >= batchSize) await flush();
  }
  await flush();
}

/** Read rows without inserting — used when a later table depends on them. */
async function collect(file: string, keep: (r: any) => boolean): Promise<any[]> {
  const rl = createInterface({
    input: createReadStream(join(SEED_DIR, `${file}.ndjson`), { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  const out: any[] = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (keep(row)) out.push(row);
  }
  return out;
}

/**
 * Loads the catalogue tables the Phase 3 read APIs actually serve.
 *
 * Price observations, reviews and promotions are skipped on purpose: they are
 * 370,000 of the 390,000 rows, no Phase 3 endpoint reads them, and paying 55
 * seconds per test run for data nothing under test touches would make the
 * suite something people avoid running.
 */
async function seedCatalogue(db: ReturnType<typeof drizzle>) {
  requireDataset();
  await load(db, "categories", t.categories, MAP.categories);
  await load(db, "product_types", t.productTypes, MAP.productTypes);
  await load(db, "brands", t.brands, MAP.brands);
  await load(db, "products", t.products, MAP.products);
  await load(db, "marketplaces", t.marketplaces, MAP.marketplaces);
  await load(db, "marketplace_categories", t.marketplaceCategories, MAP.marketplaceCategories);
  await load(db, "listings", t.listings, MAP.listings);
}

/** The complete entity graph for a set of products. See createMarketplaceTestApp. */
async function seedMarketplaceGraph(
  db: ReturnType<typeof drizzle>,
  productIds: string[],
  includeProductTypePeers = false
) {
  requireDataset();
  let wanted = new Set(productIds);

  if (includeProductTypePeers) {
    // One pass over products.ndjson: find the requested products' types, then
    // take every purchasable product of those types.
    const all = await collect("products", () => true);
    const types = new Set(all.filter((p) => wanted.has(p.id)).map((p) => p.productTypeId));
    const missing = productIds.filter((id) => !all.some((p) => p.id === id));
    if (missing.length) throw new Error(`Unknown product ids: ${missing.join(", ")}`);
    wanted = new Set(
      all.filter((p) => types.has(p.productTypeId) && p.isPurchasable !== false).map((p) => p.id as string)
    );
    for (const id of productIds) wanted.add(id);
  }

  // Reference data is small and whole; nothing is gained by filtering it.
  await load(db, "categories", t.categories, MAP.categories);
  await load(db, "product_types", t.productTypes, MAP.productTypes);
  await load(db, "brands", t.brands, MAP.brands);
  await load(db, "products", t.products, MAP.products);
  await load(db, "marketplaces", t.marketplaces, MAP.marketplaces);
  await load(db, "marketplace_categories", t.marketplaceCategories, MAP.marketplaceCategories);
  /**
   * Specification schema. Load-bearing for Phase 5: without it every
   * specification comparison finds nothing to compare, the spec term drops
   * out of the similarity, its weight is redistributed across the remaining
   * terms — and the result is a plausible-looking number that is wrong.
   */
  await load(db, "attribute_definitions", t.attributeDefinitions, MAP.attributeDefinitions);
  /**
   * Commercial inputs. Phase 6 needs them: without fee rules no break-even
   * floor can be computed, and the floor then silently falls back to the
   * market for every product — including the three that genuinely have a
   * seller cost.
   */
  await load(db, "fee_rules", t.feeRules, MAP.feeRules);
  await load(db, "seller_cost_inputs", t.sellerCostInputs, MAP.sellerCostInputs);

  const listingIds = new Set<string>();
  await load(db, "listings", t.listings, MAP.listings, {
    keep: (r) => {
      if (!wanted.has(r.productId)) return false;
      listingIds.add(r.id);
      return true;
    },
  });
  if (listingIds.size === 0) {
    throw new Error(`No listings found for ${productIds.join(", ")} — check the product ids.`);
  }

  /**
   * Offers are read before sellers so the seller set can be derived from
   * them. An offer whose seller is absent violates the foreign key, and
   * loading all 1,177 sellers to sidestep that would make an exact seller
   * count impossible to assert.
   */
  const offerRows = await collect("offers", (r) => listingIds.has(r.listingId));
  const sellerIds = new Set<string>(offerRows.map((r) => r.sellerId as string));
  const offerIds = new Set<string>(offerRows.map((r) => r.id as string));

  await load(db, "sellers", t.sellers, MAP.sellers, { keep: (r) => sellerIds.has(r.id) });
  await load(db, "seller_rating_snapshots", t.sellerRatingSnapshots, MAP.sellerRatingSnapshots, {
    keep: (r) => sellerIds.has(r.sellerId),
  });
  for (let i = 0; i < offerRows.length; i += 2000) {
    await (db as any).insert(t.offers).values(offerRows.slice(i, i + 2000).map(MAP.offers));
  }

  await load(db, "price_observations", t.priceObservations, MAP.priceObservations, {
    // 13 columns per row. PostgreSQL binds at most 65,535 parameters per
    // statement, and a larger batch here failed inside the wire protocol
    // rather than with a readable error — 1,000 rows is 13,000 parameters,
    // comfortably clear of the ceiling and still one round trip per second.
    batchSize: 1000,
    prefilter: (line) => {
      const start = line.indexOf('"offerId":"');
      if (start === -1) return false;
      const from = start + 11;
      const end = line.indexOf('"', from);
      return end !== -1 && offerIds.has(line.slice(from, end));
    },
  });

  await load(db, "review_snapshots", t.reviewSnapshots, MAP.reviewSnapshots, {
    keep: (r) => listingIds.has(r.listingId),
  });
  await load(db, "promotions", t.promotions, MAP.promotions, { keep: (r) => offerIds.has(r.offerId) });
}

/* ------------------------------------------------------------------ utils */

export type Json = Record<string, any>;

/** The password every helper-created account is given. */
export const TEST_PASSWORD = "harness-test-password";

/**
 * Register, verify the address, and return the resulting bearer token.
 *
 * This is the real flow over the real HTTP surface — no direct row inserts
 * and no fabricated session — so a test that depends on being signed in
 * fails if sign-in itself breaks.
 */
let signInIp = 0;
export async function signIn(h: Harness, email: string, password = TEST_PASSWORD) {
  // Distinct source address per sign-in, so helper traffic never eats the
  // per-IP budget a rate-limit test is relying on.
  const remoteAddress = `10.200.${Math.floor(++signInIp / 256) % 256}.${signInIp % 256}`;
  const post = (url: string, payload: object) =>
    h.app.inject({ method: "POST", url: `/api/v1${url}`, payload, remoteAddress });

  const registered = await post("/auth/register", { email, password });
  if (registered.statusCode !== 201) {
    // The account already exists and is verified — just log in.
    const login = await post("/auth/login", { email, password });
    const body = login.json() as Json;
    return { token: body["token"] as string, user: body["user"] as Json, isNewUser: false };
  }

  const code = (registered.json() as Json)["devCode"] as string;
  const verified = await post("/auth/verify-email", { email, code });
  const body = verified.json() as Json;
  if (verified.statusCode !== 200) {
    throw new Error(`signIn(${email}) failed at verify-email: ${verified.statusCode} ${verified.body}`);
  }
  return { token: body["token"] as string, user: body["user"] as Json, isNewUser: true };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
