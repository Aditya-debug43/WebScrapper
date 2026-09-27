import "./helpers/env.js";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { registerErrorHandling } from "../src/plugins/errors.js";
import { fileURLToPath } from "node:url";
import { createTestApp, signIn, bearer, type Harness, type Json } from "./helpers/harness.js";
import { MemoryEmailAdapter } from "../src/email/index.js";
import { otpMessage } from "../src/email/index.js";

/** EMAIL-01..04 and API-01..05. */

let h: Harness;
before(async () => {
  h = await createTestApp();
});
after(async () => {
  await h.close();
});

describe("EMAIL", () => {
  it("EMAIL-03: the test adapter needs no external provider and captures in memory", async () => {
    const adapter = new MemoryEmailAdapter();
    assert.equal(adapter.name, "memory");
    await adapter.send({ to: "someone@example.com", subject: "s", text: "t" });
    assert.equal(adapter.sent.length, 1);
    assert.equal(adapter.last?.to, "someone@example.com");

    adapter.clear();
    assert.equal(adapter.sent.length, 0, "clear() resets between tests");
  });

  it("EMAIL-01: the OTP message states the code, its lifetime and its single use", async () => {
    const message = otpMessage("reader@example.com", "123456", 600, "email_verification");
    assert.equal(message.to, "reader@example.com");
    assert.ok(message.text.includes("123456"));
    assert.ok(/10 minutes/.test(message.text), "states the expiry in minutes");
    assert.ok(/once/.test(message.text), "states that it is single-use");
  });

  it("EMAIL-02: delivery is routed to the requested address only", async () => {
    h.email.clear();
    await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "routing@example.com", password: "routing-test-password" },
      remoteAddress: "10.90.0.1",
    });
    assert.equal(h.email.sent.length, 1);
    assert.equal(h.email.sent[0]!.to, "routing@example.com");
    assert.equal(h.email.to("someone-else@example.com").length, 0);
  });

  it("EMAIL-04: no email credential is hard-coded anywhere in the source", async () => {
    // Every provider setting must come from the environment. This greps the
    // adapters rather than trusting review.
    const files = ["../src/email/adapters/http.adapter.ts", "../src/email/index.ts", "../src/config/env.ts"];
    for (const rel of files) {
      const source = await readFile(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
      assert.ok(
        !/(?:api[_-]?key|secret|password)\s*[:=]\s*["'][A-Za-z0-9._-]{12,}["']/i.test(source),
        `${rel} appears to contain a literal credential`
      );
      // Anything that looks like a real provider key prefix.
      assert.ok(!/\bre_[A-Za-z0-9]{16,}\b|\bSG\.[A-Za-z0-9_-]{16,}\b/.test(source), `${rel} contains a provider key`);
    }
    const http = await readFile(fileURLToPath(new URL("../src/email/adapters/http.adapter.ts", import.meta.url)), "utf8");
    assert.ok(http.includes("env.EMAIL_API_KEY"), "the key is read from the environment");
    assert.ok(http.includes("env.EMAIL_API_URL"), "the endpoint is read from the environment");
  });
});

