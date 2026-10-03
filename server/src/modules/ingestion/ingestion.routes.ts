import type { FastifyInstance } from "fastify";
import { ProviderError } from "../../ingestion/types.js";
import type { IngestionService } from "../../ingestion/ingestion.service.js";

/**
 * Market-data ingestion routes.
 *
 * AUTHENTICATED, and more strictly than the read APIs need to be. Every call
 * here can spend a metered provider request, so an open endpoint is not just
 * a data-exposure question — it is somebody else's bill. The rate limit is
 * the auth-grade one rather than the general one for the same reason.
 *
 * The provider API key never appears in a request, a response, or a log line.
 * The browser asks this server to look something up; this server holds the
 * credential. That is the whole arrangement, and it is why the key lives in
 * `env` and is read in exactly one file.
 */
export function registerIngestionRoutes(app: FastifyInstance, ingestion: IngestionService) {
  app.post(
    "/ingestion/search",
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["query"],
          additionalProperties: false,
          properties: {
            query: { type: "string", minLength: 2, maxLength: 200 },
            /** Bypass the freshness window and fetch again. */
            force: { type: "boolean", default: false },
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { query: string; force: boolean; limit?: number };

      try {
        return await ingestion.ingestQuery(body.query, { force: body.force, limit: body.limit });
      } catch (cause) {
        if (!(cause instanceof ProviderError)) throw cause;

        /**
         * A provider failure is reported as a provider failure.
         *
         * 503 with a retryable flag, never 200 with an empty list. A caller
         * that cannot distinguish "nobody sells this" from "the lookup did
         * not happen" will eventually present the second as the first, and
         * the whole point of this pipeline is that it does not do that.
         *
         * The message is the adapter's own, which never contains the key —
         * the SerpApi adapter redacts it even from the URL it records.
         */
        const status = cause.kind === "quota" ? 429 : cause.kind === "auth" ? 503 : 503;
        return reply.code(status).send({
          error: "market_data_unavailable",
          provider: cause.provider,
          kind: cause.kind,
          retryable: cause.retryable,
          message: cause.message,
        });
      }
    }
  );
}
