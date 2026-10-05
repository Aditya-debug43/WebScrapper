import type { FastifyInstance } from "fastify";
import { PAGE_SIZE_MAX } from "../../lib/pagination.js";
import { DEFAULT_WINDOW, WINDOW_KEYS, type WindowKey } from "../../lib/windows.js";
import type { AnalysisService } from "./analysis.service.js";

/**
 * Analysis routes.
 *
 * AUTHENTICATED, unlike the Phase 3 and Phase 4 read APIs. Catalogue and
 * marketplace data describe public marketplaces; this is the derived
 * intelligence built on top of them — who competes with what, where the
 * price sits, what the evidence supports — and that is the product rather
 * than the raw material. It is treated as protected accordingly.
 *
 * Every parameter is bounded by schema before a handler runs. `window` and
 * `tier` are enums, so a client cannot ask for an arbitrary horizon or an
 * invented tier and receive a plausible-looking answer.
 */

const idParam = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: { id: { type: "string", minLength: 1, maxLength: 120 } },
} as const;

export function registerAnalysisRoutes(app: FastifyInstance, analysis: AnalysisService) {
  const id = (request: { params: unknown }) => (request.params as { id: string }).id;

  app.get(
    "/products/:id/competitors",
    {
      preHandler: app.authenticate,
      schema: {
        params: idParam,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            page: { type: "integer", minimum: 1, default: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: PAGE_SIZE_MAX, default: 24 },
            tier: { type: "string", enum: ["direct", "comparable", "reference"] },
            marketplace: { type: "string", minLength: 1, maxLength: 80 },
            minSimilarity: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
    },
    async (request) => {
      const q = request.query as {
        page: number;
        pageSize: number;
        tier?: "direct" | "comparable" | "reference";
        marketplace?: string;
        minSimilarity?: number;
      };
      return analysis.productCompetitors(id(request), {
        page: q.page,
        pageSize: q.pageSize,
        tier: q.tier,
        marketplaceId: q.marketplace,
        minSimilarity: q.minSimilarity,
      });
    }
  );

  app.get(
    "/products/:id/analysis",
    {
      preHandler: app.authenticate,
      schema: {
        params: idParam,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            window: { type: "string", enum: [...WINDOW_KEYS], default: DEFAULT_WINDOW },
            // An explicit range overrides the window.
            from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            marketplace: { type: "string", minLength: 1, maxLength: 80 },
            /**
             * The horizon the NON-PRICE PARAMETERS are measured over.
             *
             * Separate from `window` on purpose. The analysis itself is
             * normally asked for the whole observed history, because the
             * history section states the product's entire captured series —
             * but availability and promotional share are questions about a
             * recent horizon, and the screen has its own selector for them.
             */
            signalWindow: { type: "string", enum: [...WINDOW_KEYS] },
          },
        },
      },
    },
    async (request) => {
      const q = request.query as { window: WindowKey; from?: string; to?: string; marketplace?: string; signalWindow?: WindowKey };
      return analysis.productAnalysis(id(request), {
        window: q.window,
        from: q.from,
        to: q.to,
        marketplaceId: q.marketplace,
        signalWindow: q.signalWindow,
      });
    }
  );
}
