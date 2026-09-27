import type { FastifyError, FastifyInstance } from "fastify";
import { AppError, errorBody } from "../lib/errors.js";

/**
 * One place decides what the client sees when something goes wrong.
 *
 * The rule: known failures are reported precisely, unknown ones are reported
 * as nothing at all. A stack trace, a SQL fragment or a constraint name in a
 * 500 body is a free map of the system, so unrecognised errors are logged in
 * full server-side and answered with a bare INTERNAL_ERROR.
 */
export function registerErrorHandling(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .send(errorBody("NOT_FOUND", `No route for ${request.method} ${request.url}.`));
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      // Expected: a rule fired. Logged at warn with the extra context that is
      // deliberately kept out of the response body.
      request.log.warn(
        { code: error.code, status: error.statusCode, ...(error.logContext ?? {}) },
        error.message
      );
      return reply.code(error.statusCode).send(errorBody(error.code, error.message, error.details));
    }

    // Fastify's own schema validation. Reshaped into the standard envelope so
    // a client never has to parse two error formats.
    if (error.validation) {
      const details = (error.validation ?? []).map((v: { instancePath?: string; params?: Record<string, unknown>; message?: string }) => ({
        field: (v.instancePath || v.params?.["missingProperty"] || "").toString().replace(/^\//, ""),
        message: v.message ?? "is invalid",
      }));
      request.log.warn({ details }, "request validation failed");
      return reply
        .code(400)
        .send(errorBody("VALIDATION_FAILED", "The request did not match the expected shape.", details));
    }

    // @fastify/rate-limit surfaces as a plain 429.
    if (error.statusCode === 429) {
      return reply
        .code(429)
        .send(errorBody("RATE_LIMITED", "Too many requests. Please slow down and try again shortly."));
    }

    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      request.log.warn({ status: error.statusCode }, error.message);
      return reply.code(error.statusCode).send(errorBody("VALIDATION_FAILED", error.message));
    }

    // Unknown. Everything useful goes to the log; nothing goes to the caller.
    request.log.error({ err: error }, "unhandled error");
    return reply
      .code(500)
      .send(errorBody("INTERNAL_ERROR", "Something went wrong on our side. The failure has been logged."));
  });
}
