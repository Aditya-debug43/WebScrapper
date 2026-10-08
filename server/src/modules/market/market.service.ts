import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { clusterCatalogIds, type ProductCluster } from "../../ingestion/cluster.js";
import { FRESHNESS, type SnapshotService } from "../../ingestion/snapshot.service.js";
import { ProviderError, type ProductMarket, type ProductMarketProvider } from "../../ingestion/types.js";
import { distribution, positionOf, segmentByCondition, structure, trend } from "./competition.js";
import type { MarketRepository, PersistedMarket } from "./market.repository.js";

/**
 * OPENING A PRODUCT'S MARKET
 * ==========================
 *
 * The one operation the old architecture could not perform.
 *
 * It could search — a list of different products matching some words — and it
 * could record whichever row a user clicked. What it could not do is answer
 * "who else sells this, and for how much", which is the only question a
 * seller setting a price actually has.
 *
 *   1  IDENTIFY   a search names candidates, each with a catalogue id.
 *   2  CLUSTER    pick the ids that are this product (see `cluster.ts`).
 *   3  OPEN       one call per id returns that id's sellers.
 *   4  PERSIST    merchants, stores, offers, observations, day aggregate.
 *   5  ANALYSE    the distribution, the floor, the position, the trend.
 *
 * COST, STATED PLAINLY: one search call plus one call per catalogue id opened,
 * default four. Measured yield for that spend on live data was ten distinct
 * sellers across five stores where the previous architecture recorded one. The
 * search half is shared through the snapshot cache, so a product opened right
 * after a search pays only for the product calls.
 *
 * WHAT IS NEVER DONE HERE: inventing a seller, inventing a price, inventing a
 * date, or presenting the provider's stated price range as an observed offer.
 * If a product's market cannot be opened, this says so and says why.
 */

/**
 * Every reason the capture came back empty, not just the first.
 *
 * Reporting one failure out of four made a systematic problem look like an
 * isolated one: four ids timing out and one id timing out read identically,
 * and the first is a provider in trouble while the second is one slow page.
 */
function describeFailures(failures: string[]): string {
  if (failures.length === 0) return "No catalogue id could be opened.";
  if (failures.length === 1) return `This product's sellers could not be read: ${failures[0]}`;
  return [
    `None of the ${failures.length} catalogue ids for this product could be read:`,
    ...failures.map((f) => `  - ${f}`),
  ].join("\n");
}

/** Normalised for comparison: "6.1 inches" and "6.1 Inches" are one value. */
const attributeKey = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * SECOND CHECK, ON STRUCTURED EVIDENCE.
 *
 * `clusterCatalogIds` had to work from STORE LISTING titles — whatever each
 * retailer chose to call the thing — and from a model-code pattern. That is
 * enough to separate a WH-1000XM5 from an XM4, and useless for separating an
 * iPhone 15 from an iPhone 15 Plus: they differ by one ordinary English word,
 * which no pattern can tell apart from a retailer's descriptive padding
 * ("Wireless Noise Cancelling Headphones" adds four such words and is still
 * the same product).
 *
 * Measured on the recorded fixtures: clustering "iPhone 15 128GB" admitted
 * the Plus and the Pro, because neither states a capacity that contradicts
 * 128GB and neither carries a model code. Three different phones would have
 * been pooled into one market and priced as one product.
 *
 * The responses just fetched carry something better: the provider's own
 * STRUCTURED ATTRIBUTES — screen size, storage capacity, RAM. An iPhone 15
 * and an iPhone 15 Plus disagree on screen size as a matter of record. So the
 * rule is the same one used everywhere else in this system, applied to
 * structured data instead of prose:
 *
 *   SILENCE IS AGREEMENT. An attribute only one of them states proves
 *   nothing; catalogue coverage is uneven and absence is not disagreement.
 *
 *   A DIFFERENT VALUE IS DISAGREEMENT. An attribute both state, with
 *   different values, means they are different products. No exceptions and
 *   no scoring — this is a fact about the catalogue, not a judgement.
 *
 * The anchor is always kept: it defines the product and cannot disagree with
 * itself.
 */
