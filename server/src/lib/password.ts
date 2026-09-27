import argon2 from "argon2";
import { AppError } from "./errors.js";

/**
 * Password hashing.
 *
 * Argon2id, the algorithm OWASP names first for new applications: memory-hard,
 * so a GPU or ASIC gains far less against it than against bcrypt, and
 * side-channel resistant in the `id` variant specifically. Nothing here is
 * hand-rolled — the library owns the salt, the encoding and the verification,
 * and the digest string carries its own parameters so the cost can be raised
 * later without invalidating existing hashes.
 *
 * Parameters are the library defaults (64 MiB, 3 iterations, 4 lanes), which
 * sit on OWASP's recommended settings. They are stated explicitly rather than
 * inherited so that a change is a visible diff.
 */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
} as const;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Policy, deliberately short.
 *
 * Length is the only requirement that reliably correlates with strength;
 * character-class rules mostly push people toward `Password1!`. The upper
 * bound is not a strength rule — it stops a multi-megabyte body becoming a
 * memory-hard hashing job, which is a denial-of-service vector.
 */
export function validatePasswordStrength(password: string): void {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`must be at most ${PASSWORD_MAX_LENGTH} characters`);
  }
  if (/^\s|\s$/.test(password)) {
    problems.push("must not begin or end with a space");
  }
  if (password.trim().length === 0) {
    problems.push("must not be blank");
  }
  // A handful of passwords are guessed before any rate limit engages.
  const COMMON = new Set([
    "password", "password1", "password123", "12345678", "123456789", "qwerty123",
    "letmein123", "welcome123", "admin123", "iloveyou", "11111111", "abc12345",
  ]);
  if (COMMON.has(password.toLowerCase())) {
    problems.push("is too common — choose something less guessable");
  }

  if (problems.length > 0) {
    throw new AppError("VALIDATION_FAILED", `Password ${problems[0]}.`, {
      details: problems.map((message) => ({ field: "password", message })),
    });
  }
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { ...OPTIONS, raw: false });
}

/**
 * Verification never throws on a malformed or absent digest — it returns
 * false, so a corrupt row is a failed login rather than a 500 that tells an
 * attacker they found something interesting.
 */
export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Burn roughly the time a real verification takes, without a hash to check.
 *
 * Login answers in comparable time whether or not the address exists;
 * otherwise the response time is an account-enumeration oracle no matter how
 * carefully the error message is worded.
 */
let decoyHash: string | null = null;
export async function equalisePasswordTiming(password: string): Promise<void> {
  decoyHash ??= await argon2.hash("timing-equalisation-decoy", { ...OPTIONS, raw: false });
  try {
    await argon2.verify(decoyHash!, password);
  } catch {
    /* result is irrelevant; the work is the point */
  }
}
