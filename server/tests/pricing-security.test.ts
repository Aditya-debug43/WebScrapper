import "./helpers/env.js";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAnalysisTestApp, signIn, bearer, type Harness } from "./helpers/harness.js";

/**
 * The recommendation endpoint's security surface — Phase 6, Part 33.
 *
 * A price recommendation is the product, not the public marketplace data
 * underneath it, so it uses the same authentication as the analysis routes it
 * sits on. The analysis endpoints have had this coverage since Phase 5; the
 * recommendation had none until this file, which is exactly the kind of gap
 * that survives because everything works when you are signed in.
 */

const PRODUCT = "prod_dove_hair_fall";

let h: Harness;
let token: string;

before(async () => {
  h = await createAnalysisTestApp([PRODUCT]);
  ({ token } = await signIn(h, "pricing-security@example.com"));
});
after(async () => {
  await h.close();
});

const get = (url: string, auth = true) =>
  h.app.inject({
    method: "GET",
    url: `/api/v1${url}`,
    headers: auth ? bearer(token) : {},
    remoteAddress: "10.99.0.1",
  });

describe("the recommendation is protected", () => {
  it("requires authentication", async () => {
    const res = await get(`/products/${PRODUCT}/recommendation`, false);
    assert.equal(res.statusCode, 401);
    assert.equal((res.json() as Record<string, any>).error.code, "UNAUTHENTICATED");
  });

  it("rejects a malformed or forged bearer token", async () => {
    for (const value of ["Bearer", "Bearer ", "Bearer not-a-real-token", `Bearer ${"a".repeat(64)}`, "Basic abc"]) {
      const res = await h.app.inject({
        method: "GET",
        url: `/api/v1/products/${PRODUCT}/recommendation`,
        headers: { authorization: value },
        remoteAddress: "10.99.0.2",
      });
      assert.equal(res.statusCode, 401, `accepted "${value}"`);
    }
  });

  it("rejects unknown query parameters instead of ignoring them", async () => {
    /**
     * Fastify's AJV strips unknown properties by default, which would make a
     * misspelled filter look like it worked. That default is off, so a typo
     * fails loudly rather than silently returning the unfiltered answer.
     */
    for (const query of ["?windo=7d", "?window=7d", "?model=baseline-v1&extra=1", "?marketplaceId=mkt_amazon_in"]) {
      const res = await get(`/products/${PRODUCT}/recommendation${query}`);
      assert.equal(res.statusCode, 400, `accepted ${query}`);
    }
  });

  it("rejects an unknown model version rather than quietly serving the default", async () => {
    // Serving v1 to a caller who asked for v2 is worse than an error: the
    // numbers would be read as the other model's.
    const res = await get(`/products/${PRODUCT}/recommendation?model=totally-made-up`);
    assert.equal(res.statusCode, 400);
    assert.ok(!res.body.includes("strategies"), "a rejected version still returned a price");
  });

  it("rejects an unknown marketplace with field detail, not an empty answer", async () => {
    const res = await get(`/products/${PRODUCT}/recommendation?marketplace=mkt_does_not_exist`);
    assert.ok([400, 404].includes(res.statusCode), `got ${res.statusCode}`);
  });

  it("leaks no credential, secret or internal field into a recommendation", async () => {
    const res = await get(`/products/${PRODUCT}/recommendation`);
    assert.equal(res.statusCode, 200);
    for (const leak of [
      "passwordHash",
      "password_hash",
      "argon2",
      "tokenHash",
      "token_hash",
      "otp",
      "AUTH_SECRET",
      "SMTP_PASS",
      "sessionId",
      "session_id",
      "userId",
      "user_id",
      "DATABASE_URL",
    ]) {
      assert.ok(!res.body.includes(leak), `a recommendation response contains "${leak}"`);
    }
  });

  it("leaks nothing through a refusal either", async () => {
    // The refusal path builds a different response, so it needs its own check
    // rather than inheriting the one above.
    const refusing = await createAnalysisTestApp(["prod_airpods_pro2"]);
    try {
      const { token: t } = await signIn(refusing, "pricing-security-refusal@example.com");
      const res = await refusing.app.inject({
        method: "GET",
        url: "/api/v1/products/prod_airpods_pro2/recommendation",
        headers: bearer(t),
        remoteAddress: "10.99.0.3",
      });
      assert.equal(res.statusCode, 200);
      assert.equal((res.json() as Record<string, any>).data.status, "insufficient_evidence");
      for (const leak of ["passwordHash", "tokenHash", "AUTH_SECRET", "sessionId", "user_id"]) {
        assert.ok(!res.body.includes(leak), `a refusal response contains "${leak}"`);
      }
    } finally {
      await refusing.close();
    }
  });

  it("a missing product is a 404, and says nothing about what exists", async () => {
    const res = await get("/products/prod_definitely_not_real/recommendation");
    assert.equal(res.statusCode, 404);
    const body = res.json() as Record<string, any>;
    assert.equal(body.error.code, "NOT_FOUND");
    // No table names, no SQL, no row counts.
    for (const leak of ["select ", "products.", "pg_", "relation"]) {
      assert.ok(!String(body.error.message).toLowerCase().includes(leak), `the 404 leaks "${leak}"`);
    }
  });
});
