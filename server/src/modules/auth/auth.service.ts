import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { normalizeEmail, maskEmail } from "../../lib/email.js";
import { generateOtp, hashOtp, verifyOtpHash } from "../../lib/otp.js";
import { generateSessionToken, hashToken } from "../../lib/tokens.js";
import { otpMessage, type EmailAdapter } from "../../email/index.js";
import type { AuthRepository } from "./auth.repository.js";

export type PublicUser = {
  id: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

/**
 * The authentication rules. No SQL, no HTTP — the repository owns one and the
 * routes own the other, so this file can be read as the policy it is.
 */
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly email: EmailAdapter,
    private readonly now: () => Date = () => new Date()
  ) {}

  /**
   * Step one: issue a code.
   *
   * The response is IDENTICAL whether or not an account exists. Saying "no
   * such user" would turn this endpoint into a membership oracle — anyone
   * could enumerate who has an account — and there is no product reason to
   * reveal it, because the next step works the same either way.
   */
  async requestOtp(rawEmail: string, ctx: { ip: string | null }) {
    const email = normalizeEmail(rawEmail);
    const now = this.now();

    // Resend cooldown, measured from the last challenge issued to this address.
    const latest = await this.repo.latestChallenge(email);
    if (latest) {
      const elapsedMs = now.getTime() - new Date(latest.createdAt).getTime();
      const cooldownMs = env.OTP_RESEND_COOLDOWN_SECONDS * 1000;
      if (elapsedMs < cooldownMs) {
        const retryAfter = Math.ceil((cooldownMs - elapsedMs) / 1000);
        throw new AppError("OTP_COOLDOWN", `Please wait ${retryAfter} seconds before requesting another code.`, {
          details: { retryAfterSeconds: retryAfter },
        });
      }
    }

    // Per-address hourly ceiling, independent of the per-IP limit: one
    // attacker behind many addresses and many attackers behind one address
    // are different problems and need separate bounds.
    const hourAgo = new Date(now.getTime() - 3600_000);
    const recent = await this.repo.countChallengesSince(email, hourAgo);
    if (recent >= env.OTP_MAX_PER_EMAIL_PER_HOUR) {
      throw new AppError("RATE_LIMITED", "Too many codes requested for this address. Try again later.");
    }

    const code = generateOtp();
    const expiresAt = new Date(now.getTime() + env.OTP_TTL_SECONDS * 1000);

    await this.repo.createChallenge({
      email,
      codeHash: hashOtp(code, email),
      expiresAt,
      requestIp: ctx.ip,
    });

    // Sending can fail; the challenge is already stored, which is the right
    // way round — a code that exists but was not delivered is recoverable by
    // resending, whereas a delivered code with no record is not verifiable.
    await this.email.send(otpMessage(email, code, env.OTP_TTL_SECONDS));

    return {
      email,
      expiresAt: expiresAt.toISOString(),
      // Test/development affordance only; the environment schema refuses to
      // start production with this enabled.
      ...(env.EXPOSE_OTP_IN_RESPONSE ? { devCode: code } : {}),
    };
  }

  /**
   * Step two: verify, then create the account if this is a first sign-in.
   *
   * Ordering matters. The code is checked against the newest LIVE challenge
   * only; attempts are counted before the comparison so a wrong guess always
   * costs something; and the challenge is consumed with a conditional update
   * before any user row is touched, so a replay cannot slip in behind it.
   */
  async verifyOtp(rawEmail: string, code: string, ctx: { ip: string | null; userAgent: string | null }) {
    const email = normalizeEmail(rawEmail);
    const now = this.now();

    const challenge = await this.repo.activeChallenge(email, now);
    if (!challenge) {
      // An expired-or-consumed challenge and no challenge at all are reported
      // the same way; distinguishing them tells an attacker whether the
      // address was recently used.
      const latest = await this.repo.latestChallenge(email);
      if (latest?.consumedAt) {
        throw new AppError("OTP_ALREADY_USED", "That code has already been used. Request a new one.");
      }
      throw new AppError("OTP_EXPIRED", "That code has expired. Request a new one.");
    }

    if (challenge.attemptCount >= env.OTP_MAX_ATTEMPTS) {
      throw new AppError("OTP_TOO_MANY_ATTEMPTS", "Too many incorrect attempts. Request a new code.");
    }

    const attempts = await this.repo.incrementAttempts(challenge.id);

    if (!verifyOtpHash(code, email, challenge.codeHash)) {
      const remaining = Math.max(env.OTP_MAX_ATTEMPTS - attempts, 0);
      if (remaining === 0) {
        throw new AppError("OTP_TOO_MANY_ATTEMPTS", "Too many incorrect attempts. Request a new code.");
      }
      throw new AppError("OTP_INVALID", "That code is not correct.", {
        details: { attemptsRemaining: remaining },
      });
    }

    const consumed = await this.repo.consumeChallenge(challenge.id, now);
    if (!consumed) {
      // Lost a race with a concurrent verification of the same code.
      throw new AppError("OTP_ALREADY_USED", "That code has already been used. Request a new one.");
    }
    // Any other outstanding code for this address dies with it.
    await this.repo.consumeAllForEmail(email, now);

    const existing = await this.repo.findUserByEmail(email);
    if (existing && !existing.isActive) {
      throw new AppError("ACCOUNT_INACTIVE", "This account is not active.");
    }

    const isNewUser = existing === null;
    const user = existing ?? (await this.repo.createUserIfAbsent(email, now));
    if (existing) {
      await this.repo.markLogin(user.id, now, existing.emailVerifiedAt === null);
    }

    const token = generateSessionToken();
    const expiresAt = new Date(now.getTime() + env.SESSION_TTL_DAYS * 86_400_000);
    await this.repo.createSession({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: ctx.userAgent,
      ip: ctx.ip,
    });

    const fresh = (await this.repo.findUserById(user.id))!;
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      isNewUser,
      user: toPublicUser(fresh),
    };
  }

  /** Resolve a bearer token to a user, or null. Used by the auth decorator. */
  async authenticate(token: string) {
    const now = this.now();
    const hit = await this.repo.findLiveSession(hashToken(token), now);
    if (!hit) return null;
    if (!hit.user.isActive) return null;
    await this.repo.touchSession(hit.session.id, now);
    return { user: toPublicUser(hit.user), sessionId: hit.session.id };
  }

  /**
   * Idempotent by design: logging out an already-dead session is a success,
   * because the caller's desired state has been reached and reporting an
   * error would only tell them whether the token was real.
   */
  async logout(token: string) {
    await this.repo.revokeSession(hashToken(token), this.now());
  }

  /** Masked address, for logs. */
  static logSafeEmail(email: string) {
    return maskEmail(normalizeEmail(email));
  }
}

export function toPublicUser(u: {
  id: string;
  email: string;
  displayName: string | null;
  emailVerifiedAt: Date | string | null;
  lastLoginAt: Date | string | null;
  createdAt: Date | string;
}): PublicUser {
  const iso = (v: Date | string | null) => (v == null ? null : new Date(v).toISOString());
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    emailVerified: u.emailVerifiedAt != null,
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: iso(u.createdAt)!,
  };
}
