import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

/**
 * Environment is parsed once, validated, and then read from here. Nothing in
 * the server reads `process.env` directly, so a missing or malformed variable
 * fails at startup with a readable message rather than surfacing later as an
 * undefined connection string or, worse, a disabled security control.
 *
 * No secret has a default. Several settings are additionally *forbidden* in
 * production — see the refinements at the bottom, which are the difference
 * between "we have a test mode" and "we shipped test mode".
 */
const csv = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    /* ----------------------------------------------------------- database */
    /**
     * `postgres` talks to a real server. `pglite` runs PostgreSQL compiled to
     * WebAssembly in-process — the same engine and the same SQL, with no
     * service to install. Development and test only.
     */
    DB_DRIVER: z.enum(["postgres", "pglite"]).default("pglite"),
    DATABASE_URL: z.string().url().optional(),
    PGLITE_DATA_DIR: z.string().default("./.pglite"),

    /* ------------------------------------------------------------- server */
    PORT: z.coerce.number().int().positive().default(4000),
    HOST: z.string().default("0.0.0.0"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

    /**
     * Allowed browser origins. The Vercel frontend and the Railway API are
     * different origins, so this is load-bearing rather than ceremonial.
     * Wildcards are rejected outright in production below.
     */
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:5173,http://localhost:4173")
      .transform(csv),

    /* --------------------------------------------------------------- auth */
    /**
     * Server-side pepper for OTP and session-token hashing. A six-digit code
     * has only a million possibilities, so a bare digest of it is brute-forced
     * in seconds if the database leaks; an HMAC under a secret the database
     * does not contain is not. Must be long enough to be worth having.
     */
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),

    OTP_LENGTH: z.coerce.number().int().min(4).max(10).default(6),
    OTP_TTL_SECONDS: z.coerce.number().int().positive().default(600),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(60),
    OTP_MAX_PER_EMAIL_PER_HOUR: z.coerce.number().int().positive().default(5),

    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

    /**
     * Returns the OTP in the API response. Exists so automated tests can drive
     * the flow without an inbox, and it is refused in production by the
     * refinement below — a test convenience that can be switched on in
     * production is not a test convenience, it is a backdoor.
     */
    EXPOSE_OTP_IN_RESPONSE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),

    /* -------------------------------------------------------------- email */
    EMAIL_ADAPTER: z.enum(["memory", "console", "http"]).default("console"),
    EMAIL_FROM: z.string().default("Mulya <no-reply@mulya.local>"),
    /** Generic transactional-email HTTP endpoint; provider-agnostic on purpose. */
    EMAIL_API_URL: z.string().url().optional(),
    EMAIL_API_KEY: z.string().optional(),

    /* -------------------------------------------------------- rate limits */
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

    /* ---------------------------------------------------------- migration */
    SEED_DATA_DIR: z.string().default("./seed-data"),
    SEED_BATCH_SIZE: z.coerce.number().int().positive().default(2000),
  })
  .superRefine((v, ctx) => {
    const fail = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });

    if (v.DB_DRIVER === "postgres" && !v.DATABASE_URL) {
      fail("DATABASE_URL", "DATABASE_URL is required when DB_DRIVER=postgres.");
    }
    if (v.EMAIL_ADAPTER === "http" && (!v.EMAIL_API_URL || !v.EMAIL_API_KEY)) {
      fail("EMAIL_API_URL", "EMAIL_API_URL and EMAIL_API_KEY are required when EMAIL_ADAPTER=http.");
    }

    if (v.NODE_ENV === "production") {
      if (v.DB_DRIVER !== "postgres") {
        fail("DB_DRIVER", "PGlite is a development and test driver; production must use DB_DRIVER=postgres.");
      }
      if (v.EXPOSE_OTP_IN_RESPONSE) {
        fail("EXPOSE_OTP_IN_RESPONSE", "Refusing to start: this would return one-time codes to any caller.");
      }
      if (v.EMAIL_ADAPTER !== "http") {
        fail("EMAIL_ADAPTER", "Production must send real email; set EMAIL_ADAPTER=http.");
      }
      if (v.CORS_ORIGINS.includes("*")) {
        fail("CORS_ORIGINS", "A wildcard origin cannot be used with credentialed requests in production.");
      }
      if (v.CORS_ORIGINS.some((o) => o.startsWith("http://") && !o.startsWith("http://localhost"))) {
        fail("CORS_ORIGINS", "Production origins must be https.");
      }
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n${lines.join("\n")}\n\nSee server/.env.example.`);
}

export const env = parsed.data;
export type Env = typeof env;