function verifyAgainstAnchor(
  anchor: ProductMarket,
  markets: ProductMarket[]
): { kept: ProductMarket[]; discarded: Array<{ externalProductId: string; title: string; why: string }> } {
  const anchorAttributes = new Map(anchor.attributes.map((a) => [attributeKey(a.name), attributeKey(a.value)]));

  const kept: ProductMarket[] = [];
  const discarded: Array<{ externalProductId: string; title: string; why: string }> = [];

  for (const market of markets) {
    if (market.externalProductId === anchor.externalProductId) {
      kept.push(market);
      continue;
    }

    const clash = market.attributes
      .map((a) => ({ name: attributeKey(a.name), value: attributeKey(a.value) }))
      .find((a) => anchorAttributes.has(a.name) && anchorAttributes.get(a.name) !== a.value);

    if (clash) {
      discarded.push({
        externalProductId: market.externalProductId,
        title: market.title,
        why: `${clash.name} is "${clash.value}", the anchor's is "${anchorAttributes.get(clash.name)}"`,
      });
      continue;
    }

    kept.push(market);
  }

  return { kept, discarded };
}

/** How many catalogue ids one capture may open. The main cost dial. */
const DEFAULT_CLUSTER_LIMIT = 4;

/**
 * How long an INTERACTIVE capture may spend opening catalogue ids.
 *
 * API Gateway gives an integration 29 seconds and then returns a 503 of its
 * own — one with no error envelope, so the interface cannot even say what
 * went wrong. Meanwhile the server finishes the work and writes a perfectly
 * good market that nobody was told about.
 *
 * 18 seconds leaves room for the search call that preceded this, the writes
 * that follow it, and the round trip. The scheduler passes no deadline at
 * all: it has no gateway in front of it and would rather wait.
 */
const INTERACTIVE_DEADLINE_MS = 18_000;

/** Below this many sellers, the word "market" is doing too much work. */
export const MIN_SELLERS_FOR_MARKET = 3;

export type MarketCaptureResult = {
  productId: string;
  productName: string;
  created: boolean;
  /**
   * The query that led here, kept verbatim.
   *
   * Provenance, not a scheduling input. The product's own refresh query is
   * its catalogue id; what a person typed to find it is a different fact and
   * is recorded against their tracking row rather than against the product.
   */
  query: string;
  /** The ids opened, and what each yielded. */
  catalogIds: Array<{ externalProductId: string; sellers: number; confidence: number; reason: string }>;
  providerCalls: number;
  persisted: PersistedMarket;
  /** Ids the clustering declined, with reasons. A thin market is explainable. */
  rejected: ProductCluster<unknown>["rejected"];
  /** The listing the identification started from, where there was one. */
  anchorUrl: string | null;
};

export class MarketService {
  /**
   * What the competitive capture has cost, this process.
   *
   * Counted here rather than inferred from the snapshot counters, because a
   * market capture spends on a DIFFERENT endpoint — one call per catalogue
   * id, several per product. Left uncounted, the only visible number would
   * have been the search calls, which is the cheaper half and would have
   * understated the spend by roughly fourfold.
   */
  readonly usage = { productCalls: 0, productsOpened: 0, catalogIdFailures: 0 };

  constructor(
    private readonly repo: MarketRepository,
    private readonly snapshots: SnapshotService,
    private readonly provider: ProductMarketProvider
  ) {}

  /* ===================================================== capture: by search */

