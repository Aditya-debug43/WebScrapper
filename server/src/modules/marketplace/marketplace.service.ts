import { AppError } from "../../lib/errors.js";
import { pageMeta } from "../../lib/pagination.js";
import { PRICE_BASIS } from "../../lib/priceLadder.js";
import {
  CAPABILITY_NOTE,
  DEFAULT_WINDOW,
  capabilityFor,
  resolveWindow,
  type Capability,
  type WindowKey,
} from "../../lib/windows.js";
import type {
  HistoryFilters,
  MarketplaceRepository,
  OfferFilters,
  Page,
} from "./marketplace.repository.js";

/**
 * Marketplace rules and response shaping.
 *
 * Three responsibilities the repository deliberately does not have:
 *
 *  · deciding that an unknown filter value is a 400 rather than an empty page
 *    — silently returning nothing hides a client bug;
 *  · deciding what a set of observations is allowed to claim — the capability
 *    ladder, which is the difference between "the median is ₹519" and "one
 *    observation, so there is no median";
 *  · deciding what a client may see. Nothing here reaches for a column the
 *    repository did not already name.
 *
 * What it is NOT: a decision layer. It reports what was observed and what
 * follows arithmetically from it. No recommendation, no competitor scoring,
 * no judgement about whether a price is good. Those stay where they are.
 */
export class MarketplaceService {
  constructor(private readonly repo: MarketplaceRepository) {}

  /* ------------------------------------------------------------ guard rails */

  private async requireProduct(productId: string) {
    if (!(await this.repo.productExists(productId))) {
      throw new AppError("NOT_FOUND", `No product with id ${productId}.`);
    }
  }

  /**
   * A marketplace filter must name a marketplace that exists.
   *
   * The error lists the valid ids, because the ids are `mp_amazon_in` rather
   * than `amazon` and a client that guessed wrong deserves to be told what to
   * send instead of receiving a convincing empty page.
   */
  private async requireMarketplace(marketplaceId?: string) {
    if (!marketplaceId) return;
    if (!(await this.repo.exists("marketplaces", marketplaceId))) {
      const known = await this.repo.knownMarketplaceIds();
      throw new AppError("VALIDATION_FAILED", `Unknown marketplace: ${marketplaceId}.`, {
        details: [{ field: "marketplace", message: `expected one of ${known.join(", ")}` }],
      });
    }
  }

  private async requireSeller(sellerId?: string) {
    if (!sellerId) return;
    if (!(await this.repo.exists("sellers", sellerId))) {
      throw new AppError("VALIDATION_FAILED", `Unknown seller: ${sellerId}.`, {
        details: [{ field: "seller", message: "does not exist" }],
      });
    }
  }

  /**
   * The dataset's latest capture day, which every window is measured back
   * from. If the observation table is empty there is no honest anchor, and
   * saying so is better than inventing today's date.
   */
  private async anchor(): Promise<string> {
    const date = await this.repo.referenceDate();
    if (!date) {
      throw new AppError("NOT_FOUND", "No price observations have been captured, so no window can be resolved.");
    }
    return date;
  }

  /* --------------------------------------------------- marketplace summary */

