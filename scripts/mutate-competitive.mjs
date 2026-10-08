/**
 * MUTATION TESTING — the competitive market
 * =========================================
 *
 * A passing suite proves the code does something. It does not prove the suite
 * would notice if the code did the WRONG thing. This breaks each guarantee
 * the competitive layer claims, one at a time, and requires the suite to fail
 * every time.
 *
 * It matters more here than almost anywhere else in this repository, because
 * the failures this layer is capable of are SILENT. A market that quietly
 * counts three sellers instead of ten, or pools a refurbished unit in with
 * new stock, or anchors on an accessory, does not throw — it returns a
 * confident number that is wrong. Every mutation below is a real defect that
 * existed at some point while this was written:
 *
 *   - clustering disabled, so one catalogue id was the whole market
 *   - the accessory guard removed, so a carry case joined the headphones
 *   - condition pooled, so a phone was priced against a refurbished one
 *   - the freshness check skipped, so fifty followers bought fifty captures
 *   - the unsupervised-anchor bar lowered, so a capture built a market for a
 *     sticker
 *
 * A SURVIVED mutation means a property is asserted nowhere, and the test that
 * looks like it covers it passes for some other reason.
 *
 * Run from the repository root:  node scripts/mutate-competitive.mjs
 */
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../server/", import.meta.url)));

import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";

/**
 * Both suites: the unit guarantees and the end-to-end flow.
 *
 * Both, because a mutation can be caught by either and the point is that it
 * is caught by SOMETHING. Several of these were only killed by the
 * integration suite — the freshness short-circuit, for instance, has no
 * meaning until two callers ask for the same product.
 */
const SUITES = "tests/competitive-market.test.ts tests/discovery.test.ts";

