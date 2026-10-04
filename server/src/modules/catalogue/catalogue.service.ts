import { AppError } from "../../lib/errors.js";
import { pageMeta } from "../../lib/pagination.js";
import { aggregateReviews } from "../analysis/competitor.service.js";
import {
  buildPriceBuckets,
  computeFacets,
  sortSummaries,
  type CatalogueSort,
  type CatalogueSummary,
  type AttributeBucket,
} from "./facets.js";
import type { CatalogueRepository, ProductListFilters } from "./catalogue.repository.js";

/**
 * Catalogue rules and response shaping.
 *
 * Two responsibilities the repository deliberately does not have: deciding
 * what a bad filter means (a category id that does not exist is a 400, not an
 * empty page — silently returning nothing hides a client bug), and deciding
 * which columns a client is allowed to see.
 */
export class CatalogueService {
  constructor(private readonly repo: CatalogueRepository) {}

  async listProducts(filters: ProductListFilters) {
    // Referential validation before querying, so "no results" always means
    // "no results" rather than "you filtered on something imaginary".
    for (const [kind, id] of [
      ["category", filters.categoryId],
      ["productType", filters.productTypeId],
      ["brand", filters.brandId],
      ["marketplace", filters.marketplaceId],
    ] as const) {
      if (id && !(await this.repo.exists(kind, id))) {
        throw new AppError("VALIDATION_FAILED", `Unknown ${kind}: ${id}`, {
          details: [{ field: kind, message: "does not exist" }],
        });
      }
    }

    const { rows, total } = await this.repo.listProducts(filters);
    return {
      data: rows.map(shapeProductSummary),
      pagination: pageMeta(filters.page, filters.pageSize, total),
    };
  }

  async getProduct(id: string) {
    const product = await this.repo.findProduct(id);
    if (!product) throw new AppError("NOT_FOUND", `No product with id ${id}.`);

    const [siblings, ancestors, attributes] = await Promise.all([
      product.parentProductId
        ? this.repo.findVariantSiblings(product.parentProductId, product.id)
        : Promise.resolve([]),
      this.repo.findCategoryAncestors(product.categoryPath),
      this.repo.attributeDefinitionsFor(product.productTypeId, product.specSchemaVersion),
    ]);

    /**
     * Identity and the schema that describes it. Prices, offers, reviews and
     * competitors are deliberately absent — they are separate resources with
     * their own pagination and their own cost, and folding them in here is how
     * a detail endpoint becomes the slowest call in the system.
     *
     * `categoryPath` and `attributeDefinitions` do belong: one is the
     * product's own position in the taxonomy, the other is the schema of its
     * own specification document. Both are small, fixed, and meaningless
     * apart from this product — there is no separate resource for them to be,
     * and making the client fetch the taxonomy to render a breadcrumb would
     * trade a join for a round trip.
     */
    return {
      data: {
        ...shapeProductSummary(product),
        parentProductId: product.parentProductId,
        variantAxes: product.variantAxes ?? null,
        specifications: product.specifications ?? {},
        specSchemaVersion: product.specSchemaVersion,
        categoryPath: ancestors,
        attributeDefinitions: attributes,
        variantSiblings: siblings.map((s) => ({
          id: s.id,
          canonicalName: s.canonicalName,
          variantAxes: s.variantAxes ?? null,
        })),
      },
    };
  }

