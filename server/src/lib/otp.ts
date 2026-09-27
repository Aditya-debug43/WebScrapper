import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

/**
 * One-time codes.
 *
 * `randomInt` is the CSPRNG, not `Math.random` — a predictable code is not a
 * second factor. Codes are fixed width and may begin with zero, so they are
 * handled as strings throughout and never parsed to a number.
 */
export function generateOtp(length = env.OTP_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i++) out += randomInt(0, 10).toString();
  return out;
}

/**
 * Stored form of a code.
 *
 * HMAC-SHA256 under AUTH_SECRET rather than a bare digest, because the
 * keyspace is tiny: a six-digit code has a million possibilities, so
 * `sha256(code)` falls to a rainbow table the instant the database leaks. The
 * pepper lives in the environment, not the database, so a dump of one is not
 * enough. The email is mixed in so a hash cannot be replayed against a
 * different address.
 *
 * Deliberately not bcrypt/scrypt: the secret is what provides the work factor
 * here, and verification sits on the login path where a deliberate 100ms is a
 * denial-of-service lever rather than a security gain.
 */
export function hashOtp(code: string, email: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(`otp:${email}:${code}`).digest("hex");
}

/** Constant-time compare, so a wrong code cannot be narrowed by timing. */
export function verifyOtpHash(code: string, email: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashOtp(code, email), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
