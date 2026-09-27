import "./helpers/env.js";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { createTestApp, bearer, type Harness, type Json } from "./helpers/harness.js";
import { otpChallenges, sessions, users } from "../src/db/schema.js";

/**
 * EMAIL + PASSWORD AUTHENTICATION
 * AUTH-REG, AUTH-VER, AUTH-LOGIN, AUTH-RESET, AUTH-SEC.
 *
 * These assert STATE, not status codes: that the stored credential is an
 * Argon2id digest and never the password, that an unverified account
 * genuinely cannot log in, that a reset actually replaces the hash and kills
 * the sessions that existed before it. A test that only checked `200` would
 * pass against an endpoint that did nothing.
 *
 * Every test uses its own email address AND its own source address, so the
 * file does not depend on execution order and helper traffic never consumes
 * the per-IP budget the rate-limit test relies on.
 */

let h: Harness;
const addr = (tag: string) => `${tag}@example.com`;
const GOOD_PASSWORD = "correct-horse-battery";

let ipCounter = 0;
const nextIp = () => `10.${Math.floor(++ipCounter / 256) % 256}.0.${ipCounter % 256}`;

before(async () => {
  h = await createTestApp();
});
after(async () => {
  await h.close();
});

const post = (url: string, payload: unknown, ip = nextIp()) =>
  h.app.inject({ method: "POST", url: `/api/v1${url}`, payload: payload as object, remoteAddress: ip });

const get = (url: string, token?: string) =>
  h.app.inject({
    method: "GET",
    url: `/api/v1${url}`,
    ...(token ? { headers: bearer(token) } : {}),
    remoteAddress: nextIp(),
  });

/** Register + verify. Returns the session token. */
async function signUp(email: string, password = GOOD_PASSWORD) {
  const reg = await post("/auth/register", { email, password });
  assert.equal(reg.statusCode, 201, reg.body);
  const code = (reg.json() as Json)["devCode"] as string;
  const ver = await post("/auth/verify-email", { email, code });
  assert.equal(ver.statusCode, 200, ver.body);
  return (ver.json() as Json)["token"] as string;
}

/** Move a challenge's clock back so the resend cooldown no longer applies. */
const ageChallenges = (email: string, ms = 3_600_000) =>
  h.db
    .update(otpChallenges)
    .set({ createdAt: new Date(Date.now() - ms) })
    .where(eq(otpChallenges.email, email));

/* ======================================================== REGISTRATION */