  /**
   * THE CATALOGUE SCREEN, in one call.
   *
   * A composite rather than a resource: the page needs the matching products,
   * the facet counts to render the sidebar, and the navigation context, and
   * all three are derived from the same scope. Split across three endpoints
   * the client would make three round trips and still have to trust that they
   * saw a consistent scope between them.
   *
   * `/products` stays as the plain resource list — this does not replace it,
   * and nothing here is a second source of truth: both read the same tables.
   *
   * Scope (category subtree, product type, search) is applied in SQL. Facet
   * groups are applied over the scoped set, because their counts have to be
   * computed with each group's own selection excluded. See `facets.ts`.
   */
  async catalogue(input: {
    categoryId?: string | null;
    productTypeId?: string | null;
    search?: string;
    brandIds: string[];
    priceBucketIds: string[];
    ratingId?: string | null;
    marketplaceIds: string[];
    inStockOnly: boolean;
    specFilters: Record<string, string[]>;
    sort: CatalogueSort;
    page: number;
    pageSize: number;
  }) {
    // Referential validation first, so an empty result always means "nothing
    // matched" and never "you filtered on something imaginary".
    for (const [kind, id] of [
      ["category", input.categoryId],
      ["productType", input.productTypeId],
    ] as const) {
      if (id && !(await this.repo.exists(kind, id))) {
        throw new AppError("VALIDATION_FAILED", `Unknown ${kind}: ${id}`, {
          details: [{ field: kind, message: "does not exist" }],
        });
      }
    }

    const categoryIds = input.categoryId ? await this.repo.categorySubtreeIds(input.categoryId) : undefined;

    const scopedRows = await this.repo.scopedSummaries({
      categoryIds,
      productTypeId: input.productTypeId ?? undefined,
      search: input.search,
    });

    /**
     * Spec facets need ONE product type in scope. "RAM" is meaningless across
     * a set containing both shoes and refrigerators, and offering it would
     * invite a filter that silently excludes everything without the key.
     */
    const typesInScope = new Set(scopedRows.map((r) => r.productTypeId));
    const resolvedProductType =
      input.productTypeId ?? (typesInScope.size === 1 ? [...typesInScope][0]! : null);

    const [reviewRows, specDefs, brandRows, marketplaceRows] = await Promise.all([
      this.repo.latestReviewsFor(scopedRows.map((r) => r.productId)),
      resolvedProductType ? this.repo.filterableAttributes(resolvedProductType) : Promise.resolve([]),
      this.repo.listBrands({ page: 1, pageSize: 1000 }),
      this.repo.listMarketplaces(),
    ]);

    /**
     * One rating rule for the whole system. `aggregateReviews` is the same
     * function the analysis and competitor layers call — review-count-weighted
     * mean of each listing's latest rating, with the counts summed. The
     * catalogue once used "take the maximum" and disagreed with the product
     * page on 80 of 89 products; sharing the function is what prevents that
     * returning.
     */
    const reviewsByProduct = new Map<string, Array<{ averageRating: number | null; reviewCount: number | null }>>();
    for (const r of reviewRows) {
      const list = reviewsByProduct.get(r.productId) ?? [];
      list.push({ averageRating: r.averageRating, reviewCount: r.reviewCount });
      reviewsByProduct.set(r.productId, list);
    }

    const scoped: CatalogueSummary[] = scopedRows.map((r) => {
      const review = aggregateReviews(reviewsByProduct.get(r.productId) ?? []);
      return {
        productId: r.productId,
        brandId: r.brandId,
        categoryId: r.categoryId,
        productTypeId: r.productTypeId,
        minPriceMinor: r.minPriceMinor ?? null,
        maxPriceMinor: r.maxPriceMinor ?? null,
        marketplaceIds: r.marketplaceIds ?? [],
        listingCount: r.listingCount,
        offerCount: r.offerCount,
        rating: review.rating,
        reviewCount: review.reviewCount ?? 0,
        inStock: r.inStock,
        firstSeenAt: r.firstSeenAt,
        canonicalName: r.canonicalName,
        specifications: (r.specifications ?? {}) as Record<string, unknown>,
      };
    });

    const buckets = buildPriceBuckets(scoped);
    const { results, facets } = computeFacets({
      scoped,
      selection: {
        brandIds: input.brandIds,
        priceBucketIds: input.priceBucketIds,
        ratingId: input.ratingId ?? null,
        marketplaceIds: input.marketplaceIds,
        inStockOnly: input.inStockOnly,
        specFilters: input.specFilters,
      },
      buckets,
      specDefs: specDefs.map((d) => ({
        attributeKey: d.attributeKey,
        displayName: d.displayName,
        filterType: (d.filterType ?? "enum") as "range" | "enum" | "boolean",
        dataType: d.dataType,
        unit: d.unit,
        buckets: (d.buckets ?? null) as AttributeBucket[] | null,
      })),
      brandsById: new Map(brandRows.rows.map((b) => [b.id, b.name])),
      marketplacesById: new Map(marketplaceRows.map((m) => [m.id, m.name])),
    });

    const ordered = sortSummaries(results, input.sort);
    const offset = (input.page - 1) * input.pageSize;
    const pageRows = ordered.slice(offset, offset + input.pageSize);

    // Identity for the page's rows only — the facet counts already carry the
    // numbers, and hydrating 1,172 products to render 24 would be waste.
    const [detail, cardAttributes, navigation] = await Promise.all([
      this.repo.productIdentity(pageRows.map((r) => r.productId)),
      this.repo.filterableAttributesForTypes([...new Set(pageRows.map((r) => r.productTypeId))]),
      this.navigationFor(input.categoryId ?? null),
    ]);
    const detailById = new Map(detail.map((d) => [d.id, d]));

    /**
     * Which specs a card shows, decided here.
     *
     * The rule is registry-defined — filterable attributes, in registry order,
     * the first few that this product actually has a value for — so it belongs
     * with the registry rather than in the browser. The VALUES travel
     * structured, not pre-rendered: how to write "8 GB" is presentation, and
     * the client keeps it.
     */
    const attrsByType = new Map<string, typeof cardAttributes>();
    for (const a of cardAttributes) {
      const list = attrsByType.get(a.productTypeId) ?? [];
      list.push(a);
      attrsByType.set(a.productTypeId, list);
    }
    const keySpecsFor = (r: CatalogueSummary, limit = 3) => {
      const out: Array<{ key: string; label: string; value: unknown; unit: string | null; dataType: string }> = [];
      for (const def of attrsByType.get(r.productTypeId) ?? []) {
        const value = r.specifications?.[def.attributeKey];
        if (value === undefined || value === null) continue;
        // A false boolean is not worth a card slot — "no 5G" is not a feature.
        if (def.dataType === "boolean" && value !== true) continue;
        out.push({
          key: def.attributeKey,
          label: def.displayName,
          value,
          unit: def.unit,
          dataType: def.dataType,
        });
        if (out.length >= limit) break;
      }
      return out;
    };

    /**
     * Marketplaces as rows, not ids.
     *
     * Sending ids alone forced the browser to keep its own marketplace table
     * to resolve a name and a colour — which is the coupling this migration
     * removes, and the reason a store discovered by a provider rendered as a
     * blank pip with no label. The ids are still included for callers that
     * only need identity.
     */
    const marketplaceById = new Map(marketplaceRows.map((m) => [m.id, m]));

    return {
      data: pageRows.map((r) => ({
        ...shapeCatalogueRow(r, detailById.get(r.productId)),
        keySpecs: keySpecsFor(r),
        marketplaces: r.marketplaceIds
          .map((id) => marketplaceById.get(id))
          .filter((m): m is NonNullable<typeof m> => Boolean(m))
          .map((m) => ({ id: m.id, name: m.name, brandColor: m.brandColor })),
      })),
      pagination: pageMeta(input.page, input.pageSize, ordered.length),
      facets,
      priceBuckets: buckets,
      meta: {
        scopeTotal: scoped.length,
        resolvedProductTypeId: resolvedProductType,
        sort: input.sort,
        ...navigation,
      },
    };
  }