  async productMarketplaces(productId: string) {
    await this.requireProduct(productId);
    const rows = await this.repo.marketplaceSummary(productId);
    const referenceDate = await this.repo.referenceDate();

    return {
      data: rows.map((r) => ({
        marketplace: {
          id: r.marketplaceId,
          name: r.marketplaceName,
          domain: r.websiteDomain,
          type: r.marketplaceType,
          brandColor: r.brandColor,
        },
        listing: {
          id: r.listingId,
          externalListingId: r.externalListingId,
          status: r.listingStatus,
          matchStatus: r.matchStatus,
          matchConfidence: r.matchConfidence,
          lastSeenAt: r.lastSeenAt,
          sourceUrl: r.sourceUrl,
        },
        coverage: {
          listingCount: r.listingCount,
          sellerCount: r.sellerCount,
          offerCount: r.offerCount,
          observedOfferCount: r.observedOfferCount,
          inStockOfferCount: r.inStockOfferCount,
          lastObservedAt: r.lastObservedAt,
        },
        /**
         * Null when nothing on this platform was observed in stock. That is a
         * real state — the product is listed and unavailable — and filling it
         * with the cheapest out-of-stock price would be reporting a price
         * nobody can pay.
         */
        currentPrice:
          r.currentEffectiveMinor == null
            ? null
            : {
                basis: PRICE_BASIS.basis,
                effectiveMinor: r.currentEffectiveMinor,
                landedMinor: r.currentLandedMinor,
                sellingPriceMinor: r.currentSellingMinor,
                mrpMinor: r.mrpMinor,
                shipping: {
                  minMinor: r.minShippingFeeMinor,
                  maxMinor: r.maxShippingFeeMinor,
                  isFree: r.minShippingFeeMinor === 0,
                },
                observedAt: r.lastObservedAt,
              },
        availability: {
          isAvailable: r.inStockOfferCount > 0,
          inStockOfferCount: r.inStockOfferCount,
          observedOfferCount: r.observedOfferCount,
          /** No quantity is exposed: the dataset records stock as a boolean. */
          status: r.observedOfferCount === 0 ? "unobserved" : r.inStockOfferCount > 0 ? "in_stock" : "out_of_stock",
        },
        rating:
          r.averageRating == null && r.ratingCount == null && r.reviewCount == null
            ? null
            : {
                average: r.averageRating,
                ratingCount: r.ratingCount,
                reviewCount: r.reviewCount,
                capturedAt: r.ratingCapturedAt,
              },
      })),
      meta: { productId, referenceDate, priceBasis: PRICE_BASIS },
    };
  }

  /* --------------------------------------------------------------- listings */

  async productListings(productId: string, f: Page & { marketplaceId?: string; status?: string }) {
    await this.requireProduct(productId);
    await this.requireMarketplace(f.marketplaceId);
    const { data, total } = await this.repo.listListings(productId, f);
    return {
      data: data.map((r) => ({
        id: r.listingId,
        productId: r.productId,
        marketplace: { id: r.marketplaceId, name: r.marketplaceName, domain: r.websiteDomain },
        externalListingId: r.externalListingId,
        sourceUrl: r.sourceUrl,
        title: r.rawTitle,
        brandText: r.marketplaceBrandText,
        status: r.listingStatus,
        match: { status: r.matchStatus, confidence: r.matchConfidence },
        marketplaceCategory: r.marketplaceCategoryId
          ? {
              id: r.marketplaceCategoryId,
              externalNodeId: r.marketplaceCategoryNodeId,
              rawPath: r.marketplaceCategoryPath,
              mappedCategoryId: r.mappedCategoryId,
            }
          : null,
        provenance: { firstSeenAt: r.firstSeenAt, lastSeenAt: r.lastSeenAt, lastObservedAt: r.lastObservedAt },
        counts: { offers: r.offerCount, sellers: r.sellerCount },
      })),
      pagination: pageMeta(f.page, f.pageSize, total),
    };
  }

  /* ---------------------------------------------------------------- sellers */

  async productSellers(productId: string, f: Page & { marketplaceId?: string }) {
    await this.requireProduct(productId);
    await this.requireMarketplace(f.marketplaceId);
    const { data, total } = await this.repo.listSellers(productId, f);
    return {
      data: data.map((r) => ({
        id: r.sellerId,
        name: r.sellerName,
        marketplace: { id: r.marketplaceId, name: r.marketplaceName },
        externalSellerId: r.externalSellerId,
        sellerType: r.sellerType,
        sellerTier: r.sellerTier,
        fulfilment: r.defaultFulfilmentType,
        /** Cross-platform identity, where the same merchant sells on several. */
        sellerGroupId: r.sellerGroupId,
        onboardedAt: r.onboardedAt,
        offerCountForProduct: r.offerCountForProduct,
        rating:
          r.currentRating == null && r.currentRatingCount == null
            ? null
            : {
                current: r.currentRating,
                ratingCount: r.currentRatingCount,
                capturedAt: r.ratingCapturedAt,
                snapshotCount: r.ratingSnapshotCount,
              },
      })),
      pagination: pageMeta(f.page, f.pageSize, total),
    };
  }