describe("AUTH-REG — registration", () => {
  it("AUTH-REG-01/06/07/08: creates an unverified account, stores an Argon2id digest, issues and delivers a code", async () => {
    const email = addr("reg01");
    const res = await post("/auth/register", { email, password: GOOD_PASSWORD });
    assert.equal(res.statusCode, 201);
    const body = res.json() as Json;

    assert.ok(body["message"]);
    assert.equal(body["maskedEmail"], "re***@example.com", "the response masks the address");
    assert.equal(body["token"], undefined, "registration must not sign anybody in");
    assert.equal(body["user"], undefined);

    const [user] = await h.db.select().from(users).where(eq(users.email, email));
    assert.ok(user, "AUTH-REG-01: the account exists");
    assert.equal(user!.emailVerifiedAt, null, "AUTH-REG-06: created unverified");

    // AUTH-REG-07 at the storage layer: a digest, and specifically Argon2id.
    assert.ok(user!.passwordHash, "a credential was stored");
    assert.match(user!.passwordHash!, /^\$argon2id\$/, "Argon2id digest");
    assert.ok(!user!.passwordHash!.includes(GOOD_PASSWORD), "the password itself is not in the digest");

    // Exactly one verification challenge, stored hashed, never as the code.
    const challenges = await h.db.select().from(otpChallenges).where(eq(otpChallenges.email, email));
    assert.equal(challenges.length, 1);
    assert.equal(challenges[0]!.purpose, "email_verification");
    assert.match(challenges[0]!.codeHash, /^[0-9a-f]{64}$/);
    assert.notEqual(challenges[0]!.codeHash, body["devCode"]);

    // AUTH-REG-08: it went through the email port, to that address, with
    // wording that matches the purpose.
    const delivered = h.email.to(email);
    assert.equal(delivered.length, 1);
    assert.ok(delivered[0]!.text.includes(body["devCode"] as string));
    assert.match(delivered[0]!.subject, /verification code/i);
  });

  it("AUTH-REG-02: an invalid email is rejected and nothing is written", async () => {
    for (const bad of ["nope", "", "a@", "@b.com", `${"x".repeat(300)}@y.com`]) {
      const res = await post("/auth/register", { email: bad, password: GOOD_PASSWORD });
      assert.equal(res.statusCode, 400, `"${bad.slice(0, 12)}" should be rejected`);
      assert.equal((res.json() as Json)["error"].code, "VALIDATION_FAILED");
    }
    const [row] = await h.db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(sql`${users.email} in ('nope', '', 'a@', '@b.com')`);
    assert.equal(row!.n, 0);
  });

  it("AUTH-REG-03: a weak password is rejected and no account is created", async () => {
    const cases: Array<[string, string]> = [
      ["short", "tooshort"],
      ["", "empty"],
      ["password123", "common"],
      ["  padded-password  ", "whitespace"],
    ];
    for (const [password, tag] of cases) {
      const email = addr(`weak-${tag}`);
      const res = await post("/auth/register", { email, password });
      assert.equal(res.statusCode, 400, `${tag} should be rejected, got ${res.statusCode}`);
      const [row] = await h.db
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.email, email));
      assert.equal(row!.n, 0, `${tag}: no account should exist`);
    }
  });

  it("AUTH-REG-04: the registration response never carries a credential", async () => {
    const res = await post("/auth/register", { email: addr("reg04"), password: GOOD_PASSWORD });
    assert.ok(!res.body.includes(GOOD_PASSWORD), "the password is echoed back");
    assert.ok(!res.body.includes("argon2"), "a digest leaked");
    assert.ok(!res.body.includes("passwordHash"));
  });

  it("AUTH-REG-05: a verified address cannot register a second account", async () => {
    const email = addr("reg05");
    await signUp(email);

    const again = await post("/auth/register", { email, password: "a-completely-different-one" });
    assert.equal(again.statusCode, 409);
    assert.equal((again.json() as Json)["error"].code, "EMAIL_IN_USE");

    const rows = await h.db.select().from(users).where(eq(users.email, email));
    assert.equal(rows.length, 1, "still exactly one account");

    // The original password still works: a refused re-registration must not
    // have overwritten the credential of a live account.
    assert.equal((await post("/auth/login", { email, password: GOOD_PASSWORD })).statusCode, 200);
  });

  it("re-registering an UNVERIFIED address corrects the signup instead of duplicating it", async () => {
    const email = addr("reg-abandoned");
    await post("/auth/register", { email, password: GOOD_PASSWORD });
    await ageChallenges(email);

    const second = await post("/auth/register", { email, password: "second-attempt-password" });
    assert.equal(second.statusCode, 201, "an abandoned signup can be retried");

    const rows = await h.db.select().from(users).where(eq(users.email, email));
    assert.equal(rows.length, 1, "no duplicate account");

    // The newest code verifies, and the account is then reachable with the
    // SECOND password only — proving the credential really was replaced.
    const code = (second.json() as Json)["devCode"] as string;
    assert.equal((await post("/auth/verify-email", { email, code })).statusCode, 200);
    assert.equal((await post("/auth/login", { email, password: "second-attempt-password" })).statusCode, 200);
    assert.equal((await post("/auth/login", { email, password: GOOD_PASSWORD })).statusCode, 401);
  });

  it("normalises the address, so casing and whitespace resolve to one account", async () => {
    const res = await post("/auth/register", { email: "  MiXeD.Reg@Example.COM  ", password: GOOD_PASSWORD });
    assert.equal(res.statusCode, 201);
    const rows = await h.db.select().from(users).where(eq(users.email, "mixed.reg@example.com"));
    assert.equal(rows.length, 1, "stored against the normalised address");
  });
});

/* ================================================== EMAIL VERIFICATION */

