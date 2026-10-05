import { feeRulesForCategory, netRealisationWithShipping } from "../../lib/fees.js";
import { AppError } from "../../lib/errors.js";
import { pageMeta } from "../../lib/pagination.js";
import { PRICE_BASIS } from "../../lib/priceLadder.js";
import { round, summarise } from "../../lib/series.js";
import { CAPABILITY_NOTE, DEFAULT_WINDOW, resolveWindow, type WindowKey } from "../../lib/windows.js";
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
  private async anchor(productId?: string): Promise<string> {
    const date = await this.repo.referenceDate(productId);
    if (!date) {
      throw new AppError("NOT_FOUND", "No price observations have been captured, so no window can be resolved.");
    }
    return date;
  }

  /* --------------------------------------------------- marketplace summary */

  async productMarketplaces(productId: string) {
    await this.requireProduct(productId);
    const rows = await this.repo.marketplaceSummary(productId);
    const referenceDate = await this.repo.referenceDate(productId);

    /**
     * Commercial context, per platform: the fee rule in force and what the
     * seller banks at the platform's current price.
     *
     * Included here because the comparison screen's whole point is comparing
     * platforms, and "cheapest to the buyer" and "best for the seller" are
     * different rankings — a platform can win on price and lose on net. The
     * browser used to compute this from a bundled fee table; the rule and the
     * arithmetic now both come from the server.
     *
     * Null per row when no fee rule is captured for that platform, which is
     * normal for a store discovered from provider data.
     */
    const categoryId = await this.repo.productCategoryId(productId);
    const feeRules =
      categoryId && referenceDate ? await feeRulesForCategory(this.repo.db, categoryId, referenceDate) : [];
    const feeByMarketplace = new Map(feeRules.map((f) => [f.marketplaceId, f]));

    const [velocities, cheapest, promotions] = await Promise.all([
      this.repo.reviewVelocityForProduct(productId),
      this.repo.cheapestInStockOfferPerMarketplace(productId),
      referenceDate
        ? this.repo.promotions(productId, { page: 1, pageSize: 500, status: "active", asOf: referenceDate })
        : Promise.resolve({ data: [] as Awaited<ReturnType<MarketplaceRepository["promotions"]>>["data"] }),
    ]);
    const velocityByListing = new Map(velocities.map((v) => [v.listingId, v.velocity]));
    const cheapestByMarketplace = new Map(cheapest.map((c) => [c.marketplaceId, c]));
    const promotionsByOffer = new Map<string, typeof promotions.data>();
    for (const promo of promotions.data) {
      const list = promotionsByOffer.get(promo.offerId) ?? [];
      list.push(promo);
      promotionsByOffer.set(promo.offerId, list);
    }

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
        /**
         * The offer behind `currentPrice` — who is selling at it, and what
         * promotions are attached. Null when nothing on this platform was
         * observed in stock, matching `currentPrice`.
         */
        cheapestOffer: (() => {
          const c = cheapestByMarketplace.get(r.marketplaceId);
          if (!c) return null;
          return {
            id: c.offerId,
            effectiveMinor: c.effectiveMinor,
            seller: {
              id: c.sellerId,
              name: c.sellerName,
              type: c.sellerType,
              fulfilment: c.fulfilmentType,
            },
            activePromotions: (promotionsByOffer.get(c.offerId) ?? []).map((p) => ({
              id: p.promotionId,
              type: p.promotionType,
              availabilityClass: p.availabilityClass,
              label: p.label,
              eligibility: p.eligibility,
              discountValueMinor: p.discountValueMinor,
            })),
          };
        })(),
        /** Reviews added per day — the demand proxy, absent sales data. */
        reviewVelocity: velocityByListing.get(r.listingId) ?? null,
        feeRule: feeByMarketplace.get(r.marketplaceId) ?? null,
        /**
         * What the seller banks at this platform's current price.
         *
         * Uses the comparison screen's definition, which treats shipping as a
         * seller cost — see `lib/fees.ts` for why that differs from the
         * recommendation's margin figure and why neither was changed here.
         */
        netRealisation:
          r.currentSellingMinor == null
            ? null
            : netRealisationWithShipping({
                sellingPriceMinor: r.currentSellingMinor,
                shippingFeeMinor: r.minShippingFeeMinor ?? 0,
                feeRule: feeByMarketplace.get(r.marketplaceId) ?? null,
              }),
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

  /**
   * ONE LISTING, for the listing screen.
   *
   * A composite, like `/catalogue` and `/products/:id/analysis`: the screen
   * argues one thing — who competes on this listing and at what price — out of
   * the listing, its platform, its offers, each offer's seller rating and
   * active promotions, and the listing's own review signal. Split across
   * endpoints that is five round trips for one page, and the client would then
   * have to join them by id anyway.
   *
   * It is reached by LISTING id, so the product is resolved from the listing.
   * That is the lookup the frontend previously did against its own bundled
   * listing table, and the reason it needed one.
   */
  async listingDetail(listingId: string) {
    const listing = await this.repo.findListing(listingId);
    if (!listing) throw new AppError("NOT_FOUND", `No listing with id ${listingId}.`);

    const asOf = (await this.repo.referenceDate(listing.productId)) ?? new Date().toISOString().slice(0, 10);

    /**
     * Offers are read unpaginated for one listing, deliberately: a listing
     * carries a handful of sellers, the screen compares all of them against
     * each other, and a page boundary through a comparison is meaningless.
     * Sorted cheapest-first, which is the order the comparison is read in.
     */
    const { data: offers } = await this.repo.listOffers(listing.productId, {
      page: 1,
      pageSize: 200,
      listingId,
      sort: "effective_price_asc",
    });

    const [sellerRatings, promotions, ratings, velocity] = await Promise.all([
      this.repo.latestSellerRatings([...new Set(offers.map((o) => o.sellerId))]),
      this.repo.promotions(listing.productId, {
        page: 1,
        pageSize: 500,
        marketplaceId: listing.marketplaceId,
        status: "active",
        asOf,
      }),
      this.repo.currentRatings(listing.productId),
      this.repo.listingReviewVelocity(listingId),
    ]);

    const ratingBySeller = new Map(sellerRatings.map((r) => [r.sellerId, r]));
    const promotionsByOffer = new Map<string, typeof promotions.data>();
    for (const promo of promotions.data) {
      const list = promotionsByOffer.get(promo.offerId) ?? [];
      list.push(promo);
      promotionsByOffer.set(promo.offerId, list);
    }

    const listingRating = ratings.find((r) => r.listingId === listingId) ?? null;

    return {
      data: {
        listing: {
          id: listing.id,
          externalListingId: listing.externalListingId,
          listingUrl: listing.listingUrl,
          rawTitle: listing.rawTitle,
          marketplaceBrandText: listing.marketplaceBrandText,
          matchStatus: listing.matchStatus,
          matchConfidence: listing.matchConfidence,
          status: listing.listingStatus,
          firstSeenAt: listing.firstSeenAt,
          lastSeenAt: listing.lastSeenAt,
        },
        product: {
          id: listing.productId,
          canonicalName: listing.productName,
          productTypeId: listing.productTypeId,
          categoryId: listing.categoryId,
          brand: { id: listing.brandId, name: listing.brandName },
        },
        marketplace: {
          id: listing.marketplaceId,
          name: listing.marketplaceName,
          domain: listing.marketplaceDomain,
          type: listing.marketplaceType,
          brandColor: listing.brandColor,
          isDiscovered: listing.isDiscovered,
        },
        offers: offers.map((r) => {
          const sellerRating = ratingBySeller.get(r.sellerId) ?? null;
          return {
            id: r.offerId,
            seller: {
              id: r.sellerId,
              name: r.sellerName,
              type: r.sellerType,
              tier: r.sellerTier,
              fulfilment: r.fulfilmentType,
              /**
               * Null for a seller with no rating history — which includes
               * every storefront seller created from provider data. A zero
               * here would read as a terrible seller rather than an unrated
               * one.
               */
              rating: sellerRating?.rating ?? null,
              ratingCount: sellerRating?.ratingCount ?? null,
            },
            condition: r.itemCondition,
            status: r.offerStatus,
            isBuyboxWinner: r.isBuyboxWinner ?? false,
            saleLabel: r.saleLabel,
            observedAt: r.lastObservedAt,
            isInStock: r.isInStock,
            // Null, not zero, when the offer has never been observed.
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
            activePromotions: (promotionsByOffer.get(r.offerId) ?? []).map((p) => ({
              id: p.promotionId,
              type: p.promotionType,
              availabilityClass: p.availabilityClass,
              label: p.label,
              eligibility: p.eligibility,
              discountValueMinor: p.discountValueMinor,
            })),
          };
        }),
        rating: listingRating
          ? {
              average: listingRating.averageRating,
              ratingCount: listingRating.ratingCount,
              reviewCount: listingRating.reviewCount,
              capturedAt: listingRating.capturedAt,
            }
          : null,
        /** Reviews added per day between the two most recent snapshots. */
        reviewVelocity: velocity,
      },
      meta: { referenceDate: asOf, priceBasis: PRICE_BASIS },
    };
  }

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
    const referenceDate = await this.repo.referenceDate(productId);

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

  /**
   * ONE LISTING'S PRICE HISTORY, grouped by the offer that produced it.
   *
   * The screen draws one line per competing seller, so a flat observation list
   * would have to be regrouped by the client — and a paginated one could not be
   * regrouped at all without fetching every page first.
   *
   * Deliberately unpaginated, and bounded by construction: this is one
   * listing's offers over one window, which is a handful of sellers times the
   * capture days in range. The product-scoped endpoint stays paginated, because
   * there the row count scales with the number of platforms.
   */
  async listingPriceHistory(listingId: string, opts: { window?: WindowKey; from?: string; to?: string }) {
    const listing = await this.repo.findListing(listingId);
    if (!listing) throw new AppError("NOT_FOUND", `No listing with id ${listingId}.`);

    /**
     * Anchored on THE LISTING, not its product. A product can be captured
     * today on one platform and seven weeks ago on another, so the product
     * anchor would still empty this window — see listingReferenceDate.
     */
    const referenceDate =
      (await this.repo.listingReferenceDate(listingId)) ?? (await this.anchor(listing.productId));
    const range = this.resolveRange(opts, referenceDate);

    const filters: HistoryFilters = {
      page: 1,
      // One listing's window. Large enough that a long history is never
      // silently truncated, bounded so a bug cannot ask for the whole table.
      pageSize: 5000,
      from: range.from,
      to: range.to,
      listingId,
    };

    const [{ data }, series] = await Promise.all([
      this.repo.observations(listing.productId, filters),
      this.repo.dailySeries(listing.productId, filters),
    ]);

    /**
     * Grouped by offer, each offer's observations oldest-first.
     *
     * The repository returns newest-first, which is right for a paginated
     * table and wrong for a line: a chart drawn from a reversed series runs
     * backwards. Reversing here rather than asking for a second sort order
     * keeps one query behind both readings.
     */
    const byOffer = new Map<
      string,
      { offerId: string; sellerId: string; sellerName: string; observations: typeof data }
    >();
    for (const row of data) {
      const entry =
        byOffer.get(row.offerId) ??
        { offerId: row.offerId, sellerId: row.sellerId, sellerName: row.sellerName, observations: [] };
      entry.observations.push(row);
      byOffer.set(row.offerId, entry);
    }

    const offers = [...byOffer.values()].map((o) => ({
      ...o,
      observations: [...o.observations].reverse(),
    }));

    return {
      data: {
        listing: {
          id: listing.id,
          externalListingId: listing.externalListingId,
          listingUrl: listing.listingUrl,
          rawTitle: listing.rawTitle,
          matchStatus: listing.matchStatus,
          matchConfidence: listing.matchConfidence,
        },
        product: {
          id: listing.productId,
          canonicalName: listing.productName,
          brand: { id: listing.brandId, name: listing.brandName },
        },
        marketplace: {
          id: listing.marketplaceId,
          name: listing.marketplaceName,
          brandColor: listing.brandColor,
          isDiscovered: listing.isDiscovered,
        },
        /** One entry per competing seller — the lines the chart draws. */
        offers,
      },
      summary: summarise(series),
      meta: {
        listingId,
        productId: listing.productId,
        referenceDate,
        window: range.window,
        range: { from: range.from, to: range.to },
        priceBasis: PRICE_BASIS,
        seriesDefinition:
          "One line per offer: every observation captured for that offer in range, oldest first.",
        observationCount: data.length,
        offerCount: offers.length,
      },
    };
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
    const referenceDate = await this.anchor(productId ?? undefined);
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
    const referenceDate = await this.anchor(productId);

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

    /**
     * How many platforms carried the product in each window, and how much of
     * the time it was unbuyable.
     *
     * One query over the widest range, bucketed per window here — a price
     * series collapses each day to its cheapest in-stock offer and so cannot
     * answer either question, and asking per window would be seven queries
     * for one fact.
     */
    const coverageRows = await this.repo.coverageSeries(productId, {
      from: longest.window.from,
      to: longest.window.to,
      marketplaceId: opts.marketplaceId,
    });
    const coverageFor = (from: string, to: string) => {
      const inRange = coverageRows.filter((r) => r.date >= from && r.date <= to);
      const outOfStock = inRange.filter((r) => !r.inStock).length;
      return {
        marketplaceCount: new Set(inRange.map((r) => r.marketplaceId)).size,
        observationRows: inRange.length,
        outOfStockRows: outOfStock,
        outOfStockShare: inRange.length ? round((outOfStock / inRange.length) * 100, 1) : null,
      };
    };

    /**
     * How often this product is captured at all, as the median gap between
     * capture days. A window shorter than the cadence is empty for a reason
     * that is about the pipeline, not the market, and the interface says so.
     */
    const captureDays = [...new Set(coverageRows.map((r) => r.date))].sort();
    const gaps = captureDays
      .slice(1)
      .map((d, i) => (new Date(d).getTime() - new Date(captureDays[i]!).getTime()) / 86_400_000)
      .sort((a, b) => a - b);
    const cadenceDays = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : null;

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
          /**
           * The band, not just the number: "4.1%" means nothing without the
           * thresholds, and every caller would otherwise carry its own copy
           * of them.
           */
          volatilityBand:
            w.statistics?.volatilityPct == null
              ? null
              : w.statistics.volatilityPct < 3
                ? "stable"
                : w.statistics.volatilityPct < 8
                  ? "moderate"
                  : "volatile",
          coverage: coverageFor(w.window.from, w.window.to),
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
      meta: {
        referenceDate,
        priceBasis: PRICE_BASIS,
        marketplaceId: opts.marketplaceId ?? null,
        cadenceDays,
      },
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
    const referenceDate = await this.anchor(productId);
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
    const asOf = await this.anchor(productId);
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

