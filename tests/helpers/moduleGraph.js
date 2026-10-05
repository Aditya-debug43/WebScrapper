import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * STATIC MODULE GRAPH over `src/`.
 *
 * Shared by the architectural guards — the one that keeps the pricing engine
 * out of the browser, and the one that keeps the bundled dataset out of it.
 * Both ask the same question ("what can this entry point actually reach?")
 * and the traversal was written twice before this file existed.
 *
 * It resolves only RELATIVE imports, which is the whole point: a guard is
 * asking about this project's own modules, and `react` or `recharts` are
 * neither interesting nor resolvable this way.
 */

export const SRC = resolve(import.meta.dirname, "..", "..", "src");

/** `src`-relative, forward slashes, so an assertion reads the same on any OS. */
export const rel = (file) => relative(SRC, file).split("\\").join("/");

/**
 * Source with comments stripped.
 *
 * Comments quote module names legitimately — several of them explain exactly
 * which import must not come back — so a guard that searched raw text would
 * fail on its own documentation.
 */
export function codeOf(file) {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every JS/TS source file under a directory, recursively. */
export function sourceFiles(dir = SRC) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.(jsx?|tsx?)$/.test(entry)) found.push(full);
  }
  return found;
}

/** Relative-path imports from one file, resolved to real files on disk. */
export function localImports(file) {
  const code = codeOf(file);
  const specifiers = [];
  for (const pattern of [/\bfrom\s+["'](\.[^"']+)["']/g, /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g]) {
    let match;
    while ((match = pattern.exec(code)) !== null) specifiers.push(match[1]);
  }

  const resolved = [];
  for (const specifier of specifiers) {
    const base = resolve(dirname(file), specifier);
    const candidate = [base, `${base}.js`, `${base}.jsx`, join(base, "index.js"), join(base, "index.jsx")].find(
      (p) => existsSync(p) && statSync(p).isFile()
    );
    if (candidate) resolved.push(candidate);
  }
  return resolved;
}

/** Every module an entry point pulls in, transitively, including itself. */
export function reachableFrom(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of localImports(file)) if (!seen.has(next)) queue.push(next);
  }
  return seen;
}

/**
 * The shortest import chain from `entry` to the first module matching
 * `predicate`, or null.
 *
 * A guard that only says "the dataset is reachable" leaves someone to find
 * the route by hand; breadth-first from the entry gives the shortest one,
 * which is almost always the import that should not have been written.
 */
export function shortestPathTo(entry, predicate) {
  const seen = new Set([entry]);
  const queue = [[entry]];
  while (queue.length) {
    const path = queue.shift();
    const file = path[path.length - 1];
    if (path.length > 1 && predicate(rel(file))) return path.map(rel);
    for (const next of localImports(file)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}
