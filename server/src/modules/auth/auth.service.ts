import { randomBytes } from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { normalizeEmail, maskEmail } from "../../lib/email.js";
import { generateOtp, hashOtp, verifyOtpHash } from "../../lib/otp.js";
import { generateSessionToken, hashToken } from "../../lib/tokens.js";
import { hashPassword, verifyPassword, validatePasswordStrength, equalisePasswordTiming } from "../../lib/password.js";
import { otpMessage, type EmailAdapter } from "../../email/index.js";
import { OTP_PURPOSE, type AuthRepository, type OtpPurpose } from "./auth.repository.js";

export type PublicUser = {
  id: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

/**
 * AUTHENTICATION POLICY
 * =====================
 *
 * The credential is **email + password**. A one-time code is never a way to
 * log in; it does exactly two jobs, and the database enforces the difference:
 *
 *   email_verification  proves the address at signup
 *   password_reset      authorises replacing a forgotten password
 *
 * No SQL and no HTTP here — the repository owns one and the routes own the
 * other, so this file reads as the policy it is.
 */
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly email: EmailAdapter,
    private readonly now: () => Date = () => new Date()
  ) {}

  /* ===================================================== registration */

  /**
   * Create an account and send a verification code.
   *
   * The user row is written BEFORE verification, with `emailVerifiedAt` null.
   * The alternative — holding a pending signup somewhere else until the code
   * is confirmed — is a second user table with extra steps, and it gives up
   * the unique index that makes duplicate accounts impossible. An unverified
   * row cannot log in and cannot reach anything protected, so it is inert
   * until the address is proven.
   *
   * Re-registering an address that exists but was never verified is treated
   * as correcting an abandoned signup: the password is replaced and a fresh
   * code is sent. It is not an error, and it does not create a second row.
   */
  async register(rawEmail: string, password: string, ctx: { ip: string | null }) {
    const email = normalizeEmail(rawEmail);
    validatePasswordStrength(password);
    const now = this.now();

    const existing = await this.repo.findUserByEmail(email);

    if (existing?.emailVerifiedAt) {
      // A verified account is a hard stop. Registration is the one place this
      // is worth stating plainly: the alternative is a user who cannot sign
      // up, cannot sign in, and is told nothing useful about why.
      throw new AppError("EMAIL_IN_USE", "An account already exists for this email. Try signing in instead.");
    }

    const passwordHash = await hashPassword(password);
    const user = existing
      ? (await this.repo.replacePasswordHash(existing.id, passwordHash, now), existing)
      : await this.repo.createUser(email, passwordHash);

    const challenge = await this.issueCode(email, OTP_PURPOSE.emailVerification, ctx.ip, now);

    return {
      email,
      maskedEmail: maskEmail(email),
      userId: user.id,
      expiresAt: challenge.expiresAt,
      ...(challenge.devCode ? { devCode: challenge.devCode } : {}),
    };
  }

  /** A fresh verification code for an account that has not verified yet. */
  async resendVerification(rawEmail: string, ctx: { ip: string | null }) {
    const email = normalizeEmail(rawEmail);
    const now = this.now();
    const user = await this.repo.findUserByEmail(email);

    // Neutral when there is nothing to do: neither "no such account" nor
    // "already verified" is worth telling an unauthenticated caller.
    if (!user || user.emailVerifiedAt) {
      return { email, maskedEmail: maskEmail(email), expiresAt: null as string | null };
    }

    const challenge = await this.issueCode(email, OTP_PURPOSE.emailVerification, ctx.ip, now);
    return {
      email,
      maskedEmail: maskEmail(email),
      expiresAt: challenge.expiresAt,
      ...(challenge.devCode ? { devCode: challenge.devCode } : {}),
    };
  }

  /**
   * Confirm the address and sign the user in.
   *
   * Signing them in here is safe and is the better experience: to reach this
   * point they supplied the password at registration *and* proved control of
   * the mailbox, which is strictly more than a normal login establishes.
   */
  async verifyEmail(rawEmail: string, code: string, ctx: { ip: string | null; userAgent: string | null }) {
    const email = normalizeEmail(rawEmail);
    const now = this.now();

    const challenge = await this.consumeCode(email, OTP_PURPOSE.emailVerification, code, now);

    const user = await this.repo.findUserByEmail(email);
    if (!user) throw new AppError("OTP_INVALID", "That code is not correct.");
    if (!user.isActive) throw new AppError("ACCOUNT_INACTIVE", "This account is not active.");

    if (!user.emailVerifiedAt) await this.repo.markEmailVerified(user.id, now);
    await this.repo.markLogin(user.id, now);
    await this.repo.consumeAllForPurpose(email, OTP_PURPOSE.emailVerification, now);
    void challenge;

    const session = await this.openSession(user.id, ctx, now);
    const fresh = (await this.repo.findUserById(user.id))!;
    return { ...session, user: toPublicUser(fresh) };
  }

  /* ============================================================ login */

  /**
   * Email + password. The only way in.
   *
   * Every failure that is not "your address is unverified" returns the same
   * error, and the unknown-account path still pays the cost of a password
   * hash — otherwise the response *time* enumerates accounts however careful
   * the wording is.
   */
  async login(rawEmail: string, password: string, ctx: { ip: string | null; userAgent: string | null }) {
    const email = normalizeEmail(rawEmail);
    const now = this.now();
    const user = await this.repo.findUserByEmail(email);

    if (!user) {
      await equalisePasswordTiming(password);
      throw new AppError("INVALID_CREDENTIALS", "Email or password is incorrect.");
    }

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) throw new AppError("INVALID_CREDENTIALS", "Email or password is incorrect.");
    if (!user.isActive) throw new AppError("ACCOUNT_INACTIVE", "This account is not active.");

    /**
     * Checked AFTER the password, deliberately. Announcing "this address is
     * unverified" to anyone who types it would leak which addresses have
     * accounts; announcing it to someone who already proved they know the
     * password leaks nothing they did not already know, and they are the only
     * person who can act on it.
     */
    if (!user.emailVerifiedAt) {
      throw new AppError("EMAIL_NOT_VERIFIED", "Verify your email address before signing in.", {
        details: { email, maskedEmail: maskEmail(email) },
      });
    }

    await this.repo.markLogin(user.id, now);
    const session = await this.openSession(user.id, ctx, now);
    const fresh = (await this.repo.findUserById(user.id))!;
    return { ...session, user: toPublicUser(fresh) };
  }

  /* =================================================== password reset */

  /**
   * Always answers the same way. Whether an account exists is not something
   * an unauthenticated caller gets to learn, so the work is done only when
   * there is something to do and the response never varies.
   */
  async forgotPassword(rawEmail: string, ctx: { ip: string | null }) {
    const email = normalizeEmail(rawEmail);
    const now = this.now();
    const user = await this.repo.findUserByEmail(email);

    if (!user || !user.isActive) {
      return { maskedEmail: maskEmail(email) };
    }

    const challenge = await this.issueCode(email, OTP_PURPOSE.passwordReset, ctx.ip, now);
    return {
      maskedEmail: maskEmail(email),
      ...(challenge.devCode ? { devCode: challenge.devCode } : {}),
    };
  }

  /**
   * Verify the reset code and hand back a short-lived token.
   *
   * The challenge is NOT consumed here — the password change spends it. That
   * keeps "one code, one password change" true even though the flow has two
   * steps, and it means an abandoned reset expires on its own.
   */
  async verifyResetOtp(rawEmail: string, code: string) {
    const email = normalizeEmail(rawEmail);
    const now = this.now();
    const challenge = await this.checkCode(email, OTP_PURPOSE.passwordReset, code, now);

    const resetToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + env.RESET_TOKEN_TTL_SECONDS * 1000);
    await this.repo.attachResetToken(challenge.id, hashToken(resetToken), expiresAt);

    return { resetToken, expiresAt: expiresAt.toISOString() };
  }

  async resetPassword(rawEmail: string, resetToken: string, newPassword: string) {
    const email = normalizeEmail(rawEmail);
    validatePasswordStrength(newPassword);
    const now = this.now();

    const challenge = await this.repo.findResetChallenge(email, hashToken(resetToken), now);
    if (!challenge) {
      throw new AppError("RESET_TOKEN_INVALID", "This password reset link has expired. Start again.");
    }

    const user = await this.repo.findUserByEmail(email);
    if (!user) throw new AppError("RESET_TOKEN_INVALID", "This password reset link has expired. Start again.");

    // Spend the challenge first: if anything below fails, the code is still
    // gone, which is the safe direction to fail in.
    const spent = await this.repo.consumeChallenge(challenge.id, now);
    if (!spent) {
      throw new AppError("RESET_TOKEN_INVALID", "This password reset link has expired. Start again.");
    }

    await this.repo.replacePasswordHash(user.id, await hashPassword(newPassword), now);

    /**
     * A reset is a recovery action: the person doing it may not be the person
     * currently signed in, and if the account was compromised the attacker's
     * session is exactly what must not survive. Everything is revoked and the
     * user signs in again with the new password.
     */
    const revoked = await this.repo.revokeAllSessions(user.id, now);

    // Verifying a reset code also proves the address, for an account that
    // never finished signup.
    if (!user.emailVerifiedAt) await this.repo.markEmailVerified(user.id, now);

    return { sessionsRevoked: revoked };
  }

  /* ========================================================== session */

  async authenticate(token: string) {
    const now = this.now();
    const hit = await this.repo.findLiveSession(hashToken(token), now);
    if (!hit) return null;
    if (!hit.user.isActive) return null;
    // An unverified account cannot hold a session, but check anyway: a token
    // issued before a state change must not outlive it.
    if (!hit.user.emailVerifiedAt) return null;
    await this.repo.touchSession(hit.session.id, now);
    return { user: toPublicUser(hit.user), sessionId: hit.session.id };
  }

  /** Idempotent: logging out a dead session is a success, not an error. */
  async logout(token: string) {
    await this.repo.revokeSession(hashToken(token), this.now());
  }

  /* ========================================================== internals */

  private async openSession(
    userId: string,
    ctx: { ip: string | null; userAgent: string | null },
    now: Date
  ) {
    const token = generateSessionToken();
    const expiresAt = new Date(now.getTime() + env.SESSION_TTL_DAYS * 86_400_000);
    await this.repo.createSession({
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: ctx.userAgent,
      ip: ctx.ip,
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /** Cooldown, hourly ceiling, generate, store the hash, send. */
  private async issueCode(email: string, purpose: OtpPurpose, ip: string | null, now: Date) {
    const latest = await this.repo.latestChallenge(email, purpose);
    if (latest) {
      const elapsed = now.getTime() - new Date(latest.createdAt).getTime();
      const cooldown = env.OTP_RESEND_COOLDOWN_SECONDS * 1000;
      if (elapsed < cooldown) {
        const retryAfter = Math.ceil((cooldown - elapsed) / 1000);
        throw new AppError("OTP_COOLDOWN", `Please wait ${retryAfter} seconds before requesting another code.`, {
          details: { retryAfterSeconds: retryAfter },
        });
      }
    }

    const hourAgo = new Date(now.getTime() - 3_600_000);
    if ((await this.repo.countChallengesSince(email, purpose, hourAgo)) >= env.OTP_MAX_PER_EMAIL_PER_HOUR) {
      throw new AppError("RATE_LIMITED", "Too many codes requested for this address. Try again later.");
    }

    const code = generateOtp();
    const expiresAt = new Date(now.getTime() + env.OTP_TTL_SECONDS * 1000);
    const challenge = await this.repo.createChallenge({
      email,
      purpose,
      codeHash: hashOtp(code, `${purpose}:${email}`),
      expiresAt,
      requestIp: ip,
    });

    /**
     * The row is written before the send, so a code can never be delivered
     * that this server cannot verify. The cost is that a FAILED send leaves
     * a challenge behind — and the cooldown would then punish the user for
     * our outage, answering their retry with "please wait 47 seconds" when
     * nothing was ever delivered.
     *
     * So a failed send removes its own challenge — removes, not consumes,
     * because the cooldown is measured from the newest row whether or not
     * it was spent. The error still propagates: the caller is told delivery
     * failed, never that a code is on its way. Transports that cannot fail
     * (memory, console) never take this path, which is why it did not exist
     * before SMTP.
     */
    try {
      await this.email.send(otpMessage(email, code, env.OTP_TTL_SECONDS, purpose));
    } catch (cause) {
      await this.repo.deleteChallenge(challenge.id).catch(() => {});
      throw cause;
    }

    return {
      expiresAt: expiresAt.toISOString(),
      devCode: env.EXPOSE_OTP_IN_RESPONSE ? code : undefined,
    };
  }

  /**
   * Validate a code without consuming it. Attempts are counted BEFORE the
   * comparison, so a wrong guess always costs something.
   */
  private async checkCode(email: string, purpose: OtpPurpose, code: string, now: Date) {
    const challenge = await this.repo.activeChallenge(email, purpose, now);
    if (!challenge) {
      const latest = await this.repo.latestChallenge(email, purpose);
      if (latest?.consumedAt) {
        throw new AppError("OTP_ALREADY_USED", "That code has already been used. Request a new one.");
      }
      throw new AppError("OTP_EXPIRED", "That code has expired. Request a new one.");
    }

    if (challenge.attemptCount >= env.OTP_MAX_ATTEMPTS) {
      throw new AppError("OTP_TOO_MANY_ATTEMPTS", "Too many incorrect attempts. Request a new code.");
    }

    const attempts = await this.repo.incrementAttempts(challenge.id);

    if (!verifyOtpHash(code, `${purpose}:${email}`, challenge.codeHash)) {
      const remaining = Math.max(env.OTP_MAX_ATTEMPTS - attempts, 0);
      if (remaining === 0) {
        throw new AppError("OTP_TOO_MANY_ATTEMPTS", "Too many incorrect attempts. Request a new code.");
      }
      throw new AppError("OTP_INVALID", "That code is not correct.", {
        details: { attemptsRemaining: remaining },
      });
    }

    return challenge;
  }

  /** Validate and spend, in that order. */
  private async consumeCode(email: string, purpose: OtpPurpose, code: string, now: Date) {
    const challenge = await this.checkCode(email, purpose, code, now);
    if (!(await this.repo.consumeChallenge(challenge.id, now))) {
      throw new AppError("OTP_ALREADY_USED", "That code has already been used. Request a new one.");
    }
    return challenge;
  }
}

/** The only shape a user ever leaves the server in. No hash, ever. */
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