describe("AUTH-VER — email verification", () => {
  it("AUTH-VER-01: a valid code verifies the address and opens a session", async () => {
    const email = addr("ver01");
    const reg = await post("/auth/register", { email, password: GOOD_PASSWORD });
    const code = (reg.json() as Json)["devCode"] as string;

    const res = await post("/auth/verify-email", { email, code });
    assert.equal(res.statusCode, 200);
    const body = res.json() as Json;

    assert.equal(body["user"].emailVerified, true);
    assert.ok(typeof body["token"] === "string" && body["token"].length >= 32);
    assert.equal(body["user"].passwordHash, undefined);

    const [user] = await h.db.select().from(users).where(eq(users.email, email));
    assert.ok(user!.emailVerifiedAt, "verification timestamp recorded");
    assert.ok(user!.lastLoginAt, "treated as a sign-in");

    // The session is stored hashed, never as the token that was handed out.
    const [session] = await h.db.select().from(sessions).where(eq(sessions.userId, user!.id));
    assert.ok(session);
    assert.notEqual(session!.tokenHash, body["token"]);
    assert.match(session!.tokenHash, /^[0-9a-f]{64}$/);
  });

  it("AUTH-VER-02: a wrong code is rejected and costs an attempt", async () => {
    const email = addr("ver02");
    const good = ((await post("/auth/register", { email, password: GOOD_PASSWORD })).json() as Json)["devCode"];
    const wrong = good === "000000" ? "111111" : "000000";

    const res = await post("/auth/verify-email", { email, code: wrong });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as Json)["error"].code, "OTP_INVALID");

    const [c] = await h.db.select().from(otpChallenges).where(eq(otpChallenges.email, email));
    assert.equal(c!.attemptCount, 1);
    assert.equal(c!.consumedAt, null, "a failed attempt does not spend the code");

    const [user] = await h.db.select().from(users).where(eq(users.email, email));
    assert.equal(user!.emailVerifiedAt, null, "still unverified");
  });

  it("AUTH-VER-03: an expired code is refused even though it is otherwise correct", async () => {
    const email = addr("ver03");
    const code = ((await post("/auth/register", { email, password: GOOD_PASSWORD })).json() as Json)["devCode"];

    // Both timestamps move: otp_expiry_after_creation requires
    // expires_at > created_at, so a code cannot expire before it existed.
    await h.db
      .update(otpChallenges)
      .set({ createdAt: new Date(Date.now() - 7_200_000), expiresAt: new Date(Date.now() - 3_600_000) })
      .where(eq(otpChallenges.email, email));

    const res = await post("/auth/verify-email", { email, code });
    assert.equal(res.statusCode, 410);
    assert.equal((res.json() as Json)["error"].code, "OTP_EXPIRED");
  });

  it("AUTH-VER-04: a consumed code cannot be replayed", async () => {
    const email = addr("ver04");
    const code = ((await post("/auth/register", { email, password: GOOD_PASSWORD })).json() as Json)["devCode"];
    assert.equal((await post("/auth/verify-email", { email, code })).statusCode, 200);

    const replay = await post("/auth/verify-email", { email, code });
    assert.equal(replay.statusCode, 409);
    assert.equal((replay.json() as Json)["error"].code, "OTP_ALREADY_USED");

    const rows = await h.db.select().from(users).where(eq(users.email, email));
    assert.equal(rows.length, 1, "a replay did not create a second account");
  });

  it("AUTH-VER-05: the attempt limit is enforced and then blocks even the correct code", async () => {
    const email = addr("ver05");
    const good = ((await post("/auth/register", { email, password: GOOD_PASSWORD })).json() as Json)["devCode"];
    const wrong = good === "000000" ? "111111" : "000000";

    // OTP_MAX_ATTEMPTS is 3 under test.
    assert.equal((await post("/auth/verify-email", { email, code: wrong })).statusCode, 400);
    assert.equal((await post("/auth/verify-email", { email, code: wrong })).statusCode, 400);
    const third = await post("/auth/verify-email", { email, code: wrong });
    assert.equal((third.json() as Json)["error"].code, "OTP_TOO_MANY_ATTEMPTS");

    const afterLimit = await post("/auth/verify-email", { email, code: good });
    assert.equal((afterLimit.json() as Json)["error"].code, "OTP_TOO_MANY_ATTEMPTS");

    const [user] = await h.db.select().from(users).where(eq(users.email, email));
    assert.equal(user!.emailVerifiedAt, null, "the account stays unverified");
  });

  it("AUTH-VER-06: the resend cooldown is enforced, then a fresh code is issued and works", async () => {
    const email = addr("ver06");
    await post("/auth/register", { email, password: GOOD_PASSWORD });

    const immediate = await post("/auth/resend-verification", { email });
    assert.equal(immediate.statusCode, 429);
    assert.equal((immediate.json() as Json)["error"].code, "OTP_COOLDOWN");
    assert.ok((immediate.json() as Json)["error"].details.retryAfterSeconds > 0);
    assert.equal(
      (await h.db.select().from(otpChallenges).where(eq(otpChallenges.email, email))).length,
      1,
      "the blocked resend wrote nothing"
    );

    await ageChallenges(email);
    const later = await post("/auth/resend-verification", { email });
    assert.equal(later.statusCode, 202);
    assert.equal(
      (await h.db.select().from(otpChallenges).where(eq(otpChallenges.email, email))).length,
      2,
      "a second challenge now exists"
    );
    assert.equal(
      (await post("/auth/verify-email", { email, code: (later.json() as Json)["devCode"] })).statusCode,
      200
    );
  });

  it("AUTH-VER-07: an already-verified account cannot be pushed back, and resend stays neutral", async () => {
    const email = addr("ver07");
    await signUp(email);
    await ageChallenges(email);

    const resend = await post("/auth/resend-verification", { email });
    assert.equal(resend.statusCode, 202, "the response shape does not change");
    assert.equal((resend.json() as Json)["devCode"], undefined, "but no code is actually issued");

    const [user] = await h.db.select().from(users).where(eq(users.email, email));
    assert.ok(user!.emailVerifiedAt, "still verified");
    assert.equal((await post("/auth/login", { email, password: GOOD_PASSWORD })).statusCode, 200);
  });

  it("a resend for an address with no account looks exactly like one that has", async () => {
    const known = addr("ver-neutral-known");
    await post("/auth/register", { email: known, password: GOOD_PASSWORD });
    await ageChallenges(known);

    const a = await post("/auth/resend-verification", { email: known });
    const b = await post("/auth/resend-verification", { email: addr("ver-neutral-absent") });
    assert.equal(a.statusCode, b.statusCode);
    assert.equal((a.json() as Json)["message"], (b.json() as Json)["message"]);
    assert.equal(
      (await h.db.select().from(otpChallenges).where(eq(otpChallenges.email, addr("ver-neutral-absent")))).length,
      0,
      "no work is done for an address with no account"
    );
  });
});

