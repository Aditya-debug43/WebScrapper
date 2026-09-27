import { AppError } from "../../lib/errors.js";
import { pageMeta } from "../../lib/pagination.js";
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

    const siblings = product.parentProductId
      ? await this.repo.findVariantSiblings(product.parentProductId, product.id)
      : [];

    /**
     * Identity only. Prices, offers, reviews and competitors are deliberately
     * absent — they are separate resources with their own pagination and their
     * own cost, and folding them in here is how a detail endpoint becomes the
     * slowest call in the system.
     */
    return {
      data: {
        ...shapeProductSummary(product),
        parentProductId: product.parentProductId,
        variantAxes: product.variantAxes ?? null,
        specifications: product.specifications ?? {},
        specSchemaVersion: product.specSchemaVersion,
        variantSiblings: siblings.map((s) => ({
          id: s.id,
          canonicalName: s.canonicalName,
          variantAxes: s.variantAxes ?? null,
        })),
      },
    };
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