  /**
   * Identify a product from a search result and open its market.
   *
   * `ref` is the signed reference the search issued. Resolved against the
   * STORED capture rather than trusted from the request, so a client cannot
   * ask for a market around a price nobody offered.
   */
  async captureFromResult(
    ref: string,
    opts: { clusterLimit?: number; force?: boolean; deadlineMs?: number } = {}
  ): Promise<MarketCaptureResult> {
    const resolved = await this.snapshots.resolveResult(ref);
    if (!resolved) {
      throw new AppError("NOT_FOUND", "That search result could not be resolved. Search again and retry.");
    }

    const { offer, query, snapshotOffers } = resolved;
    if (!offer.externalId) {
      /**
       * A row with no catalogue id cannot be opened, and there is no honest
       * fallback: recording the single row would reproduce the exact defect
       * this redesign exists to remove — a "market" of one seller.
       */
      throw new AppError(
        "VALIDATION_FAILED",
        "That result carries no catalogue identity, so its competing sellers cannot be looked up. Pick another result for the same product."
      );
    }

    return this.capture({
      query: query || offer.rawTitle,
      candidates: (snapshotOffers ?? [offer]).map((o) => ({
        title: o.rawTitle,
        priceMinor: o.priceMinor,
        source: o.sourceName,
        externalProductId: o.externalId,
      })),
      anchorExternalProductId: offer.externalId,
      anchorUrl: offer.url,
      clusterLimit: opts.clusterLimit,
      force: opts.force,
      // Somebody clicked a button and is watching a spinner.
      deadlineMs: opts.deadlineMs ?? INTERACTIVE_DEADLINE_MS,
    });
  }

  /**
   * Identify a product from a query alone and open its market.
   *
   * Used by the scheduler, which has a product's own canonical query rather
   * than a user's click. The anchor is then the product's existing primary
   * catalogue id where it has one — so a refresh re-opens the SAME product
   * rather than whatever ranks first today.
   */
  async captureFromQuery(
    query: string,
    opts: {
      anchorExternalProductId?: string | null;
      clusterLimit?: number;
      force?: boolean;
      deadlineMs?: number;
    } = {}
  ): Promise<MarketCaptureResult> {
    const snapshot = await this.snapshots.snapshotFor(query, {
      maxAgeSeconds: opts.force ? FRESHNESS.userRefresh() : FRESHNESS.recommendation(),
    });

    return this.capture({
      query: snapshot.query,
      candidates: snapshot.offers.map((o) => ({
        title: o.rawTitle,
        priceMinor: o.priceMinor,
        source: o.sourceName,
        externalProductId: o.externalId,
      })),
      anchorExternalProductId: opts.anchorExternalProductId ?? null,
      clusterLimit: opts.clusterLimit,
      force: opts.force,
      deadlineMs: opts.deadlineMs,
    });
  }

  /** Re-open a product this system already holds. */
  async refreshProduct(
    productId: string,
    opts: { clusterLimit?: number; force?: boolean; deadlineMs?: number } = {}
  ): Promise<MarketCaptureResult> {
    const product = await this.repo.productById(productId);
    if (!product) throw new AppError("NOT_FOUND", `No product with id ${productId}.`);

    const limit = opts.clusterLimit ?? DEFAULT_CLUSTER_LIMIT;

    /**
     * Prefer the catalogue ids already clustered onto this product over
     * re-running the identification. It is both cheaper — no search call —
     * and more stable: re-identifying from a query every time means a product
     * can drift onto a different catalogue id as rankings move, and its price
     * history would then be a history of two products.
     */
    const known = await this.repo.catalogIdsFor(productId, this.provider.name, limit);
    if (known.length > 0) {
      const fetched = await this.openIds(known, { deadlineMs: opts.deadlineMs });
      if (fetched.markets.length === 0) {
        throw new AppError("MARKET_DATA_UNAVAILABLE", describeFailures(fetched.failures));
      }
      const persisted = await this.repo.persistMarket({
        productId,
        markets: fetched.markets,
        providerCalls: fetched.calls,
      });
      await this.repo.recordCatalogIds(
        productId,
        this.provider.name,
        fetched.markets.map((m, i) => ({
          externalProductId: m.externalProductId,
          title: m.title,
          isPrimary: m.externalProductId === product.external_product_id,
          confidence: i === 0 ? 1 : 0.9,
          sellerCount: m.sellers.length,
        }))
      );
      return {
        productId,
        productName: product.canonical_name,
        created: false,
        query: product.canonical_query ?? product.canonical_name,
        catalogIds: fetched.markets.map((m) => ({
          externalProductId: m.externalProductId,
          sellers: m.sellers.length,
          confidence: 1,
          reason: "already clustered onto this product",
        })),
        providerCalls: fetched.calls,
        persisted,
        rejected: [],
        // A scheduled refresh has no originating listing.
        anchorUrl: null,
      };
    }

    if (!product.canonical_query) {
      throw new AppError(
        "VALIDATION_FAILED",
        "This product has no live market query and no catalogue identity, so its competition cannot be looked up. Track it from a live search result first."
      );
    }

    return this.captureFromQuery(product.canonical_query, {
      anchorExternalProductId: product.external_product_id,
      clusterLimit: limit,
      force: opts.force,
      deadlineMs: opts.deadlineMs,
    });
  }

