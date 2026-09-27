import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { brands, categories, listings, marketplaces, productTypes, products } from "../../db/schema.js";
import { offsetFor } from "../../lib/pagination.js";

/**
 * Qualified column reference for use inside a correlated subquery.
 *
 * Interpolating a Drizzle column directly renders it UNQUALIFIED, so
 * `where l.marketplace_id = ${marketplaces.id}` became
 * `where l.marketplace_id = "id"` — which the inner scope resolves to
 * `listings.id`. The comparison then never matches and every count came back
 * as a plausible-looking zero. Naming both parts is the fix.
 */
const outer = (table: string, column: string) => sql`${sql.identifier(table)}.${sql.identifier(column)}`;

/** Escapes LIKE metacharacters so a search term is matched literally. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => "\\" + ch);
}

export type ProductListFilters = {
  page: number;
  pageSize: number;
  search?: string;
  categoryId?: string;
  productTypeId?: string;
  brandId?: string;
  marketplaceId?: string;
  sort: "relevance" | "name_asc" | "name_desc" | "newest";
};

/**
 * Catalogue reads. Every value reaches SQL as a bound parameter through
 * Drizzle's tagged templates — there is no string concatenation of user input
 * anywhere in this file, including in the sort clause, which is resolved from
 * a closed set rather than interpolated.
 */
export class CatalogueRepository {
  constructor(private readonly db: Db) {}

  private whereFor(f: ProductListFilters): SQL | undefined {
    const clauses: SQL[] = [];

    if (f.search) {
      // Binding the parameter stops SQL injection, but it does NOT stop
      // PATTERN injection: a '%' inside the value is still a LIKE wildcard, so
      // a search for "%" returned the entire catalogue. Escaping the three
      // special characters makes user input match literally.
      const pattern = `%${escapeLike(f.search)}%`;
      const match = or(ilike(products.canonicalName, pattern), ilike(products.modelName, pattern));
      if (match) clauses.push(match);
    }
    if (f.categoryId) clauses.push(eq(products.categoryId, f.categoryId));
    if (f.productTypeId) clauses.push(eq(products.productTypeId, f.productTypeId));
    if (f.brandId) clauses.push(eq(products.brandId, f.brandId));
    if (f.marketplaceId) {
      // "Carried by this marketplace" is a property of the product's listings,
      // expressed as a semi-join so a product with three listings is still
      // returned once.
      clauses.push(
        sql`exists (select 1 from ${listings} l where l.product_id = ${products.id} and l.marketplace_id = ${f.marketplaceId})`
      );
    }

    if (clauses.length === 0) return undefined;
    return clauses.length === 1 ? clauses[0] : and(...clauses);
  }

  private orderFor(sort: ProductListFilters["sort"]) {
    switch (sort) {
      case "name_desc":
        return [desc(sql`lower(${products.canonicalName})`), asc(products.id)];
      case "newest":
        // Nulls last, then a stable tiebreak — without one, two products
        // sharing a date can swap between pages and a row is seen twice.
        return [sql`${products.firstSeenAt} desc nulls last`, asc(products.id)];
      case "name_asc":
      case "relevance":
      default:
        // lower(), not the raw column: the database's collation decides
        // whether "AGARO" sorts before "Accu-Chek", and PGlite locally need
        // not agree with a managed Postgres. Folding case makes the order
        // deterministic across both and matches what a reader of an
        // alphabetical list expects.
        return [asc(sql`lower(${products.canonicalName})`), asc(products.id)];
    }
  }

  async listProducts(f: ProductListFilters) {
    const where = this.whereFor(f);

    const rows = await this.db
      .select({
        id: products.id,
        canonicalName: products.canonicalName,
        modelName: products.modelName,
        isPurchasable: products.isPurchasable,
        lifecycleStatus: products.lifecycleStatus,
        firstSeenAt: products.firstSeenAt,
        brandId: brands.id,
        brandName: brands.name,
        brandTier: brands.tier,
        categoryId: categories.id,
        categoryName: categories.name,
        categoryPath: categories.path,
        productTypeId: productTypes.id,
        productTypeName: productTypes.name,
        marketplaceCount: sql<number>`(select count(*)::int from ${listings} l where l.product_id = ${outer("products", "id")})`,
      })
      .from(products)
      .innerJoin(brands, eq(brands.id, products.brandId))
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .innerJoin(productTypes, eq(productTypes.id, products.productTypeId))
      .where(where)
      .orderBy(...this.orderFor(f.sort))
      .limit(f.pageSize)
      .offset(offsetFor(f.page, f.pageSize));

    const totalRows = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(products)
      .where(where);

    return { rows, total: totalRows[0]?.n ?? 0 };
  }