/* ================================================================ LOGIN */

describe("AUTH-LOGIN — login", () => {
  it("AUTH-LOGIN-01/05/06/07: a verified user signs in, and /me returns them without a digest", async () => {
    const email = addr("login01");
    await signUp(email);

    const res = await post("/auth/login", { email, password: GOOD_PASSWORD });
    assert.equal(res.statusCode, 200);
    const body = res.json() as Json;
    assert.equal(body["user"].email, email);
    assert.equal(body["user"].emailVerified, true);
    assert.equal(body["user"].passwordHash, undefined);
    assert.ok(!res.body.includes("argon2"), "no digest anywhere in the payload");
    assert.ok(!res.body.includes(GOOD_PASSWORD), "the password is echoed back");

    const [user] = await h.db.select().from(users).where(eq(users.email, email));
    const live = await h.db.select().from(sessions).where(eq(sessions.userId, user!.id));
    assert.ok(live.length >= 1, "AUTH-LOGIN-05: a session row exists");

    const me = await get("/auth/me", body["token"]);
    assert.equal(me.statusCode, 200);
    assert.equal((me.json() as Json)["user"].id, body["user"].id);
    assert.equal((me.json() as Json)["user"].passwordHash, undefined);
    assert.ok(!me.body.includes("argon2"));
  });

  it("AUTH-LOGIN-02/03: a wrong password and an unknown account fail identically", async () => {
    const email = addr("login02");
    await signUp(email);

    const wrong = await post("/auth/login", { email, password: "not-the-password" });
    const unknown = await post("/auth/login", { email: addr("nobody-at-all"), password: GOOD_PASSWORD });

    assert.equal(wrong.statusCode, 401);
    assert.equal(unknown.statusCode, 401);
    assert.equal((wrong.json() as Json)["error"].code, "INVALID_CREDENTIALS");
    // Identical code AND identical message: an attacker must not be able to
    // tell "no such account" from "wrong password".
    assert.deepEqual(wrong.json(), unknown.json());
  });

  it("AUTH-LOGIN-04: an unverified account cannot log in, and is told how to fix it", async () => {
    const email = addr("login04");
    await post("/auth/register", { email, password: GOOD_PASSWORD });

    const res = await post("/auth/login", { email, password: GOOD_PASSWORD });
    assert.equal(res.statusCode, 403);
    const body = res.json() as Json;
    assert.equal(body["error"].code, "EMAIL_NOT_VERIFIED");
    assert.equal(body["token"], undefined, "no session is issued");
    assert.ok(body["error"].details.maskedEmail, "the client can offer a resend");

    const [user] = await h.db.select().from(users).where(eq(users.email, email));
    assert.equal(
      (await h.db.select().from(sessions).where(eq(sessions.userId, user!.id))).length,
      0,
      "no session exists for an unverified account"
    );
  });

  it("AUTH-LOGIN-08/09: logout revokes the session and the token stops working", async () => {
    const email = addr("login08");
    const token = await signUp(email);
    assert.equal((await get("/auth/me", token)).statusCode, 200);

    const out = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: bearer(token),
      remoteAddress: nextIp(),
    });
    assert.equal(out.statusCode, 204);

    const [user] = await h.db.select().from(users).where(eq(users.email, email));
    const rows = await h.db.select().from(sessions).where(eq(sessions.userId, user!.id));
    assert.ok(rows.every((s) => s.revokedAt), "revoked, not deleted — the event stays auditable");

    assert.equal((await get("/auth/me", token)).statusCode, 401, "AUTH-LOGIN-09");
  });

  it("an expired session is rejected", async () => {
    const email = addr("login-expired");
    const token = await signUp(email);
    const [user] = await h.db.select().from(users).where(eq(users.email, email));
    await h.db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 7_200_000), expiresAt: new Date(Date.now() - 3_600_000) })
      .where(eq(sessions.userId, user!.id));

    assert.equal((await get("/auth/me", token)).statusCode, 401);
  });

  it("logging in with different casing or padding reaches the same account", async () => {
    const email = addr("login-case");
    await signUp(email);
    const res = await post("/auth/login", { email: "  LOGIN-CASE@Example.com  ", password: GOOD_PASSWORD });
    assert.equal(res.statusCode, 200);
    assert.equal((res.json() as Json)["user"].email, email);
  });

  it("email uniqueness is enforced by the database, not only by the service", async () => {
    const email = addr("uniqueness");
    await signUp(email);
    const chain = (e: unknown): string => {
      let out = "";
      let cur = e as { message?: string; constraint?: string; detail?: string; cause?: unknown } | undefined;
      while (cur) {
        out += `${cur.message ?? ""} ${cur.constraint ?? ""} ${cur.detail ?? ""} `;
        cur = cur.cause as typeof cur;
      }
      return out;
    };
    for (const value of [email, email.toUpperCase()]) {
      let caught: unknown;
      try {
        await h.db.insert(users).values({ email: value, passwordHash: "x" }).execute();
      } catch (e) {
        caught = e;
      }
      assert.ok(caught, `${value} should have been rejected`);
      assert.match(chain(caught), /duplicate key|unique|users_email_lower_key/i);
    }
  });
});