  /* ----------------------------------------------------------- the core */

  private async capture(input: {
    query: string;
    candidates: Array<{ title: string; priceMinor: number | null; source: string | null; externalProductId: string | null }>;
    anchorExternalProductId: string | null;
    anchorUrl?: string | null;
    clusterLimit?: number;
    /** Skip the freshness short-circuit. A deliberate "read it again now". */
    force?: boolean;
    /** Set when somebody is waiting on the other end of a request. */
    deadlineMs?: number;
  }): Promise<MarketCaptureResult> {
    const limit = input.clusterLimit ?? DEFAULT_CLUSTER_LIMIT;

    const cluster = clusterCatalogIds(input.query, input.candidates, {
      anchorExternalProductId: input.anchorExternalProductId,
      limit,
    });

    if (!cluster) {
      /**
       * Nothing confidently this product. Said plainly, and nothing spent.
       *
       * Both causes read the same way to a caller and neither is an error in
       * this system: the provider returned rows with no catalogue identity,
       * or it returned rows that are not the product — accessories, a
       * neighbouring model, spare parts. Guessing at the best of them is how
       * a capture ends up building a market for a sticker.
       */
      throw new AppError(
        "MARKET_DATA_UNAVAILABLE",
        `Nothing in the market response for "${input.query}" was confidently this product, so no competing sellers were looked up. ` +
          `The response carried ${input.candidates.length} result(s), none of them an unambiguous match.`
      );
    }

    /**
     * IS THIS PRODUCT'S MARKET ALREADY FRESH?
     *
     * Asked after identification and before any spend, because identification
     * is free — it reads a stored snapshot — while opening the market is the
     * expensive half. Without this check, fifty people following the same
     * product on the same afternoon would buy fifty captures of an identical
     * market, which is the single worst cost profile this system could have.
     *
     * The market belongs to the PRODUCT, not to whoever asked for it. So the
     * second asker gets the same stored evidence the first one paid for, and
     * the freshness window is the only thing that decides when it is re-read.
     */
    if (!input.force) {
      const existing = await this.repo.productByExternalId(this.provider.name, cluster.anchor.externalProductId);
      const ageSeconds = existing?.last_captured_at
        ? (Date.now() - new Date(existing.last_captured_at).getTime()) / 1000
        : Infinity;

      if (existing && ageSeconds <= FRESHNESS.recommendation() && (existing.seller_count ?? 0) > 0) {
        return {
          productId: existing.id,
          productName: existing.canonical_name,
          created: false,
          query: input.query,
          catalogIds: [],
          providerCalls: 0,
          persisted: {
            productId: existing.id,
            sellersWritten: existing.seller_count ?? 0,
            observationsWritten: 0,
            marketplacesWritten: existing.marketplace_count ?? 0,
            snapshotWritten: false,
          },
          rejected: [],
          anchorUrl: input.anchorUrl ?? null,
        };
      }
    }

    const fetched = await this.openIds(cluster.members.map((m) => m.externalProductId), {
      deadlineMs: input.deadlineMs,
    });
    if (fetched.markets.length === 0) {
      throw new AppError("MARKET_DATA_UNAVAILABLE", describeFailures(fetched.failures));
    }

    /**
     * The ANCHOR's response defines the product, even when a sibling returned
     * more sellers. Identity and coverage are different jobs: letting the
     * most productive id name the product would mean a product's title and
     * attributes changing between captures depending on which store list was
     * fullest that day.
     */
    const anchorMarket =
      fetched.markets.find((m) => m.externalProductId === cluster.anchor.externalProductId) ?? fetched.markets[0]!;

    /**
     * SECOND CHECK, ON STRUCTURED EVIDENCE — see `verifyAgainstAnchor`.
     *
     * The clustering worked from store listing titles, which cannot separate
     * an iPhone 15 from an iPhone 15 Plus: they differ by one ordinary word.
     * These responses carry the provider's own structured attributes, where
     * the two disagree on screen size as a matter of record.
     *
     * Rejected ids keep their row in `product_catalog_ids` with the reason,
     * so a capture that discarded half of what it fetched is visible rather
     * than looking like a product with few sellers.
     */
    const verified = verifyAgainstAnchor(anchorMarket, fetched.markets);
    for (const discarded of verified.discarded) {
      cluster.rejected.push({
        externalProductId: discarded.externalProductId,
        title: discarded.title,
        reason: `a different product by the provider's own attributes — ${discarded.why}`,
      });
    }

    const product = await this.repo.resolveOrCreateProduct({ market: anchorMarket, searchQuery: input.query });

    /**
     * Yield counts only the ids that SURVIVED verification. An id discarded
     * for being a different product recorded as having yielded three sellers
     * would be re-opened first on the next capture, because the scheduler
     * prefers productive ids — it would pay to fetch the same wrong product
     * every time.
     */
    const yieldById = new Map(verified.kept.map((m) => [m.externalProductId, m.sellers.length]));
    for (const d of verified.discarded) yieldById.set(d.externalProductId, 0);
    await this.repo.recordCatalogIds(
      product.id,
      anchorMarket.provider,
      cluster.members.map((m) => ({
        externalProductId: m.externalProductId,
        title: m.item.title,
        isPrimary: m.externalProductId === cluster.anchor.externalProductId,
        confidence: m.confidence,
        sellerCount: yieldById.get(m.externalProductId) ?? null,
      }))
    );

    const persisted = await this.repo.persistMarket({
      productId: product.id,
      markets: verified.kept,
      providerCalls: fetched.calls,
    });

    return {
      productId: product.id,
      productName: product.canonicalName,
      created: product.created,
      query: input.query,
      catalogIds: cluster.members.map((m) => ({
        externalProductId: m.externalProductId,
        sellers: yieldById.get(m.externalProductId) ?? 0,
        confidence: m.confidence,
        reason: m.reason,
      })),
      providerCalls: fetched.calls,
      persisted,
      rejected: cluster.rejected,
      anchorUrl: input.anchorUrl ?? null,
    };
  }

