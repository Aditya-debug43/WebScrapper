import { apiRequest } from "./http";

/**
 * The authentication API, one function per endpoint.
 *
 * This layer is a transport only — it holds no policy. Whether a password is
 * strong enough, whether an address is verified, how long a code lives and
 * how many attempts it survives are all decided by the server and are not
 * duplicated here. A screen that wants to know something asks and reads the
 * answer.
 *
 * THE CREDENTIAL IS EMAIL + PASSWORD. A one-time code is never a way to log
 * in: it proves an address at signup, and it authorises replacing a
 * forgotten password. There is no `request-otp` and no passwordless path.
 */

/** Create an account. Does NOT sign anybody in — the address is unproven. */
export function register(email, password) {
  return apiRequest("/auth/register", { method: "POST", body: { email, password } });
}

/** A fresh verification code for an account that has not verified yet. */
export function resendVerification(email) {
  return apiRequest("/auth/resend-verification", { method: "POST", body: { email } });
}

/** Confirm the address. Returns `{ token, expiresAt, user }` — signs them in. */
export function verifyEmail(email, code) {
  return apiRequest("/auth/verify-email", { method: "POST", body: { email, code } });
}

/** Email + password. Returns `{ token, expiresAt, user }`. */
export function login(email, password) {
  return apiRequest("/auth/login", { method: "POST", body: { email, password } });
}

/**
 * Begin a password reset. Always resolves the same way, whether or not an
 * account exists — the caller cannot learn which, and must not try to.
 */
export function forgotPassword(email) {
  return apiRequest("/auth/forgot-password", { method: "POST", body: { email } });
}

/** Exchange a reset code for a short-lived `{ resetToken, expiresAt }`. */
export function verifyResetOtp(email, code) {
  return apiRequest("/auth/verify-reset-otp", { method: "POST", body: { email, code } });
}

/** Spend the reset token on a new password. Revokes every existing session. */
export function resetPassword(email, resetToken, password) {
  return apiRequest("/auth/reset-password", { method: "POST", body: { email, resetToken, password } });
}

/** The signed-in user. The response never contains a password hash. */
export function fetchCurrentUser(token) {
  return apiRequest("/auth/me", { token });
}

/** Revoke this session server-side. Idempotent. */
export function logout(token) {
  return apiRequest("/auth/logout", { method: "POST", token });
}
