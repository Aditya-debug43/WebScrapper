import { mockDelay } from "./client";
import { getProduct } from "../data/products";
import { getBrand } from "../data/brands";
import { getListingsForProduct } from "../data/listings";
import { marketplaces } from "../data/marketplaces";
import { getCurrentEffectivePrice, getEffectivePriceOnDate } from "../utils/pricingEngine";

// Products tracked by default on first load — a real deployment would read
// this from a per-user "tracked products" resource on the backend.
export const DEFAULT_TRACKED_PRODUCT_IDS = [
  "prod_galaxy_m14_5g_6_128_blue",
  "prod_galaxy_m14_5g_8_256_silver",
];

function daysAgoIso(n) {
  const d = new Date("2026-08-14"); // "today" in this dataset
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** GET /api/dashboard/tracked-products?ids=... */
export async function getTrackedProductsSummary(productIds) {
  await mockDelay();
  return productIds
    .map((id) => {
      const product = getProduct(id);
      if (!product) return null;
      const brand = getBrand(product.brandId);
      const current = getCurrentEffectivePrice(id);
      const weekAgoMinor = getEffectivePriceOnDate(id, daysAgoIso(7));
      const changeMinor = current && weekAgoMinor != null ? current.universalEffectiveMinor - weekAgoMinor : null;
      const changePct = changeMinor != null && weekAgoMinor ? changeMinor / weekAgoMinor : null;
      const marketplaceCount = getListingsForProduct(id).length;
      return {
        product,
        brand,
        currentPriceMinor: current?.universalEffectiveMinor ?? null,
        changeMinor,
        changePct,
        marketplaceCount,
      };
    })
    .filter(Boolean);
}

/** GET /api/dashboard/alerts?ids=... — derived, not stored: a materially large 7-day drop is an alert. */
export async function getPriceAlerts(productIds) {
  await mockDelay();
  const summaries = await getTrackedProductsSummary(productIds);
  const alerts = [];
  for (const s of summaries) {
    if (s.changePct != null && s.changePct <= -0.04) {
      alerts.push({
        id: `alert_drop_${s.product.id}`,
        productId: s.product.id,
        severity: "serious",
        type: "price_drop",
        message: `${s.product.canonicalName} moved ${Math.abs(s.changePct * 100).toFixed(1)}% lower across the last 7 days.`,
      });
    }
    if (s.changePct != null && s.changePct >= 0.04) {
      alerts.push({
        id: `alert_rise_${s.product.id}`,
        productId: s.product.id,
        severity: "good",
        type: "price_rise",
        message: `${s.product.canonicalName} moved ${(s.changePct * 100).toFixed(1)}% higher across the last 7 days.`,
      });
    }
  }
  return alerts;
}

export async function getPortfolioPosition(productIds) {
  await mockDelay();
  const summaries = await getTrackedProductsSummary(productIds);
  const totalMarketplaces = new Set(
    productIds.flatMap((id) => getListingsForProduct(id).map((l) => l.marketplaceId))
  ).size;
  return {
    trackedCount: summaries.length,
    marketplaceCoverage: totalMarketplaces,
    marketplaceTotal: marketplaces.length,
    avgChangePct:
      summaries.filter((s) => s.changePct != null).reduce((sum, s) => sum + s.changePct, 0) /
      (summaries.filter((s) => s.changePct != null).length || 1),
  };
}
