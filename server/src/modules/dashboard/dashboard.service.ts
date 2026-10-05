import { AppError } from "../../lib/errors.js";
import { round, summarise, type SeriesPoint } from "../../lib/series.js";
import { DEFAULT_WINDOW, resolveWindow, type WindowKey } from "../../lib/windows.js";
import type { AnalysisRepository } from "../analysis/analysis.repository.js";
import type { DashboardRepository, ProductProfileRow } from "./dashboard.repository.js";
import { buildProfiles, pickStratified, type Profile } from "./defaultSet.js";

/**
 * THE DESK
 * ========
 *
 * One composite read behind one page. The browser used to make three calls —
 * summaries, alerts, portfolio — each of which independently recomputed the
 * per-product window statistics over the bundled dataset, so the same work
 * was done three times and the three results could in principle disagree.
 * They are one computation here, and the page makes one request.
 *
 * The honest-refusal behaviour is the point of this screen and survives the
 * move intact. At this catalogue's capture cadence a one-day window holds a
 * single observation for most products, and a single observation is a price
 * level, not a movement: such a product reports its capability and no change
 * at all, rather than a change of zero.
 */

/** A move smaller than this is not worth raising. A judgement call, so it is named. */
const ALERT_THRESHOLD_PCT = 4;

export type DashboardAlert = {
  id: string;
  productId: string;
  productName: string;
  severity: "serious" | "good";
  type: "price_drop" | "price_rise";
  changePct: number;
  observationCount: number;
  message: string;
};

export class DashboardService {
  constructor(
    private readonly repo: DashboardRepository,
    private readonly analysis: AnalysisRepository
  ) {}

  /**
   * Which products belong on this desk.
   *
   * Three sources in precedence order: an explicit request, then whatever the
   * user has tracked, then the stratified default. The default exists because
   * a desk that opens empty cannot demonstrate anything, and a hand-written
   * list of ids cannot demonstrate that the analysis generalises.
   *
   * Returns the catalogue profile rows when it had to load them, because the
   * caller needs the very same rows to tier the products it ends up with and
   * that query is the most expensive read on the page.
   */
  async resolveTracked(options: { userId: string; productIds?: string[] }): Promise<{
    productIds: string[];
    source: "requested" | "tracked" | "default";
    unknownIds: string[];
    profileRows: ProductProfileRow[] | null;
  }> {
    if (options.productIds && options.productIds.length > 0) {
      const existing = new Set(await this.repo.existingProductIds(options.productIds));
      const known = options.productIds.filter((id) => existing.has(id));
      if (known.length === 0) {
        throw new AppError("NOT_FOUND", "None of the requested products exist.");
      }
      return {
        productIds: known,
        source: "requested",
        // Named rather than dropped: a desk that silently shrinks is a desk
        // that lies about what it is watching.
        unknownIds: options.productIds.filter((id) => !existing.has(id)),
        profileRows: null,
      };
    }

    const tracked = await this.repo.trackedFor(options.userId);
    if (tracked.length > 0) {
      return { productIds: tracked, source: "tracked", unknownIds: [], profileRows: null };
    }

    const profileRows = await this.repo.productProfiles();
    const chosen = pickStratified(buildProfiles(profileRows));
    return {
      productIds: chosen.map((p) => p.id),
      source: "default",
      unknownIds: [],
      profileRows,
    };
  }