describe("API foundation", () => {
  it("API-01: /health reports liveness and discloses nothing about the infrastructure", async () => {
    const res = await h.app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);
    const body = res.json() as Json;
    assert.deepEqual(body, { status: "ok" });

    // No version, host, driver or dependency detail — a health endpoint is
    // unauthenticated and is the cheapest reconnaissance target there is.
    const text = JSON.stringify(body).toLowerCase();
    for (const leak of ["postgres", "pglite", "version", "host", "database", "commit", "node"]) {
      assert.ok(!text.includes(leak), `health response mentions "${leak}"`);
    }
  });

  it("API-02: malformed requests are rejected with 4xx before reaching a service", async () => {
    const cases: Array<[string, string, unknown, number]> = [
      ["POST", "/api/v1/auth/register", {}, 400],
      ["POST", "/api/v1/auth/register", { email: 42, password: "a-valid-password" }, 400],
      ["POST", "/api/v1/auth/register", { email: "a@b.com" }, 400],
      ["POST", "/api/v1/auth/register", { email: "a@b.com", password: "a-valid-password", extra: "no" }, 400],
      ["POST", "/api/v1/auth/verify-email", { email: "a@b.com" }, 400],
      ["POST", "/api/v1/auth/verify-email", { email: "a@b.com", code: "12" }, 400],
      ["POST", "/api/v1/auth/verify-email", { email: "a@b.com", code: "abcdef" }, 400],
      ["POST", "/api/v1/auth/login", { email: "a@b.com" }, 400],
      ["POST", "/api/v1/auth/reset-password", { email: "a@b.com", resetToken: "tooshort", password: "a-valid-password" }, 400],
    ];
    // One source address per case: there are more cases than the per-IP auth
    // budget allows, and a 429 here would look like the schema working.
    let n = 0;
    for (const [method, url, payload, expected] of cases) {
      const res = await h.app.inject({
        method: method as "POST",
        url,
        payload: payload as object,
        remoteAddress: `10.91.0.${++n}`,
      });
      assert.equal(res.statusCode, expected, `${method} ${url} ${JSON.stringify(payload)}`);
    }
  });

  it("API-03: validation errors use the standard envelope with field detail", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "nope", password: "a-valid-enough-password" },
      remoteAddress: "10.92.0.1",
    });
    assert.equal(res.statusCode, 400);
    const body = res.json() as Json;
    assert.deepEqual(Object.keys(body), ["error"], "the body is exactly { error }");
    assert.equal(body["error"].code, "VALIDATION_FAILED");
    assert.equal(typeof body["error"].message, "string");
    assert.ok(Array.isArray(body["error"].details), "field-level detail is included");
    assert.ok(body["error"].details.length > 0);
  });

  it("API-03b: a 404 uses the same envelope", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/v1/nope" });
    assert.equal(res.statusCode, 404);
    const body = res.json() as Json;
    assert.equal(body["error"].code, "NOT_FOUND");
  });

  it("API-04: an unhandled server error exposes no stack, SQL or internals", async () => {
    /**
     * Exercised on a throwaway instance carrying the real error handler,
     * rather than by bolting a route onto the live app — Fastify refuses new
     * routes after the instance is ready, and production code should not grow
     * a deliberately-throwing endpoint just to be testable.
     */
    const probe = Fastify({ logger: false });
    registerErrorHandling(probe);
    probe.get("/api/v1/__boom", async () => {
      throw new Error('relation "secret_table" does not exist at /srv/app/src/db.ts:42');
    });
    await probe.ready();

    const res = await probe.inject({ method: "GET", url: "/api/v1/__boom" });
    assert.equal(res.statusCode, 500);
    const raw = res.body;
    assert.equal((res.json() as Json)["error"].code, "INTERNAL_ERROR");
    for (const leak of ["secret_table", "/srv/app", "db.ts", "stack", "at Object"]) {
      assert.ok(!raw.includes(leak), `the 500 body leaked "${leak}"`);
    }
    await probe.close();
  });

  it("API-05: protected endpoints reject unauthenticated requests", async () => {
    for (const [method, url] of [
      ["GET", "/api/v1/auth/me"],
      ["POST", "/api/v1/auth/logout"],
    ] as const) {
      const res = await h.app.inject({ method, url });
      assert.equal(res.statusCode, 401, `${method} ${url}`);
      assert.equal((res.json() as Json)["error"].code, "UNAUTHENTICATED");
    }
  });

  it("API-05b: the same endpoints succeed once authenticated", async () => {
    const { token } = await signIn(h, "protected@example.com");
    const res = await h.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: bearer(token) });
    assert.equal(res.statusCode, 200);
  });
});
