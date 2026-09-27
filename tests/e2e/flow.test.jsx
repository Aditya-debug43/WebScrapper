import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderAuthApp, TOKEN_KEY } from "../helpers/renderAuth.jsx";

/**
 * E2E-01..06 — the whole thing, for real.
 *
 * The React components are the shipped ones, the fetch client is the
 * shipped one, and the server on the other end is the real Fastify
 * application with a real PostgreSQL behind it. Nothing in this file stubs
 * a network call, and there is no canned response anywhere in it.
 *
 * The verification codes are read out of the API's own console email
 * adapter — the same place a developer reads them during development — so
 * even the six digits typed into the form are digits the server issued.
 */

const LOG = process.env.E2E_API_LOG;
const PASSWORD = "e2e-correct-horse-battery";
const NEW_PASSWORD = "e2e-a-brand-new-password";

/** A fresh address per run, so a re-run is not a duplicate registration. */
const stamp = Date.now().toString(36);
const addr = (tag) => `e2e-${tag}-${stamp}@example.com`;

/**
 * The newest code the server actually sent to this address.
 *
 * Polls, because the email is written to the log a moment after the HTTP
 * response the browser already has.
 */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function codeSentTo(email, { subject }) {
  // The console adapter prints `→ <address> · <subject>` and then the body;
  // the code sits on its own indented line a few lines down.
  const header = new RegExp(`\\[email:console\\] → ${escape(email)} · ${escape(subject)}`, "g");

  for (let attempt = 0; attempt < 40; attempt++) {
    const log = await readFile(LOG, "utf8").catch(() => "");
    const headers = [...log.matchAll(header)];
    if (headers.length) {
      const body = log.slice(headers.at(-1).index);
      const code = body.match(/^\s{2,}(\d{6})\s*$/m)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No "${subject}" email reached ${email}. Check ${LOG}.`);
}

const verificationCodeFor = (email) => codeSentTo(email, { subject: "Verify your Mulya account" });
const resetCodeFor = (email) => codeSentTo(email, { subject: "Reset your Mulya password" });

describe("E2E — the real application against the real API", () => {
  it("E2E-00: the test really is talking to a live server", async () => {
    const base = import.meta.env.VITE_API_BASE_URL;
    expect(base, "VITE_API_BASE_URL was not injected").toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/v1$/);
    const health = await fetch(base.replace(/\/api\/v1$/, "/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
  });

  it("E2E-01: register → verify → the desk, with a code the server really sent", async () => {
    const email = addr("signup");
    const user = userEvent.setup();
    renderAuthApp({ route: "/create-account" });

    await user.type(screen.getByLabelText(/work email/i), email);
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /create account/i }));

    // Registration must not have signed anybody in.
    expect(await screen.findByRole("heading", { name: /check your email/i }, { timeout: 20_000 })).toBeInTheDocument();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();

    const code = await verificationCodeFor(email);
    await user.type(screen.getByLabelText(/verification code/i), code);
    await user.click(screen.getByRole("button", { name: /verify and continue/i }));

    expect(await screen.findByTestId("desk", {}, { timeout: 20_000 })).toBeInTheDocument();
    const token = window.localStorage.getItem(TOKEN_KEY);
    expect(token).toBeTruthy();

    // The token is real: the live API accepts it, and answers without a hash.
    const me = await fetch(`${import.meta.env.VITE_API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.user.email).toBe(email);
    expect(JSON.stringify(body)).not.toContain("argon2");
    expect(body.user.passwordHash).toBeUndefined();
  });

  it("E2E-02: the same password signs that account back in on a fresh browser", async () => {
    const email = addr("signup");
    const user = userEvent.setup();
    renderAuthApp({ route: "/sign-in" });

    await user.type(screen.getByLabelText(/^email$/i), email);
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByTestId("desk", {}, { timeout: 20_000 })).toBeInTheDocument();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeTruthy();
  });

  it("E2E-03: the wrong password is refused by the live server", async () => {
    const email = addr("signup");
    const user = userEvent.setup();
    renderAuthApp({ route: "/sign-in" });

    await user.type(screen.getByLabelText(/^email$/i), email);
    await user.type(screen.getByLabelText(/^password$/i), "not-the-right-password");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("alert", {}, { timeout: 20_000 })).toHaveTextContent(
      /email or password is incorrect/i
    );
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(screen.queryByTestId("desk")).not.toBeInTheDocument();
  });

  it("E2E-04: an unverified account cannot sign in, however correct the password", async () => {
    const email = addr("unverified");
    const user = userEvent.setup();

    // Register and then walk away, exactly as an abandoned signup would.
    const first = renderAuthApp({ route: "/create-account" });
    await user.type(screen.getByLabelText(/work email/i), email);
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /create account/i }));
    await screen.findByRole("heading", { name: /check your email/i }, { timeout: 20_000 });
    first.unmount();
    window.sessionStorage.clear();

    renderAuthApp({ route: "/sign-in" });
    await user.type(screen.getByLabelText(/^email$/i), email);
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    const alert = await screen.findByRole("alert", {}, { timeout: 20_000 });
    expect(alert).toHaveTextContent(/verify your email address/i);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("E2E-05: a password reset replaces the credential and kills the old session", async () => {
    const email = addr("reset");
    const user = userEvent.setup();

    // Create and verify an account.
    const signup = renderAuthApp({ route: "/create-account" });
    await user.type(screen.getByLabelText(/work email/i), email);
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /create account/i }));
    await screen.findByRole("heading", { name: /check your email/i }, { timeout: 20_000 });
    await user.type(screen.getByLabelText(/verification code/i), await verificationCodeFor(email));
    await user.click(screen.getByRole("button", { name: /verify and continue/i }));
    await screen.findByTestId("desk", {}, { timeout: 20_000 });

    const oldToken = window.localStorage.getItem(TOKEN_KEY);
    expect(oldToken).toBeTruthy();
    signup.unmount();
    window.localStorage.clear();
    window.sessionStorage.clear();

    // Reset it.
    renderAuthApp({ route: "/forgot-password" });
    await user.type(screen.getByLabelText(/^email$/i), email);
    await user.click(screen.getByRole("button", { name: /send reset code/i }));

    await screen.findByRole("heading", { name: /choose a new password/i }, { timeout: 20_000 });
    await user.type(screen.getByLabelText(/verification code/i), await resetCodeFor(email));
    await user.type(screen.getByLabelText(/new password/i), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: /update password/i }));

    // Ends at the door, signed out, told why.
    expect(
      await screen.findByRole("heading", { name: /the desk, where you left it/i }, { timeout: 20_000 })
    ).toBeInTheDocument();
    expect(screen.getByText(/password updated/i)).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull());

    // The session held before the reset is genuinely dead on the server.
    const stale = await fetch(`${import.meta.env.VITE_API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${oldToken}` },
    });
    expect(stale.status).toBe(401);

    // The old password is dead and the new one works, in the real UI.
    await user.type(screen.getByLabelText(/^email$/i), email);
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(await screen.findByRole("alert", {}, { timeout: 20_000 })).toHaveTextContent(/incorrect/i);

    await user.clear(screen.getByLabelText(/^password$/i));
    await user.type(screen.getByLabelText(/^password$/i), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(await screen.findByTestId("desk", {}, { timeout: 20_000 })).toBeInTheDocument();
  });

  it("E2E-06: signing out revokes the session on the server, not just in the browser", async () => {
    const email = addr("signup");
    const user = userEvent.setup();
    renderAuthApp({ route: "/sign-in" });

    await user.type(screen.getByLabelText(/^email$/i), email);
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    await screen.findByTestId("desk", {}, { timeout: 20_000 });

    const token = window.localStorage.getItem(TOKEN_KEY);
    await user.click(screen.getByRole("button", { name: /^account —/i }));
    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));

    await waitFor(() => expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull());
    expect(
      await screen.findByRole("heading", { name: /the desk, where you left it/i }, { timeout: 20_000 })
    ).toBeInTheDocument();

    // The decisive check: the token no longer works against the live API.
    const after = await fetch(`${import.meta.env.VITE_API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
  });
});
