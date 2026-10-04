import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  attributeDefinitions,
  brands,
  categories,
  listings,
  marketplaces,
  productTypes,
  products,
} from "../../db/schema.js";
import { offsetFor } from "../../lib/pagination.js";
import { UNIVERSAL_EFFECTIVE_MINOR } from "../../lib/priceLadder.js";

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
      .orderBy(asc(categories.level), sql`${categories.displayOrder} asc nulls last`, asc(categories.name));
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

  /**
   * The breadcrumb for a category: its ancestors, then itself.
   *
   * `path` is a materialised SLUG path — "electronics/mobiles-accessories/
   * smartphones" — so the ancestors are exactly the categories whose path is a
   * prefix of it. One query, no tree walk.
   *
   * This previously split on " > " and resolved the pieces by NAME, which the
   * data has never looked like: the split produced a single segment, no row
   * matched it by name, and `/categories/:id` returned an empty `ancestors`
   * array for every category. Nothing read it until the catalogue needed a
   * breadcrumb, so the bug was invisible.
   *
   * Matching on path prefixes rather than names is also the sturdier rule —
   * two categories may share a name under different parents ("Accessories"),
   * and a name lookup cannot tell them apart.
   */
  async findCategoryAncestors(path: string) {
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) return [];
    const prefixes = segments.map((_, i) => segments.slice(0, i + 1).join("/"));

    const rows = await this.db
      .select({
        id: categories.id,
        name: categories.name,
        level: categories.level,
        path: categories.path,
      })
      .from(categories)
      .where(inArray(categories.path, prefixes));

    // Ordered by depth, so the breadcrumb reads root-first regardless of the
    // order the rows came back in.
    return prefixes
      .map((p) => rows.find((r) => r.path === p))
      .filter((r): r is { id: string; name: string; level: number; path: string } => Boolean(r))
      .map(({ id, name, level }) => ({ id, name, level }));
  }

  async findChildCategories(parentId: string) {
    return this.db
      .select({ id: categories.id, name: categories.name, level: categories.level })
      .from(categories)
      .where(eq(categories.parentId, parentId))
      .orderBy(sql`${categories.displayOrder} asc nulls last`, asc(categories.name));
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
        /**
         * Whether a provider discovered this store rather than the system being
         * built around it. Exposed because the client has to be able to tell:
         * a discovered store has no brand colour and no fee rules, and a screen
         * that cannot distinguish it will render a blank swatch and an unknown
         * margin without being able to explain either.
         */
        isDiscovered: marketplaces.isDiscovered,
        isActive: marketplaces.isActive,
        listingCount: sql<number>`(select count(*)::int from ${listings} l where l.marketplace_id = ${outer("marketplaces", "id")})`,
      })
      .from(marketplaces)
      // Curated order first, discovered stores after it by name.
      .orderBy(sql`${marketplaces.displayOrder} asc nulls last`, asc(marketplaces.name));
  }

  /* ------------------------------------------------- the catalogue screen */

  /**
   * A category and everything beneath it.
   *
   * Products hang off LEAF categories, so an exact-match filter on a
   * department returns nothing — selecting "Electronics" would show an empty
   * catalogue while claiming hundreds of products exist. `categories.path` is
   * a materialised slug path ("electronics/mobiles-accessories/smartphones"),
   * so the subtree is a `path/%` prefix match plus the node itself.
   *
   * The separator matters: a `" > "` pattern (which an out-of-date comment on
   * `findCategoryAncestors` suggested) matches nothing, and the query would
   * then quietly return just the node — correct for a leaf, and wrong for
   * every department, which is the case the subtree exists for.
   */
  async categorySubtreeIds(categoryId: string): Promise<string[]> {
    const node = await this.findCategory(categoryId);
    if (!node) return [];
    const rows = await this.db
      .select({ id: categories.id })
      .from(categories)
      .where(or(eq(categories.id, node.id), sql`${categories.path} like ${`${node.path}/%`}`));
    return rows.map((r) => r.id);
  }

  /**
   * The product rows in scope for a catalogue query, with the aggregates every
   * facet and sort needs.
   *
   * Scope is category subtree, product type and search — NOT the facet groups,
   * whose counts have to be computed from the scope with each group's own
   * selection excluded.
   *
   * One query, and deliberately unpaginated: the facet counts are over the
   * whole scope, not over a page, so the scope has to be resolved in full.
   * It is bounded by construction — the largest department in this catalogue
   * holds a few hundred products out of 1,172 — and returns identity plus
   * numbers, no nested rows.
   *
   * Prices are the CHEAPEST and DEAREST in-stock universal-effective price,
   * taken from the latest observation per offer. Same basis, same rung and
   * same `distinct on` shape as `AnalysisRepository.currentPrices`, so a price
   * in the catalogue cannot disagree with the price on the product page.
   *
   * ── Why this is one grouped pass, not per-product subqueries ───────────
   * The obvious shape is a correlated subquery per column: cheapest price,
   * dearest price, any-in-stock. Written that way it took three `distinct on`
   * passes over `price_observations` FOR EVERY PRODUCT — around 3,500 passes
   * for an unscoped catalogue — and the request did not come back.
   *
   * So the latest observation per offer is resolved ONCE, in a CTE, and
   * aggregated by product. `filter (where is_in_stock)` gives the two prices
   * and `bool_or` the availability from that single result, and a product with
   * no in-stock offer aggregates to NULL — which is the right answer and the
   * reason the join is a LEFT one.
   */
  async scopedSummaries(scope: { categoryIds?: string[]; productTypeId?: string; search?: string }) {
    const clauses: SQL[] = [sql`p.is_purchasable = true`];

    if (scope.categoryIds) {
      if (scope.categoryIds.length === 0) return [];
      clauses.push(sql`p.category_id in (${sql.join(scope.categoryIds.map((id) => sql`${id}`), sql`, `)})`);
    }
    if (scope.productTypeId) clauses.push(sql`p.product_type_id = ${scope.productTypeId}`);
    if (scope.search) {
      const pattern = `%${escapeLike(scope.search)}%`;
      clauses.push(sql`(p.canonical_name ilike ${pattern} or p.model_name ilike ${pattern})`);
    }

    const where = sql.join(clauses, sql` and `);

    const result = (await this.db.execute(sql`
      with scoped as (
        select p.id, p.canonical_name, p.model_name, p.first_seen_at, p.lifecycle_status,
               p.brand_id, p.category_id, p.product_type_id, p.specifications, p.variant_axes
          from products p
         where ${where}
      ),
      coverage as (
        select l.product_id,
               count(distinct l.id)::int             as listing_count,
               count(o.id)::int                      as offer_count,
               coalesce(array_agg(distinct l.marketplace_id), '{}') as marketplace_ids
          from listings l
          join scoped s on s.id = l.product_id
          left join offers o on o.listing_id = l.id
         group by l.product_id
      ),
      -- The latest observation per offer, carrying only the columns the
      -- ladder needs. No arithmetic here: this step exists to THROW ROWS
      -- AWAY, and it uses price_obs_offer_date_idx to do it.
      latest_raw as (
        select distinct on (po.offer_id)
               po.offer_id, po.observed_at, po.is_in_stock,
               po.selling_price_minor, po.shipping_fee_minor,
               l.product_id
          from price_observations po
          join offers o   on o.id = po.offer_id
          join listings l on l.id = o.listing_id
          join scoped s   on s.id = l.product_id
         order by po.offer_id, po.observed_at desc
      ),
      -- The price ladder, evaluated only on the survivors.
      --
      -- This split is the difference between a request that returns and one
      -- that does not. The effective-price expression runs a correlated
      -- subquery over promotions per row; applied inside the distinct-on
      -- above, it was computed for all 354,940 observations and then
      -- discarded for all but the newest of each offer, about 9,700.
      -- Evaluating it here costs a fraction of that. The alias stays "po"
      -- because the shared ladder SQL is written against that name.
      latest as (
        select po.product_id, po.is_in_stock, ${UNIVERSAL_EFFECTIVE_MINOR} as eff
          from latest_raw po
      ),
      priced as (
        select product_id,
               min(eff) filter (where is_in_stock)::int as min_eff,
               max(eff) filter (where is_in_stock)::int as max_eff,
               coalesce(bool_or(is_in_stock), false)    as in_stock
          from latest
         group by product_id
      )
      select s.id                                  as "productId",
             s.canonical_name                      as "canonicalName",
             s.model_name                          as "modelName",
             s.first_seen_at::text                 as "firstSeenAt",
             s.lifecycle_status                    as "lifecycleStatus",
             s.brand_id                            as "brandId",
             s.category_id                         as "categoryId",
             s.product_type_id                     as "productTypeId",
             s.specifications                      as "specifications",
             s.variant_axes                        as "variantAxes",
             coalesce(c.listing_count, 0)          as "listingCount",
             coalesce(c.offer_count, 0)            as "offerCount",
             coalesce(c.marketplace_ids, '{}')     as "marketplaceIds",
             pr.min_eff                            as "minPriceMinor",
             pr.max_eff                            as "maxPriceMinor",
             coalesce(pr.in_stock, false)          as "inStock"
        from scoped s
        left join coverage c on c.product_id = s.id
        left join priced   pr on pr.product_id = s.id`)) as unknown as {
      rows: Array<{
        productId: string;
        canonicalName: string;
        modelName: string;
        firstSeenAt: string | null;
        lifecycleStatus: string;
        brandId: string;
        categoryId: string;
        productTypeId: string;
        specifications: Record<string, unknown> | null;
        variantAxes: Record<string, string> | null;
        listingCount: number;
        offerCount: number;
        marketplaceIds: string[];
        minPriceMinor: number | null;
        maxPriceMinor: number | null;
        inStock: boolean;
      }>;
    };

    return result.rows;
  }

  /**
   * Identity for the rows on ONE page.
   *
   * The facets are computed over the whole scope, but only a page is rendered,
   * so names, brands and category paths are hydrated for that page alone.
   * Loading all 1,172 to display 24 would be waste the facet pass does not
   * require.
   */
  async productIdentity(productIds: string[]) {
    if (productIds.length === 0) return [];
    return this.db
      .select({
        id: products.id,
        canonicalName: products.canonicalName,
        modelName: products.modelName,
        isPurchasable: products.isPurchasable,
        lifecycleStatus: products.lifecycleStatus,
        firstSeenAt: products.firstSeenAt,
        variantAxes: products.variantAxes,
        brandId: brands.id,
        brandName: brands.name,
        brandTier: brands.tier,
        categoryId: categories.id,
        categoryName: categories.name,
        categoryPath: categories.path,
        productTypeId: productTypes.id,
        productTypeName: productTypes.name,
      })
      .from(products)
      .innerJoin(brands, eq(brands.id, products.brandId))
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .innerJoin(productTypes, eq(productTypes.id, products.productTypeId))
      .where(inArray(products.id, productIds));
  }

  /**
   * Filterable attributes for several product types at once.
   *
   * A catalogue page can show products of many types, and each card names a
   * few specs worth seeing. Which specs those are is a registry rule, so the
   * server answers it — one query for the page rather than a lookup table
   * shipped to the browser.
   */
  async filterableAttributesForTypes(productTypeIds: string[]) {
    if (productTypeIds.length === 0) return [];
    return this.db
      .select({
        productTypeId: attributeDefinitions.productTypeId,
        attributeKey: attributeDefinitions.attributeKey,
        displayName: attributeDefinitions.displayName,
        dataType: attributeDefinitions.dataType,
        unit: attributeDefinitions.unit,
      })
      .from(attributeDefinitions)
      .where(
        and(
          inArray(attributeDefinitions.productTypeId, productTypeIds),
          eq(attributeDefinitions.isFilterable, true)
        )
      )
      .orderBy(sql`${attributeDefinitions.displayOrder} asc nulls last`, asc(attributeDefinitions.attributeKey));
  }

  /**
   * The schema of one product's specification document.
   *
   * Filtered to the product's own `specSchemaVersion`: a product type can
   * carry more than one, and showing a v4 field against a v3 document would
   * render a label with nothing behind it. Ordered editorially, so the spec
   * list reads the way the registry intended rather than alphabetically.
   */
  async attributeDefinitionsFor(productTypeId: string, schemaVersion: string | null) {
    const clauses: SQL[] = [eq(attributeDefinitions.productTypeId, productTypeId)];
    if (schemaVersion) clauses.push(eq(attributeDefinitions.schemaVersion, schemaVersion));
    return this.db
      .select({
        attributeKey: attributeDefinitions.attributeKey,
        displayName: attributeDefinitions.displayName,
        dataType: attributeDefinitions.dataType,
        unit: attributeDefinitions.unit,
        isRequired: attributeDefinitions.isRequired,
        isPricingRelevant: attributeDefinitions.isPricingRelevant,
        higherIsBetter: attributeDefinitions.higherIsBetter,
        schemaVersion: attributeDefinitions.schemaVersion,
      })
      .from(attributeDefinitions)
      .where(and(...clauses))
      .orderBy(sql`${attributeDefinitions.displayOrder} asc nulls last`, asc(attributeDefinitions.attributeKey));
  }

  /**
   * The attributes this product type turns into filter facets.
   *
   * `is_filterable`, exactly as the browser registry selects them, and in
   * `display_order` — the registry's own editorial sequence, so the sidebar
   * still opens with RAM and Storage rather than alphabetically with Battery
   * and Charging. `attribute_key` is the tiebreak, not the primary order.
   */
  async filterableAttributes(productTypeId: string) {
    return this.db
      .select({
        attributeKey: attributeDefinitions.attributeKey,
        displayName: attributeDefinitions.displayName,
        filterType: attributeDefinitions.filterType,
        dataType: attributeDefinitions.dataType,
        unit: attributeDefinitions.unit,
        buckets: attributeDefinitions.buckets,
      })
      .from(attributeDefinitions)
      .where(and(eq(attributeDefinitions.productTypeId, productTypeId), eq(attributeDefinitions.isFilterable, true)))
      .orderBy(sql`${attributeDefinitions.displayOrder} asc nulls last`, asc(attributeDefinitions.attributeKey));
  }

  /**
   * The latest review snapshot per listing, for a batch of products.
   *
   * Per LISTING, not per product, because that is how reviews are captured —
   * two marketplaces draw on different customer populations. Aggregating them
   * into one product rating is a rule (`aggregateReviews`) applied in the
   * service, and reusing that one rule is what keeps the catalogue's rating
   * identical to the product page's.
   */
  async latestReviewsFor(productIds: string[]) {
    if (productIds.length === 0) return [];
    const result = (await this.db.execute(sql`
      select distinct on (rs.listing_id)
             l.product_id      as "productId",
             rs.average_rating as "averageRating",
             rs.review_count   as "reviewCount"
        from review_snapshots rs
        join listings l on l.id = rs.listing_id
       where l.product_id in (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})
       order by rs.listing_id, rs.captured_at desc`)) as unknown as {
      rows: Array<{ productId: string; averageRating: number | null; reviewCount: number | null }>;
    };
    return result.rows;
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