  async findProduct(id: string) {
    const rows = await this.db
      .select({
        id: products.id,
        parentProductId: products.parentProductId,
        canonicalName: products.canonicalName,
        modelName: products.modelName,
        variantAxes: products.variantAxes,
        specifications: products.specifications,
        specSchemaVersion: products.specSchemaVersion,
        isPurchasable: products.isPurchasable,
        lifecycleStatus: products.lifecycleStatus,
        firstSeenAt: products.firstSeenAt,
        brandId: brands.id,
        brandName: brands.name,
        brandTier: brands.tier,
        categoryId: categories.id,
        categoryName: categories.name,
        categoryPath: categories.path,
        productTypeId: productTypes.id,
        productTypeName: productTypes.name,
        marketplaceCount: sql<number>`(select count(*)::int from ${listings} l where l.product_id = ${outer("products", "id")})`,
      })
      .from(products)
      .innerJoin(brands, eq(brands.id, products.brandId))
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .innerJoin(productTypes, eq(productTypes.id, products.productTypeId))
      .where(eq(products.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Sibling variants under the same family node, for the detail response. */
  async findVariantSiblings(parentProductId: string, excludeId: string) {
    return this.db
      .select({ id: products.id, canonicalName: products.canonicalName, variantAxes: products.variantAxes })
      .from(products)
      .where(and(eq(products.parentProductId, parentProductId), sql`${products.id} <> ${excludeId}`))
      .orderBy(asc(products.canonicalName));
  }

  /* ------------------------------------------------------------ taxonomy */

  async listCategories(opts: { parentId?: string | null; level?: number }) {
    const clauses: SQL[] = [];
    if (opts.parentId === null) clauses.push(sql`${categories.parentId} is null`);
    else if (opts.parentId !== undefined) clauses.push(eq(categories.parentId, opts.parentId));
    if (opts.level !== undefined) clauses.push(eq(categories.level, opts.level));

    return this.db
      .select({
        id: categories.id,
        parentId: categories.parentId,
        level: categories.level,
        name: categories.name,
        path: categories.path,
        productCount: sql<number>`(select count(*)::int from ${products} p where p.category_id = ${outer("categories", "id")})`,
      })
      .from(categories)
      .where(clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : and(...clauses))
      .orderBy(asc(categories.level), asc(categories.name));
  }

  async findCategory(id: string) {
    const rows = await this.db
      .select({
        id: categories.id,
        parentId: categories.parentId,
        level: categories.level,
        name: categories.name,
        path: categories.path,
        productCount: sql<number>`(select count(*)::int from ${products} p where p.category_id = ${outer("categories", "id")})`,
      })
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findCategoryAncestors(path: string) {
    // `path` is the materialised ancestry ("Beauty > Hair Care > Shampoo");
    // resolving names to rows keeps breadcrumbs one query rather than a walk.
    const names = path.split(" > ").map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) return [];
    const rows = await this.db
      .select({ id: categories.id, name: categories.name, level: categories.level })
      .from(categories)
      .where(inArray(categories.name, names));
    return names
      .map((n) => rows.find((r) => r.name === n))
      .filter((r): r is { id: string; name: string; level: number } => Boolean(r));
  }

  async findChildCategories(parentId: string) {
    return this.db
      .select({ id: categories.id, name: categories.name, level: categories.level })
      .from(categories)
      .where(eq(categories.parentId, parentId))
      .orderBy(asc(categories.name));
  }

  async listProductTypes(categoryId?: string) {
    return this.db
      .select({ id: productTypes.id, categoryId: productTypes.categoryId, name: productTypes.name })
      .from(productTypes)
      .where(categoryId ? eq(productTypes.categoryId, categoryId) : undefined)
      .orderBy(asc(productTypes.name));
  }

  async listBrands(opts: { page: number; pageSize: number; search?: string }) {
    const where = opts.search ? ilike(brands.name, `%${escapeLike(opts.search)}%`) : undefined;
    const rows = await this.db
      .select({
        id: brands.id,
        name: brands.name,
        tier: brands.tier,
        parentCompany: brands.parentCompany,
        productCount: sql<number>`(select count(*)::int from ${products} p where p.brand_id = ${outer("brands", "id")})`,
      })
      .from(brands)
      .where(where)
      .orderBy(asc(brands.name))
      .limit(opts.pageSize)
      .offset(offsetFor(opts.page, opts.pageSize));
    const totalRows = await this.db.select({ n: sql<number>`count(*)::int` }).from(brands).where(where);
    return { rows, total: totalRows[0]?.n ?? 0 };
  }

  async listMarketplaces() {
    return this.db
      .select({
        id: marketplaces.id,
        name: marketplaces.name,
        countryCode: marketplaces.countryCode,
        defaultCurrency: marketplaces.defaultCurrency,
        websiteDomain: marketplaces.websiteDomain,
        marketplaceType: marketplaces.marketplaceType,
        brandColor: marketplaces.brandColor,
        isActive: marketplaces.isActive,
        listingCount: sql<number>`(select count(*)::int from ${listings} l where l.marketplace_id = ${outer("marketplaces", "id")})`,
      })
      .from(marketplaces)
      .orderBy(asc(marketplaces.name));
  }

  /* --------------------------------------------- existence, for 400 vs 404 */

  async exists(kind: "category" | "brand" | "marketplace" | "productType", id: string) {
    const table = { category: categories, brand: brands, marketplace: marketplaces, productType: productTypes }[kind];
    const rows = await this.db
      .select({ n: sql<number>`1` })
      .from(table)
      .where(eq(table.id, id))
      .limit(1);
    return rows.length > 0;
  }
}