  /** Breadcrumb, sibling categories and the product types a scope offers. */
  private async navigationFor(categoryId: string | null) {
    if (!categoryId) {
      return {
        breadcrumb: [] as Array<{ id: string; name: string; level: number }>,
        childCategories: await this.repo.listCategories({ parentId: null }),
        productTypesInScope: [] as Array<{ id: string; categoryId: string; name: string }>,
      };
    }
    const category = await this.repo.findCategory(categoryId);
    if (!category) return { breadcrumb: [], childCategories: [], productTypesInScope: [] };
    const [breadcrumb, childCategories, productTypesInScope] = await Promise.all([
      this.repo.findCategoryAncestors(category.path),
      this.repo.findChildCategories(category.id),
      this.repo.listProductTypes(category.id),
    ]);
    return { breadcrumb, childCategories, productTypesInScope };
  }

  async listCategories(opts: { parentId?: string | null; level?: number }) {
    return { data: await this.repo.listCategories(opts) };
  }

  async getCategory(id: string) {
    const category = await this.repo.findCategory(id);
    if (!category) throw new AppError("NOT_FOUND", `No category with id ${id}.`);
    const [ancestors, children, types] = await Promise.all([
      this.repo.findCategoryAncestors(category.path),
      this.repo.findChildCategories(category.id),
      this.repo.listProductTypes(category.id),
    ]);
    return { data: { ...category, ancestors, children, productTypes: types } };
  }

