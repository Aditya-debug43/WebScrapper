import "./helpers/env.js";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createTestApp, signIn, bearer, type Harness, type Json } from "./helpers/harness.js";
import { otpChallenges, sessions, users } from "../src/db/schema.js";

/**
 * Authentication, AUTH-01..AUTH-20.
 *
 * These assert STATE, not status codes: that exactly one challenge row exists,
 * that the stored value is a hash rather than the code, that a second
 * verification of the same code cannot create a second account. A test that
 * only checks `200` would pass against an endpoint that did nothing.
 *
 * Each test uses its own email address, so the suite does not depend on
 * execution order despite sharing one application instance.
 */

let h: Harness;
const addr = (tag: string) => `${tag}@example.com`;

/**
 * Each test calls from its OWN source address.
 *
 * `inject` defaults to a single remote address, so without this every test in
 * the file draws on one shared per-IP budget and the suite starts returning
 * 429 partway through — which is the limiter working correctly and the tests
 * being wrong. Isolating the address lets the per-IP limit be tested
 * deliberately, by one test that reuses a single address on purpose.
 */
let ipCounter = 0;
const nextIp = () => `10.${Math.floor(++ipCounter / 256) % 256}.0.${ipCounter % 256}`;

before(async () => {
  h = await createTestApp();
});
after(async () => {
  await h.close();
});

const requestOtp = (email: string, ip = nextIp()) =>
  h.app.inject({
    method: "POST",
    url: "/api/v1/auth/request-otp",
    payload: { email },
    remoteAddress: ip,
  });
const verifyOtp = (email: string, code: string, ip = nextIp()) =>
  h.app.inject({
    method: "POST",
    url: "/api/v1/auth/verify-otp",
    payload: { email, code },
    remoteAddress: ip,
  });

describe("AUTH — request OTP", () => {
  it("AUTH-01 / AUTH-03 / AUTH-20: issues exactly one challenge, stores only a hash, and does not leak the code", async () => {
    const email = addr("auth01");
    const res = await requestOtp(email);
    assert.equal(res.statusCode, 202);

    const body = res.json() as Json;
    const code = body["devCode"] as string;
    assert.match(code, /^\d{6}$/, "a six-digit code should have been generated");

    const rows = await h.db.select().from(otpChallenges).where(eq(otpChallenges.email, email));
    assert.equal(rows.length, 1, "exactly one challenge row");

    const row = rows[0]!;
    // AUTH-20: the stored value must not be the code, and must be a digest.
    assert.notEqual(row.codeHash, code);
    assert.match(row.codeHash, /^[0-9a-f]{64}$/, "HMAC-SHA256 hex digest");
    assert.ok(!JSON.stringify(row).includes(code), "the code must appear nowhere in the stored row");
    assert.equal(row.attemptCount, 0);
    assert.equal(row.consumedAt, null);
    assert.ok(new Date(row.expiresAt).getTime() > Date.now(), "challenge should be in the future");

    // The production body carries no code at all — devCode exists only
    // because EXPOSE_OTP_IN_RESPONSE is on for tests.
    assert.ok(body["message"], "a neutral message is returned");
    assert.equal(body["token"], undefined);
  });

  it("AUTH-02: rejects a malformed email before any row is written", async () => {
    for (const bad of ["not-an-email", "", "a@", "@b.com", "x".repeat(300)]) {
      const res = await h.app.inject({
        method: "POST",
        url: "/api/v1/auth/request-otp",
        payload: { email: bad },
      });
      assert.equal(res.statusCode, 400, `"${bad.slice(0, 12)}" should be rejected`);
      assert.equal((res.json() as Json)["error"].code, "VALIDATION_FAILED");
    }
    const [{ n }] = await h.db.select({ n: sql<number>`count(*)::int` }).from(otpChallenges).where(
      eq(otpChallenges.email, "not-an-email")
    );
    assert.equal(n, 0, "no challenge should exist for a rejected address");
  });

  it("AUTH-04 / EMAIL-01 / EMAIL-02: sends the code to the right address via the email port", async () => {
    const email = addr("auth04");
    const res = await requestOtp(email);
    const code = (res.json() as Json)["devCode"] as string;

    const delivered = h.email.to(email);
    assert.equal(delivered.length, 1, "exactly one message delivered");
    assert.equal(delivered[0]!.to, email, "EMAIL-02: correct recipient");
    assert.ok(delivered[0]!.text.includes(code), "EMAIL-01: the message carries the code");
    assert.ok(delivered[0]!.subject.includes(code), "the subject shows the code for convenience");
  });

  it("normalises the address, so casing and whitespace resolve to one identity", async () => {
    const res = await requestOtp("  MiXeD.Case@Example.COM  ");
    assert.equal(res.statusCode, 202);
    const rows = await h.db.select().from(otpChallenges).where(eq(otpChallenges.email, "mixed.case@example.com"));
    assert.equal(rows.length, 1, "stored against the normalised address");
  });
});