  /**
   * Open each catalogue id, tolerating individual failures.
   *
   * One id failing must not cost the whole market: four ids were opened to
   * get breadth, and three of four is still a market. The failures are
   * returned rather than swallowed so a systematically failing provider does
   * not look like a product with few sellers.
   */
  private async openIds(
    ids: string[],
    opts: { deadlineMs?: number } = {}
  ): Promise<{ markets: ProductMarket[]; calls: number; failures: string[] }> {
    /**
     * IN PARALLEL, and that is a correctness property, not a micro-optimisation.
     *
     * These calls are independent — each asks a different catalogue id for its
     * own sellers — and running them one after another made the total latency
     * the SUM of them. Measured against production: a single provider call
     * from that host takes about 8 seconds, so a capture of four ids plus the
     * search took 34 seconds. API Gateway gives an integration 29. The user
     * saw a 503 while the server went on working and wrote the market
     * correctly half a minute later: the worst shape a failure can have,
     * because the interface says it failed and the database says it did not.
     *
     * Run together they cost the slowest call rather than all of them.
     *
     * WHAT THIS GIVES UP, deliberately: the sequential version stopped early
     * on a quota or auth error, since one means the rest will fail too. That
     * saving is gone — a capture with a dead key now spends all N attempts.
     * N is four. Paying four doomed calls once, on a misconfiguration that
     * needs fixing anyway, is a far better trade than making every capture
     * four times slower than it needs to be for everyone else.
     */
    /**
     * A DEADLINE FOR THE WHOLE BATCH, when the caller is a waiting request.
     *
     * The per-call timeout cannot do this job. It is 30 seconds — correct for
     * the scheduler, which has nothing in front of it — but API Gateway gives
     * an interactive request 29 in total, so a single slow call can overrun
     * the entire budget on its own and the client gets a 503 from the gateway
     * with no error envelope in it, while the server finishes the work and
     * writes a perfectly good market nobody was told about.
     *
     * So an interactive capture takes what has arrived by its deadline and
     * reports the rest as unanswered. A market of three sellers now is worth
     * more than a market of four the caller never receives. The scheduler
     * passes no deadline and waits for everything.
     */
    const pending = ids.map((id) =>
      this.provider.fetchProduct(id, {
        country: env.MARKET_DATA_COUNTRY,
        currency: env.MARKET_DATA_CURRENCY,
      })
    );

    const settled = await (opts.deadlineMs == null
      ? Promise.allSettled(pending)
      : Promise.all(
          pending.map((p) =>
            Promise.race([
              p.then(
                (value) => ({ status: "fulfilled", value }) as PromiseSettledResult<ProductMarket>,
                (reason) => ({ status: "rejected", reason }) as PromiseSettledResult<ProductMarket>
              ),
              new Promise<PromiseSettledResult<ProductMarket>>((resolve) =>
                setTimeout(
                  () =>
                    resolve({
                      status: "rejected",
                      reason: new ProviderError(
                        this.provider.name,
                        `Did not answer within the ${opts.deadlineMs}ms this request could wait.`,
                        "timeout",
                        true
                      ),
                    }),
                  opts.deadlineMs
                ).unref?.()
              ),
            ])
          )
        ));

    const markets: ProductMarket[] = [];
    const failures: string[] = [];

    settled.forEach((result, i) => {
      this.usage.productCalls++;
      if (result.status === "fulfilled") {
        markets.push(result.value);
        return;
      }
      this.usage.catalogIdFailures++;
      const cause = result.reason;
      const message = cause instanceof ProviderError ? `${cause.kind}: ${cause.message}` : String(cause);
      failures.push(`${ids[i]} — ${message}`);
    });

    if (markets.length > 0) this.usage.productsOpened++;
    /**
     * `calls` counts attempts, not successes: a failed call is still a call
     * the provider charged for, and a cost record that only counted the ones
     * that worked would understate the spend exactly when it mattered most.
     */
    return { markets, calls: settled.length, failures };
  }