  async listBrands(opts: { page: number; pageSize: number; search?: string }) {
    const { rows, total } = await this.repo.listBrands(opts);
    return { data: rows, pagination: pageMeta(opts.page, opts.pageSize, total) };
  }

  async listMarketplaces() {
    return { data: await this.repo.listMarketplaces() };
  }
}

/**
 * One catalogue row: identity, plus the numbers the card shows.
 *
 * `rating`, `reviewCount` and the prices are NULLABLE and stay null when the
 * data is absent. A card that prints "4.0★" for a product with no review
 * snapshot, or "₹0" for one with no in-stock offer, is inventing evidence —
 * and with live provider data those gaps are now common rather than
 * theoretical.
 */
function shapeCatalogueRow(
  s: CatalogueSummary,
  d:
    | {
        id: string;
        canonicalName: string;
        modelName: string;
        isPurchasable: boolean;
        lifecycleStatus: string;
        firstSeenAt: string | null;
        variantAxes: Record<string, string> | null;
        brandId: string;
        brandName: string;
        brandTier: string;
        categoryId: string;
        categoryName: string;
        categoryPath: string;
        productTypeId: string;
        productTypeName: string;
      }
    | undefined
) {
  return {
    product: d
      ? {
          id: d.id,
          canonicalName: d.canonicalName,
          modelName: d.modelName,
          isPurchasable: d.isPurchasable,
          lifecycleStatus: d.lifecycleStatus,
          firstSeenAt: d.firstSeenAt,
          variantAxes: d.variantAxes ?? null,
          brand: { id: d.brandId, name: d.brandName, tier: d.brandTier },
          category: { id: d.categoryId, name: d.categoryName, path: d.categoryPath },
          productType: { id: d.productTypeId, name: d.productTypeName },
        }
      : { id: s.productId, canonicalName: s.canonicalName },
    minPriceMinor: s.minPriceMinor,
    maxPriceMinor: s.maxPriceMinor,
    marketplaceIds: s.marketplaceIds,
    listingCount: s.listingCount,
    offerCount: s.offerCount,
    rating: s.rating,
    reviewCount: s.reviewCount,
    inStock: s.inStock,
  };
}

/** The one place that decides which product columns leave the server. */
function shapeProductSummary(p: {
  id: string;
  canonicalName: string;
  modelName: string;
  isPurchasable: boolean;
  lifecycleStatus: string;
  firstSeenAt: string | null;
  brandId: string;
  brandName: string;
  brandTier: string;
  categoryId: string;
  categoryName: string;
  categoryPath: string;
  productTypeId: string;
  productTypeName: string;
  marketplaceCount: number;
}) {
  return {
    id: p.id,
    canonicalName: p.canonicalName,
    modelName: p.modelName,
    isPurchasable: p.isPurchasable,
    lifecycleStatus: p.lifecycleStatus,
    firstSeenAt: p.firstSeenAt,
    brand: { id: p.brandId, name: p.brandName, tier: p.brandTier },
    category: { id: p.categoryId, name: p.categoryName, path: p.categoryPath },
    productType: { id: p.productTypeId, name: p.productTypeName },
    marketplaceCount: p.marketplaceCount,
  };
}
