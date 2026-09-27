import { vi } from "vitest";

/**
 * A stand-in for the API, speaking the real contract.
 *
 * It is NOT a stub of the frontend's own functions — those are exactly what
 * is under test. It replaces `fetch`, so every assertion here is about the
 * requests the application actually puts on the wire and the way it handles
 * the responses the real server would send: the same status codes, the same
 * `{ error: { code, message, details } }` envelope, the same 204 on logout.
 *
 * Every call is recorded, so a test can assert that signing in really did
 * POST /auth/login with the typed credentials rather than trusting that a
 * screen changed for the right reason.
 *
 * The real end-to-end proof is `tests/e2e`, which runs both servers and
 * mocks nothing at all.
 */
export function installFakeApi(routes = {}) {
  const calls = [];

  const handler = vi.fn(async (input, init = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.replace(/^.*?\/api\/v1/, "");
    const body = init.body ? JSON.parse(init.body) : undefined;
    const authorization = init.headers?.Authorization ?? init.headers?.authorization ?? null;

    calls.push({ url, path, method, body, authorization });

    const route = routes[`${method} ${path}`];
    if (!route) {
      return jsonResponse(404, { error: { code: "NOT_FOUND", message: `No fake route for ${method} ${path}` } });
    }

    const result = typeof route === "function" ? await route({ body, authorization, calls }) : route;
    if (result.status === 204) return new Response(null, { status: 204 });
    return jsonResponse(result.status, result.body);
  });

  vi.stubGlobal("fetch", handler);

  return {
    calls,
    /** Every request to one endpoint, oldest first. */
    to(method, path) {
      return calls.filter((c) => c.method === method && c.path === path);
    },
    /** The most recent request to one endpoint, or undefined. */
    last(method, path) {
      return this.to(method, path).at(-1);
    },
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body ?? {}), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/* --------------------------------------------------- canned response shapes */

export const A_USER = {
  id: "11111111-2222-3333-4444-555555555555",
  email: "operator@example.com",
  displayName: null,
  emailVerified: true,
  lastLoginAt: "2026-09-20T09:15:00.000Z",
  createdAt: "2026-09-01T08:00:00.000Z",
};

export const A_SESSION = {
  token: "a-session-token-that-is-long-enough-to-be-real",
  expiresAt: "2026-10-27T09:15:00.000Z",
  user: A_USER,
};

export const ok = (body) => ({ status: 200, body });
export const created = (body) => ({ status: 201, body });
export const accepted = (body) => ({ status: 202, body });
export const noContent = () => ({ status: 204 });
export const fails = (status, code, message, details) => ({
  status,
  body: { error: details === undefined ? { code, message } : { code, message, details } },
});