describe("AUTH — verify OTP", () => {
  it("AUTH-05 / AUTH-06: a valid code authenticates and creates exactly one user", async () => {
    const email = addr("auth05");
    const code = (await requestOtp(email).then((r) => r.json())) as Json;

    const res = await verifyOtp(email, code["devCode"]);
    assert.equal(res.statusCode, 200);
    const body = res.json() as Json;

    assert.equal(body["isNewUser"], true);
    assert.equal(body["user"].email, email);
    assert.equal(body["user"].emailVerified, true, "first verification verifies the address");
    assert.ok(typeof body["token"] === "string" && body["token"].length >= 32);
    assert.equal(body["user"].passwordHash, undefined, "no such concept exists");

    const found = await h.db.select().from(users).where(eq(users.email, email));
    assert.equal(found.length, 1, "AUTH-06: exactly one user row");
    assert.ok(found[0]!.emailVerifiedAt, "verification timestamp recorded");
    assert.ok(found[0]!.lastLoginAt, "login recorded");

    // The session is stored hashed, never as the token itself.
    const [session] = await h.db.select().from(sessions).where(eq(sessions.userId, found[0]!.id));
    assert.ok(session, "a session row exists");
    assert.notEqual(session!.tokenHash, body["token"]);
    assert.match(session!.tokenHash, /^[0-9a-f]{64}$/);
  });

  it("AUTH-07 / AUTH-19: an existing user signs in again without gaining a second account", async () => {
    const email = addr("auth07");
    const first = await signIn(h, email);
    assert.equal(first.isNewUser, true);

    // Past the resend cooldown: age the previous challenge rather than sleep.
    await h.db
      .update(otpChallenges)
      .set({ createdAt: new Date(Date.now() - 3600_000) })
      .where(eq(otpChallenges.email, email));

    const second = await signIn(h, email);
    assert.equal(second.isNewUser, false, "AUTH-07: recognised as returning");
    assert.equal(second.user["id"], first.user["id"], "same identity");

    const found = await h.db.select().from(users).where(eq(users.email, email));
    assert.equal(found.length, 1, "AUTH-19: still exactly one account");
  });

  it("AUTH-08: a wrong code is rejected and costs an attempt", async () => {
    const email = addr("auth08");
    const good = ((await requestOtp(email).then((r) => r.json())) as Json)["devCode"] as string;
    const wrong = good === "000000" ? "111111" : "000000";

    const res = await verifyOtp(email, wrong);
    assert.equal(res.statusCode, 400);
    const body = res.json() as Json;
    assert.equal(body["error"].code, "OTP_INVALID");
    assert.equal(body["token"], undefined, "no session is issued");

    const [row] = await h.db.select().from(otpChallenges).where(eq(otpChallenges.email, email));
    assert.equal(row!.attemptCount, 1, "the attempt was counted");
    assert.equal(row!.consumedAt, null, "a failed attempt does not consume the challenge");

    const found = await h.db.select().from(users).where(eq(users.email, email));
    assert.equal(found.length, 0, "no account is created by a failed verification");
  });

  it("AUTH-09: an expired code is rejected even though it is otherwise correct", async () => {
    const email = addr("auth09");
    const code = ((await requestOtp(email).then((r) => r.json())) as Json)["devCode"] as string;

    // Both timestamps move, because otp_expiry_after_creation requires
    // expires_at > created_at — a challenge cannot expire before it existed.
    await h.db
      .update(otpChallenges)
      .set({ createdAt: new Date(Date.now() - 7200_000), expiresAt: new Date(Date.now() - 3600_000) })
      .where(eq(otpChallenges.email, email));

    const res = await verifyOtp(email, code);
    assert.equal(res.statusCode, 410);
    assert.equal((res.json() as Json)["error"].code, "OTP_EXPIRED");
    assert.equal((await h.db.select().from(users).where(eq(users.email, email))).length, 0);
  });

  it("AUTH-10: a consumed code cannot be replayed", async () => {
    const email = addr("auth10");
    const code = ((await requestOtp(email).then((r) => r.json())) as Json)["devCode"] as string;

    const first = await verifyOtp(email, code);
    assert.equal(first.statusCode, 200);

    const replay = await verifyOtp(email, code);
    assert.equal(replay.statusCode, 409);
    assert.equal((replay.json() as Json)["error"].code, "OTP_ALREADY_USED");

    assert.equal(
      (await h.db.select().from(users).where(eq(users.email, email))).length,
      1,
      "the replay did not create a second account"
    );
  });

  it("AUTH-11: the attempt limit is enforced and then blocks even the correct code", async () => {
    const email = addr("auth11");
    const good = ((await requestOtp(email).then((r) => r.json())) as Json)["devCode"] as string;
    const wrong = good === "000000" ? "111111" : "000000";

    // OTP_MAX_ATTEMPTS is 3 in the test environment.
    assert.equal((await verifyOtp(email, wrong)).statusCode, 400);
    assert.equal((await verifyOtp(email, wrong)).statusCode, 400);
    const third = await verifyOtp(email, wrong);
    assert.equal((third.json() as Json)["error"].code, "OTP_TOO_MANY_ATTEMPTS");

    // The correct code is now worthless — which is the point of the limit.
    const afterLimit = await verifyOtp(email, good);
    assert.equal((afterLimit.json() as Json)["error"].code, "OTP_TOO_MANY_ATTEMPTS");
    assert.equal((await h.db.select().from(users).where(eq(users.email, email))).length, 0);
  });

  it("AUTH-12: the resend cooldown is enforced and reports when to retry", async () => {
    const email = addr("auth12");
    assert.equal((await requestOtp(email)).statusCode, 202);

    const immediate = await requestOtp(email);
    assert.equal(immediate.statusCode, 429);
    const body = immediate.json() as Json;
    assert.equal(body["error"].code, "OTP_COOLDOWN");
    assert.ok(body["error"].details.retryAfterSeconds > 0);

    assert.equal(
      (await h.db.select().from(otpChallenges).where(eq(otpChallenges.email, email))).length,
      1,
      "the blocked resend created no second challenge"
    );

    // Past the cooldown it succeeds, proving the limit is temporal.
    await h.db
      .update(otpChallenges)
      .set({ createdAt: new Date(Date.now() - 3600_000) })
      .where(eq(otpChallenges.email, email));
    assert.equal((await requestOtp(email)).statusCode, 202);
  });

  it("AUTH-13a: the per-address hourly ceiling is enforced independently of the cooldown", async () => {
    const email = addr("auth13a");
    // OTP_MAX_PER_EMAIL_PER_HOUR is 5. Age each challenge past the cooldown
    // but keep it inside the hour, so only the hourly ceiling can fire.
    for (let i = 0; i < 5; i++) {
      const res = await requestOtp(email);
      assert.equal(res.statusCode, 202, `request ${i + 1} should succeed`);
      await h.db
        .update(otpChallenges)
        .set({ createdAt: new Date(Date.now() - 120_000) })
        .where(eq(otpChallenges.email, email));
    }

    const blocked = await requestOtp(email);
    assert.equal(blocked.statusCode, 429);
    assert.equal((blocked.json() as Json)["error"].code, "RATE_LIMITED");
    assert.equal(
      (await h.db.select().from(otpChallenges).where(eq(otpChallenges.email, email))).length,
      5,
      "the sixth request wrote nothing"
    );
  });

  it("AUTH-13b: the per-IP authentication rate limit is enforced", async () => {
    // One address, many distinct emails — so the per-email cooldown and the
    // hourly ceiling cannot fire and only the per-IP limiter can.
    // AUTH_RATE_LIMIT_MAX is 8 in the test environment.
    const ip = "203.0.113.77";
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) {
      codes.push((await requestOtp(`ratelimit${i}@example.com`, ip)).statusCode);
    }
    assert.ok(
      codes.every((c) => c === 202),
      `the first eight requests should succeed, got ${codes.join(",")}`
    );

    const blocked = await requestOtp("ratelimit-over@example.com", ip);
    assert.equal(blocked.statusCode, 429, "the ninth request from this address is refused");
    assert.equal((blocked.json() as Json)["error"].code, "RATE_LIMITED");

    // A different address is unaffected: the limit is per-caller, not global.
    assert.equal((await requestOtp("ratelimit-other@example.com")).statusCode, 202);
  });
});

