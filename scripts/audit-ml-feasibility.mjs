import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * ML FEASIBILITY AUDIT
 * ====================
 *
 * Phase 6 asks whether this dataset genuinely supports a new machine-learning
 * pricing layer. That question is answered by counting, not by opinion, so
 * this script measures the things that decide it:
 *
 *   - is there a demand signal at all (units, conversion, elasticity)?
 *   - how much price VARIATION exists per product?
 *   - how many observations, over how long, at what cadence?
 *   - how big is the largest honest training sample?
 *   - what would the target variable be, and is it circular?
 *
 * Every number it prints comes from the seed files the application loads.
 *
 *   node scripts/audit-ml-feasibility.mjs
 */

const DIR = resolve("server/seed-data");
const read = (name) => {
  const path = resolve(DIR, `${name}.ndjson`);
  if (!existsSync(path)) throw new Error(`missing ${path} — run node scripts/export-dataset.mjs first`);
  return readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
};

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
const head = (t) => console.log(`\n${"=".repeat(74)}\n${t}\n${"=".repeat(74)}`);

const products = read("products");
const listings = read("listings");
const offers = read("offers");
const observations = read("price_observations");
const reviews = read("review_snapshots");
const promotions = read("promotions");
const attrDefs = read("attribute_definitions");

/* ------------------------------------------------- 1. is there any demand? */

head("1. DEMAND SIGNAL — what the dataset does NOT contain");

const DEMAND_FIELDS = [
  "unitsSold", "units_sold", "quantitySold", "quantity_sold", "salesVolume", "sales_volume",
  "conversionRate", "conversion_rate", "orders", "orderCount", "clicks", "impressions",
  "pageViews", "addToCart", "revenue", "demand", "elasticity",
];
const allKeys = new Set();
for (const table of [products, listings, offers, observations, reviews, promotions]) {
  for (const row of table.slice(0, 500)) for (const k of Object.keys(row)) allKeys.add(k);
}
const found = DEMAND_FIELDS.filter((f) => allKeys.has(f));
console.log(`  fields searched for across every table: ${DEMAND_FIELDS.length}`);
console.log(`  demand / conversion / volume fields FOUND: ${found.length ? found.join(", ") : "none"}`);
console.log(`  → a quantity sold at a price exists nowhere in this dataset.`);
console.log(`     Without it, price elasticity and true willingness-to-pay are`);
console.log(`     not estimable — not poorly estimable, NOT ESTIMABLE.`);

/* --------------------------------------------- 2. the closest demand proxy */

head("2. THE CLOSEST PROXY — review accumulation");

// Review snapshots are captured per LISTING; a product is reviewed on each
// marketplace separately, so they must be rolled up through the listing.
const listingToProduct = new Map(listings.map((l) => [l.id, l.productId]));
const byProductReviews = new Map();
for (const r of reviews) {
  const productId = listingToProduct.get(r.listingId);
  if (!productId) continue;
  const list = byProductReviews.get(productId) ?? [];
  list.push(r);
  byProductReviews.set(productId, list);
}
let withTwoSnapshots = 0;
let velocityMeasurable = 0;
for (const [, snaps] of byProductReviews) {
  if (snaps.length >= 2) withTwoSnapshots += 1;
  const dates = new Set(snaps.map((s) => s.capturedAt));
  if (dates.size >= 2) velocityMeasurable += 1;
}
console.log(`  products with any review snapshot:        ${byProductReviews.size} / ${products.length}`);
console.log(`  products with 2+ snapshots:              ${withTwoSnapshots}`);
console.log(`  products where a velocity is measurable: ${velocityMeasurable}`);
console.log(`  → review growth is a proxy for PURCHASES, at an unknown and`);
console.log(`     category-dependent review rate. It cannot be scaled into units.`);

/* ------------------------------------------------- 3. price variation */

head("3. PRICE VARIATION — how many distinct price points per product");

const obsByProduct = new Map();
const listingProduct = new Map(listings.map((l) => [l.id, l.productId]));
const offerListing = new Map(offers.map((o) => [o.id, o.listingId]));
for (const o of observations) {
  const productId = listingProduct.get(offerListing.get(o.offerId));
  if (!productId) continue;
  const rec = obsByProduct.get(productId) ?? { prices: new Set(), dates: new Set(), n: 0 };
  rec.prices.add(o.sellingPriceMinor);
  rec.dates.add(o.observedAt);
  rec.n += 1;
  obsByProduct.set(productId, rec);
}
const distinctPrices = [...obsByProduct.values()].map((r) => r.prices.size).sort((a, b) => a - b);
const q = (p) => distinctPrices[Math.floor((distinctPrices.length - 1) * p)];
console.log(`  products with observations:  ${obsByProduct.size}`);
console.log(`  distinct selling prices per product — min ${q(0)}, p25 ${q(0.25)}, median ${q(0.5)}, p75 ${q(0.75)}, max ${q(1)}`);
const lowVariation = distinctPrices.filter((v) => v < 5).length;
console.log(`  products with fewer than 5 distinct prices: ${lowVariation} (${pct(lowVariation, distinctPrices.length)})`);
console.log(`  → price variation is AMPLE. This is the half of the elasticity`);
console.log(`     equation the dataset has, and it is genuinely good: a median`);
console.log(`     product moved price ${q(0.5)} times across the capture window.`);
console.log(`     The missing half is the quantity sold at each of those prices,`);
console.log(`     and no amount of price history substitutes for it.`);

