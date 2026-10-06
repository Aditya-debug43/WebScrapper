#!/usr/bin/env node
/**
 * END-TO-END: the real frontend against the real backend.
 *
 * Nothing is mocked. This script
 *
 *   1. creates a throwaway PostgreSQL (PGlite) in a temp directory,
 *   2. applies the real migrations to it,
 *   3. starts the real API server on a free port,
 *   4. runs the flow test, which drives the application's own React
 *      components and its own fetch client over real HTTP,
 *   5. tears everything down.
 *
 * The one-time codes come out of the server's own console email adapter —
 * the same place a developer reads them — so even the code the test types
 * is one the server really issued.
 *
 *   npm run test:e2e
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import process from "node:process";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SERVER = join(ROOT, "server");
const PORT = Number(process.env.E2E_PORT ?? 4177);
const BASE = `http://127.0.0.1:${PORT}`;

const isWindows = process.platform === "win32";
const npx = isWindows ? "npx.cmd" : "npx";

let dataDir;
let logPath;
let api;

async function main() {
  /**
   * Refuse to run against somebody else's server.
   *
   * A leftover API from an earlier run answers /health perfectly well, so
   * without this the suite waits, finds it "up", and tests a stale build
   * against a database this run never migrated. That failure looks like a
   * product bug and is not one — it cost a debugging cycle, so it is a
   * pre-flight check now.
   */
  if (await portAnswers()) {
    throw new Error(
      `Something is already listening on ${BASE}.\n` +
        `That is almost certainly a leftover API from an earlier run — stop it and try again.`
    );
  }

  dataDir = await mkdtemp(join(tmpdir(), "mulya-e2e-"));
  const logDir = join(ROOT, "tests", "e2e", ".run");
  await mkdir(logDir, { recursive: true });
  logPath = join(logDir, "api.log");

  const env = {
    ...process.env,
    NODE_ENV: "development",
    DB_DRIVER: "pglite",
    PGLITE_DATA_DIR: dataDir,
    PORT: String(PORT),
    HOST: "127.0.0.1",
    LOG_LEVEL: "info",
    CORS_ORIGINS: "http://localhost:5173,http://localhost:4173",
    // Generated per run, never read from a file. Rotating it would
    // invalidate every code and session, which is exactly what we want
    // between runs.
    AUTH_SECRET: randomBytes(48).toString("base64url"),
    OTP_LENGTH: "6",
    OTP_TTL_SECONDS: "600",
    OTP_MAX_ATTEMPTS: "5",
    OTP_RESEND_COOLDOWN_SECONDS: "1",
    OTP_MAX_PER_EMAIL_PER_HOUR: "20",
    SESSION_TTL_DAYS: "30",
    /**
     * The fixture provider, so live discovery is exercised end to end
     * without a network call or an API key. It replays recorded SerpApi
     * responses through the PRODUCTION normaliser, so the parsing, matching
     * and persistence under test are the real ones.
     */
    MARKET_DATA_PROVIDER: "fixture",
    MARKET_DATA_FIXTURE_DIR: "./fixtures/market-data",
    RESET_TOKEN_TTL_SECONDS: "900",
    // The console adapter prints the message body when this is on, which is
    // how the test reads a genuine code. The environment schema refuses to
    // start production with it enabled.
    EXPOSE_OTP_IN_RESPONSE: "true",
    EMAIL_ADAPTER: "console",
    EMAIL_FROM: "Mulya <no-reply@localhost>",
    // High enough that a multi-step flow from one address is not mistaken
    // for an attack. The limiter itself is covered by the API test suite.
    RATE_LIMIT_MAX: "2000",
    RATE_LIMIT_WINDOW_SECONDS: "60",
    AUTH_RATE_LIMIT_MAX: "200",
    AUTH_RATE_LIMIT_WINDOW_SECONDS: "60",
  };

  step("applying migrations to a throwaway database");
  await run(npx, ["tsx", "src/scripts/migrate.ts"], { cwd: SERVER, env });

  /**
   * The catalogue, because since Phase 7 the recommendation screen reads it
   * over HTTP.
   *
   * Authentication needs no data and this used to run against empty tables.
   * A recommendation needs a product, its listings, its offers and their
   * observations, and stubbing any of that would leave the one flow this
   * phase changed untested end to end. It costs about a minute, which is the
   * price of the test being real.
   */
  step("seeding the catalogue (the recommendation flow needs real products)");
  await run(npx, ["tsx", "src/scripts/seed.ts"], { cwd: SERVER, env });

  step(`starting the API on ${BASE}`);
  const log = createWriteStream(logPath, { flags: "w" });
  api = spawn(npx, ["tsx", "src/server.ts"], {
    cwd: SERVER,
    env,
    shell: isWindows,
    // On POSIX this makes the child its own process group, so teardown can
    // signal the whole tree. Windows uses taskkill /T instead.
    detached: !isWindows,
  });
  api.stdout.pipe(log);
  api.stderr.pipe(log);
  api.on("exit", (code) => {
    if (code !== 0 && code !== null) console.error(`API exited with ${code}`);
  });

  await waitForHealth();
  step("API is up — running the flow against it");

  const code = await run(
    npx,
    ["vitest", "run", "--config", "tests/e2e/vitest.config.js"],
    {
      cwd: ROOT,
      env: { ...process.env, E2E_API_BASE: `${BASE}/api/v1`, E2E_API_LOG: logPath },
      inherit: true,
      allowFailure: true,
    }
  );

  return code;
}

/** True when anything at all responds on the API port. */
async function portAnswers() {
  try {
    await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(attempts = 90) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await sleep(500);
  }
  const tail = await readFile(logPath, "utf8").catch(() => "");
  throw new Error(`The API never became healthy.\n\n--- api.log ---\n${tail.slice(-3000)}`);
}

function run(command, args, { cwd, env, inherit = false, allowFailure = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: isWindows,
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (d) => (output += d));
    child.stderr?.on("data", (d) => (output += d));
    child.on("exit", (code) => {
      if (code === 0 || allowFailure) return resolvePromise(code ?? 1);
      reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${output.slice(-3000)}`));
    });
    child.on("error", reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (message) => console.log(`\n▸ ${message}`);

/**
 * Kill the server AND its children.
 *
 * `npx tsx src/server.ts` under a shell is three processes deep, and
 * signalling only the one we spawned leaves the actual listener alive —
 * which is what poisoned a previous run. `taskkill /T` and a POSIX process
 * group each take the whole tree.
 */
async function shutdown() {
  if (api?.pid && !api.killed) {
    if (isWindows) {
      await run("taskkill", ["/PID", String(api.pid), "/T", "/F"], { allowFailure: true }).catch(() => {});
    } else {
      try {
        process.kill(-api.pid, "SIGTERM");
      } catch {
        api.kill("SIGTERM");
      }
    }
    // Wait for the port to actually free, so a re-run does not race it.
    for (let i = 0; i < 20 && (await portAnswers()); i++) await sleep(250);
  }
  if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => {});
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  console.error(`\n${error.message}`);
  exitCode = 1;
} finally {
  await shutdown();
}
process.exit(exitCode);