  async sellerRatingHistory(sellerId: string, f: Page) {
    const seller = await this.repo.findSeller(sellerId);
    if (!seller) throw new AppError("NOT_FOUND", `No seller with id ${sellerId}.`);

    const { data, total } = await this.repo.sellerRatingHistory(sellerId, f);
    const current = data.length ? data[0]! : null;

    return {
      data,
      /**
       * SELLER rating, not product rating. A merchant's service score and a
       * product's review score answer different questions and live in
       * different tables; conflating them would let a good product mask a bad
       * seller.
       */
      meta: {
        sellerId: seller.sellerId,
        sellerName: seller.sellerName,
        marketplace: { id: seller.marketplaceId, name: seller.marketplaceName },
        current: current ? { rating: current.rating, ratingCount: current.ratingCount, capturedAt: current.capturedAt } : null,
        subject: "seller",
      },
      pagination: pageMeta(f.page, f.pageSize, total),
    };
  }

  /* ----------------------------------------------------------------- offers */

  async productOffers(productId: string, f: OfferFilters) {
    await this.requireProduct(productId);
    await this.requireMarketplace(f.marketplaceId);
    await this.requireSeller(f.sellerId);

    if (f.minPriceMinor !== undefined && f.maxPriceMinor !== undefined && f.minPriceMinor > f.maxPriceMinor) {
      throw new AppError("VALIDATION_FAILED", "minPrice cannot be greater than maxPrice.", {
        details: [{ field: "minPrice", message: "must be less than or equal to maxPrice" }],
      });
    }

    const { data, total } = await this.repo.listOffers(productId, f);
    const referenceDate = await this.repo.referenceDate();

    return {
      data: data.map((r) => ({
        id: r.offerId,
        listingId: r.listingId,
        marketplaceId: r.marketplaceId,
        sourceUrl: r.sourceUrl,
        externalListingId: r.externalListingId,
        seller: { id: r.sellerId, name: r.sellerName, type: r.sellerType, tier: r.sellerTier },
        fulfilment: r.fulfilmentType,
        condition: r.itemCondition,
        status: r.offerStatus,
        /**
         * Null when this offer has never been observed. The offer exists in
         * the catalogue; nothing has been captured for it. Reporting zero
         * would be a price.
         */
        price:
          r.universalEffectiveMinor == null
            ? null
            : {
                basis: PRICE_BASIS.basis,
                mrpMinor: r.mrpMinor,
                sellingPriceMinor: r.sellingPriceMinor,
                shippingFeeMinor: r.shippingFeeMinor,
                landedMinor: r.landedMinor,
                universalDiscountMinor: r.universalDiscountMinor,
                universalEffectiveMinor: r.universalEffectiveMinor,
                conditionalDiscountMinor: r.conditionalDiscountMinor,
                conditionalBestMinor: r.conditionalBestMinor,
                deferredBenefitMinor: r.deferredBenefitMinor,
                financingBenefitMinor: r.financingBenefitMinor,
                currencyCode: r.currencyCode,
              },
        availability:
          r.lastObservedAt == null
            ? { status: "unobserved", isInStock: null, observedAt: null }
            : { status: r.isInStock ? "in_stock" : "out_of_stock", isInStock: r.isInStock, observedAt: r.lastObservedAt },
        isBuyboxWinner: r.isBuyboxWinner,
        saleLabel: r.saleLabel,
        activePromotionCount: r.activePromotionCount,
        provenance: { firstSeenAt: r.firstSeenAt, lastObservedAt: r.lastObservedAt, rawDocumentId: r.rawDocumentId },
      })),
      pagination: pageMeta(f.page, f.pageSize, total),
      meta: { productId, referenceDate, priceBasis: PRICE_BASIS },
    };
  }

  /* ---------------------------------------------------------- price history */

  async productPriceHistory(
    productId: string,
    opts: Page & { window?: WindowKey; from?: string; to?: string; marketplaceId?: string; sellerId?: string; offerId?: string }
  ) {
    await this.requireProduct(productId);
    await this.requireMarketplace(opts.marketplaceId);
    await this.requireSeller(opts.sellerId);
    return this.history(productId, opts, { productId });
  }

