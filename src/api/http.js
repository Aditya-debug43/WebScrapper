/**
 * The one place the frontend talks to the backend.
 *
 * The base URL is read from the environment and is never hard-coded: local
 * development, a preview deployment and production each point somewhere
 * different, and burying any of them in the bundle makes the other two a
 * code change. `VITE_API_BASE_URL` is documented in `.env.example`.
 *
 * The fallback is a relative `/api/v1`, which is correct when the API is
 * served from the same origin (a reverse proxy, or Vite's dev proxy). It is
 * deliberately relative — a hard-coded `http://localhost:4000` would ship in
 * a production build and fail silently for everybody but the author.
 */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(/\/+$/, "");

/**
 * A failure the API described in its own error envelope.
 *
 * `code` is the stable machine-readable value screens branch on
 * (`EMAIL_NOT_VERIFIED`, `OTP_COOLDOWN`, …); `message` is the server's
 * human wording, which is what we show unless a screen has something more
 * useful to say. Screens never parse `message`.
 */
export class ApiError extends Error {
  constructor(code, message, { status = 0, details } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** Field-level validation detail, as `{ fieldName: "message" }`. */
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(
      this.details.filter((d) => d && d.field).map((d) => [d.field, d.message ?? "is invalid"])
    );
  }
}

/**
 * One request.
 *
 * Everything that can go wrong arrives as an ApiError, including a dead
 * network and a response that is not JSON — so a caller never has to
 * distinguish "the server said no" from "fetch threw", and a screen can
 * always render `error.message`.
 */
export async function apiRequest(path, { method = "GET", body, token, signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      signal,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (cause) {
    if (cause?.name === "AbortError") throw cause;
    throw new ApiError("NETWORK_ERROR", "Could not reach the server. Check your connection and try again.", {
      status: 0,
    });
  }

  if (response.status === 204) return null;

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const envelope = payload?.error;
    throw new ApiError(
      envelope?.code ?? "UNEXPECTED_ERROR",
      envelope?.message ?? `The server returned ${response.status}.`,
      { status: response.status, details: envelope?.details }
    );
  }

  return payload;
}
