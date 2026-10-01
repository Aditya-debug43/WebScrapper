import { createServer } from "vite";

/**
 * THE ENGINE'S OWN RECOMMENDATION BASELINE
 *
 * The backend's baseline script reports counts over all 1,172 products. The
 * figure recorded in earlier phases — "1,156 purchasable → 1,043 recommended /
 * 113 refused" — used a different denominator, so the two cannot be compared
 * directly without this: the same question, asked of the frontend engine,
 * which is the baseline.
 *
 *   node scripts/engine-recommendation-baseline.mjs
 */

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });

try {
  const [{ products }, engine] = await Promise.all([
    vite.ssrLoadModule("/src/data/products.js"),
    vite.ssrLoadModule("/src/utils/pricingEngine.js"),
  ]);

  let recommended = 0;
  let refused = 0;
  let conflicts = 0;
  const reasons = new Map();
  const noPrice = [];

  for (const product of products) {
    const rec = engine.buildRecommendation(product.id);
    if (rec.insufficientData) {
      refused += 1;
      if (rec.constraintConflict) conflicts += 1;
      // The engine states refusal in prose; the useful split is whether it had
      // a current price at all, which is the backend's `no_current_price`.
      const hadPrice = rec.currentPriceMinor != null;
      if (!hadPrice) noPrice.push(product.id);
      const key = hadPrice ? "no usable comparables" : "no current price";
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    } else {
      recommended += 1;
    }
  }

  console.log(`\n  products          ${products.length}`);
  console.log(`  recommended       ${recommended}`);
  console.log(`  refused           ${refused}`);
  for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${reason.padEnd(22)} ${String(n).padStart(4)}`);
  }
  console.log(`  constraint conflicts ${conflicts}`);
  console.log(`\n  products with no current price: ${noPrice.length}`);
  console.log("");
} finally {
  await vite.close();
}
