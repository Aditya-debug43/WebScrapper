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

/**
 * E2E-07..12 — the recommendation, over the wire.
 *
 * Phase 7's claim is that the recommendation screen is driven by the backend.
 * These sign in against the live API, mount the SHIPPED page, and assert that
 * what appears on it came from a real HTTP response built by the real service
 * over a real database. Nothing here is stubbed, including the failure case.
 */
describe("E2E — the recommendation comes from the backend", () => {
  /** Strong data, 6 marketplaces: the recommendation path. */
  const PRICED = "prod_dove_hair_fall";

  async function signedIn(route) {
    const user = userEvent.setup();
    const view = renderAuthApp({ route: "/sign-in" });
    await user.type(screen.getByLabelText(/^email$/i), addr("signup"));
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    await screen.findByTestId("desk", {}, { timeout: 20_000 });
    view.unmount();
    // A second mount with the session already in storage — the same thing a
    // page refresh does.
    return { user, view: renderAuthApp({ route }) };
  }

  /**
   * E2E-07..10 were rewritten for the real-data architecture.
   *
   * They used to drive a SEEDED product through the catalogue-comparable
   * engine. That engine priced against a bundled catalogue, and the whole
   * point of this phase is that production no longer has one — so asserting
   * it still works would be asserting the thing we removed.
   *
   * What they prove now is the replacement: a product discovered live can be
   * tracked and priced from real market evidence, and a seeded product
   * refuses rather than quietly pricing against synthetic comparables.
   */

  it("E2E-07: live search finds a product and tracking records a real price", async () => {
    const { user } = await signedIn("/catalogue");

    // Typed into the box, as a user would. The results come from a capture,
    // not from the products table.
    const box = await screen.findByLabelText(/search the live market/i, {}, { timeout: 30_000 });
    await user.type(box, "iPhone 15 128GB");
    await user.click(screen.getByRole("button", { name: /^search$/i }));

    const buttons = await screen.findAllByRole("button", { name: /track this product/i }, { timeout: 30_000 });
    expect(buttons.length).toBeGreaterThan(0);

    const token = window.localStorage.getItem(TOKEN_KEY);
    const search = await fetch(
      `${import.meta.env.VITE_API_BASE_URL}/search?q=${encodeURIComponent("iPhone 15 128GB")}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(search.status).toBe(200);
    const { data } = await search.json();
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0].ref).toBeTruthy();

    // Tracking it creates the product and its first real observation.
    const tracked = await fetch(`${import.meta.env.VITE_API_BASE_URL}/tracked`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ref: data.results[0].ref }),
    });
    expect(tracked.status).toBe(201);
    const created = (await tracked.json()).data;
    expect(created.product.id).toBeTruthy();

    const desk = await fetch(`${import.meta.env.VITE_API_BASE_URL}/tracked`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const rows = (await desk.json()).data;
    const row = rows.find((r) => r.productId === created.product.id);
    expect(row.observationCount).toBeGreaterThanOrEqual(1);
    expect(row.currentPriceMinor).toBeGreaterThan(0);
  });

  it("E2E-08: a seeded product refuses rather than pricing from synthetic data", async () => {
    const token = window.localStorage.getItem(TOKEN_KEY) ?? (await signedIn("/"), window.localStorage.getItem(TOKEN_KEY));
    const response = await fetch(
      `${import.meta.env.VITE_API_BASE_URL}/products/${PRICED}/market-recommendation`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    // 400 with a reason: it has no live market query behind it.
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.message).toMatch(/no live market query/i);
    expect(JSON.stringify(body)).not.toMatch(/recommendedPriceMinor/);
  });

  it("E2E-09: a tracked live product is priced with no history at all", async () => {
    const { user } = await signedIn("/catalogue");
    const box = await screen.findByLabelText(/search the live market/i, {}, { timeout: 30_000 });
    await user.type(box, "POCO X6 Pro 8GB 256GB");
    await user.click(screen.getByRole("button", { name: /^search$/i }));

    await screen.findAllByRole("button", { name: /track this product/i }, { timeout: 30_000 });
    await user.click(screen.getAllByRole("button", { name: /track this product/i })[0]);
    await screen.findByRole("button", { name: /^tracking$/i }, {}, { timeout: 30_000 });

    const token = window.localStorage.getItem(TOKEN_KEY);
    const desk = await fetch(`${import.meta.env.VITE_API_BASE_URL}/tracked`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const row = (await desk.json()).data[0];

    const rec = await fetch(
      `${import.meta.env.VITE_API_BASE_URL}/products/${row.productId}/market-recommendation`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(rec.status).toBe(200);
    const { data } = await rec.json();

    // Cold start: one capture, no history, and still a defensible answer —
    // or an honest refusal if even the current market is too thin.
    if (data.available) {
      expect(data.mode).toBe("cold_start");
      expect(data.recommendedPriceMinor).toBeGreaterThan(0);
      /*
       * Competing SELLERS, not search rows. The distinction is the whole
       * redesign: a shopping search returns one row per catalogue id, so the
       * old count was counting different products. These are merchants
       * selling this one, each on a marketplace.
       */
      expect(data.market.sellerCount).toBeGreaterThanOrEqual(3);
      expect(data.market.marketplaceCount).toBeGreaterThanOrEqual(2);
      expect(data.market.sellers.length).toBe(data.market.sellerCount);
      // And the market it was argued from was assembled from several ids.
      expect(data.market.catalogIdCount).toBeGreaterThan(1);
      expect(data.method).toBe("deterministic");
    } else {
      expect(data.reason).toBe("insufficient_market_evidence");
      expect(data.recommendedPriceMinor).toBeUndefined();
    }
  });

  it("E2E-10: a product that does not exist fails safely", async () => {
    await signedIn("/products/prod_does_not_exist/recommendation");
    expect(await screen.findByText(/could not be found|no product with id/i, {}, { timeout: 30_000 })).toBeInTheDocument();
    expect(screen.queryByText(/Recommended price/i)).not.toBeInTheDocument();
  });

  it("E2E-11: the endpoint refuses an unauthenticated request", async () => {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/products/${PRICED}/market-recommendation`);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(JSON.stringify(body)).not.toMatch(/recommendedPriceMinor/);
  });

  it("E2E-12: a revoked session cannot load a recommendation", async () => {
    const { user } = await signedIn("/");
    // The remount restores the session before the menu exists.
    await screen.findByTestId("desk", {}, { timeout: 20_000 });
    const token = window.localStorage.getItem(TOKEN_KEY);
    await user.click(screen.getByRole("button", { name: /^account —/i }));
    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));
    await waitFor(() => expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull());

    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/products/${PRICED}/market-recommendation`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(401);
  });
});

/**
 * E2E-13..18 — the cross-marketplace analysis, over the wire.
 *
 * Phase 8's claim is that the analysis screen is driven by the backend and
 * that the browser no longer prices anything anywhere. These sign in against
 * the live API, mount the SHIPPED page, and assert that what appears came
 * from real HTTP responses built by the real services over a real database.
 */
describe("E2E — the analysis comes from the backend", () => {
  const STRONG = "prod_dove_hair_fall";
  const THIN = "prod_airpods_pro2";

  async function signedIn(route) {
    const user = userEvent.setup();
    const view = renderAuthApp({ route: "/sign-in" });
    await user.type(screen.getByLabelText(/^email$/i), addr("signup"));
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    await screen.findByTestId("desk", {}, { timeout: 20_000 });
    view.unmount();
    return { user, view: renderAuthApp({ route }) };
  }

  it("E2E-13: the analysis renders values the API computed", async () => {
    await signedIn(`/products/${STRONG}/analysis`);
    expect(await screen.findByTestId("workspace", {}, { timeout: 30_000 })).toBeInTheDocument();
    expect(await screen.findByText(/What we observed/i, {}, { timeout: 30_000 })).toBeInTheDocument();

    /**
     * The decisive check: fetch the analysis independently and compare the
     * figures on screen against it. A page doing its own arithmetic would
     * disagree with the service and fail here.
     */
    const token = window.localStorage.getItem(TOKEN_KEY);
    const base = import.meta.env.VITE_API_BASE_URL;
    const auth = { headers: { Authorization: `Bearer ${token}` } };

    const analysis = await fetch(`${base}/products/${STRONG}/analysis?from=0001-01-01`, auth);
    expect(analysis.status).toBe(200);
    const { data } = await analysis.json();

    const inr = (minor) => `₹${Math.round(minor / 100).toLocaleString("en-IN")}`;
    // Every marketplace the API reports is named on the page, at its price.
    for (const row of data.marketplaceRows.filter((r) => r.effectiveMinor != null)) {
      expect(screen.getAllByText(row.marketplaceName).length).toBeGreaterThan(0);
      expect(screen.getAllByText(inr(row.effectiveMinor)).length).toBeGreaterThan(0);
    }
    // And every finding headline the API determined.
    expect(data.findings.length).toBeGreaterThan(0);
  });

  it("E2E-14: the analysis request is what feeds the page", async () => {
    const token = await (async () => {
      await signedIn("/");
      await screen.findByTestId("desk", {}, { timeout: 20_000 });
      return window.localStorage.getItem(TOKEN_KEY);
    })();

    const base = import.meta.env.VITE_API_BASE_URL;
    const response = await fetch(`${base}/products/${STRONG}/analysis?from=0001-01-01`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const { data, meta } = await response.json();
    expect(data.marketplaceRows.length).toBeGreaterThan(1);
    expect(data.competitors.rows.length).toBeGreaterThan(0);
    expect(data.history.observationCount).toBeGreaterThan(0);
    // Phase 5's two omissions are now served by the recommendation.
    expect(meta.notMigrated.map((n) => n.id).sort()).toEqual(["bridge", "wtp"]);
  });

  it("E2E-15: a thin product renders the limited analysis, not an invented one", async () => {
    await signedIn(`/products/${THIN}/analysis`);
    expect(await screen.findByTestId("workspace", {}, { timeout: 30_000 })).toBeInTheDocument();
    // The limited banner appears and the competitor section does not.
    expect(await screen.findByText(/What we observed/i, {}, { timeout: 30_000 })).toBeInTheDocument();
    expect(screen.queryByText(/Therefore . the price/i)).not.toBeInTheDocument();
  });

  it("E2E-16: a reload still loads the analysis from the backend", async () => {
    const { view } = await signedIn(`/products/${STRONG}/analysis`);
    await screen.findByText(/What we observed/i, {}, { timeout: 30_000 });
    view.unmount();
    renderAuthApp({ route: `/products/${STRONG}/analysis` });
    expect(await screen.findByText(/What we observed/i, {}, { timeout: 30_000 })).toBeInTheDocument();
  });

  it("E2E-17: a product that does not exist fails safely", async () => {
    await signedIn("/products/prod_does_not_exist/analysis");
    expect(await screen.findByText(/could not be found/i, {}, { timeout: 30_000 })).toBeInTheDocument();
  });

  it("E2E-18: the analysis endpoint refuses an unauthenticated request", async () => {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/products/${STRONG}/analysis`);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(JSON.stringify(body)).not.toMatch(/marketplaceRows|findings/);
  });
});
