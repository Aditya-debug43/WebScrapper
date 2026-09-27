import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderAuthApp, TOKEN_KEY } from "./helpers/renderAuth.jsx";
import { A_SESSION, A_USER, accepted, created, fails, installFakeApi, noContent, ok } from "./helpers/fakeApi.js";

/**
 * UI-AUTH-01..13 — the authentication interface.
 *
 * These assert what reaches the network and what the browser is left
 * holding, not merely which words appear on screen. A test that only
 * checked for the text "Signed in" would pass against a screen that
 * fabricated it.
 *
 * Nothing here hard-codes a user or short-circuits a guard: every signed-in
 * state in this file is produced by a response the application asked for.
 */

const EMAIL = "operator@example.com";
const PASSWORD = "correct-horse-battery";

describe("UI-AUTH — the door", () => {
  it("UI-AUTH-01: an anonymous visitor to a protected route gets the sign-in screen, not the desk", async () => {
    installFakeApi({});
    renderAuthApp({ route: "/catalogue" });

    expect(await screen.findByRole("heading", { name: /the desk, where you left it/i })).toBeInTheDocument();
    expect(screen.queryByTestId("desk")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("UI-AUTH-02: signing in posts the credentials, stores the token and lands on the desk", async () => {
    const api = installFakeApi({
      "POST /auth/login": ok(A_SESSION),
      "GET /auth/me": ok({ user: A_USER }),
    });
    const user = userEvent.setup();
    renderAuthApp({ route: "/sign-in" });

    await user.type(screen.getByLabelText(/^email$/i), EMAIL);
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByTestId("desk")).toBeInTheDocument();

    // It really went to the real endpoint, with what was typed.
    const login = api.last("POST", "/auth/login");
    expect(login).toBeDefined();
    expect(login.body).toEqual({ email: EMAIL, password: PASSWORD });
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe(A_SESSION.token);
  });

  it("UI-AUTH-03: rejected credentials show the server's wording and leave the browser signed out", async () => {
    installFakeApi({
      "POST /auth/login": fails(401, "INVALID_CREDENTIALS", "Email or password is incorrect."),
    });
    const user = userEvent.setup();
    renderAuthApp({ route: "/sign-in" });

    await user.type(screen.getByLabelText(/^email$/i), EMAIL);
    await user.type(screen.getByLabelText(/^password$/i), "wrong-password-entirely");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
    expect(screen.queryByTestId("desk")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("UI-AUTH-04: an unverified account is offered a new code and taken to verification", async () => {
    const api = installFakeApi({
      "POST /auth/login": fails(403, "EMAIL_NOT_VERIFIED", "Verify your email address before signing in.", {
        email: EMAIL,
        maskedEmail: "op***@example.com",
      }),
      "POST /auth/resend-verification": accepted({ message: "If that account still needs verifying, a new code is on its way." }),
    });
    const user = userEvent.setup();
    renderAuthApp({ route: "/sign-in" });

    await user.type(screen.getByLabelText(/^email$/i), EMAIL);
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/verify your email address/i);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();

    await user.click(within(alert).getByRole("button", { name: /send a new code/i }));

    expect(await screen.findByRole("heading", { name: /check your email/i })).toBeInTheDocument();
    expect(api.last("POST", "/auth/resend-verification").body).toEqual({ email: EMAIL });
  });

  it("the password never reaches browser storage", async () => {
    installFakeApi({ "POST /auth/login": ok(A_SESSION), "GET /auth/me": ok({ user: A_USER }) });
    const user = userEvent.setup();
    renderAuthApp({ route: "/sign-in" });

    await user.type(screen.getByLabelText(/^email$/i), EMAIL);
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    await screen.findByTestId("desk");

    const everything = JSON.stringify({ ...window.localStorage, ...window.sessionStorage });
    expect(everything).not.toContain(PASSWORD);
  });
});

describe("UI-AUTH — creating an account", () => {
  it("UI-AUTH-05: registering posts email and password, and does NOT sign anybody in", async () => {
    const api = installFakeApi({
      "POST /auth/register": created({
        message: "Account created. Check your email for a verification code.",
        maskedEmail: "op***@example.com",
        expiresAt: "2026-09-27T10:10:00.000Z",
      }),
    });
    const user = userEvent.setup();
    renderAuthApp({ route: "/create-account" });

    await user.type(screen.getByLabelText(/work email/i), EMAIL);
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByRole("heading", { name: /check your email/i })).toBeInTheDocument();
    expect(api.last("POST", "/auth/register").body).toEqual({ email: EMAIL, password: PASSWORD });

    // The critical part: registration produced no session.
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(screen.queryByTestId("desk")).not.toBeInTheDocument();
  });

  it("a duplicate address is reported with a route to sign in, and no account state is invented", async () => {
    installFakeApi({
      "POST /auth/register": fails(409, "EMAIL_IN_USE", "An account already exists for this email. Try signing in instead."),
    });
    const user = userEvent.setup();
    renderAuthApp({ route: "/create-account" });

    await user.type(screen.getByLabelText(/work email/i), EMAIL);
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /create account/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/already exists/i);
    expect(within(alert).getByRole("link", { name: /sign in/i })).toBeInTheDocument();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("field-level validation from the server is attached to the field it belongs to", async () => {
    installFakeApi({
      "POST /auth/register": fails(400, "VALIDATION_FAILED", "Password must be at least 8 characters.", [
        { field: "password", message: "must be at least 8 characters" },
      ]),
    });
    const user = userEvent.setup();
    renderAuthApp({ route: "/create-account" });

    await user.type(screen.getByLabelText(/work email/i), EMAIL);
    await user.type(screen.getByLabelText(/^password$/i), "shortpw");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    const password = await screen.findByLabelText(/^password$/i);
    await waitFor(() => expect(password).toHaveAttribute("aria-invalid", "true"));
    // Exact, so this matches the FIELD error and not the form-level notice,
    // which restates the same sentence with the field name in front.
    expect(screen.getByText("must be at least 8 characters")).toBeInTheDocument();
  });
});

describe("UI-AUTH — verifying the address", () => {
  it("UI-AUTH-06: a correct code signs the user in and opens the desk", async () => {
    const api = installFakeApi({
      "POST /auth/register": created({ message: "created", maskedEmail: "op***@example.com" }),
      "POST /auth/verify-email": ok(A_SESSION),
      "GET /auth/me": ok({ user: A_USER }),
    });
    const user = userEvent.setup();
    renderAuthApp({ route: "/create-account" });

    await user.type(screen.getByLabelText(/work email/i), EMAIL);
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await screen.findByRole("heading", { name: /check your email/i });
    await user.type(screen.getByLabelText(/verification code/i), "123456");
    await user.click(screen.getByRole("button", { name: /verify and continue/i }));

    expect(await screen.findByTestId("desk")).toBeInTheDocument();
    expect(api.last("POST", "/auth/verify-email").body).toEqual({ email: EMAIL, code: "123456" });
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe(A_SESSION.token);
  });

  it("UI-AUTH-07: a wrong code reports the attempts left and does not sign anybody in", async () => {
    installFakeApi({
      "POST /auth/register": created({ message: "created", maskedEmail: "op***@example.com" }),
      "POST /auth/verify-email": fails(400, "OTP_INVALID", "That code is not correct.", { attemptsRemaining: 2 }),
    });
    const user = userEvent.setup();
    renderAuthApp({ route: "/create-account" });

    await user.type(screen.getByLabelText(/work email/i), EMAIL);
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await screen.findByRole("heading", { name: /check your email/i });
    await user.type(screen.getByLabelText(/verification code/i), "000000");
    await user.click(screen.getByRole("button", { name: /verify and continue/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/2 attempts left/i);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(screen.queryByTestId("desk")).not.toBeInTheDocument();
  });

  it("an exhausted code stops asking for one and offers a new one", async () => {
    installFakeApi({
      "POST /auth/register": created({ message: "created", maskedEmail: "op***@example.com" }),
      "POST /auth/verify-email": fails(429, "OTP_TOO_MANY_ATTEMPTS", "Too many incorrect attempts. Request a new code."),
      "POST /auth/resend-verification": accepted({ message: "on its way" }),
    });
    const user = userEvent.setup();
    renderAuthApp({ route: "/create-account" });

    await user.type(screen.getByLabelText(/work email/i), EMAIL);
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await screen.findByRole("heading", { name: /check your email/i });
    await user.type(screen.getByLabelText(/verification code/i), "000000");
    await user.click(screen.getByRole("button", { name: /verify and continue/i }));

    await screen.findByRole("alert");
    expect(screen.getByLabelText(/verification code/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /verify and continue/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /send a new code/i }));
    expect(await screen.findByText(/a new code is on its way/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/verification code/i)).toBeEnabled());
  });

  it("a resend cooldown is shown as a countdown rather than a repeated failure", async () => {
    installFakeApi({
      "POST /auth/register": created({ message: "created", maskedEmail: "op***@example.com" }),
      "POST /auth/resend-verification": fails(429, "OTP_COOLDOWN", "Please wait 41 seconds before requesting another code.", {
        retryAfterSeconds: 41,
      }),
    });
    const user = userEvent.setup();
    renderAuthApp({ route: "/create-account" });

    await user.type(screen.getByLabelText(/work email/i), EMAIL);
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await screen.findByRole("heading", { name: /check your email/i });
    await user.click(screen.getByRole("button", { name: /send a new code/i }));

    expect(await screen.findByRole("button", { name: /send a new code \(41s\)/i })).toBeDisabled();
  });

  it("the verification screen cannot be reached without an address to verify", async () => {
    installFakeApi({});
    renderAuthApp({ route: "/verify-email" });
    expect(await screen.findByRole("heading", { name: /set up your pricing desk/i })).toBeInTheDocument();
  });
});

describe("UI-AUTH — password reset", () => {
  it("UI-AUTH-08: a known and an unknown address are treated identically", async () => {
    const api = installFakeApi({
      "POST /auth/forgot-password": accepted({
        message: "If an account exists for this email, we have sent a verification code.",
        maskedEmail: "no***@example.com",
      }),
    });
    const user = userEvent.setup();
    renderAuthApp({ route: "/forgot-password" });

    await user.type(screen.getByLabelText(/^email$/i), "nobody-here@example.com");
    await user.click(screen.getByRole("button", { name: /send reset code/i }));

    // Same destination, same wording, no hint either way.
    expect(await screen.findByRole("heading", { name: /choose a new password/i })).toBeInTheDocument();
    expect(screen.queryByText(/no account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/does not exist/i)).not.toBeInTheDocument();
    expect(api.last("POST", "/auth/forgot-password").body).toEqual({ email: "nobody-here@example.com" });
  });

  it("UI-AUTH-09: a completed reset exchanges the code for a token, then ends SIGNED OUT", async () => {
    const api = installFakeApi({
      "POST /auth/forgot-password": accepted({ message: "sent", maskedEmail: "op***@example.com" }),
      "POST /auth/verify-reset-otp": ok({ resetToken: "a-reset-token-long-enough", expiresAt: "2026-09-27T10:30:00Z" }),
      "POST /auth/reset-password": ok({ message: "Password updated. Sign in with your new password.", sessionsRevoked: 2 }),
    });
    const user = userEvent.setup();
    renderAuthApp({ route: "/forgot-password" });

    await user.type(screen.getByLabelText(/^email$/i), EMAIL);
    await user.click(screen.getByRole("button", { name: /send reset code/i }));

    await screen.findByRole("heading", { name: /choose a new password/i });
    await user.type(screen.getByLabelText(/verification code/i), "654321");
    await user.type(screen.getByLabelText(/new password/i), "a-brand-new-password");
    await user.click(screen.getByRole("button", { name: /update password/i }));

    // Back at the door, told why, and holding no session.
    expect(await screen.findByRole("heading", { name: /the desk, where you left it/i })).toBeInTheDocument();
    expect(screen.getByText(/password updated/i)).toBeInTheDocument();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();

    expect(api.last("POST", "/auth/verify-reset-otp").body).toEqual({ email: EMAIL, code: "654321" });
    expect(api.last("POST", "/auth/reset-password").body).toEqual({
      email: EMAIL,
      resetToken: "a-reset-token-long-enough",
      password: "a-brand-new-password",
    });
  });

  it("a spent reset token is reported and the form stops accepting the dead code", async () => {
    installFakeApi({
      "POST /auth/forgot-password": accepted({ message: "sent", maskedEmail: "op***@example.com" }),
      "POST /auth/verify-reset-otp": ok({ resetToken: "a-reset-token-long-enough", expiresAt: "2026-09-27T10:30:00Z" }),
      "POST /auth/reset-password": fails(400, "RESET_TOKEN_INVALID", "This password reset link has expired. Start again."),
    });
    const user = userEvent.setup();
    renderAuthApp({ route: "/forgot-password" });

    await user.type(screen.getByLabelText(/^email$/i), EMAIL);
    await user.click(screen.getByRole("button", { name: /send reset code/i }));

    await screen.findByRole("heading", { name: /choose a new password/i });
    await user.type(screen.getByLabelText(/verification code/i), "654321");
    await user.type(screen.getByLabelText(/new password/i), "a-brand-new-password");
    await user.click(screen.getByRole("button", { name: /update password/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/expired/i);
    expect(screen.getByRole("button", { name: /update password/i })).toBeDisabled();
  });

  it("the reset screen cannot be reached without an address", async () => {
    installFakeApi({});
    renderAuthApp({ route: "/reset-password" });
    expect(await screen.findByRole("heading", { name: /let's get you back in/i })).toBeInTheDocument();
  });
});

describe("UI-AUTH — sessions", () => {
  it("UI-AUTH-10: a stored token is checked against the server before it is trusted", async () => {
    window.localStorage.setItem(TOKEN_KEY, A_SESSION.token);
    const api = installFakeApi({ "GET /auth/me": ok({ user: A_USER }) });

    renderAuthApp({ route: "/" });

    expect(await screen.findByTestId("desk")).toBeInTheDocument();
    const me = api.last("GET", "/auth/me");
    expect(me).toBeDefined();
    expect(me.authorization).toBe(`Bearer ${A_SESSION.token}`);
  });

  it("UI-AUTH-11: a token the server rejects is discarded, and the visitor lands at the door", async () => {
    window.localStorage.setItem(TOKEN_KEY, "a-revoked-token");
    installFakeApi({ "GET /auth/me": fails(401, "UNAUTHENTICATED", "Sign in to continue.") });

    renderAuthApp({ route: "/" });

    expect(await screen.findByRole("heading", { name: /the desk, where you left it/i })).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull());
    expect(screen.queryByTestId("desk")).not.toBeInTheDocument();
  });

  it("a backend that cannot be reached leaves the application signed out, not half signed in", async () => {
    window.localStorage.setItem(TOKEN_KEY, A_SESSION.token);
    // No routes at all: every call 404s, which the client reports as an error.
    installFakeApi({});

    renderAuthApp({ route: "/" });

    expect(await screen.findByRole("heading", { name: /the desk, where you left it/i })).toBeInTheDocument();
    expect(screen.queryByTestId("desk")).not.toBeInTheDocument();
  });

  it("UI-AUTH-12: signing out revokes the session server-side and clears the browser", async () => {
    window.localStorage.setItem(TOKEN_KEY, A_SESSION.token);
    const api = installFakeApi({
      "GET /auth/me": ok({ user: A_USER }),
      "POST /auth/logout": noContent(),
    });
    const user = userEvent.setup();
    renderAuthApp({ route: "/" });

    await screen.findByTestId("desk");

    // Driven through the real account menu, the same control the masthead
    // renders — not through a handle invented for the test.
    await user.click(screen.getByRole("button", { name: /account — operator@example\.com/i }));
    expect(screen.getByText(A_USER.email)).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));

    await waitFor(() => expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull());
    const logout = api.last("POST", "/auth/logout");
    expect(logout).toBeDefined();
    expect(logout.authorization).toBe(`Bearer ${A_SESSION.token}`);

    // And the desk is gone, without a reload.
    expect(await screen.findByRole("heading", { name: /the desk, where you left it/i })).toBeInTheDocument();
  });

  it("UI-AUTH-13: a success response with no token does not become a signed-in state", async () => {
    // The shape a careless backend change could produce. It must be refused
    // outright: a user object with no token cannot authorise a single
    // subsequent request, so treating it as a session is exactly the fake
    // login state this design exists to rule out.
    installFakeApi({ "POST /auth/login": ok({ user: A_USER }) });
    const user = userEvent.setup();
    renderAuthApp({ route: "/sign-in" });

    await user.type(screen.getByLabelText(/^email$/i), EMAIL);
    await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/did not return a usable session/i);
    expect(screen.queryByTestId("desk")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});
