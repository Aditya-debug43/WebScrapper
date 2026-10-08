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
     * How long the token handed out by verify-reset-otp stays usable. Short:
     * it exists only to carry proof across the two steps of one reset, and a
     * user who has just typed a code is already at the keyboard.
     */
    RESET_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),

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
    EMAIL_ADAPTER: z.enum(["memory", "console", "http", "smtp"]).default("console"),
    EMAIL_FROM: z.string().default("Mulya <no-reply@mulya.local>"),
    /** Generic transactional-email HTTP endpoint; provider-agnostic on purpose. */
    EMAIL_API_URL: z.string().url().optional(),
    EMAIL_API_KEY: z.string().optional(),

    /**
     * SMTP. Required only when EMAIL_ADAPTER=smtp, checked by the refinement
     * below so the failure names the exact variable that is missing.
     *
     * SMTP_PASS must be a provider app password — for Gmail, a Google App
     * Password issued under 2-Step Verification. A normal account password
     * will simply be refused by Gmail, and putting one here would expose the
     * whole account rather than one revocable credential.
     */
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().positive().max(65535).optional(),
    /** true → implicit TLS (465). false → STARTTLS upgrade (587). */
    SMTP_SECURE: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),

    /* -------------------------------------------------------- rate limits */
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

    /* ---------------------------------------------------------- migration */
    SEED_DATA_DIR: z.string().default("./seed-data"),
    SEED_BATCH_SIZE: z.coerce.number().int().positive().default(2000),

    /* -------------------------------------------------- market data (ingestion) */
    /**
     * Where live offer data comes from. Same shape as EMAIL_ADAPTER above:
     * one variable, one factory, and callers that hold the port rather than
     * the implementation.
     *
     *   serpapi  live Google Shopping results via SerpApi
     *   fixture  recorded responses from disk — tests, and development
     *            without spending metered requests
     *   none     ingestion is switched off; the endpoint refuses rather
     *            than pretending. The default, because a deployment that
     *            has not been given a key should not look like one that
     *            found no offers.
     */
    MARKET_DATA_PROVIDER: z.enum(["serpapi", "fixture", "none"]).default("none"),

    /**
     * Server-side only, and never sent to a client. The frontend calls our
     * ingestion route; our route calls the provider. The key exists on this
     * process and in the deployment's secret store, nowhere else.
     */
    SERPAPI_KEY: z.string().min(1).optional(),

    /**
     * 30s, raised from 15s when the competitive capture went live.
     *
     * 15s was chosen when there was one endpoint to call and it was fast.
     * There are now two, the product endpoint is the slower of them, and a
     * capture makes one search call plus one per catalogue id. Measured from
     * the production host, a cold search alone took 8.6s — so the old budget
     * left almost nothing, and the first real capture there failed on it.
     *
     * The cost of being generous is bounded: a provider that has genuinely
     * stopped answering costs one wait per catalogue id, once, and the
     * capture is recorded as failed either way. The cost of being tight is a
     * product that silently never gets a market.
     */
    MARKET_DATA_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    MARKET_DATA_COUNTRY: z.string().length(2).default("in"),
    MARKET_DATA_CURRENCY: z.string().length(3).default("INR"),
    MARKET_DATA_FIXTURE_DIR: z.string().default("./fixtures/market-data"),

    /**
     * How long a capture stays good enough to reuse.
     *
     * Every provider request costs money on a metered plan, and prices do not
     * move minute to minute. A request for a query captured inside this window
     * returns the stored observations instead of fetching again; the caller
     * can override with an explicit refresh. Six hours is roughly the interval
     * at which marketplace repricing becomes visible, and it keeps a page
     * refresh from being an expense.
     */
    MARKET_DATA_TTL_SECONDS: z.coerce.number().int().positive().default(21_600),

    /**
     * How fresh a SEARCH insists on being, in seconds.
     *
     * Shorter than the general window because typing a query is an explicit
     * request for the current market — but not zero, or a user pressing enter
     * twice buys two calls for one question. Fifteen minutes is long enough
     * to absorb retries and impatience, short enough that a search still
     * means "now".
     */
    MARKET_DATA_SEARCH_TTL_SECONDS: z.coerce.number().int().positive().default(900),

    /**
     * The floor under a deliberate "refresh prices" press.
     *
     * The button is not a licence to spend: inside this window it returns
     * what is already stored and says so. Separate from the search window
     * because the two are different promises to the user.
     */
    MARKET_DATA_REFRESH_FLOOR_SECONDS: z.coerce.number().int().positive().default(1_800),

    /**
     * How long full response bodies are kept before pruning to hash-only.
     *
     * Bodies are what make a capture re-readable — a parser fixed later can
     * be re-run over what was actually received, and a tracked result can be
     * resolved server-side. They are also the bulk of the storage: roughly
     * 150 KB per capture. Ninety days keeps every body a re-parse would
     * realistically want while bounding growth.
     */
    MARKET_DATA_BODY_RETENTION_DAYS: z.coerce.number().int().positive().default(90),

    /**
     * Upper bound on products captured in one scheduled sweep.
     *
     * A ceiling on spend per run: if demand grows faster than the budget,
     * the sweep takes the most-followed products first and the rest wait for
     * the next hour rather than the bill arriving as a surprise.
     */
    CAPTURE_SWEEP_MAX_PRODUCTS: z.coerce.number().int().positive().default(50),

    /* ----------------------------------------------------------------- AI
     *
     * Which provider reasons over the pricing evidence. `none` is the
     * default and is a complete, working configuration: the deterministic
     * engine still produces a recommendation, labelled as deterministic.
     *
     * The provider is named ONLY here and in the adapter factory. Switching
     * is a configuration change, not a rewrite — which is the requirement,
     * because the final provider has not been chosen.
     */
    AI_PROVIDER: z.enum(["none", "gemini", "openai", "anthropic"]).default("none"),
    AI_MODEL: z.string().min(1).default("gemini-2.0-flash"),
    /** Server-side only. Never reaches the browser and is never logged. */
    AI_API_KEY: z.string().min(1).optional(),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

    /**
     * Upper bound on results requested per query, so a caller cannot turn one
     * API call into a hundred by asking for more.
     */
    MARKET_DATA_MAX_RESULTS: z.coerce.number().int().positive().max(100).default(40),
  })
  .superRefine((v, ctx) => {
    const fail = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });

    if (v.DB_DRIVER === "postgres" && !v.DATABASE_URL) {
      fail("DATABASE_URL", "DATABASE_URL is required when DB_DRIVER=postgres.");
    }
    if (v.EMAIL_ADAPTER === "http" && (!v.EMAIL_API_URL || !v.EMAIL_API_KEY)) {
      fail("EMAIL_API_URL", "EMAIL_API_URL and EMAIL_API_KEY are required when EMAIL_ADAPTER=http.");
    }

    if (v.MARKET_DATA_PROVIDER === "serpapi" && !v.SERPAPI_KEY) {
      fail("SERPAPI_KEY", "SERPAPI_KEY is required when MARKET_DATA_PROVIDER=serpapi.");
    }

    if (v.EMAIL_ADAPTER === "smtp") {
      // Named one at a time: "SMTP configuration is incomplete" sends people
      // reading their own .env line by line, which is the slow way to find
      // the one variable they forgot.
      if (!v.SMTP_HOST) fail("SMTP_HOST", "SMTP_HOST is required when EMAIL_ADAPTER=smtp (Gmail: smtp.gmail.com).");
      if (!v.SMTP_PORT) fail("SMTP_PORT", "SMTP_PORT is required when EMAIL_ADAPTER=smtp (465 for TLS, 587 for STARTTLS).");
      if (!v.SMTP_USER) fail("SMTP_USER", "SMTP_USER is required when EMAIL_ADAPTER=smtp (the full email address to send from).");
      if (!v.SMTP_PASS) {
        fail(
          "SMTP_PASS",
          "SMTP_PASS is required when EMAIL_ADAPTER=smtp. For Gmail this must be a Google App Password, not the account password."
        );
      }

      /**
       * Gmail will not send as an address the authenticated account does not
       * own — it silently rewrites the header, so the mail arrives looking
       * wrong and nothing reports an error. Better to refuse at startup.
       */
      if (v.SMTP_USER && v.EMAIL_FROM) {
        const address = v.EMAIL_FROM.match(/<([^>]+)>/)?.[1] ?? v.EMAIL_FROM;
        if (address.trim().toLowerCase() !== v.SMTP_USER.trim().toLowerCase()) {
          fail(
            "EMAIL_FROM",
            `EMAIL_FROM must send as the authenticated SMTP account. Use "${v.SMTP_USER}" or "Some Name <${v.SMTP_USER}>".`
          );
        }
      }

      /**
       * The two settings contradict each other: SMTP exists to deliver the
       * code to an inbox, and this would hand it to any caller instead. With
       * both on, nobody would notice delivery was broken.
       */
      if (v.EXPOSE_OTP_IN_RESPONSE) {
        fail(
          "EXPOSE_OTP_IN_RESPONSE",
          "Set EXPOSE_OTP_IN_RESPONSE=false when EMAIL_ADAPTER=smtp — a real send must not also return the code."
        );
      }
    }

    if (v.NODE_ENV === "production") {
      if (v.DB_DRIVER !== "postgres") {
        fail("DB_DRIVER", "PGlite is a development and test driver; production must use DB_DRIVER=postgres.");
      }
      if (v.EXPOSE_OTP_IN_RESPONSE) {
        fail("EXPOSE_OTP_IN_RESPONSE", "Refusing to start: this would return one-time codes to any caller.");
      }
      // `memory` and `console` do not deliver anything. `http` and `smtp`
      // both do, and which one is right is an operational choice rather than
      // a correctness one — the auth service cannot tell them apart.
      if (v.EMAIL_ADAPTER !== "http" && v.EMAIL_ADAPTER !== "smtp") {
        fail("EMAIL_ADAPTER", "Production must send real email; set EMAIL_ADAPTER=http or EMAIL_ADAPTER=smtp.");
      }
      if (v.CORS_ORIGINS.includes("*")) {
        fail("CORS_ORIGINS", "A wildcard origin cannot be used with credentialed requests in production.");
      }
      if (v.CORS_ORIGINS.some((o) => o.startsWith("http://") && !o.startsWith("http://localhost"))) {
        fail("CORS_ORIGINS", "Production origins must be https.");
      }
      /**
       * Recorded responses are real data, but they are data from whenever
       * they were recorded. Replaying them in production would present
       * month-old prices as the current market — the one failure mode this
       * pipeline exists to avoid. `none` is allowed: it refuses honestly.
       */
      if (v.MARKET_DATA_PROVIDER === "fixture") {
        fail("MARKET_DATA_PROVIDER", "Recorded fixtures must not serve production; use serpapi, or none to disable ingestion.");
      }
    }
  });

/**
 * Exported so the configuration rules can be tested directly, against
 * explicit inputs, without a test having to mutate `process.env` and reimport
 * this module. The rules are the thing under test; the process environment is
 * just one caller of them.
 */
export const envSchema = schema;

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n${lines.join("\n")}\n\nSee server/.env.example.`);
}

export const env = parsed.data;
export type Env = typeof env;
