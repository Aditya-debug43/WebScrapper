import type { FastifyInstance } from "fastify";
import type { DiscoveryService } from "./discovery.service.js";
import type { MarketPricingService } from "../pricing/marketPricing.service.js";

/**
 * Live discovery and tracking.
 *
 * Authenticated throughout. Search costs a provider call when nothing fresh
 * is stored, so anonymous access would be an open tap on a metered API; and
 * tracking is inherently per-user.
 *
 * The rate limits here are a second line of defence behind the freshness
 * window — the TTL already means a repeated query returns a stored snapshot
 * rather than buying a call, and these bound the pathological cases.
 */

export function registerDiscoveryRoutes(
  app: FastifyInstance,
  discovery: DiscoveryService,
  pricing: MarketPricingService
) {
  const userId = (request: { currentUser?: { id: string } }) => request.currentUser!.id;

  app.get(
    "/search",
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        querystring: {
          type: "object",
          required: ["q"],
          additionalProperties: false,
          properties: {
            q: { type: "string", minLength: 2, maxLength: 200 },
            limit: { type: "integer", minimum: 1, maximum: 100 },
            /**
             * A deliberate "refresh prices". Still floored by
             * MARKET_DATA_REFRESH_FLOOR_SECONDS — the button is not a licence
             * to spend.
             */
            refresh: { type: "boolean", default: false },
          },
        },
      },
    },
    async (request) => {
      const q = request.query as { q: string; limit?: number; refresh: boolean };
      return discovery.search(q.q, { limit: q.limit, force: q.refresh });
    }
  );

  app.post(
    "/tracked",
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["ref"],
          additionalProperties: false,
          properties: {
            /**
             * The signed reference to a stored search result. Deliberately
             * the ONLY thing accepted: a client that could post a title and a
             * price could ask to track a product at a price nobody offered.
             */
            ref: { type: "string", minLength: 8, maxLength: 512 },
          },
        },
      },
    },
    async (request, reply) => {
      const { ref } = request.body as { ref: string };
      const result = await discovery.track(userId(request), ref);
      return reply.code(201).send(result);
    }
  );

  app.get("/tracked", { preHandler: app.authenticate }, async (request) =>
    discovery.listTracked(userId(request))
  );

  app.delete(
    "/tracked/:id",
    {
      preHandler: app.authenticate,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", minLength: 1, maxLength: 120 } },
        },
      },
    },
    async (request) => discovery.untrack(userId(request), (request.params as { id: string }).id)
  );

  /**
   * A price for a tracked product, from real market evidence.
   *
   * Works with zero history: a single capture already contains what a price
   * has to be argued against. Reuses whatever snapshot is fresh, so opening
   * this straight after a search costs no extra provider call.
   */
  app.get(
    "/products/:id/market-recommendation",
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", minLength: 1, maxLength: 120 } },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { refresh: { type: "boolean", default: false } },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { refresh } = request.query as { refresh: boolean };
      return pricing.recommend(id, { refresh });
    }
  );

  /** Provider usage, so the cost of all this is measurable before it is capped. */
  app.get("/market/usage", { preHandler: app.authenticate }, async () => discovery.usage());
}