/* ======================================================= PASSWORD RESET */

describe("AUTH-RESET — forgot and reset password", () => {
  it("AUTH-RESET-01/02/03/04: accepted, reveals nothing, and sends a reset-specific code", async () => {
    const email = addr("reset01");
    await signUp(email);
    await ageChallenges(email);

    const known = await post("/auth/forgot-password", { email });
    const unknown = await post("/auth/forgot-password", { email: addr("no-such-person") });

    assert.equal(known.statusCode, 202);
    assert.equal(unknown.statusCode, 202);
    // AUTH-RESET-02: same status and same message either way.
    assert.equal((known.json() as Json)["message"], (unknown.json() as Json)["message"]);

    // AUTH-RESET-03: but a challenge exists only for the real account.
    const mine = await h.db
      .select()
      .from(otpChallenges)
      .where(sql`${otpChallenges.email} = ${email} and ${otpChallenges.purpose} = 'password_reset'`);
    assert.equal(mine.length, 1);
    assert.match(mine[0]!.codeHash, /^[0-9a-f]{64}$/);
    assert.equal(
      (await h.db.select().from(otpChallenges).where(eq(otpChallenges.email, addr("no-such-person")))).length,
      0,
      "no work is done for an address with no account"
    );

    // AUTH-RESET-04: delivered, with reset wording rather than verification.
    const delivered = h.email.to(email);
    const last = delivered[delivered.length - 1]!;
    assert.match(last.subject, /password reset/i);
    assert.ok(last.text.includes((known.json() as Json)["devCode"] as string));
    assert.match(last.text, /did not request a password reset/i, "an unexpected reset code is a warning");
  });

  it("AUTH-RESET-05/09/10/11/12: the full flow replaces the password and kills existing sessions", async () => {
    const email = addr("reset05");
    const oldToken = await signUp(email);
    const [before] = await h.db.select().from(users).where(eq(users.email, email));
    const oldHash = before!.passwordHash;
    await ageChallenges(email);

    const forgot = await post("/auth/forgot-password", { email });
    const code = (forgot.json() as Json)["devCode"] as string;

    const verified = await post("/auth/verify-reset-otp", { email, code });
    assert.equal(verified.statusCode, 200, "AUTH-RESET-05");
    const resetToken = (verified.json() as Json)["resetToken"] as string;
    assert.ok(resetToken.length >= 16);

    const NEW_PASSWORD = "a-brand-new-password";
    const done = await post("/auth/reset-password", { email, resetToken, password: NEW_PASSWORD });
    assert.equal(done.statusCode, 200);
    assert.ok((done.json() as Json)["sessionsRevoked"] >= 1);

    // AUTH-RESET-09: a new Argon2id digest, different from the old one.
    const [after] = await h.db.select().from(users).where(eq(users.email, email));
    assert.match(after!.passwordHash!, /^\$argon2id\$/);
    assert.notEqual(after!.passwordHash, oldHash);
    assert.ok(!after!.passwordHash!.includes(NEW_PASSWORD));

    // AUTH-RESET-10 and AUTH-RESET-11.
    assert.equal((await post("/auth/login", { email, password: GOOD_PASSWORD })).statusCode, 401, "old password dead");
    assert.equal((await post("/auth/login", { email, password: NEW_PASSWORD })).statusCode, 200, "new password works");

    // AUTH-RESET-12: the session held before the reset no longer authenticates.
    assert.equal((await get("/auth/me", oldToken)).statusCode, 401);
  });

  it("AUTH-RESET-06: an invalid reset code is rejected", async () => {
    const email = addr("reset06");
    await signUp(email);
    await ageChallenges(email);
    const good = ((await post("/auth/forgot-password", { email })).json() as Json)["devCode"];
    const wrong = good === "000000" ? "111111" : "000000";

    const res = await post("/auth/verify-reset-otp", { email, code: wrong });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as Json)["error"].code, "OTP_INVALID");
    assert.equal((res.json() as Json)["resetToken"], undefined);
  });

  it("AUTH-RESET-07: an expired reset code is rejected", async () => {
    const email = addr("reset07");
    await signUp(email);
    await ageChallenges(email);
    const code = ((await post("/auth/forgot-password", { email })).json() as Json)["devCode"];

    await h.db
      .update(otpChallenges)
      .set({ createdAt: new Date(Date.now() - 7_200_000), expiresAt: new Date(Date.now() - 3_600_000) })
      .where(sql`${otpChallenges.email} = ${email} and ${otpChallenges.purpose} = 'password_reset'`);

    const res = await post("/auth/verify-reset-otp", { email, code });
    assert.equal(res.statusCode, 410);
  });

  it("AUTH-RESET-08: a reset token is single-use and the code behind it cannot be replayed", async () => {
    const email = addr("reset08");
    await signUp(email);
    await ageChallenges(email);
    const code = ((await post("/auth/forgot-password", { email })).json() as Json)["devCode"];
    const resetToken = ((await post("/auth/verify-reset-otp", { email, code })).json() as Json)["resetToken"];

    assert.equal(
      (await post("/auth/reset-password", { email, resetToken, password: "first-new-password" })).statusCode,
      200
    );

    const replay = await post("/auth/reset-password", { email, resetToken, password: "second-new-password" });
    assert.equal(replay.statusCode, 400);
    assert.equal((replay.json() as Json)["error"].code, "RESET_TOKEN_INVALID");

    const codeReplay = await post("/auth/verify-reset-otp", { email, code });
    assert.ok([400, 409, 410].includes(codeReplay.statusCode), `got ${codeReplay.statusCode}`);

    assert.equal((await post("/auth/login", { email, password: "first-new-password" })).statusCode, 200);
    assert.equal((await post("/auth/login", { email, password: "second-new-password" })).statusCode, 401);
  });

  it("a weak new password is refused and the old one still works", async () => {
    const email = addr("reset-weak");
    await signUp(email);
    await ageChallenges(email);
    const code = ((await post("/auth/forgot-password", { email })).json() as Json)["devCode"];
    const resetToken = ((await post("/auth/verify-reset-otp", { email, code })).json() as Json)["resetToken"];

    assert.equal((await post("/auth/reset-password", { email, resetToken, password: "short" })).statusCode, 400);
    assert.equal((await post("/auth/login", { email, password: GOOD_PASSWORD })).statusCode, 200);
  });

  it("a forged reset token cannot change a password", async () => {
    const email = addr("reset-forged");
    await signUp(email);
    const forged = "f".repeat(43);
    const res = await post("/auth/reset-password", { email, resetToken: forged, password: "forged-new-password" });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as Json)["error"].code, "RESET_TOKEN_INVALID");
    assert.equal((await post("/auth/login", { email, password: GOOD_PASSWORD })).statusCode, 200);
  });

  it("a verification code cannot authorise a password reset", async () => {
    const email = addr("cross-purpose");
    const reg = await post("/auth/register", { email, password: GOOD_PASSWORD });
    const verificationCode = (reg.json() as Json)["devCode"] as string;

    const misuse = await post("/auth/verify-reset-otp", { email, code: verificationCode });
    assert.ok(misuse.statusCode >= 400, "a verification code must not satisfy a reset challenge");
    assert.equal((misuse.json() as Json)["resetToken"], undefined);

    // And the verification challenge is untouched — the misuse did not
    // consume the code the user still needs.
    const [c] = await h.db.select().from(otpChallenges).where(eq(otpChallenges.email, email));
    assert.equal(c!.consumedAt, null);
    assert.equal((await post("/auth/verify-email", { email, code: verificationCode })).statusCode, 200);
  });
});

