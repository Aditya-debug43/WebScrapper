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

export function registerCatalogueRoutes(app: FastifyInstance, catalogue: CatalogueService) {
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
