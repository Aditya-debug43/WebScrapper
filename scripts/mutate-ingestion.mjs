/**
 * MUTATION TESTING — market data ingestion
 * ========================================
 *
 * A passing test suite proves the code does something. It does not prove the
 * suite would notice if the code did the WRONG thing. This breaks each
 * guarantee the ingestion layer claims, one at a time, and requires the
 * suite to fail every time.
 *
 * A SURVIVED mutation means a property is asserted nowhere — the test that
 * looks like it covers it passes for some other reason. Every survivor found
 * while this was written turned out to be a real gap:
 *
 *   - the human-confirmation test picked a seeded listing the fixture never
 *     touches, so it passed without exercising anything
 *   - the key-redaction test passed a pre-redacted URL into the normaliser,
 *     never running the code that does the redacting
 *
 * Run from the repository root:  node scripts/mutate-ingestion.mjs
 */
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../server/", import.meta.url)));

import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";

const MUTATIONS = [
  { id: "ING-M1", why: "matching floor removed — any best candidate accepted",
    file: "src/ingestion/matching.ts", find: "export const MATCH_CONFIDENCE_FLOOR = 0.82;", to: "export const MATCH_CONFIDENCE_FLOOR = 0.0;" },
  { id: "ING-M2", why: "variant gate disabled — a 256GB offer may land on a 128GB product",
    file: "src/ingestion/matching.ts",
    find: "    if (storageClash || ramClash) {", to: "    if (false) {" },
  { id: "ING-M3", why: "ambiguity guard removed — a coin-flip between two candidates is accepted",
    file: "src/ingestion/matching.ts", find: "if (runnerUp && best.score - runnerUp.score < 0.05) {", to: "if (false && runnerUp) {" },
  { id: "ING-M4", why: "provider failure converted into an empty result",
    file: "src/ingestion/ingestion.service.ts",
    find: "      await this.repo.closeRun(captureRunId, { runStatus: \"failed\", pagesSucceeded: 0, notes: message });\n      throw cause;",
    to: "      await this.repo.closeRun(captureRunId, { runStatus: \"success\", pagesSucceeded: 0, notes: message });\n      return { ...base, captureRunId, status: \"success\", message };" },
  { id: "ING-M5", why: "human confirmation overwritten by a later auto-match",
    file: "src/ingestion/ingestion.repository.ts",
    find: "      if (existing.matchStatus === \"human_confirmed\") {", to: "      if (false) {" },
  { id: "ING-M6", why: "unmatched offers persisted as listings anyway",
    file: "src/ingestion/ingestion.service.ts",
    find: "      if (verdict.status === \"unmatched\") {", to: "      if (false && verdict.status === \"unmatched\") {" },
  { id: "ING-M7", why: "API key no longer redacted from the recorded request URL",
    file: "src/ingestion/providers/serpapi.provider.ts",
    find: "api_key: \"REDACTED\"", to: "api_key: this.apiKey" },
  { id: "ING-M8", why: "unstated delivery charge treated as free",
    file: "src/ingestion/providers/serpapi.provider.ts",
    find: "  return { feeMinor: null, note };", to: "  return { feeMinor: 0, note };" },
  { id: "ING-M9", why: "unreadable results dropped silently instead of reported",
    file: "src/ingestion/providers/serpapi.provider.ts",
    find: "      skipped.push({ reason: \"no title\", raw: result });", to: "      void result;" },
  { id: "ING-M10", why: "a missing fixture returns an empty market instead of erroring",
    file: "src/ingestion/providers/fixture.provider.ts",
    find: "      throw new ProviderError(this.name, `No recorded response at ${path}`, \"unavailable\", false);",
    to: "      return { provider: this.name, query: query.query, offers: [], raw: null, requestUrl: `fixture://${path}`, fetchedAt: new Date().toISOString(), skipped: [] };" },
  { id: "ING-M11", why: "discovered stores recorded as curated marketplaces",
    file: "src/ingestion/ingestion.repository.ts", find: "      isDiscovered: true,", to: "      isDiscovered: false," },
  { id: "ING-M12", why: "same-day duplicate observations allowed through",
    file: "src/ingestion/ingestion.repository.ts",
    find: ".onConflictDoNothing({ target: [priceObservations.offerId, priceObservations.observedAt] })", to: "" },
  { id: "ING-M13", why: "model numbers stripped as capacities again (iPhone 13 == iPhone 15)",
    file: "src/ingestion/matching.ts",
    find: '.filter((t) => t.length > 1 && !STOPWORDS.has(t) && !COLOURS.includes(t));',
    // `\\d` in source so a single backslash reaches the file. Written as `\d`
    // the string parses to a literal "d", the regex never matches a number,
    // and the mutant silently does nothing — which is how it first "survived".
    to: '.filter((t) => t.length > 1 && !STOPWORDS.has(t) && !COLOURS.includes(t) && !/^\\d+(gb|tb)?$/.test(t));' },
  { id: "ING-M14", why: "missing-capacity penalty removed — a bare title matches a specific variant",
    file: "src/ingestion/matching.ts",
    find: 'if (storage != null && incoming.storageGb == null) score -= 0.25;',
    to: 'if (false) score -= 0.25;' },
  { id: "ING-M15", why: "colour counted twice again — a correct match refused over cosmetics",
    file: "src/ingestion/matching.ts",
    find: ' && !COLOURS.includes(t));',
    to: ');' },
  { id: "ING-M16", why: "colour disagreement no longer costs confidence",
    file: "src/ingestion/matching.ts",
    find: 'if (colourVerdict === \"differs\") score -= 0.15;',
    to: 'if (false) score -= 0.15;' },
];

const results = [];
for (const m of MUTATIONS) {
  const backup = `${m.file}.bak`;
  copyFileSync(m.file, backup);
  const src = readFileSync(m.file, "utf8");
  if (!src.includes(m.find)) {
    console.log(`${m.id}: ANCHOR MISSING — ${m.find.slice(0, 60)}`);
    results.push({ ...m, verdict: "ANCHOR MISSING" });
    unlinkSync(backup);
    continue;
  }
  writeFileSync(m.file, src.replace(m.find, m.to));
  let verdict;
  try {
    execSync("npx tsx --test tests/ingestion.test.ts", { stdio: "pipe", timeout: 300000 });
    verdict = "SURVIVED";
  } catch {
    verdict = "KILLED";
  }
  copyFileSync(backup, m.file);
  unlinkSync(backup);
  console.log(`${m.id}: ${verdict.padEnd(14)} ${m.why}`);
  results.push({ ...m, verdict });
}

const killed = results.filter((r) => r.verdict === "KILLED").length;
console.log(`\n${killed}/${results.length} killed`);
if (killed !== results.length) {
  console.log("NOT ALL KILLED:");
  for (const r of results.filter((x) => x.verdict !== "KILLED")) console.log(`  ${r.id} ${r.verdict} — ${r.why}`);
  process.exitCode = 1;
}
