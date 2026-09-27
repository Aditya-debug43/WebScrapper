import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";
import { bearerFrom } from "../lib/tokens.js";
import type { AuthService, PublicUser } from "../modules/auth/auth.service.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Present only after `authenticate` has run on the route. */
    currentUser?: PublicUser;
    sessionId?: string;
    /** The raw bearer token, needed by logout and nothing else. */
    bearerToken?: string;
  }
  interface FastifyInstance {
    /** preHandler for routes that require a signed-in user. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Attaches the user when a valid token is present, but never rejects. */
    optionalAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Authentication as a decorator, registered once.
 *
 * Every protected route reuses this, so there is exactly one place that knows
 * how a credential is read, validated and turned into a user — and exactly one
 * place to change when that changes.
 */
export function registerAuth(app: FastifyInstance, authService: AuthService) {
  const resolve = async (request: FastifyRequest) => {
    const token = bearerFrom(request.headers.authorization);
    if (!token) return null;
    const result = await authService.authenticate(token);
    if (!result) return null;
    request.currentUser = result.user;
    request.sessionId = result.sessionId;
    request.bearerToken = token;
    return result;
  };

  app.decorate("authenticate", async (request: FastifyRequest, _reply: FastifyReply) => {
    const result = await resolve(request);
    if (!result) {
      // One message for "no header", "malformed header", "unknown token",
      // "expired" and "revoked". Telling them apart tells an attacker which
      // token was once real.
      throw new AppError("UNAUTHENTICATED", "Sign in to continue.");
    }
  });

  app.decorate("optionalAuth", async (request: FastifyRequest, _reply: FastifyReply) => {
    await resolve(request);
  });
}