/* ============================================================= SECURITY */

describe("AUTH-SEC — security properties", () => {
  it("AUTH-SEC-03: no endpoint ever returns a password or a password hash", async () => {
    const email = addr("sec03");
    const token = await signUp(email);
    const responses = [await post("/auth/login", { email, password: GOOD_PASSWORD }), await get("/auth/me", token)];
    for (const res of responses) {
      assert.ok(!res.body.includes("argon2"), "an argon2 digest leaked");
      assert.ok(!res.body.includes("passwordHash"), "the passwordHash key leaked");
      assert.ok(!res.body.includes("password_hash"), "the password_hash column leaked");
      assert.ok(!res.body.includes(GOOD_PASSWORD), "the password leaked");
    }
  });

  it("AUTH-SEC-04: the per-IP authentication rate limit is enforced", async () => {
    // One source address, many distinct emails, so only the per-IP limiter
    // can fire. AUTH_RATE_LIMIT_MAX is 8 under test.
    const ip = "203.0.113.55";
    for (let i = 0; i < 8; i++) {
      const res = await post("/auth/login", { email: `limited${i}@example.com`, password: GOOD_PASSWORD }, ip);
      assert.ok(res.statusCode < 500, `request ${i + 1} should be handled, got ${res.statusCode}`);
    }
    const blocked = await post("/auth/login", { email: addr("limited-over"), password: GOOD_PASSWORD }, ip);
    assert.equal(blocked.statusCode, 429);
    assert.equal((blocked.json() as Json)["error"].code, "RATE_LIMITED");

    // A different caller is unaffected: the limit is per-IP, not global.
    assert.notEqual((await post("/auth/login", { email: addr("elsewhere"), password: GOOD_PASSWORD })).statusCode, 429);
  });

  it("AUTH-SEC-01/02: the logger redacts credentials, and no module hands it one", async () => {
    const root = fileURLToPath(new URL("../src/", import.meta.url));

    // The redact list is the mechanism, so assert it names the fields.
    const app = await readFile(join(root, "app.ts"), "utf8");
    for (const path of ["req.body.password", "req.body.code", "req.headers.authorization"]) {
      assert.ok(app.includes(`"${path}"`), `the logger does not redact ${path}`);
    }

    /**
     * And nothing hands a credential to the logger in the first place.
     *
     * The scan reads each logger call's object argument as text and looks for
     * any mention of a credential — `{ code }`, `{ otp: code }` and
     * `{ password }` are all caught, where a check on key names alone would
     * miss the shorthand forms.
     *
     * One carve-out, applied before the scan: `key: error.something` is
     * metadata read off a thrown AppError, not a credential. That holds
     * because `logContext` is the only free-form part of an AppError and is
     * itself asserted below.
     *
     * `email/adapters` is excluded on purpose: the console adapter PRINTS the
     * message it would otherwise send, which is a delivery channel for local
     * development rather than a log of a secret.
     */
    const FORBIDDEN = /\b(password|passwordHash|newPassword|codeHash|otp|code|token|resetToken|tokenHash|secret)\b/i;
    const ERROR_METADATA = /[A-Za-z_$][\w$]*\s*:\s*(?:error|err)\.[\w.?]+/g;
    const files: string[] = [];
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "adapters") continue;
          await walk(full);
        } else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    await walk(root);
    assert.ok(files.length > 10, "the scan found the source tree");

    for (const file of files) {
      const source = await readFile(file, "utf8");
      // Every logger call whose first argument is an object literal.
      for (const match of source.matchAll(/\.log\.\w+\(\s*\{([^}]*)/g)) {
        const logged = match[1]!.replace(ERROR_METADATA, "");
        assert.ok(!FORBIDDEN.test(logged), `${file} logs a credential: {${match[1]!.trim()}`);
      }
      // The one free-form field on an AppError reaches the log by spread.
      for (const match of source.matchAll(/logContext:\s*\{([^}]*)\}/g)) {
        assert.ok(!FORBIDDEN.test(match[1]!), `${file} puts a credential in logContext`);
      }
      // Nothing writes a credential straight to stdout either.
      assert.ok(
        !/console\.(log|info|warn|error)\([^)]*\b(password|passwordHash|resetToken)\b/i.test(source),
        `${file} writes a credential to the console`
      );
    }
  });

  it("AUTH-SEC-05: no authentication secret is hard-coded in the source", async () => {
    const root = fileURLToPath(new URL("../src/", import.meta.url));
    const targets = ["config/env.ts", "lib/password.ts", "lib/tokens.ts", "lib/otp.ts", "modules/auth/auth.service.ts"];
    for (const rel of targets) {
      const source = await readFile(join(root, rel), "utf8");
      assert.ok(
        !/(?:AUTH_SECRET|apiKey|secretKey)\s*[:=]\s*["'][A-Za-z0-9._\-!@#$%^&*]{12,}["']/i.test(source),
        `${rel} appears to contain a literal secret`
      );
    }
    const envSource = await readFile(join(root, "config/env.ts"), "utf8");
    assert.ok(/AUTH_SECRET/.test(envSource), "the secret is read from the environment");
    assert.ok(!/AUTH_SECRET[^\n]*\.default\(/.test(envSource), "AUTH_SECRET must have no default");
  });
});