  async offerPriceHistory(offerId: string, opts: Page & { window?: WindowKey; from?: string; to?: string }) {
    const offer = await this.repo.findOffer(offerId);
    if (!offer) throw new AppError("NOT_FOUND", `No offer with id ${offerId}.`);
    return this.history(null, { ...opts, offerId }, { offer });
  }

  /**
   * One history implementation for both scopes.
   *
   * An explicit `from`/`to` overrides the window, so a caller can ask a
   * question the seven fixed horizons do not cover without a new endpoint.
   * The response always reports the range it actually used — labelling a
   * response "7 days" while querying something else is the specific failure
   * this is written to avoid.
   */
  private async history(
    productId: string | null,
    opts: Page & { window?: WindowKey; from?: string; to?: string; marketplaceId?: string; sellerId?: string; offerId?: string },
    subject: Record<string, unknown>
  ) {
    const referenceDate = await this.anchor();
    const range = this.resolveRange(opts, referenceDate);

    const filters: HistoryFilters = {
      page: opts.page,
      pageSize: opts.pageSize,
      from: range.from,
      to: range.to,
      marketplaceId: opts.marketplaceId,
      sellerId: opts.sellerId,
      offerId: opts.offerId,
    };

    const [{ data, total }, series] = await Promise.all([
      this.repo.observations(productId, filters),
      this.repo.dailySeries(productId, filters),
    ]);

    return {
      data,
      pagination: pageMeta(opts.page, opts.pageSize, total),
      summary: summarise(series),
      meta: {
        ...subject,
        referenceDate,
        window: range.window,
        range: { from: range.from, to: range.to },
        priceBasis: PRICE_BASIS,
        /** Stated, because a statistic over a different series is a different number. */
        seriesDefinition:
          "One point per capture day: the cheapest in-stock effective price observed that day across the offers in scope.",
        observationCount: total,
        seriesPointCount: series.length,
      },
    };
  }

  /**
   * Current state beside historical context, at several horizons at once.
   *
   * Part of the point is the comparison, and asking for it one window at a
   * time is four round trips over the same rows.
   */
  async priceSummary(productId: string, opts: { windows: WindowKey[]; marketplaceId?: string }) {
    await this.requireProduct(productId);
    await this.requireMarketplace(opts.marketplaceId);
    const referenceDate = await this.anchor();

    const windows = await Promise.all(
      opts.windows.map(async (key) => {
        const resolved = resolveWindow(key, referenceDate);
        const series = await this.repo.dailySeries(productId, {
          from: resolved.from,
          to: resolved.to,
          marketplaceId: opts.marketplaceId,
        });
        return { window: resolved, ...summarise(series) };
      })
    );

    /**
     * "Current" is the most recent point of the longest window requested, so
     * a product last captured six weeks ago still reports its current price
     * rather than null just because the 1-day window is empty.
     */
    const longest = windows.reduce((a, b) => (b.window.days > a.window.days ? b : a), windows[0]!);
    const current = longest.last;

    return {
      data: {
        productId,
        current: current
          ? { effectiveMinor: current.minor, observedAt: current.date, basis: PRICE_BASIS.basis }
          : null,
        windows: windows.map((w) => ({
          window: w.window.key,
          label: w.window.label,
          days: w.window.days,
          range: { from: w.window.from, to: w.window.to },
          capability: w.capability,
          capabilityNote: CAPABILITY_NOTE[w.capability],
          observationCount: w.n,
          statistics: w.statistics,
          withheld: w.withheld,
          /**
           * Where the current price sits inside the window's observed range,
           * 0 = the cheapest it was seen, 1 = the dearest. Undefined when the
           * range has no width — every observation identical is not a
           * position, and dividing by it would be a 0/0.
           */
          currentPositionPct:
            current && w.statistics && w.statistics.maxMinor !== w.statistics.minMinor
              ? round((current.minor - w.statistics.minMinor) / (w.statistics.maxMinor - w.statistics.minMinor), 4)
              : null,
        })),
      },
      meta: { referenceDate, priceBasis: PRICE_BASIS, marketplaceId: opts.marketplaceId ?? null },
    };
  }

