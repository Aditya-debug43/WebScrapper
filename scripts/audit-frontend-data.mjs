/**
 * TRANSITIVE IMPORT AUDIT
 * =======================
 *
 * Walks the real module graph from the application entry point and reports
 * which files reach `src/data/*`, and by what path.
 *
 * A grep finds direct importers, which is not the question. The question is
 * whether the shipped bundle contains the static dataset at all, and a page
 * three hops away from it is as fatal as one importing it directly.
 *
 *   node scripts/audit-frontend-data.mjs
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";

const ENTRY = process.argv[2] ?? "src/main.jsx";
const ROOT = process.cwd();

/** Resolve an import specifier the way Vite would, for relative paths only. */
function resolveImport(fromFile, spec) {
  if (!spec.startsWith(".")) return null; // bare package — not our source
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.js"),
    join(base, "index.jsx"),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g;
const DYNAMIC_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

const graph = new Map();
const seen = new Set();
const queue = [resolve(ROOT, ENTRY)];

while (queue.length) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);

  let src;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  const deps = new Set();
  for (const re of [IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const target = resolveImport(file, m[1]);
      if (target) {
        deps.add(target);
        queue.push(target);
      }
    }
  }
  graph.set(file, deps);
}

const rel = (f) => f.replace(ROOT, "").replace(/\\/g, "/").replace(/^\//, "");
const isData = (f) => rel(f).startsWith("src/data/");

/** Shortest import path from the entry to a given module. */
function pathTo(target) {
  const start = resolve(ROOT, ENTRY);
  const prev = new Map([[start, null]]);
  const q = [start];
  while (q.length) {
    const cur = q.shift();
    if (cur === target) break;
    for (const next of graph.get(cur) ?? []) {
      if (!prev.has(next)) {
        prev.set(next, cur);
        q.push(next);
      }
    }
  }
  if (!prev.has(target)) return null;
  const chain = [];
  for (let n = target; n; n = prev.get(n)) chain.unshift(rel(n));
  return chain;
}

const reachedData = [...seen].filter(isData).sort();

console.log(`entry: ${ENTRY}`);
console.log(`modules reachable:          ${seen.size}`);
console.log(`src/data modules reachable: ${reachedData.length}\n`);

if (reachedData.length === 0) {
  console.log("CLEAN — the production graph does not reach src/data at all.");
} else {
  console.log("REACHABLE STATIC DATA, with the shortest path that pulls it in:\n");
  for (const d of reachedData) {
    const chain = pathTo(d);
    console.log(`  ${rel(d)}`);
    console.log(`      ${chain.join("\n        -> ")}\n`);
  }
}

/** The modules that must change: reachable code importing static data. */
const gateways = new Map();
for (const [file, deps] of graph) {
  if (isData(file)) continue;
  const hits = [...deps].filter(isData).map(rel);
  if (hits.length) gateways.set(rel(file), hits);
}
if (gateways.size) {
  console.log("GATEWAY MODULES (reachable code importing static data directly):\n");
  for (const [file, hits] of [...gateways].sort()) {
    console.log(`  ${file}`);
    console.log(`      ${hits.join(", ")}`);
  }
}

process.exitCode = reachedData.length ? 1 : 0;
