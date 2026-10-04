import type { FastifyInstance } from "fastify";
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "../../lib/pagination.js";
import type { CatalogueService } from "./catalogue.service.js";

/**
 * Read-only catalogue routes.
 *
 * Every query parameter is bounded by schema before a handler sees it:
 * `page` cannot be zero or negative, `pageSize` cannot be used to ask for the
 * whole table, and `sort` is an enum rather than a string that reaches an
 * ORDER BY. Unknown parameters are rejected rather than ignored, so a typo in
 * a filter name fails loudly instead of silently widening the result.
 */
const paginationProps = {
  page: { type: "integer", minimum: 1, default: 1 },
  pageSize: { type: "integer", minimum: 1, maximum: PAGE_SIZE_MAX, default: PAGE_SIZE_DEFAULT },
} as const;

/** `a,b,c` → `["a","b","c"]`. Absent or empty means no selection, not none. */
function csv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * `ram_gb:8,12;storage_gb:256` → `{ ram_gb: ["8","12"], storage_gb: ["256"] }`
 *
 * Values stay strings. They are compared against the spec document as the UI
 * displayed them, and coercing "8" to 8 here would start a disagreement about
 * what `8` and `8.0` mean that the comparison does not need to have.
 */
function parseSpecs(value: string | undefined): Record<string, string[]> {
  if (!value) return {};
  const out: Record<string, string[]> = {};
  for (const group of value.split(";")) {
    const [key, list] = group.split(":");
    const trimmed = key?.trim();
    if (!trimmed || !list) continue;
    const values = csv(list);
    if (values.length) out[trimmed] = values;
  }
  return out;
}

export function registerCatalogueRoutes(app: FastifyInstance, catalogue: CatalogueService) {
  /**
   * The catalogue screen: results, facet counts and navigation in one call.
   *
   * Multi-select groups arrive as comma-separated lists, which keeps the URL
   * shareable and the querystring schema flat. `specs` is the one nested
   * parameter — `specs=ram_gb:8,12;storage_gb:256` — because the keys are not
   * known in advance: they come from the attribute registry, so they cannot be
   * enumerated in a schema.
   */
  app.get(
    "/catalogue",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            ...paginationProps,
            category: { type: "string", maxLength: 80 },
            productType: { type: "string", maxLength: 80 },
            search: { type: "string", maxLength: 120 },
            brands: { type: "string", maxLength: 600 },
            prices: { type: "string", maxLength: 300 },
            rating: { type: "string", enum: ["r4", "r35", "r3"] },
            marketplaces: { type: "string", maxLength: 600 },
            inStock: { type: "boolean", default: false },
            specs: { type: "string", maxLength: 800 },
            sort: {
              type: "string",
              enum: ["relevance", "price_asc", "price_desc", "rating", "reviews", "recent", "name_asc", "name_desc"],
              default: "relevance",
            },
          },
        },
      },
    },
    async (request) => {
      const q = request.query as {
        page: number;
        pageSize: number;
        category?: string;
        productType?: string;
        search?: string;
        brands?: string;
        prices?: string;
        rating?: "r4" | "r35" | "r3";
        marketplaces?: string;
        inStock: boolean;
        specs?: string;
        sort: Parameters<CatalogueService["catalogue"]>[0]["sort"];
      };

      return catalogue.catalogue({
        page: q.page,
        pageSize: q.pageSize,
        categoryId: q.category ?? null,
        productTypeId: q.productType ?? null,
        search: q.search?.trim() || undefined,
        brandIds: csv(q.brands),
        priceBucketIds: csv(q.prices),
        ratingId: q.rating ?? null,
        marketplaceIds: csv(q.marketplaces),
        inStockOnly: q.inStock,
        specFilters: parseSpecs(q.specs),
        sort: q.sort,
      });
    }
  );

  app.get(
    "/products",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            ...paginationProps,
            search: { type: "string", minLength: 1, maxLength: 120 },
            category: { type: "string", maxLength: 80 },
            productType: { type: "string", maxLength: 80 },
            brand: { type: "string", maxLength: 80 },
            marketplace: { type: "string", maxLength: 80 },
            sort: { type: "string", enum: ["relevance", "name_asc", "name_desc", "newest"], default: "relevance" },
          },
        },
      },
    },
    async (request) => {
      const q = request.query as {
        page: number;
        pageSize: number;
        search?: string;
        category?: string;
        productType?: string;
        brand?: string;
        marketplace?: string;
        sort: "relevance" | "name_asc" | "name_desc" | "newest";
      };
      return catalogue.listProducts({
        page: q.page,
        pageSize: q.pageSize,
        search: q.search?.trim() || undefined,
        categoryId: q.category,
        productTypeId: q.productType,
        brandId: q.brand,
        marketplaceId: q.marketplace,
        sort: q.sort,
      });
    }
  );

  app.get(
    "/products/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", minLength: 1, maxLength: 120 } },
        },
      },
    },
    async (request) => catalogue.getProduct((request.params as { id: string }).id)
  );

  app.get(
    "/categories",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            // "root" is how a caller asks for departments — parentId IS NULL
            // cannot be expressed as a query-string value otherwise.
            parent: { type: "string", maxLength: 80 },
            level: { type: "integer", minimum: 0, maximum: 10 },
          },
        },
      },
    },
    async (request) => {
      const q = request.query as { parent?: string; level?: number };
      return catalogue.listCategories({
        parentId: q.parent === "root" ? null : q.parent,
        level: q.level,
      });
    }
  );

  app.get(
    "/categories/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", minLength: 1, maxLength: 80 } },
        },
      },
    },
    async (request) => catalogue.getCategory((request.params as { id: string }).id)
  );

  app.get(
    "/brands",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { ...paginationProps, search: { type: "string", minLength: 1, maxLength: 80 } },
        },
      },
    },
    async (request) => {
      const q = request.query as { page: number; pageSize: number; search?: string };
      return catalogue.listBrands({ page: q.page, pageSize: q.pageSize, search: q.search?.trim() || undefined });
    }
  );

  app.get("/marketplaces", async () => catalogue.listMarketplaces());
}
