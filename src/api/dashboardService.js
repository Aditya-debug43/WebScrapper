import { mockDelay } from "./client";
import { getProduct } from "../data/products";
import { getBrand } from "../data/brands";
import { getListingsForProduct } from "../data/listings";
import { marketplaces } from "../data/marketplaces";
import { getCurrentEffectivePrice } from "../utils/pricingEngine";
import { OBSERVATION_WINDOWS, DEFAULT_WINDOW_KEY, windowByKey, datasetLatestDate } from "../utils/observationWindows";
import { analyseWindow } from "../utils/observationWindowStats";
import { demoSetIds, profileFor } from "../utils/demoSet";

/**
 * The products the desk opens on.
 *
 * This used to be two hand-written ids, which is exactly what the review
 * picked up: two products cannot show whether the analysis generalises. They
 * are now chosen by `utils/demoSet` — a stratified sample across marketplace
 * reach, history depth, competitive density, department and price, including
 * cases the engine is expected to refuse. See that module for the method.
 *
 * A real deployment would read a per-user tracked-products resource here; the
 * shape of this export is unchanged so that swap stays a one-line change.
 */
export const DEFAULT_TRACKED_PRODUCT_IDS = demoSetIds();

export { OBSERVATION_WINDOWS, DEFAULT_WINDOW_KEY };

/**
 * A movement is only reported where the window can actually carry one. At
 * this catalogue's capture cadence a 1-day window holds a single observation
 * for most products, and a single observation has no direction — so the
 * summary returns the capability alongside the number, and the interface is
 * expected to respect it rather than print a change of zero.
 */
export async function getTrackedProductsSummary(productIds, windowKey = DEFAULT_WINDOW_KEY) {
  await mockDelay();
  const win = windowByKey(windowKey);
  return productIds
    .map((id) => {
      const product = getProduct(id);
      if (!product) return null;
      const current = getCurrentEffectivePrice(id);
      const w = analyseWindow(id, win.days);
      return {
        product,
        brand: getBrand(product.brandId),
        profile: profileFor(id),
        currentPriceMinor: current?.universalEffectiveMinor ?? null,
        marketplaceCount: getListingsForProduct(id).length,
        window: w,
        capability: w.capability,
        changeMinor: w.changeMinor,
        // Kept as a fraction for the existing formatters; null whenever the
        // window cannot support a direction.
        changePct: w.changePct == null ? null : w.changePct / 100,
        observationCount: w.n,
      };
    })
    .filter(Boolean);
}

/**
 * GET /api/dashboard/alerts — derived, never stored.
 *
 * An alert needs a direction, so windows that only carry a snapshot produce
 * none. That is the point: firing "no movement" at a product observed once
 * this week would be a statement the data does not support.
 */
export async function getPriceAlerts(productIds, windowKey = DEFAULT_WINDOW_KEY) {
  await mockDelay();
  const summaries = await getTrackedProductsSummary(productIds, windowKey);
  const win = windowByKey(windowKey);
  const alerts = [];
  for (const s of summaries) {
    if (s.changePct == null) continue;
    if (s.changePct <= -0.04) {
      alerts.push({
        id: `alert_drop_${s.product.id}_${win.key}`,
        productId: s.product.id,
        severity: "serious",
        type: "price_drop",
        message: `${s.product.canonicalName} moved ${Math.abs(s.changePct * 100).toFixed(1)}% lower across ${win.label.toLowerCase()}, over ${s.observationCount} observations.`,
      });
    }
    if (s.changePct >= 0.04) {
      alerts.push({
        id: `alert_rise_${s.product.id}_${win.key}`,
        productId: s.product.id,
        severity: "good",
        type: "price_rise",
        message: `${s.product.canonicalName} moved ${(s.changePct * 100).toFixed(1)}% higher across ${win.label.toLowerCase()}, over ${s.observationCount} observations.`,
      });
    }
  }
  return alerts;
}

export async function getPortfolioPosition(productIds, windowKey = DEFAULT_WINDOW_KEY) {
  await mockDelay();
  const summaries = await getTrackedProductsSummary(productIds, windowKey);
  const win = windowByKey(windowKey);
  const totalMarketplaces = new Set(
    productIds.flatMap((id) => getListingsForProduct(id).map((l) => l.marketplaceId))
  ).size;

  // The average is taken only over products whose window carries a direction,
  // and the count of those is reported beside it — an average over four of
  // twelve products is a different claim from an average over twelve.
  const directional = summaries.filter((s) => s.changePct != null);
  const avgChangePct = directional.length
    ? directional.reduce((sum, s) => sum + s.changePct, 0) / directional.length
    : null;

  return {
    trackedCount: summaries.length,
    marketplaceCoverage: totalMarketplaces,
    marketplaceTotal: marketplaces.length,
    avgChangePct,
    directionalCount: directional.length,
    snapshotCount: summaries.filter((s) => s.capability === "snapshot").length,
    emptyCount: summaries.filter((s) => s.capability === "none").length,
    windowLabel: win.label,
    windowDays: win.days,
    asOf: datasetLatestDate(),
  };
}