const MUTATIONS = [
  /* ------------------------------------------------- coverage: the clustering */
  {
    id: "CM-M1",
    why: "clustering disabled — one catalogue id becomes the whole market again",
    file: "src/ingestion/cluster.ts",
    // The budget forced to one, so only the anchor is ever opened.
    find: "  const limit = Math.max(1, opts.limit ?? 4);",
    to: "  const limit = 1;",
  },
  {
    id: "CM-M2",
    why: "a contradicted specification no longer excludes — 128GB merges with 256GB",
    file: "src/ingestion/cluster.ts",
    find: "    if (!overlap) {\n      return null; // states a different value for something the anchor states",
    to: "    if (false) {\n      return null;",
  },
  {
    id: "CM-M3",
    why: "model codes no longer have to match — the XM4 joins the XM5's market",
    file: "src/ingestion/cluster.ts",
    find: "    if (shared.length === 0) {\n      return null;\n    }",
    to: "    if (false) {\n      return null;\n    }",
  },
  {
    id: "CM-M4",
    why: "the price-class guard removed — a 999-rupee accessory joins a 27,000-rupee product",
    file: "src/ingestion/cluster.ts",
    find: "    if (ratio > PRICE_RATIO_LIMIT) {",
    to: "    if (false) {",
  },
  {
    id: "CM-M5",
    why: "accessories admitted without the near-parity test that overrides their classification",
    file: "src/ingestion/cluster.ts",
    find: "      if (!exactModelMatch || ratio > WORDY_LISTING_RATIO) {",
    to: "      if (false) {",
  },
  {
    id: "CM-M6",
    why: "an automatic capture anchors on a merely-plausible row — a market built for a sticker",
    file: "src/ingestion/cluster.ts",
    find: 'const anchorScored = wanted ?? scored.filter((s) => s.relevance === "strong").sort((a, b) => b.score - a.score)[0];',
    to: 'const anchorScored =\n    wanted ??\n    scored.filter((s) => s.relevance === "strong" || s.relevance === "plausible").sort((a, b) => b.score - a.score)[0];',
  },

  /* ---------------------------------------------- identity: the second check */
  {
    id: "CM-M7",
    why: "attribute verification skipped — an iPhone 15 and an iPhone 15 Plus priced as one product",
    file: "src/modules/market/market.service.ts",
    find: "    const clash = market.attributes",
    to: "    const clash = ([] as typeof market.attributes)",
  },

  /* ---------------------------------------------------- honesty: the provider */
  {
    id: "CM-M8",
    why: "an unstated shipping cost reported as free, understating every landed price",
    file: "src/ingestion/providers/serpapi.market.ts",
    find: "  if (!figure) return { minor: null, note };",
    to: "  if (!figure) return { minor: 0, note };",
  },
  {
    id: "CM-M9",
    why: "a merchant id dropped — sellers lose identity and cannot be followed across captures",
    file: "src/ingestion/providers/serpapi.market.ts",
    find: "      sellerExternalId: store.merchant_id ?? null,",
    to: "      sellerExternalId: null,",
  },
  {
    id: "CM-M10",
    why: "silence read as 'in stock' — a price nobody can buy at becomes the market floor",
    file: "src/ingestion/providers/serpapi.market.ts",
    find: "  const inStock = /in stock/.test(joined)",
    to: "  const inStock = true || /in stock/.test(joined)",
  },
  {
    id: "CM-M11",
    why: "a product response with no product_results becomes a market with no sellers",
    file: "src/ingestion/providers/serpapi.market.ts",
    find: '    throw new ProviderError(provider, "Product response carried no product_results.", "malformed", false);',
    to: "    return { provider, externalProductId, title: '', brand: null, thumbnailUrl: null, attributes: [], sellers: [], priceRangeLowMinor: null, priceRangeHighMinor: null, priceTrackingAvailable: false, relatedTitles: [], fetchedAt: new Date().toISOString(), raw: body, requestUrl };",
  },

  /* ------------------------------------------- correctness: the analysis */
  {
    id: "CM-M12",
    why: "condition pooled — a new listing priced against refurbished stock",
    file: "src/modules/market/competition.ts",
    find: '  const primaryCondition = order.find((c) => (byCondition.get(c)?.length ?? 0) > 0)!;',
    to: '  const primaryCondition = "new" as const;\n  byCondition.set("new", offers);',
  },
  {
    id: "CM-M13",
    why: "out-of-stock sellers counted in the floor — an unbuyable price leads the market",
    file: "src/modules/market/competition.ts",
    find: "  const inPlay = offers.filter((o) => o.inStock);\n  const pool = inPlay.length > 0 ? inPlay : offers;",
    to: "  const pool = offers;",
  },
  {
    id: "CM-M14",
    why: "a single capture reported as a trend",
    file: "src/modules/market/competition.ts",
    find: "  if (points.length < 2) return null;",
    to: "  if (points.length < 1) return null;",
  },
  {
    id: "CM-M15",
    why: "a median computed over a halved seller population reported as comparable",
    file: "src/modules/market/competition.ts",
    find: "    comparable: minSellerCount > 0 && maxSellerCount / minSellerCount <= 2,",
    to: "    comparable: true,",
  },
  {
    id: "CM-M16",
    why: "quantiles returned un-rounded, so a price becomes a fraction of a paisa",
    file: "src/modules/market/competition.ts",
    find: "  return Math.round(percentile(sortedAscending, fraction));",
    to: "  return percentile(sortedAscending, fraction);",
  },

  /* ------------------------------------------------- honesty: the refusal */
  {
    id: "CM-M17",
    why: "a one-seller market priced anyway instead of refused",
    file: "src/modules/pricing/marketPricing.service.ts",
    find: "    if (!dist || !struct || dist.sellerCount < MIN_USABLE_SELLERS) {",
    to: "    if (!dist || !struct) {",
  },
  {
    id: "CM-M18",
    why: "a recommendation below the cheapest real offer — a price no evidence supports",
    // Moved out of the service: the guard is the reason the engine was
    // extracted as a pure function, since nothing was reaching this branch.
    file: "src/modules/pricing/deterministic.ts",
    find: "  if (target < dist.lowMinor) {",
    to: "  if (false) {",
  },
  {
    id: "CM-M19",
    why: "an AI failure presented as an AI judgement rather than the deterministic figure",
    file: "src/modules/pricing/marketPricing.service.ts",
    find: 'method: ai?.used ? ("ai" as const) : ("deterministic" as const),',
    to: 'method: "ai" as const,',
  },

  /* ----------------------------------------------------------- cost control */
  {
    id: "CM-M20",
    why: "freshness check skipped — fifty followers of one product buy fifty captures",
    file: "src/modules/market/market.service.ts",
    find: "    if (!input.force) {\n      const existing = await this.repo.productByExternalId(",
    to: "    if (false) {\n      const existing = await this.repo.productByExternalId(",
  },
  {
    id: "CM-M23",
    why: "catalogue ids opened one at a time — a capture costs the sum of its calls and outlives the gateway timeout",
    file: "src/modules/market/market.service.ts",
    // Await each call as it is created, so the batch below resolves already
    // -settled promises and the whole thing runs in sequence.
    find: "    const pending = ids.map((id) =>\n      this.provider.fetchProduct(id, {",
    to: "    const pending = [] as Array<Promise<ProductMarket>>;\n    for (const _id of ids) pending.push(Promise.resolve(await this.provider.fetchProduct(_id, { country: env.MARKET_DATA_COUNTRY, currency: env.MARKET_DATA_CURRENCY })));\n    void ids.map((id) =>\n      (() => this.provider.fetchProduct(id, {",
  },
  {
    id: "CM-M21",
    why: "sellers no longer deduplicated across catalogue ids — competition double-counted",
    file: "src/modules/market/market.repository.ts",
    find: "        const key = seller.sellerExternalId ?? `name:${slugify(seller.sellerName)}`;",
    to: "        const key = `${market.externalProductId}:${seller.sellerExternalId ?? slugify(seller.sellerName)}`;",
  },
  {
    id: "CM-M22",
    why: "same-day observations overwritten instead of kept — history becomes rewritable",
    file: "src/modules/market/market.repository.ts",
    find: ".onConflictDoNothing({ target: [priceObservations.offerId, priceObservations.observedAt] })",
    to: "",
  },
];

const results = [];
for (const m of MUTATIONS) {
  const backup = `${m.file}.bak`;
  copyFileSync(m.file, backup);
  const src = readFileSync(m.file, "utf8");

  /**
   * The repository's files are CRLF. A literal "\n" in an anchor above
   * silently matches nothing, the mutant is never applied, and the suite
   * passes — reported as SURVIVED when nothing was actually mutated. So the
   * anchor is matched against both line endings and the miss is loud.
   */
  const find = src.includes("\r\n") ? m.find.replace(/\n/g, "\r\n") : m.find;
  const to = src.includes("\r\n") ? m.to.replace(/\n/g, "\r\n") : m.to;

  if (!src.includes(find)) {
    console.log(`${m.id}: ANCHOR MISSING — ${m.find.slice(0, 70).replace(/\n/g, "\\n")}`);
    results.push({ ...m, verdict: "ANCHOR MISSING" });
    unlinkSync(backup);
    continue;
  }

  writeFileSync(m.file, src.replace(find, to));
  let verdict;
  try {
    execSync(`npx tsx --test ${SUITES}`, { stdio: "pipe", timeout: 600000 });
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