describe("AUTH — session", () => {
  it("AUTH-14: /me returns the authenticated user", async () => {
    const email = addr("auth14");
    const { token, user } = await signIn(h, email);

    const res = await h.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: bearer(token),
      remoteAddress: nextIp(),
    });
    assert.equal(res.statusCode, 200);
    const me = (res.json() as Json)["user"];
    assert.equal(me.id, user["id"]);
    assert.equal(me.email, email);
    assert.equal(me.emailVerified, true);
  });

  it("AUTH-15: /me rejects missing, malformed and unknown credentials alike", async () => {
    for (const headers of [
      undefined,
      { authorization: "Bearer" },
      { authorization: "Basic abc" },
      { authorization: "Bearer not-a-real-token" },
    ]) {
      const res = await h.app.inject({ method: "GET", url: "/api/v1/auth/me", headers });
      assert.equal(res.statusCode, 401);
      const body = res.json() as Json;
      assert.equal(body["error"].code, "UNAUTHENTICATED");
      // Identical message in every case: distinguishing them would say which
      // token had once been real.
      assert.equal(body["error"].message, "Sign in to continue.");
    }
  });

  it("AUTH-16 / AUTH-17: logout revokes the session and the token stops working", async () => {
    const email = addr("auth16");
    const { token } = await signIn(h, email);

    assert.equal(
      (await h.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: bearer(token) })).statusCode,
      200
    );

    const out = await h.app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: bearer(token) });
    assert.equal(out.statusCode, 204);

    // State: the row is revoked rather than deleted, so the event is auditable.
    const [user] = await h.db.select().from(users).where(eq(users.email, email));
    const rows = await h.db.select().from(sessions).where(eq(sessions.userId, user!.id));
    assert.equal(rows.length, 1);
    assert.ok(rows[0]!.revokedAt, "session marked revoked");

    const afterLogout = await h.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: bearer(token),
    });
    assert.equal(afterLogout.statusCode, 401, "AUTH-17");
  });

  it("an expired session is rejected", async () => {
    const email = addr("authexp");
    const { token } = await signIn(h, email);
    const [user] = await h.db.select().from(users).where(eq(users.email, email));
    await h.db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 7200_000), expiresAt: new Date(Date.now() - 3600_000) })
      .where(eq(sessions.userId, user!.id));

    const res = await h.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: bearer(token) });
    assert.equal(res.statusCode, 401);
  });

  it("AUTH-18: email uniqueness is enforced by the database, not only by the service", async () => {
    const email = addr("auth18");
    await signIn(h, email);

    // Bypass the service entirely and attempt a direct duplicate insert,
    // including one differing only in case — the functional unique index on
    // lower(email) is what has to catch it.
    // Drizzle wraps driver errors, so the constraint name lives on the cause
    // rather than the message — assert against the whole chain.
    const chain = (e: unknown): string => {
      let out = "";
      let cur: any = e;
      while (cur) {
        out += `${cur.message ?? ""} ${cur.constraint ?? ""} ${cur.detail ?? ""} `;
        cur = cur.cause;
      }
      return out;
    };
    const expectDuplicate = async (value: string, label: string) => {
      let caught: unknown;
      try {
        await h.db.insert(users).values({ email: value }).execute();
      } catch (e) {
        caught = e;
      }
      assert.ok(caught, `${label}: the insert should have been rejected`);
      assert.match(chain(caught), /duplicate key|unique|users_email_lower_key/i, label);
    };
    await expectDuplicate(email, "exact duplicate rejected");
    await expectDuplicate(email.toUpperCase(), "case-variant duplicate rejected");
  });
});