  private resolveRange(
    opts: { window?: WindowKey; from?: string; to?: string },
    referenceDate: string
  ): { from: string; to: string; window: { key: string; label: string; days: number } | null } {
    if (opts.from || opts.to) {
      const from = opts.from ?? "0001-01-01";
      const to = opts.to ?? referenceDate;
      if (from > to) {
        throw new AppError("VALIDATION_FAILED", "`from` must not be later than `to`.", {
          details: [{ field: "from", message: "must be on or before `to`" }],
        });
      }
      return { from, to, window: null };
    }
    const resolved = resolveWindow(opts.window ?? DEFAULT_WINDOW, referenceDate);
    return {
      from: resolved.from,
      to: resolved.to,
      window: { key: resolved.key, label: resolved.label, days: resolved.days },
    };
  }

  /* ---------------------------------------------------------------- reviews */

  async productReviews(productId: string, f: Page & { marketplaceId?: string }) {
    await this.requireProduct(productId);
    await this.requireMarketplace(f.marketplaceId);
    const { data, total } = await this.repo.reviewSnapshots(productId, f);
    return {
      data,
      pagination: pageMeta(f.page, f.pageSize, total),
      meta: {
        productId,
        /**
         * Snapshots, with their capture dates preserved. Where a listing has
         * only one, that is one snapshot — no trend is computed from it and
         * none is implied.
         */
        subject: "product",
        note: "Review and rating figures are captured snapshots per listing. A single snapshot supports a level, not a trend.",
      },
    };
  }

  async productRatingHistory(productId: string, opts: { marketplaceId?: string; window?: WindowKey; from?: string; to?: string }) {
    await this.requireProduct(productId);
    await this.requireMarketplace(opts.marketplaceId);
    const referenceDate = await this.anchor();
    const range = this.resolveRange(opts, referenceDate);

    // Snapshots are few per listing, so the whole range is returned rather
    // than paginated — there is no page of 355,000 here.
    const { data } = await this.repo.reviewSnapshots(productId, {
      page: 1,
      pageSize: 1000,
      marketplaceId: opts.marketplaceId,
    });
    const inRange = data.filter((r) => r.capturedAt >= range.from && r.capturedAt <= range.to);

    const byMarketplace = new Map<string, typeof inRange>();
    for (const row of inRange) {
      const bucket = byMarketplace.get(row.marketplaceId) ?? [];
      bucket.push(row);
      byMarketplace.set(row.marketplaceId, bucket);
    }

    return {
      data: [...byMarketplace.entries()].map(([marketplaceId, points]) => {
        const ordered = [...points].sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : 1));
        const first = ordered[0]!;
        const last = ordered[ordered.length - 1]!;
        const enough = ordered.length >= 2;
        return {
          marketplaceId,
          marketplaceName: first.marketplaceName,
          snapshotCount: ordered.length,
          points: ordered.map((p) => ({
            capturedAt: p.capturedAt,
            averageRating: p.averageRating,
            ratingCount: p.ratingCount,
            reviewCount: p.reviewCount,
          })),
          /**
           * Only computed from two real snapshots. One snapshot is a level;
           * inventing a trend from it would be inventing review growth that
           * was never observed.
           */
          trend: enough
            ? {
                ratingChange:
                  first.averageRating != null && last.averageRating != null
                    ? round(last.averageRating - first.averageRating, 3)
                    : null,
                reviewCountChange:
                  first.reviewCount != null && last.reviewCount != null ? last.reviewCount - first.reviewCount : null,
                fromCapturedAt: first.capturedAt,
                toCapturedAt: last.capturedAt,
              }
            : null,
          withheld: enough ? [] : [{ metric: "trend", reason: "Fewer than two snapshots in this range." }],
        };
      }),
      meta: { productId, referenceDate, window: range.window, range: { from: range.from, to: range.to }, subject: "product" },
    };
  }

  /* ------------------------------------------------------------- promotions */

  async productPromotions(
    productId: string,
    f: Page & { marketplaceId?: string; offerId?: string; availabilityClass?: string; status?: "active" | "expired" | "all" }
  ) {
    await this.requireProduct(productId);
    await this.requireMarketplace(f.marketplaceId);
    const asOf = await this.anchor();
    const { data, total } = await this.repo.promotions(productId, { ...f, asOf });

    return {
      data,
      pagination: pageMeta(f.page, f.pageSize, total),
      meta: {
        productId,
        /** Activity is judged against the dataset's capture date, not the clock. */
        asOf,
        priceBasis: PRICE_BASIS,
        availabilityClasses: {
          universal: "Every buyer receives it automatically. The only class that moves the comparison price.",
          conditional: "Card, coupon, exchange or membership. Real for some buyers, never comparable across sellers.",
          deferred: "Cashback or wallet credit returned later. Never a price.",
          financing: "Interest absorbed on an instalment plan. Never a price.",
        },
      },
    };
  }
}

