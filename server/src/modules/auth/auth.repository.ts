import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { otpChallenges, sessions, users } from "../../db/schema.js";

/**
 * All SQL for authentication. Services hold the rules; this holds the
 * queries. Nothing above this layer writes a WHERE clause.
 */

/**
 * What a one-time code is for. Kept as a closed union here and as a check
 * constraint in the database, so a verification code can never authorise a
 * password reset and vice versa.
 */
export const OTP_PURPOSE = {
  emailVerification: "email_verification",
  passwordReset: "password_reset",
} as const;
export type OtpPurpose = (typeof OTP_PURPOSE)[keyof typeof OTP_PURPOSE];

export class AuthRepository {
  constructor(private readonly db: Db) {}

  /* ------------------------------------------------------------- users */

  /**
   * Looked up on `lower(email)` so the query uses the functional unique index
   * and cannot miss a row differing only in case.
   */
  async findUserByEmail(email: string) {
    const rows = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);
    return rows[0] ?? null;
  }

  async findUserById(id: string) {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * Insert, or return the row that already exists.
   *
   * Resolved by the database rather than by a read followed by a write: two
   * simultaneous registrations would both see "no user" and both insert.
   * `onConflictDoNothing` against the unique index makes the loser a no-op,
   * and the follow-up read returns the winner.
   */
  async createUser(email: string, passwordHash: string) {
    await this.db.insert(users).values({ email, passwordHash }).onConflictDoNothing();
    const user = await this.findUserByEmail(email);
    if (!user) throw new Error(`User row missing immediately after insert for ${email}`);
    return user;
  }

  /** Replace the credential on an account that exists but is not yet verified. */
  async replacePasswordHash(userId: string, passwordHash: string, now: Date) {
    await this.db.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, userId));
  }

  async markEmailVerified(userId: string, now: Date) {
    await this.db
      .update(users)
      .set({ emailVerifiedAt: now, updatedAt: now })
      .where(eq(users.id, userId));
  }

  async markLogin(userId: string, now: Date) {
    await this.db.update(users).set({ lastLoginAt: now, updatedAt: now }).where(eq(users.id, userId));
  }

  /* -------------------------------------------------------- challenges */

  async createChallenge(row: {
    email: string;
    purpose: OtpPurpose;
    codeHash: string;
    expiresAt: Date;
    requestIp: string | null;
  }) {
    const inserted = await this.db.insert(otpChallenges).values(row).returning();
    return inserted[0]!;
  }

  /** The newest challenge of this purpose, consumed or not. */
  async latestChallenge(email: string, purpose: OtpPurpose) {
    const rows = await this.db
      .select()
      .from(otpChallenges)
      .where(and(eq(otpChallenges.email, email), eq(otpChallenges.purpose, purpose)))
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * The newest challenge of this purpose that is still usable. Verification
   * targets only this one, so an older outstanding code cannot be used after
   * a resend.
   */
  async activeChallenge(email: string, purpose: OtpPurpose, now: Date) {
    const rows = await this.db
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.email, email),
          eq(otpChallenges.purpose, purpose),
          isNull(otpChallenges.consumedAt),
          gt(otpChallenges.expiresAt, now)
        )
      )
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async countChallengesSince(email: string, purpose: OtpPurpose, since: Date) {
    const rows = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.email, email),
          eq(otpChallenges.purpose, purpose),
          gt(otpChallenges.createdAt, since)
        )
      );
    return rows[0]?.n ?? 0;
  }

  async incrementAttempts(id: string) {
    const rows = await this.db
      .update(otpChallenges)
      .set({ attemptCount: sql`${otpChallenges.attemptCount} + 1` })
      .where(eq(otpChallenges.id, id))
      .returning({ attemptCount: otpChallenges.attemptCount });
    return rows[0]?.attemptCount ?? 0;
  }

  /**
   * Consume, conditional on still being unconsumed. The `isNull` in the WHERE
   * is what makes reuse impossible under concurrency: two simultaneous
   * verifications both pass validation, but only one UPDATE matches a row.
   */
  async consumeChallenge(id: string, now: Date) {
    const rows = await this.db
      .update(otpChallenges)
      .set({ consumedAt: now })
      .where(and(eq(otpChallenges.id, id), isNull(otpChallenges.consumedAt)))
      .returning({ id: otpChallenges.id });
    return rows.length === 1;
  }

  /**
   * Remove a challenge outright.
   *
   * The one caller is a FAILED send. Consuming it would not do: the resend
   * cooldown is measured from the newest challenge whether or not it was
   * consumed, so a code that never left the building would still lock the
   * user out of asking for another one. A code that was not delivered was
   * never issued, and the row should say so.
   */
  async deleteChallenge(id: string) {
    await this.db.delete(otpChallenges).where(eq(otpChallenges.id, id));
  }

  /** Supersede every outstanding code of one purpose for this address. */
  async consumeAllForPurpose(email: string, purpose: OtpPurpose, now: Date) {
    await this.db
      .update(otpChallenges)
      .set({ consumedAt: now })
      .where(
        and(
          eq(otpChallenges.email, email),
          eq(otpChallenges.purpose, purpose),
          isNull(otpChallenges.consumedAt)
        )
      );
  }

  /* ------------------------------------------------------ reset tokens */

  async attachResetToken(id: string, tokenHash: string, expiresAt: Date) {
    await this.db
      .update(otpChallenges)
      .set({ resetTokenHash: tokenHash, resetTokenExpiresAt: expiresAt })
      .where(eq(otpChallenges.id, id));
  }

  /**
   * A reset token is only honoured while its challenge is unconsumed, so the
   * password change itself is what spends it — one token, one password.
   */
  async findResetChallenge(email: string, tokenHash: string, now: Date) {
    const rows = await this.db
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.email, email),
          eq(otpChallenges.purpose, OTP_PURPOSE.passwordReset),
          eq(otpChallenges.resetTokenHash, tokenHash),
          isNull(otpChallenges.consumedAt),
          gt(otpChallenges.resetTokenExpiresAt, now)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /* ----------------------------------------------------------- sessions */

  async createSession(row: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
    ip: string | null;
  }) {
    const inserted = await this.db.insert(sessions).values(row).returning();
    return inserted[0]!;
  }

  /** Joined, so authenticating a request is one round trip rather than two. */
  async findLiveSession(tokenHash: string, now: Date) {
    const rows = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
      .limit(1);
    return rows[0] ?? null;
  }

  async touchSession(id: string, now: Date) {
    await this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id));
  }

  async revokeSession(tokenHash: string, now: Date) {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.length === 1;
  }

  /**
   * Every live session for a user. Called after a password reset: whoever
   * changed the password may not be whoever was signed in, so the old
   * sessions must not survive it.
   */
  async revokeAllSessions(userId: string, now: Date) {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.length;
  }
}
