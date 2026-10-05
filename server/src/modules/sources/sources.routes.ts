import type { FastifyInstance } from "fastify";
import type { SourcesService } from "./sources.service.js";

/**
 * Data-source provenance — read-only, authenticated.
 *
 * Authenticated for a stronger reason than the catalogue is: these rows name
 * the providers in use, the queries sent to them and the URLs they returned.
 * That is a description of how this system acquires its data, which is not
 * something to hand to an anonymous caller.
 *
 * Both limits are bounded by schema. `raw_documents` and `capture_runs` grow
 * without bound, so an endpoint that could return all of them is one that
 * eventually would.
 */

const RUN_LIMIT_DEFAULT = 20;
const REJECTION_LIMIT_DEFAULT = 20;
const LIMIT_MAX = 200;

export function registerSourcesRoutes(app: FastifyInstance, sources: SourcesService) {
  app.get(
    "/sources",
    {
      preHandler: app.authenticate,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            runLimit: { type: "integer", minimum: 1, maximum: LIMIT_MAX, default: RUN_LIMIT_DEFAULT },
            rejectionLimit: {
              type: "integer",
              minimum: 1,
              maximum: LIMIT_MAX,
              default: REJECTION_LIMIT_DEFAULT,
            },
          },
        },
      },
    },
    async (request) => {
      const q = request.query as { runLimit: number; rejectionLimit: number };
      return sources.overview({ runLimit: q.runLimit, rejectionLimit: q.rejectionLimit });
    }
  );
}