  async desk(options: { userId: string; productIds?: string[]; window?: WindowKey }) {
    const windowKey = options.window ?? DEFAULT_WINDOW;
    const { productIds, source, unknownIds, profileRows } = await this.resolveTracked(options);

    const referenceDate = await this.repo.referenceDate(productIds);
    if (!referenceDate) {
      // No capture anywhere on the desk. Report the shape with nothing in it
      // rather than inventing an anchor and calling every window empty.
      return {
        data: {
          asOf: null,
          source,
          unknownIds,
          window: { key: windowKey, days: 0, label: "", from: null, to: null },
          tracked: [],
          alerts: [],
          portfolio: emptyPortfolio(windowKey),
        },
      };
    }

    const window = resolveWindow(windowKey, referenceDate);

    const [catalogueProfiles, currentPrices, marketplaceCounts, coverage, seriesRows] =
      await Promise.all([
        // Already loaded when the default set was chosen; only the explicit
        // and user-tracked paths still have to pay for it.
        profileRows ?? this.repo.productProfiles(),
        this.analysis.currentPrices(productIds),
        this.repo.marketplaceCounts(productIds),
        this.repo.marketplaceCoverage(productIds),
        this.repo.dailySeriesForProducts(productIds, window.from, window.to),
      ]);

    /**
     * The tier is computed over the WHOLE catalogue even when the desk holds
     * twelve products, because a product's tier depends on how many
     * comparables share its type and price band — a question that cannot be
     * answered from the twelve alone.
     */
    const profiles = new Map<string, Profile>();
    for (const p of buildProfiles(catalogueProfiles)) profiles.set(p.id, p);

    const priceByProduct = new Map(currentPrices.map((p) => [p.productId, p]));
    const countByProduct = new Map(marketplaceCounts.map((m) => [m.productId, m.marketplaceCount]));

    const seriesByProduct = new Map<string, SeriesPoint[]>();
    for (const row of seriesRows) {
      const list = seriesByProduct.get(row.productId) ?? [];
      list.push({ date: row.date, minor: row.minor });
      seriesByProduct.set(row.productId, list);
    }

    const tracked = productIds.map((id) => {
      const profile = profiles.get(id) ?? null;
      const summary = summarise(seriesByProduct.get(id) ?? []);
      const current = priceByProduct.get(id) ?? null;
      return {
        product: {
          id,
          canonicalName: profile?.name ?? id,
          brandName: profile?.brandName ?? null,
          categoryName: profile?.categoryName ?? null,
          productTypeName: profile?.productTypeName ?? null,
        },
        expectedTier: profile?.expectedTier ?? null,
        currentPriceMinor: current?.universalEffectiveMinor ?? null,
        marketplaceCount: countByProduct.get(id) ?? 0,
        observationCount: summary.n,
        capability: summary.capability,
        changeMinor: summary.statistics?.changeMinor ?? null,
        /** Percent, as the rest of the API reports percentages. */
        changePct: summary.statistics?.changePct ?? null,
        withheld: summary.withheld,
      };
    });

    const alerts: DashboardAlert[] = [];
    for (const t of tracked) {
      // A window that carries no direction raises nothing. Firing "no
      // movement" at a product observed once this week would be a statement
      // the data does not support.
      if (t.changePct == null) continue;
      if (t.changePct > -ALERT_THRESHOLD_PCT && t.changePct < ALERT_THRESHOLD_PCT) continue;

      const dropped = t.changePct < 0;
      alerts.push({
        id: `alert_${dropped ? "drop" : "rise"}_${t.product.id}_${window.key}`,
        productId: t.product.id,
        productName: t.product.canonicalName,
        severity: dropped ? "serious" : "good",
        type: dropped ? "price_drop" : "price_rise",
        changePct: t.changePct,
        observationCount: t.observationCount,
        /**
         * The sentence is composed here, with the rule, because it states the
         * evidence the alert rests on. Separating them lets an interface
         * render an alert without saying how many observations produced it.
         */
        message: `${t.product.canonicalName} moved ${Math.abs(t.changePct).toFixed(1)}% ${
          dropped ? "lower" : "higher"
        } across ${window.label.toLowerCase()}, over ${t.observationCount} observations.`,
      });
    }

    // The average is taken only over products whose window carries a
    // direction, and the count of those is reported beside it — an average
    // over four of twelve products is a different claim from one over twelve.
    const directional = tracked.filter((t) => t.changePct != null);
    const avgChangePct = directional.length
      ? round(directional.reduce((sum, t) => sum + t.changePct!, 0) / directional.length, 2)
      : null;

    return {
      data: {
        asOf: referenceDate,
        source,
        unknownIds,
        window,
        tracked,
        alerts,
        portfolio: {
          trackedCount: tracked.length,
          marketplaceCoverage: coverage.covered,
          marketplaceTotal: coverage.total,
          avgChangePct,
          directionalCount: directional.length,
          snapshotCount: tracked.filter((t) => t.capability === "snapshot").length,
          emptyCount: tracked.filter((t) => t.capability === "none").length,
          alertThresholdPct: ALERT_THRESHOLD_PCT,
          windowLabel: window.label,
          windowDays: window.days,
        },
      },
    };
  }
}

function emptyPortfolio(windowKey: WindowKey) {
  return {
    trackedCount: 0,
    marketplaceCoverage: 0,
    marketplaceTotal: 0,
    avgChangePct: null,
    directionalCount: 0,
    snapshotCount: 0,
    emptyCount: 0,
    alertThresholdPct: ALERT_THRESHOLD_PCT,
    windowLabel: "",
    windowDays: 0,
    windowKey,
  };
}
