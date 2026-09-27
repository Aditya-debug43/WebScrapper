import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

/**
 * Session tokens.
 *
 * Opaque 256-bit random strings, not JWTs. Two reasons, and the first is
 * decisive: logout has to actually invalidate the session, and revoking a
 * stateless token requires a denylist — which is a session table with extra
 * steps and worse failure modes. The second is that an opaque token carries no
 * claims at all, so nothing sensitive can leak out of it by construction.
 *
 * Only the hash is stored. A database dump therefore yields no usable
 * credentials, which is the same reasoning applied to the OTP codes.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(`session:${token}`).digest("hex");
}

export function tokensMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** `Authorization: Bearer <token>` → token, or null when absent/malformed. */
export function bearerFrom(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (!scheme || !value) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return value.trim() || null;
}
