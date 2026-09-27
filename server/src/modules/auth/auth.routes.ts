import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { bearerFrom } from "../../lib/tokens.js";
import { maskEmail, normalizeEmail } from "../../lib/email.js";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../lib/password.js";
import type { AuthService } from "./auth.service.js";

/**
 * Schemas are declared here and enforced by Fastify before a handler runs, so
 * malformed input never reaches a service or the database.
 *
 * Passwords are length-bounded in the schema as well as in the policy: the
 * upper bound stops a multi-megabyte body becoming a memory-hard hashing job,
 * and that has to be rejected before the service, not inside it.
 */
const emailProperty = { type: "string", format: "email", minLength: 3, maxLength: 254 } as const;
const passwordProperty = {
  type: "string",
  minLength: PASSWORD_MIN_LENGTH,
  maxLength: PASSWORD_MAX_LENGTH,
} as const;
const codeProperty = { type: "string", pattern: `^[0-9]{${env.OTP_LENGTH}}$` } as const;

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

/** Applied to the endpoints an attacker would hammer. */
const authLimit = {
  rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: env.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000 },
};

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService) {
  const ip = (req: { ip: string }) => req.ip ?? null;
  const ua = (req: { headers: Record<string, unknown> }) => (req.headers["user-agent"] as string) ?? null;

  /**
   * Trim the address before the schema sees it. `format: "email"` rejects
   * surrounding whitespace, so an address pasted with a trailing space would
   * be a validation error rather than a sign-in. preValidation is the one
   * hook that runs before schema checking.
   */
  app.addHook("preValidation", async (request) => {
    const body = request.body as { email?: unknown } | undefined;
    if (body && typeof body.email === "string") body.email = body.email.trim();
  });

  /* ----------------------------------------------------- registration */

  app.post(
    "/auth/register",
    {
      config: authLimit,
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          additionalProperties: false,
          properties: { email: emailProperty, password: passwordProperty },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body as { email: string; password: string };
      const result = await auth.register(email, password, { ip: ip(request) });
      request.log.info({ userId: result.userId }, "account registered, awaiting verification");
      return reply.code(201).send({
        message: "Account created. Check your email for a verification code.",
        maskedEmail: result.maskedEmail,
        expiresAt: result.expiresAt,
        ...(result.devCode ? { devCode: result.devCode } : {}),
      });
    }
  );

  app.post(
    "/auth/resend-verification",
    {
      config: authLimit,
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
      const result = await auth.resendVerification(email, { ip: ip(request) });
      request.log.info({ email: maskEmail(normalizeEmail(email)) }, "verification resend requested");
      return reply.code(202).send({
        // Identical whether the account exists, is already verified, or is
        // genuinely awaiting a code.
        message: "If that account still needs verifying, a new code is on its way.",
        maskedEmail: result.maskedEmail,
        ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
        ...((result as { devCode?: string }).devCode ? { devCode: (result as { devCode?: string }).devCode } : {}),
      });
    }
  );

  app.post(
    "/auth/verify-email",
    {
      config: authLimit,
      schema: {
        body: {
          type: "object",
          required: ["email", "code"],
          additionalProperties: false,
          properties: { email: emailProperty, code: codeProperty },
        },
        response: {
          200: {
            type: "object",
            properties: {
              token: { type: "string" },
              expiresAt: { type: "string" },
              user: userShape,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, code } = request.body as { email: string; code: string };
      const result = await auth.verifyEmail(email, code, { ip: ip(request), userAgent: ua(request) });
      request.log.info({ userId: result.user.id }, "email verified, session opened");
      return reply.code(200).send(result);
    }
  );

  /* ------------------------------------------------------------ login */

  app.post(
    "/auth/login",
    {
      config: authLimit,
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          additionalProperties: false,
          // Length is NOT bounded below here: an existing password predating a
          // policy change must still be accepted, and rejecting it at the
          // schema would lock the user out of their own account.
          properties: { email: emailProperty, password: { type: "string", maxLength: PASSWORD_MAX_LENGTH } },
        },
        response: {
          200: {
            type: "object",
            properties: { token: { type: "string" }, expiresAt: { type: "string" }, user: userShape },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body as { email: string; password: string };
      const result = await auth.login(email, password, { ip: ip(request), userAgent: ua(request) });
      request.log.info({ userId: result.user.id }, "signed in");
      return reply.code(200).send(result);
    }
  );

  /* --------------------------------------------------- password reset */

  app.post(
    "/auth/forgot-password",
    {
      config: authLimit,
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
      const result = await auth.forgotPassword(email, { ip: ip(request) });
      request.log.info({ email: maskEmail(normalizeEmail(email)) }, "password reset requested");
      return reply.code(202).send({
        // Never varies. Whether an account exists is not something an
        // unauthenticated caller gets to learn.
        message: "If an account exists for this email, we have sent a verification code.",
        maskedEmail: result.maskedEmail,
        ...(result.devCode ? { devCode: result.devCode } : {}),
      });
    }
  );

  app.post(
    "/auth/verify-reset-otp",
    {
      config: authLimit,
      schema: {
        body: {
          type: "object",
          required: ["email", "code"],
          additionalProperties: false,
          properties: { email: emailProperty, code: codeProperty },
        },
        response: {
          200: { type: "object", properties: { resetToken: { type: "string" }, expiresAt: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { email, code } = request.body as { email: string; code: string };
      return reply.code(200).send(await auth.verifyResetOtp(email, code));
    }
  );

  app.post(
    "/auth/reset-password",
    {
      config: authLimit,
      schema: {
        body: {
          type: "object",
          required: ["email", "resetToken", "password"],
          additionalProperties: false,
          properties: {
            email: emailProperty,
            resetToken: { type: "string", minLength: 16, maxLength: 200 },
            password: passwordProperty,
          },
        },
      },
    },
    async (request, reply) => {
      const { email, resetToken, password } = request.body as {
        email: string;
        resetToken: string;
        password: string;
      };
      const result = await auth.resetPassword(email, resetToken, password);
      request.log.info({ sessionsRevoked: result.sessionsRevoked }, "password reset");
      return reply.code(200).send({
        message: "Password updated. Sign in with your new password.",
        sessionsRevoked: result.sessionsRevoked,
      });
    }
  );

  /* ---------------------------------------------------------- session */

  app.post("/auth/logout", { preHandler: app.authenticate }, async (request, reply) => {
    const token = bearerFrom(request.headers.authorization);
    if (!token) throw new AppError("UNAUTHENTICATED", "Sign in to continue.");
    await auth.logout(token);
    request.log.info({ userId: request.currentUser?.id }, "signed out");
    return reply.code(204).send();
  });

  app.get(
    "/auth/me",
    {
      preHandler: app.authenticate,
      schema: { response: { 200: { type: "object", properties: { user: userShape } } } },
    },
    async (request, reply) => reply.code(200).send({ user: request.currentUser })
  );
}
