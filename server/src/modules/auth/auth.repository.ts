import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { otpChallenges, sessions, users } from "../../db/schema.js";

/**
 * All SQL for authentication lives here. Services hold the rules; this holds
 * the queries. Nothing above this layer writes a WHERE clause.
 */
export class AuthRepository {
  constructor(private readonly db: Db) {}

  /* ------------------------------------------------------------- users */

  /**
   * Looked up on `lower(email)` so the query can use the unique functional
   * index, and so a lookup cannot miss a row that differs only in case.
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
   * Create-or-return, resolved by the database rather than by a read followed
   * by a write. Two verifications arriving together would both see "no user"
   * and both insert; `onConflictDoNothing` against the unique index makes the
   * loser return nothing, and the follow-up read gets the winner's row. This
   * is why repeated verification cannot produce duplicate accounts.
   */
  async createUserIfAbsent(email: string, now: Date) {
    await this.db
      .insert(users)
      .values({ email, emailVerifiedAt: now, lastLoginAt: now })
      .onConflictDoNothing();
    const user = await this.findUserByEmail(email);
    if (!user) throw new Error(`User row missing immediately after upsert for ${email}`);
    return user;
  }

  async markLogin(userId: string, now: Date, verifyEmail: boolean) {
    await this.db
      .update(users)
      .set({
        lastLoginAt: now,
        updatedAt: now,
        ...(verifyEmail ? { emailVerifiedAt: now } : {}),
      })
      .where(eq(users.id, userId));
  }

  /* -------------------------------------------------------- challenges */

  async createChallenge(row: {
    email: string;
    codeHash: string;
    expiresAt: Date;
    requestIp: string | null;
  }) {
    const inserted = await this.db.insert(otpChallenges).values(row).returning();
    return inserted[0]!;
  }

  /** The newest challenge for this address, consumed or not. */
  async latestChallenge(email: string) {
    const rows = await this.db
      .select()
      .from(otpChallenges)
      .where(eq(otpChallenges.email, email))
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * The newest challenge that is still usable: unconsumed and unexpired.
   * Verification deliberately targets only this one, so an older outstanding
   * code cannot be used after a resend.
   */
  async activeChallenge(email: string, now: Date) {
    const rows = await this.db
      .select()
      .from(otpChallenges)
      .where(
        and(eq(otpChallenges.email, email), isNull(otpChallenges.consumedAt), gt(otpChallenges.expiresAt, now))
      )
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async countChallengesSince(email: string, since: Date) {
    const rows = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(otpChallenges)
      .where(and(eq(otpChallenges.email, email), gt(otpChallenges.createdAt, since)));
    return rows[0]?.n ?? 0;
  }

  /** Returns the new attempt count, so the caller need not re-read. */
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
   * verifications of the same code both pass validation, but only one UPDATE
   * matches a row, and the other is rejected.
   */
  async consumeChallenge(id: string, now: Date) {
    const rows = await this.db
      .update(otpChallenges)
      .set({ consumedAt: now })
      .where(and(eq(otpChallenges.id, id), isNull(otpChallenges.consumedAt)))
      .returning({ id: otpChallenges.id });
    return rows.length === 1;
  }

  /** Invalidate outstanding codes once one has been used. */
  async consumeAllForEmail(email: string, now: Date) {
    await this.db
      .update(otpChallenges)
      .set({ consumedAt: now })
      .where(and(eq(otpChallenges.email, email), isNull(otpChallenges.consumedAt)));
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
}
