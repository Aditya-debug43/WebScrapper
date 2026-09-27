import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarantees about the SOURCE, not about a rendered screen.
 *
 * The interface tests prove the application behaves correctly against the
 * responses it is given. These prove the things a behavioural test cannot
 * reach: that there is no second code path which fabricates a session, no
 * credential compiled into the bundle, and no backend URL that only works
 * on the author's machine.
 */

// Resolved from the project root rather than from `import.meta.url`: under
// the jsdom environment that URL is not a file: URL.
const SRC = resolve(process.cwd(), "src") + "/";

async function sourceFiles(dir = SRC, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await sourceFiles(full, acc);
    else if (/\.(js|jsx)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const read = async (rel) => readFile(join(SRC, rel), "utf8");

/** Repo-relative, forward-slashed, so assertions read the same on any OS. */
const label = (file) => file.slice(SRC.length).replace(/\\/g, "/");

/**
 * Source with its prose removed.
 *
 * These checks are about what the code DOES, and several of the things they
 * look for — `localStorage`, `http://localhost` — are words a comment is
 * entitled to use while explaining why the code does not do them.
 *
 * The line-comment strip refuses to fire after a colon, so the `//` inside
 * a URL survives. Without that, stripping comments would delete exactly the
 * hard-coded origins this file exists to find.
 */
const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/[^\n]*/g, "");

describe("UI-AUTH-13 — no fabricated authentication", () => {
  it("there is exactly one place a session is adopted, and it requires a server token", async () => {
    const context = await read("state/AuthContext.jsx");
    expect(context).toContain("if (!result?.token || !result?.user)");

    // Nothing else may write the token key.
    const writers = [];
    for (const file of await sourceFiles()) {
      const source = await readFile(file, "utf8");
      if (/mulya\.auth\.token/.test(source)) writers.push(file);
    }
    expect(writers.map(label)).toEqual(["state/AuthContext.jsx"]);
  });

  it("no module invents a user, a bypass or a development sign-in", async () => {
    const FORBIDDEN = [
      /\bDEV_USER\b/,
      /\bMOCK_USER\b/,
      /\bFAKE_USER\b/,
      /\bDEMO_USER\b/,
      /\bskipAuth\b/i,
      /\bbypassAuth\b/i,
      /isAuthenticated\s*[:=]\s*true/,
      /\bsetUser\(\s*\{/, // a literal user object pushed into state
    ];
    for (const file of await sourceFiles()) {
      const source = await readFile(file, "utf8");
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(codeOf(source)), `${label(file)} matches ${pattern}`).toBe(false);
      }
    }
  });

  it("the guard decides on server-confirmed state, never on the presence of a stored token", async () => {
    const guards = await read("components/auth/RouteGuards.jsx");
    expect(guards).toContain("isRestoring");
    expect(guards).toContain("isAuthenticated");
    // Reading storage directly in a guard would be the shortcut that makes
    // an unvalidated token look like a session.
    expect(/localStorage|sessionStorage/.test(codeOf(guards))).toBe(false);
  });

  it("the user record is never persisted — only the token is, and it is re-validated", async () => {
    const context = await read("state/AuthContext.jsx");
    expect(context).toContain("authApi.fetchCurrentUser");
    // The only thing handed to storage.write is a token.
    const writes = [...context.matchAll(/storage\.write\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(writes.sort()).toEqual(["null", "null", "result.token"]);
  });
});

describe("configuration", () => {
  it("the API base URL comes from the environment and is never a hard-coded host", async () => {
    const http = await read("api/http.js");
    expect(http).toContain("import.meta.env.VITE_API_BASE_URL");

    /**
     * The rule is about where this application SENDS requests, so it is
     * stated that way rather than as "no URL anywhere". The dataset is full
     * of marketplace URLs and should be: they are the pages an observation
     * was collected from — recorded evidence, not a destination.
     *
     * Two checks, together covering the real failure: a host compiled into
     * the bundle that works for the author and fails for everybody else.
     */

    // 1. No call site anywhere passes fetch an absolute URL.
    for (const file of await sourceFiles()) {
      const source = codeOf(await readFile(file, "utf8"));
      const absolute = source.match(/\bfetch\(\s*["'`]https?:\/\//g) ?? [];
      expect(absolute, `${label(file)} fetches an absolute URL`).toEqual([]);
    }

    // 2. And the layers that DO make requests carry no origin at all.
    const networkLayer = (await sourceFiles()).filter((f) => /^(api|state)\//.test(label(f)));
    expect(networkLayer.length).toBeGreaterThan(3);
    for (const file of networkLayer) {
      const source = codeOf(await readFile(file, "utf8"));
      const origins = source.match(/["'`]https?:\/\/[^"'`\s]+/g) ?? [];
      expect(origins, `${label(file)} hard-codes ${origins.join(", ")}`).toEqual([]);
    }
  });

  it("no credential, key or secret is compiled into the bundle", async () => {
    const PATTERNS = [
      /(?:api[_-]?key|secret|passwo?rd|token)\s*[:=]\s*["'][A-Za-z0-9._\-/+]{16,}["']/i,
      /\bsk_(?:live|test)_[A-Za-z0-9]{8,}/,
      /\bre_[A-Za-z0-9]{16,}\b/,
      /\bSG\.[A-Za-z0-9_-]{16,}\b/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ];
    for (const file of await sourceFiles()) {
      const source = codeOf(await readFile(file, "utf8"));
      for (const pattern of PATTERNS) {
        expect(pattern.test(source), `${label(file)} matches ${pattern}`).toBe(false);
      }
    }
  });

  it("no password, hash or code is written to browser storage or the console", async () => {
    for (const file of await sourceFiles()) {
      const source = codeOf(await readFile(file, "utf8"));
      expect(
        /(?:localStorage|sessionStorage)\.setItem\([^)]*\b(password|passwordHash|code|otp)\b/i.test(source),
        `${label(file)} stores a credential`
      ).toBe(false);
      expect(
        /console\.(log|info|warn|error|debug)\([^)]*\b(password|passwordHash|resetToken|token)\b/i.test(source),
        `${label(file)} logs a credential`
      ).toBe(false);
    }
  });
});

describe("the application user is not a marketplace seller", () => {
  it("nothing in the authentication layer reads or writes a seller identity", async () => {
    const authFiles = [
      "state/AuthContext.jsx",
      "api/authService.js",
      "api/http.js",
      "components/auth/AccountMenu.jsx",
      "components/auth/RouteGuards.jsx",
      "pages/auth/SignIn.jsx",
      "pages/auth/CreateAccount.jsx",
      "pages/auth/VerifyEmail.jsx",
      "pages/auth/ForgotPassword.jsx",
      "pages/auth/ResetPassword.jsx",
    ];
    for (const rel of authFiles) {
      // A comment may name the distinction; code may not act on it.
      const code = codeOf(await read(rel));
      expect(/\bsellerId\b|\buser\.seller\b|\bsellersService\b/.test(code), `${rel} couples a user to a seller`).toBe(
        false
      );
    }
  });
});