  /* ==================================================== reading the market */

  /**
   * A product's competitive picture: who sells it, at what, and where that
   * leaves a seller.
   *
   * Reads stored evidence. It does not call the provider, so opening this
   * screen is free however often it is opened — capture is a separate,
   * scheduled, metered act.
   */
  async marketFor(productId: string, opts: { yourPriceMinor?: number | null } = {}) {
    const product = await this.repo.productById(productId);
    if (!product) throw new AppError("NOT_FOUND", `No product with id ${productId}.`);

    const allOffers = await this.repo.currentMarket(productId);

    /**
     * CONDITION PARTITIONS THE MARKET BEFORE ANY STATISTIC IS TAKEN.
     *
     * Found against live data: a capture for an iPhone returned a renewed
     * unit at Rs 89,999 and a used one at Rs 1,08,399 beside new stock at
     * Rs 1,14,999-1,47,227. Pooled, the market's floor was a refurbished
     * price and its spread was 50%, and the analysis reasoned about "the
     * cheapest seller" as if a new-stock seller could match it. They are not
     * competitors. See `segmentByCondition`.
     */
    const segmented = segmentByCondition(allOffers);
    const offers = segmented?.primary ?? [];

    const dist = distribution(offers);
    const struct = structure(offers);
    const points = await this.repo.marketTrendPoints(productId);
    const movement = trend(points);

    /** Grouped by store, because "which marketplace is cheapest" is a question. */
    const byMarketplace = new Map<string, { marketplaceId: string; marketplaceName: string; sellers: number; lowMinor: number }>();
    for (const o of offers) {
      const entry = byMarketplace.get(o.marketplaceId) ?? {
        marketplaceId: o.marketplaceId,
        marketplaceName: o.marketplaceName,
        sellers: 0,
        lowMinor: o.priceMinor,
      };
      entry.sellers++;
      entry.lowMinor = Math.min(entry.lowMinor, o.priceMinor);
      byMarketplace.set(o.marketplaceId, entry);
    }

    const catalogIds = await this.repo.catalogIdsFor(productId, this.provider.name, 20);

    return {
      product: {
        id: product.id,
        name: product.canonical_name,
        externalProductId: product.external_product_id,
        origin: product.origin,
        specifications: product.specifications ?? {},
        trackerCount: Number(product.tracker_count ?? 0),
        lastCapturedAt: product.last_captured_at,
        /** How many catalogue ids this market was assembled from. */
        catalogIdCount: catalogIds.length,
      },
      /**
       * Stated rather than implied: a market of two sellers is reported as a
       * market of two sellers, not quietly presented as the market.
       */
      sufficient: offers.length >= MIN_SELLERS_FOR_MARKET,

      /**
       * Which condition everything below describes, and what was set aside.
       *
       * Reported rather than dropped: a refurbished market 20% under the new
       * one is real competitive information, and a seller is entitled to see
       * it. It is simply not the market their price is argued from.
       */
      condition: segmented?.primaryCondition ?? null,
      otherConditions: (segmented?.secondary ?? []).map((group) => {
        const groupDist = distribution(group.offers);
        return {
          condition: group.condition,
          sellerCount: group.offers.length,
          lowMinor: groupDist?.lowMinor ?? null,
          medianMinor: groupDist?.medianMinor ?? null,
          highMinor: groupDist?.highMinor ?? null,
        };
      }),
      distribution: dist,
      structure: struct
        ? {
            floorMinor: struct.floorMinor,
            secondFloorMinor: struct.secondFloorMinor,
            floorGapMinor: struct.floorGapMinor,
            atFloorCount: struct.atFloorCount,
            clustering: struct.clustering,
            cheapest: { sellerName: struct.cheapest.sellerName, marketplaceName: struct.cheapest.marketplaceName, priceMinor: struct.cheapest.priceMinor },
            dearest: { sellerName: struct.dearest.sellerName, marketplaceName: struct.dearest.marketplaceName, priceMinor: struct.dearest.priceMinor },
          }
        : null,
      position: opts.yourPriceMinor != null ? positionOf(opts.yourPriceMinor, offers) : null,
      sellers: [...offers].sort((a, b) => a.priceMinor - b.priceMinor),
      marketplaces: [...byMarketplace.values()].sort((a, b) => a.lowMinor - b.lowMinor),
      history: {
        /** Our own captures. There is no provider history to import. */
        points,
        trend: movement,
        /** Said explicitly so no reader mistakes a short series for a flat one. */
        note:
          points.length < 2
            ? "Only one capture so far, so there is no trend yet. History accumulates from this system's own captures; the data provider does not supply a past series."
            : null,
      },
    };
  }

  /** Per-seller series, for showing WHO moved rather than that prices moved. */
  async sellerHistory(productId: string, days = 90) {
    return this.repo.sellerSeries(productId, days);
  }
}