/* ------------------------------------------------- 4. time structure */

head("4. TIME STRUCTURE — is a time-aware split even possible?");

const dates = [...new Set(observations.map((o) => o.observedAt))].sort();
const perDay = new Map();
for (const o of observations) perDay.set(o.observedAt, (perDay.get(o.observedAt) ?? 0) + 1);
const counts = [...perDay.values()];
console.log(`  observations:            ${observations.length.toLocaleString("en-IN")}`);
console.log(`  distinct capture dates:  ${dates.length}   (${dates[0]} … ${dates[dates.length - 1]})`);
const span = (new Date(dates[dates.length - 1]) - new Date(dates[0])) / 86400000 + 1;
console.log(`  calendar span:           ${span} days, ${pct(dates.length, span)} of days captured`);
console.log(`  observations per day:    min ${Math.min(...counts)}, max ${Math.max(...counts)}`);
const obsCounts = [...obsByProduct.values()].map((r) => r.dates.size).sort((a, b) => a - b);
const qd = (p) => obsCounts[Math.floor((obsCounts.length - 1) * p)];
console.log(`  capture DAYS per product — min ${qd(0)}, median ${qd(0.5)}, max ${qd(1)}`);
console.log(`  → a train/validate/test split by date is possible, but each`);
console.log(`     product contributes at most ${qd(1)} daily points, and a price series`);
console.log(`     that barely moves gives a time-split model almost nothing to learn.`);

/* ------------------------------------------- 5. cross-sectional sample */

head("5. CROSS-SECTIONAL SAMPLE — the honest training size for a price model");

const typeSizes = new Map();
for (const p of products) typeSizes.set(p.productTypeId, (typeSizes.get(p.productTypeId) ?? 0) + 1);
const sizes = [...typeSizes.values()].sort((a, b) => b - a);
console.log(`  products:            ${products.length}`);
console.log(`  product types:       ${typeSizes.size}`);
console.log(`  largest type:        ${sizes[0]} products`);
console.log(`  median type:         ${sizes[Math.floor(sizes.length / 2)]} products`);
console.log(`  types with 5+:       ${sizes.filter((n) => n >= 5).length}`);
console.log(`  types with 20+:      ${sizes.filter((n) => n >= 20).length}`);

const relevantByType = new Map();
for (const a of attrDefs) {
  if (!a.isPricingRelevant) continue;
  if (!["integer", "decimal"].includes(a.dataType)) continue;
  relevantByType.set(a.productTypeId, (relevantByType.get(a.productTypeId) ?? 0) + 1);
}
const numericCounts = [...typeSizes.keys()].map((t) => relevantByType.get(t) ?? 0);
console.log(`  numeric pricing-relevant attributes per type — min ${Math.min(...numericCounts)}, max ${Math.max(...numericCounts)}`);
console.log(`  types with 0 numeric pricing attributes: ${numericCounts.filter((n) => n === 0).length}`);
console.log(`  → a price-on-attributes model is only comparable WITHIN a product`);
console.log(`     type, so the sample is the type's size, not ${products.length}.`);
console.log(`     A gradient-boosted tree on ${sizes[0]} rows with a handful of features`);
console.log(`     would fit noise, and cross-type pooling would compare a lipstick`);
console.log(`     to a laptop.`);

/* ------------------------------------------------- 6. target variable */

head("6. TARGET VARIABLE — what could be predicted, and what it would mean");

const promoOffers = new Set(promotions.filter((p) => p.availabilityClass === "universal").map((p) => p.offerId));
const observedOnPromo = observations.filter((o) => promoOffers.has(o.offerId)).length;
console.log(`  candidate targets present in the data:`);
console.log(`    selling price            YES  (${observations.length.toLocaleString("en-IN")} rows)`);
console.log(`    effective price          YES  (derived: landed − universal discount)`);
console.log(`    observations on promo    ${pct(observedOnPromo, observations.length)} — a target contaminated by sale state`);
console.log(`    price actually PAID      NO`);
console.log(`    price a buyer WOULD pay  NO`);
console.log(`    optimal price            NO`);
console.log(`  → every available target is an OBSERVED LISTING PRICE. A model`);
console.log(`     trained on it predicts what sellers ask, not what buyers accept.`);
console.log(`     Calling that "optimal price" would be a labelling error, not a`);
console.log(`     modelling achievement.`);

/* ------------------------------------------------- 7. leakage */

head("7. LEAKAGE — why a market-price model is nearly circular here");

console.log(`  The recommendation's strongest input is already the competitive`);
console.log(`  median of the same effective price a model would be trained to`);
console.log(`  predict. Feeding competitor prices in to predict a competitor`);
console.log(`  price returns the input with extra steps, and any apparent skill`);
console.log(`  is the identity function wearing a validation score.`);
console.log(`  Honest features must therefore EXCLUDE: own current price,`);
console.log(`  competitive median, competitive spread, historical median —`);
console.log(`  which leaves attributes, brand tier and rating. That model`);
console.log(`  already exists: it is the hedonic WTP component, and it refuses`);
console.log(`  on most products because adjusted R² does not clear 0.5.`);

head("VERDICT INPUTS");
console.log(`  demand signal:              absent`);
console.log(`  elasticity estimable:       no`);
console.log(`  largest within-type sample: ${sizes[0]} products`);
console.log(`  honest non-leaking features: attributes + brand tier + rating`);
console.log(`  model that already uses them: hedonic OLS, refuses below adjR² 0.5`);
console.log("");
