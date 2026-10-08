import type { FastifyInstance } from "fastify";
import type { MarketService } from "./market.service.js";
import type { MarketPricingService } from "../pricing/marketPricing.service.js";

/**
 * A PRODUCT'S COMPETITIVE MARKET
 * ==============================
 *
 * The endpoints the previous API had no way to express. It could search, and
 * it could return a recommendation; it could not answer "show me everyone who
 * sells this and what they charge", because nothing in the system held that.
 *
 * Reads are free. `GET /products/:id/market` touches no provider at all — it
 * reports stored evidence — so a seller can keep the screen open, sort it,
 * and compare marketplaces without spending a single call. Capture is a
 * separate, explicit, metered act: `POST /products/:id/capture`.
 *
 * That split is deliberate. When reading and capturing are the same
 * operation, every page view is a purchase, and the only way to control cost
 * becomes showing people less of their own data.
 */

export function registerMarketRoutes(app: FastifyInstance, market: MarketService, pricing: MarketPricingService) {
  const idParam = {
    type: "object",
    required: ["id"],
    additionalProperties: false,
    properties: { id: { type: "string", minLength: 1, maxLength: 120 } },
  } as const;

  /**
   * Who sells this product, at what, where — and where a given price lands.
   *
   * `yourPrice` is optional and is the seller's own intended price. Supplied
   * as a query parameter rather than stored, because it is a question being
   * asked ("if I listed at this, where would I be?") and not a fact about
   * the product.
   */
  app.get(
    "/products/:id/market",
    {
      preHandler: app.authenticate,
      schema: {
        params: idParam,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            /** Major units, as a seller would type it. Converted once, here. */
            yourPrice: { type: "number", minimum: 0, maximum: 100_000_000 },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { yourPrice } = request.query as { yourPrice?: number };
      const data = await market.marketFor(id, {
        yourPriceMinor: yourPrice == null ? null : Math.round(yourPrice * 100),
      });
      return { data };
    }
  );

  /** Each competing seller's own price series, from this system's captures. */
  app.get(
    "/products/:id/market/sellers",
    {
      preHandler: app.authenticate,
      schema: {
        params: idParam,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { days: { type: "integer", minimum: 1, maximum: 365, default: 90 } },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { days } = request.query as { days: number };
      return { data: await market.sellerHistory(id, days) };
    }
  );

  /**
   * Re-open this product's market now.
   *
   * POST, not GET, and rate-limited hard: this is the operation that spends
   * provider calls — one per catalogue id, several per request. It returns
   * what it cost alongside what it found, so the spend is visible at the
   * point it happens rather than only in an aggregate counter.
   */
  app.post(
    "/products/:id/capture",
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        params: idParam,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            /**
             * How many catalogue ids to open. Bounded at eight: beyond that
             * the marginal id is contributing a seller or two for a full
             * call, and the clustering's confidence in it is low enough that
             * it is as likely to be a neighbouring configuration.
             */
            clusterLimit: { type: "integer", minimum: 1, maximum: 8 },
            /** Bypass the snapshot freshness window, still floored by config. */
            force: { type: "boolean", default: false },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { clusterLimit?: number; force?: boolean };
      /**
       * A waiting request, so the capture gets a wall-clock deadline and
       * takes whatever has arrived by it. Overrunning the gateway loses the
       * answer entirely — the work completes and the caller is told it
       * failed — which is strictly worse than a partial market.
       *
       * The clock starts here, at the edge, so every phase inside shares one
       * budget instead of each getting its own.
       */
      const result = await market.refreshProduct(id, {
        clusterLimit: body.clusterLimit,
        force: body.force,
        deadlineAt: Date.now() + 20_000,
      });
      return {
        data: {
          productId: result.productId,
          productName: result.productName,
          catalogIds: result.catalogIds,
          providerCalls: result.providerCalls,
          sellers: result.persisted.sellersWritten,
          marketplaces: result.persisted.marketplacesWritten,
          observations: result.persisted.observationsWritten,
          /** Ids the clustering declined, with reasons. Explains a thin market. */
          rejected: result.rejected.slice(0, 20),
        },
      };
    }
  );

  /**
   * What to sell at, argued from the competition above.
   *
   * The same engine the discovery module exposes, reachable from the market
   * screen so a seller does not have to navigate away from the evidence to
   * see the conclusion drawn from it.
   */
  app.get(
    "/products/:id/recommended-price",
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        params: idParam,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            refresh: { type: "boolean", default: false },
            yourPrice: { type: "number", minimum: 0, maximum: 100_000_000 },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { refresh, yourPrice } = request.query as { refresh: boolean; yourPrice?: number };
      return pricing.recommend(id, {
        refresh,
        yourPriceMinor: yourPrice == null ? null : Math.round(yourPrice * 100),
      });
    }
  );
}
