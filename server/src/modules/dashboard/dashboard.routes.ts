import type { FastifyInstance } from "fastify";
import { DEFAULT_WINDOW, WINDOW_KEYS, type WindowKey } from "../../lib/windows.js";
import type { DashboardService } from "./dashboard.service.js";

/**
 * The desk — one composite read, authenticated.
 *
 * Authenticated because the desk is per-user: without a caller there is no
 * tracked set to read, and the default set would be the only answer this
 * endpoint could ever give.
 *
 * `products` is capped. The whole page's statistics are computed per product,
 * so an uncapped list is a way to ask the server to analyse the entire
 * catalogue in one request.
 */

const MAX_TRACKED = 50;

export function registerDashboardRoutes(app: FastifyInstance, dashboard: DashboardService) {
  app.get(
    "/dashboard",
    {
      preHandler: app.authenticate,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            /** Comma-separated product ids. Omitted means "whatever my desk holds". */
            products: { type: "string", minLength: 1, maxLength: 4000 },
            window: { type: "string", enum: [...WINDOW_KEYS], default: DEFAULT_WINDOW },
          },
        },
      },
    },
    async (request) => {
      const q = request.query as { products?: string; window: WindowKey };
      const productIds = q.products
        ? [...new Set(q.products.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, MAX_TRACKED)
        : undefined;

      // `authenticate` has run, so this is set; the non-null is the same
      // assertion every authenticated handler in this codebase makes.
      return dashboard.desk({
        userId: request.currentUser!.id,
        productIds,
        window: q.window,
      });
    }
  );
}
