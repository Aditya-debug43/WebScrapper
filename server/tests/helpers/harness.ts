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

export async function createTestApp(opts: { seedCatalogue?: boolean } = {}): Promise<Harness> {
  const email = new MemoryEmailAdapter();
  const built = await bootstrap(email, opts);
  return { ...built, email };
}

/**
 * The same application, wired to a specific email adapter.
 *
 * Exists so a test can drive a transport that FAILS. Delivery could not fail
 * before SMTP — memory and console always succeed — so the failure path had
 * no way to be exercised through the real HTTP surface until now.
 */
export async function createTestAppWith(
  email: EmailAdapter,
  opts: { seedCatalogue?: boolean } = {}
): Promise<BuiltApp> {
  return bootstrap(email, opts);
}

async function bootstrap(email: EmailAdapter, opts: { seedCatalogue?: boolean }): Promise<BuiltApp> {
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
async function seedCatalogue(db: ReturnType<typeof drizzle>) {
  if (!existsSync(join(SEED_DIR, "manifest.json"))) {
    throw new Error(
      `No dataset at ${SEED_DIR}.\n` +
        `Run this once from the repository root:\n\n    node scripts/export-dataset.mjs\n`
    );
  }

  const load = async (file: string, table: unknown, map: (r: any) => any, batchSize = 2000) => {
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
      batch.push(map(JSON.parse(line)));
      if (batch.length >= batchSize) await flush();
    }
    await flush();
  };

  await load("categories", t.categories, (r) => ({
    id: r.id, parentId: r.parentId ?? null, level: r.level, name: r.name, path: r.path,
  }));
  await load("product_types", t.productTypes, (r) => ({
    id: r.id, categoryId: r.categoryId, name: r.name, schemaVersion: r.schemaVersion,
  }));
  await load("brands", t.brands, (r) => ({
    id: r.id, name: r.name, tier: r.tier, parentCompany: r.parentCompany ?? null, aliasNames: r.aliasNames ?? [],
  }));
  await load("products", t.products, (r) => ({
    id: r.id, parentProductId: r.parentProductId ?? null, isPurchasable: r.isPurchasable ?? true,
    brandId: r.brandId, categoryId: r.categoryId, productTypeId: r.productTypeId,
    canonicalName: r.canonicalName, modelName: r.modelName, variantAxes: r.variantAxes ?? null,
    specSchemaVersion: r.specSchemaVersion ?? null, specifications: r.specifications ?? {},
    identifiers: r.identifiers ?? null, lifecycleStatus: r.lifecycleStatus ?? "active",
    firstSeenAt: r.firstSeenAt ?? null,
  }));
  await load("marketplaces", t.marketplaces, (r) => ({
    id: r.id, name: r.name, countryCode: r.countryCode, defaultCurrency: r.defaultCurrency,
    websiteDomain: r.websiteDomain, isActive: r.isActive ?? true, brandColor: r.brandColor ?? null,
    marketplaceType: r.marketplaceType, categoryAffinity: r.categoryAffinity ?? [],
  }));
  await load("marketplace_categories", t.marketplaceCategories, (r) => ({
    id: r.id, marketplaceId: r.marketplaceId, externalNodeId: r.externalNodeId, rawPath: r.rawPath,
    mappedCategoryId: r.mappedCategoryId ?? null, mappingConfidence: r.mappingConfidence ?? null,
    mappedBy: r.mappedBy ?? null,
  }));
  await load("listings", t.listings, (r) => ({
    id: r.id, productId: r.productId, marketplaceId: r.marketplaceId,
    externalListingId: r.externalListingId, listingUrl: r.listingUrl ?? null,
    marketplaceCategoryId: r.marketplaceCategoryId ?? null, rawTitle: r.rawTitle ?? null,
    marketplaceBrandText: r.marketplaceBrandText ?? null, matchStatus: r.matchStatus,
    matchConfidence: r.matchConfidence ?? null, listingStatus: r.listingStatus ?? "active",
    firstSeenAt: r.firstSeenAt ?? null, lastSeenAt: r.lastSeenAt ?? null,
  }));
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
