import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { bearerFrom } from "../../lib/tokens.js";
import type { AuthService } from "./auth.service.js";

/**
 * Schemas are declared here and enforced by Fastify before a handler runs, so
 * malformed input never reaches a service or the database.
 *
 * `format: "email"` plus an explicit length bound: the format check alone
 * accepts absurdly long strings, and an address is a database write.
 */
const emailProperty = {
  type: "string",
  format: "email",
  minLength: 3,
  maxLength: 254,
} as const;

const userShape = {
  type: "object",
  properties: {
    id: { type: "string" },
    email: { type: "string" },
    displayName: { type: ["string", "null"] },
    emailVerified: { type: "boolean" },
    lastLoginAt: { type: ["string", "null"] },
    createdAt: { type: "string" },
  },
} as const;

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService) {
  const clientIp = (req: { ip: string }) => req.ip ?? null;

  /**
   * Trim the address before the schema sees it.
   *
   * `format: "email"` rejects surrounding whitespace, so an address pasted
   * with a trailing space was answered with a validation error rather than a
   * sign-in link. preValidation runs before schema checking, which is the one
   * hook where this can be fixed without loosening the format.
   */
  app.addHook("preValidation", async (request) => {
    const body = request.body as { email?: unknown } | undefined;
    if (body && typeof body.email === "string") body.email = body.email.trim();
  });

  app.post(
    "/auth/request-otp",
    {
      config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: env.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000 } },
      schema: {
        body: {
          type: "object",
          required: ["email"],
          additionalProperties: false,
          properties: { email: emailProperty },
        },
      },
    },
    async (request, reply) => {
      const { email } = request.body as { email: string };
      const result = await auth.requestOtp(email, { ip: clientIp(request) });

      // Logged with a masked address and no code, ever.
      request.log.info({ email: AuthServiceLogEmail(email) }, "otp requested");

      return reply.code(202).send({
        // Deliberately the same wording whether or not the account exists.
        message: "If that address can receive mail, a sign-in code is on its way.",
        expiresAt: result.expiresAt,
        ...(result.devCode ? { devCode: result.devCode } : {}),
      });
    }
  );

  app.post(
    "/auth/verify-otp",
    {
      config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: env.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000 } },
      schema: {
        body: {
          type: "object",
          required: ["email", "code"],
          additionalProperties: false,
          properties: {
            email: emailProperty,
            // Digits only, exactly the configured width — a string, never a
            // number, because a code may begin with zero.
            code: { type: "string", pattern: `^[0-9]{${env.OTP_LENGTH}}$` },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              token: { type: "string" },
              expiresAt: { type: "string" },
              isNewUser: { type: "boolean" },
              user: userShape,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, code } = request.body as { email: string; code: string };
      const result = await auth.verifyOtp(email, code, {
        ip: clientIp(request),
        userAgent: request.headers["user-agent"] ?? null,
      });

      request.log.info(
        { userId: result.user.id, isNewUser: result.isNewUser },
        "authenticated"
      );

      return reply.code(200).send(result);
    }
  );

  app.post(
    "/auth/logout",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const token = bearerFrom(request.headers.authorization);
      if (!token) throw new AppError("UNAUTHENTICATED", "Sign in to continue.");
      await auth.logout(token);
      request.log.info({ userId: request.currentUser?.id }, "signed out");
      return reply.code(204).send();
    }
  );

  app.get(
    "/auth/me",
    {
      preHandler: app.authenticate,
      schema: { response: { 200: { type: "object", properties: { user: userShape } } } },
    },
    async (request, reply) => reply.code(200).send({ user: request.currentUser })
  );
}

/** Local helper so routes never construct a log line containing a full address. */
function AuthServiceLogEmail(email: string) {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  return `${local.slice(0, 2)}${local.length > 2 ? "***" : ""}@${domain}`;
}