/* ----------------------------------------------------------- statistics */

type SeriesPoint = { date: string; minor: number };

type Summary = {
  n: number;
  capability: Capability;
  first: SeriesPoint | null;
  last: SeriesPoint | null;
  statistics: {
    minMinor: number;
    maxMinor: number;
    spreadMinor: number;
    medianMinor: number | null;
    meanMinor: number | null;
    q1Minor: number | null;
    q3Minor: number | null;
    iqrMinor: number | null;
    changeMinor: number | null;
    changePct: number | null;
    volatilityPct: number | null;
  } | null;
  withheld: Array<{ metric: string; reason: string }>;
};

/**
 * What a window of observations supports — and, explicitly, what it does not.
 *
 * The thresholds are the same ones the frontend analysis uses, for the same
 * reason: a median over three points is arithmetic, not evidence, and a
 * coefficient of variation over three points describes the sampling rather
 * than the market. Every statistic that is withheld says why, so the
 * interface can explain a gap instead of leaving one.
 *
 * The median is the linear-interpolated percentile — the same definition as
 * `percentile()` in the frontend engine, and the same one PostgreSQL's
 * `percentile_cont` implements. Computed here rather than in SQL so that a
 * single function produces every statistic from a single series.
 */
function summarise(series: SeriesPoint[]): Summary {
  const n = series.length;
  const capability = capabilityFor(n);
  const withheld: Array<{ metric: string; reason: string }> = [];

  if (n === 0) {
    return {
      n: 0,
      capability,
      first: null,
      last: null,
      statistics: null,
      withheld: [
        { metric: "all", reason: "No observations were captured inside this range." },
      ],
    };
  }

  const ordered = [...series].sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  const values = [...series.map((p) => p.minor)].sort((a, b) => a - b);

  const minMinor = values[0]!;
  const maxMinor = values[values.length - 1]!;

  const directional = n >= 2;
  const distributional = n >= 5;

  if (!directional) {
    withheld.push({ metric: "change", reason: "One observation carries a level, not a movement." });
  }
  if (!distributional) {
    withheld.push({ metric: "median", reason: "Fewer than five observations; a median here would describe the sampling." });
    withheld.push({ metric: "volatility", reason: "Fewer than five observations; a coefficient of variation would not be meaningful." });
    withheld.push({ metric: "quartiles", reason: "Fewer than five observations." });
  }

  const mean = values.reduce((s, v) => s + v, 0) / n;
  const changeMinor = directional ? last.minor - first.minor : null;

  return {
    n,
    capability,
    first,
    last,
    statistics: {
      minMinor,
      maxMinor,
      spreadMinor: maxMinor - minMinor,
      medianMinor: distributional ? Math.round(percentile(values, 0.5)) : null,
      meanMinor: directional ? Math.round(mean) : null,
      q1Minor: distributional ? Math.round(percentile(values, 0.25)) : null,
      q3Minor: distributional ? Math.round(percentile(values, 0.75)) : null,
      iqrMinor: distributional ? Math.round(percentile(values, 0.75) - percentile(values, 0.25)) : null,
      changeMinor,
      changePct: changeMinor != null && first.minor !== 0 ? round((changeMinor / first.minor) * 100, 2) : null,
      volatilityPct: distributional && mean !== 0 ? round((stdev(values, mean) / mean) * 100, 2) : null,
    },
    withheld,
  };
}

/** Linear interpolation between order statistics — R-7 / `percentile_cont`. */
function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/** Population standard deviation — these are all the observations there are. */
function stdev(values: number[], mean: number): number {
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
