import type { FastifyInstance } from "fastify";
import { MODEL_VERSIONS, RECOMMENDATION_MODEL_VERSION, type ModelVersion, type PricingService } from "./pricing.service.js";

/**
 * The recommendation endpoint.
 *
 * Authenticated, like the analysis routes it sits on top of: a price
 * recommendation is the product, not the public marketplace data underneath
 * it.
 *
 * There is deliberately NO `window` parameter. A recommendation is
 * measured against the product's whole observed history — its 90-day
 * normal, its distortion reading and its history-depth check all are — so
 * narrowing the history would not ask a different question, it would ask
 * the same one with less evidence. `marketplace` IS offered, because
 * which market you are pricing into genuinely is a different question.
 *
 * `model` selects the recommendation model. It defaults to `baseline-v1` —
 * the migrated frontend engine — and accepts `hedonic-cv-v2`, which differs
 * only in how the attribute model is fitted and trusted. An unknown value is
 * rejected rather than silently falling back, because a caller who thinks it
 * is reading v2 and is actually reading v1 would draw the wrong conclusion
 * from the numbers. Every response states the version that produced it.
 */
export function registerPricingRoutes(app: FastifyInstance, pricing: PricingService) {
  app.get(
    "/products/:id/recommendation",
    {
      preHandler: app.authenticate,
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
          properties: {
            marketplace: { type: "string", minLength: 1, maxLength: 80 },
            model: { type: "string", enum: [...MODEL_VERSIONS], default: RECOMMENDATION_MODEL_VERSION },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const q = request.query as { marketplace?: string; model: ModelVersion };
      return pricing.recommend(id, { marketplaceId: q.marketplace, modelVersion: q.model });
    }
  );
}
