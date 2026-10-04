import type { FastifyInstance } from "fastify";
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "../../lib/pagination.js";
import { DEFAULT_WINDOW, WINDOW_KEYS, type WindowKey } from "../../lib/windows.js";
import type { MarketplaceService } from "./marketplace.service.js";
import type { OfferSort } from "./marketplace.repository.js";

/**
 * Marketplace data routes — read-only.
 *
 * Every parameter is bounded by schema before a handler runs. `sort` is an
 * enum resolved to SQL from a closed map, never a string that reaches an
 * ORDER BY; `window` is an enum, so a client cannot ask for an arbitrary
 * horizon and receive a plausible-looking answer to a question the dataset
 * cannot support. Unknown parameters are rejected rather than ignored, so a
 * misspelled filter fails loudly instead of silently widening the result.
 *
 * Observations are the reason every list here paginates: the table holds
 * 354,940 rows and an endpoint that could return them all is one that
 * eventually will.
 */

const paginationProps = {
  page: { type: "integer", minimum: 1, default: 1 },
  pageSize: { type: "integer", minimum: 1, maximum: PAGE_SIZE_MAX, default: PAGE_SIZE_DEFAULT },
} as const;

const idParam = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: { id: { type: "string", minLength: 1, maxLength: 120 } },
} as const;

const marketplaceProp = { type: "string", minLength: 1, maxLength: 80 } as const;
const dateProp = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;
const windowProp = { type: "string", enum: [...WINDOW_KEYS], default: DEFAULT_WINDOW } as const;

/** Observations are dense, so history pages default larger than a catalogue page. */
const HISTORY_PAGE_DEFAULT = 100;

