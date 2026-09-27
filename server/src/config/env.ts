import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

/**
 * Environment is parsed once, validated, and then read from here. Nothing in
 * the server reads `process.env` directly, so a missing or malformed variable
 * fails at startup with a readable message rather than surfacing later as an
 * undefined connection string.
 *
 * No value here has a production-safe default. `DATABASE_URL` in particular is
 * required whenever the driver is `postgres`, because a default would silently
 * connect somewhere nobody intended.
 */
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    /**
     * `postgres` talks to a real server over the wire. `pglite` runs
     * PostgreSQL compiled to WebAssembly in-process, against a directory on
     * disk — the same engine and the same SQL, with no service to install.
     * That is what makes the migrations runnable in CI and in environments
     * without Docker, and it is a development and test driver only.
     */
    DB_DRIVER: z.enum(["postgres", "pglite"]).default("pglite"),
    DATABASE_URL: z.string().url().optional(),
    PGLITE_DATA_DIR: z.string().default("./.pglite"),

    PORT: z.coerce.number().int().positive().default(4000),
    HOST: z.string().default("0.0.0.0"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

    /** Where the export step writes, and the seed reads. */
    SEED_DATA_DIR: z.string().default("./seed-data"),
    SEED_BATCH_SIZE: z.coerce.number().int().positive().default(2000),
  })
  .superRefine((v, ctx) => {
    if (v.DB_DRIVER === "postgres" && !v.DATABASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "DATABASE_URL is required when DB_DRIVER=postgres.",
      });
    }
    if (v.NODE_ENV === "production" && v.DB_DRIVER !== "postgres") {
      ctx.addIssue({
        code: "custom",
        path: ["DB_DRIVER"],
        message: "PGlite is a development and test driver; production must use DB_DRIVER=postgres.",
      });
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n${lines.join("\n")}\n\nSee server/.env.example.`);
}

export const env = parsed.data;
export type Env = typeof env;
