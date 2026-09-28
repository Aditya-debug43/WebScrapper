/**
 * MUST be the first import in every test file.
 *
 * `config/env.ts` validates and freezes configuration at import time, so the
 * environment has to be set before anything pulls it in. ESM evaluates
 * imported modules in source order, which makes importing this first both
 * sufficient and the only thing that works.
 */
process.env["NODE_ENV"] = "test";
process.env["DB_DRIVER"] = "pglite";
process.env["EMAIL_ADAPTER"] = "memory";
// Pinned, because dotenv fills in anything the test does not set — and a
// developer who points their own .env at a real mailbox should not thereby
// change what the test suite asserts.
process.env["EMAIL_FROM"] = "Mulya <no-reply@mulya.test>";
process.env["LOG_LEVEL"] = "silent";

// A throwaway pepper. Real deployments supply their own; the schema enforces
// a 32-character minimum and there is no default, so this cannot leak into a
// real environment by accident.
process.env["AUTH_SECRET"] = "test-only-secret-value-at-least-32-chars-long";

// Deterministic, tight limits so the tests can actually reach them rather
// than needing to send a hundred requests to prove a limiter works.
process.env["OTP_LENGTH"] = "6";
process.env["OTP_TTL_SECONDS"] = "600";
process.env["OTP_MAX_ATTEMPTS"] = "3";
process.env["OTP_RESEND_COOLDOWN_SECONDS"] = "60";
process.env["OTP_MAX_PER_EMAIL_PER_HOUR"] = "5";
process.env["AUTH_RATE_LIMIT_MAX"] = "8";
process.env["AUTH_RATE_LIMIT_WINDOW_SECONDS"] = "60";
process.env["RATE_LIMIT_MAX"] = "1000";
process.env["SESSION_TTL_DAYS"] = "30";

// The OTP is returned in the response so tests can complete the flow without
// an inbox. The environment schema refuses to start production this way.
process.env["EXPOSE_OTP_IN_RESPONSE"] = "true";

export {};