export function registerMarketplaceRoutes(app: FastifyInstance, marketplace: MarketplaceService) {
  const id = (request: { params: unknown }) => (request.params as { id: string }).id;

  /* ------------------------------------------------- marketplace summary */

  app.get(
    "/products/:id/marketplaces",
    { schema: { params: idParam } },
    async (request) => marketplace.productMarketplaces(id(request))
  );

  /* ---------------------------------------------------------- listings */

  app.get(
    "/products/:id/listings",
    {
      schema: {
        params: idParam,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            ...paginationProps,
            marketplace: marketplaceProp,
            status: { type: "string", enum: ["active", "delisted", "suppressed"] },
          },
        },
      },
    },
    async (request) => {
      const q = request.query as { page: number; pageSize: number; marketplace?: string; status?: string };
      return marketplace.productListings(id(request), {
        page: q.page,
        pageSize: q.pageSize,
        marketplaceId: q.marketplace,
        status: q.status,
      });
    }
  );

  /* ------------------------------------------------------------ sellers */

  app.get(
    "/products/:id/sellers",
    {
      schema: {
        params: idParam,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { ...paginationProps, marketplace: marketplaceProp },
        },
      },
    },
    async (request) => {
      const q = request.query as { page: number; pageSize: number; marketplace?: string };
      return marketplace.productSellers(id(request), {
        page: q.page,
        pageSize: q.pageSize,
        marketplaceId: q.marketplace,
      });
    }
  );

  app.get(
    "/sellers/:id/rating-history",
    {
      schema: {
        params: idParam,
        querystring: { type: "object", additionalProperties: false, properties: { ...paginationProps } },
      },
    },
    async (request) => {
      const q = request.query as { page: number; pageSize: number };
      return marketplace.sellerRatingHistory(id(request), { page: q.page, pageSize: q.pageSize });
    }
  );

  /**
   * One listing, by listing id.
   *
   * The listing screen's address is the listing, not the product, so the
   * product is resolved here rather than required from the caller. Before this
   * existed, a frontend routed to `/listings/:id` had no way to find out which
   * product it belonged to except by keeping its own copy of the listing table.
   */
  app.get("/listings/:id", { schema: { params: idParam } }, async (request) =>
    marketplace.listingDetail(id(request))
  );

  /* ------------------------------------------------------------- offers */

  app.get(
    "/products/:id/offers",
    {
      schema: {
        params: idParam,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            ...paginationProps,
            marketplace: marketplaceProp,
            seller: { type: "string", minLength: 1, maxLength: 120 },
            inStock: { type: "boolean" },
            fulfilment: { type: "string", maxLength: 40 },
            condition: { type: "string", enum: ["new", "renewed", "used"] },
            // Minor units (paise), matching every other money value in the API.
            minPrice: { type: "integer", minimum: 0 },
            maxPrice: { type: "integer", minimum: 0 },
            hasPromotion: { type: "boolean" },
            sort: {
              type: "string",
              enum: [
                "effective_price_asc",
                "effective_price_desc",
                "price_asc",
                "price_desc",
                "seller_name",
                "last_observed",
              ],
              default: "effective_price_asc",
            },
          },
        },
      },
    },
    async (request) => {
      const q = request.query as {
        page: number;
        pageSize: number;
        marketplace?: string;
        seller?: string;
        inStock?: boolean;
        fulfilment?: string;
        condition?: string;
        minPrice?: number;
        maxPrice?: number;
        hasPromotion?: boolean;
        sort: OfferSort;
      };
      return marketplace.productOffers(id(request), {
        page: q.page,
        pageSize: q.pageSize,
        marketplaceId: q.marketplace,
        sellerId: q.seller,
        inStock: q.inStock,
        fulfilment: q.fulfilment,
        condition: q.condition,
        minPriceMinor: q.minPrice,
        maxPriceMinor: q.maxPrice,
        hasPromotion: q.hasPromotion,
        sort: q.sort,
      });
    }
  );

  /* ------------------------------------------------------ price history */

  const historyQuery = {
    type: "object",
    additionalProperties: false,
    properties: {
      page: { type: "integer", minimum: 1, default: 1 },
      pageSize: { type: "integer", minimum: 1, maximum: PAGE_SIZE_MAX, default: HISTORY_PAGE_DEFAULT },
      window: windowProp,
      // An explicit range overrides the window, for questions the seven
      // fixed horizons do not cover.
      from: dateProp,
      to: dateProp,
      marketplace: marketplaceProp,
      seller: { type: "string", minLength: 1, maxLength: 120 },
      offer: { type: "string", minLength: 1, maxLength: 120 },
    },
  } as const;

  app.get(
    "/products/:id/price-history",
    { schema: { params: idParam, querystring: historyQuery } },
    async (request) => {
      const q = request.query as {
        page: number;
        pageSize: number;
        window: WindowKey;
        from?: string;
        to?: string;
        marketplace?: string;
        seller?: string;
        offer?: string;
      };
      return marketplace.productPriceHistory(id(request), {
        page: q.page,
        pageSize: q.pageSize,
        window: q.window,
        from: q.from,
        to: q.to,
        marketplaceId: q.marketplace,
        sellerId: q.seller,
        offerId: q.offer,
      });
    }
  );

  app.get(
    "/offers/:id/price-history",
    {
      schema: {
        params: idParam,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            page: { type: "integer", minimum: 1, default: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: PAGE_SIZE_MAX, default: HISTORY_PAGE_DEFAULT },
            window: windowProp,
            from: dateProp,
            to: dateProp,
          },
        },
      },
    },
    async (request) => {
      const q = request.query as { page: number; pageSize: number; window: WindowKey; from?: string; to?: string };
      return marketplace.offerPriceHistory(id(request), {
        page: q.page,
        pageSize: q.pageSize,
        window: q.window,
        from: q.from,
        to: q.to,
      });
    }
  );

  /**
   * Current state beside historical context, at several horizons at once.
   *
   * Factual and statistical only — no recommendation, no judgement about
   * whether a price is good. That remains a later phase and a different
   * module.
   */
  app.get(
    "/products/:id/price-summary",
    {
      schema: {
        params: idParam,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            windows: {
              type: "array",
              items: { type: "string", enum: [...WINDOW_KEYS] },
              minItems: 1,
              maxItems: WINDOW_KEYS.length,
              default: ["7d", "1m", "3m"],
            },
            marketplace: marketplaceProp,
          },
        },
      },
    },
    async (request) => {
      const q = request.query as { windows: WindowKey[]; marketplace?: string };
      // AJV's `coerceTypes: "array"` turns a single ?windows=7d into ["7d"],
      // so one value and several behave the same way.
      const unique = [...new Set(q.windows)];
      return marketplace.priceSummary(id(request), { windows: unique, marketplaceId: q.marketplace });
    }
  );

  /* ------------------------------------------------------------ reviews */

  app.get(
    "/products/:id/reviews",
    {
      schema: {
        params: idParam,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { ...paginationProps, marketplace: marketplaceProp },
        },
      },
    },
    async (request) => {
      const q = request.query as { page: number; pageSize: number; marketplace?: string };
      return marketplace.productReviews(id(request), {
        page: q.page,
        pageSize: q.pageSize,
        marketplaceId: q.marketplace,
      });
    }
  );

  app.get(
    "/products/:id/rating-history",
    {
      schema: {
        params: idParam,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { window: windowProp, from: dateProp, to: dateProp, marketplace: marketplaceProp },
        },
      },
    },
    async (request) => {
      const q = request.query as { window: WindowKey; from?: string; to?: string; marketplace?: string };
      return marketplace.productRatingHistory(id(request), {
        window: q.window,
        from: q.from,
        to: q.to,
        marketplaceId: q.marketplace,
      });
    }
  );

  /* --------------------------------------------------------- promotions */

  app.get(
    "/products/:id/promotions",
    {
      schema: {
        params: idParam,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            ...paginationProps,
            marketplace: marketplaceProp,
            offer: { type: "string", minLength: 1, maxLength: 120 },
            availabilityClass: { type: "string", enum: ["universal", "conditional", "deferred", "financing"] },
            status: { type: "string", enum: ["active", "expired", "all"], default: "all" },
          },
        },
      },
    },
    async (request) => {
      const q = request.query as {
        page: number;
        pageSize: number;
        marketplace?: string;
        offer?: string;
        availabilityClass?: string;
        status: "active" | "expired" | "all";
      };
      return marketplace.productPromotions(id(request), {
        page: q.page,
        pageSize: q.pageSize,
        marketplaceId: q.marketplace,
        offerId: q.offer,
        availabilityClass: q.availabilityClass,
        status: q.status,
      });
    }
  );
}
