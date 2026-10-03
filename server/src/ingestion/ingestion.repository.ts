import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import {
  brands,
  captureRuns,
  listings,
  marketplaces,
  offers,
  priceObservations,
  products,
  rawDocuments,
  rejectedRecords,
  sellers,
} from "../db/schema.js";
import type { MatchCandidate } from "./matching.js";

/**
 * PERSISTENCE FOR INGESTED MARKET DATA
 * ====================================
 *
 * Writes into tables that already existed and had no producer: `capture_runs`,
 * `raw_documents`, `rejected_records`, and the Listing → Offer → Observation
 * chain the rest of the system already reads. Nothing here is a new concept;
 * it is the missing half of an existing design.
 *
 * Two properties it has to hold, both load-bearing:
 *
 *   IDEMPOTENT   ingesting the same query twice on the same day must produce
 *                the same rows, not duplicates. Every identifier below is
 *                derived deterministically from the data rather than
 *                generated, and `price_observations` has a unique index on
 *                (offer, date) that makes a repeat a no-op.
 *
 *   REVERSIBLE   every row carries the capture run that produced it, so a
 *                bad parser version can be identified after the fact instead
 *                of being discovered as "the numbers look odd".
 */

/** A stable id from stable inputs, so re-ingestion updates instead of duplicating. */
function derivedId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha1").update(parts.join("\u0000")).digest("hex").slice(0, 24);
  return `${prefix}_${digest}`;
}

/** "Vijay Sales" → "vijay-sales", for a domain-ish slug and a stable id. */
function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

export type ResolvedMarketplace = { id: string; name: string; isDiscovered: boolean };

export class IngestionRepository {
  constructor(private readonly db: Db) {}

  /* ------------------------------------------------------------ freshness */

  /**
   * The most recent successful capture of this query, if any.
   *
   * This is what stops a page refresh from costing a provider request. The
   * service compares `startedAt` against the TTL; the decision is not made
   * here because "how stale is too stale" is policy, not storage.
   */
  async lastSuccessfulRun(provider: string, query: string, notBefore: Date) {
    const [row] = await this.db
      .select({ id: captureRuns.id, startedAt: captureRuns.startedAt, finishedAt: captureRuns.finishedAt })
      .from(captureRuns)
      .where(
        and(
          eq(captureRuns.provider, provider),
          eq(captureRuns.sourceQuery, query),
          inArray(captureRuns.runStatus, ["success", "partial"]),
          gte(captureRuns.startedAt, notBefore)
        )
      )
      .orderBy(desc(captureRuns.startedAt))
      .limit(1);
    return row ?? null;
  }

  /* ---------------------------------------------------------- capture run */

  async openRun(input: { provider: string; query: string; parserVersion: string }): Promise<string> {
    const id = `run_${randomUUID()}`;
    await this.db.insert(captureRuns).values({
      id,
      // Deliberately null: one provider call spans many stores. See the
      // column comment in schema.ts.
      marketplaceId: null,
      provider: input.provider,
      sourceQuery: input.query,
      startedAt: new Date(),
      runStatus: "failed", // until proven otherwise — a crash leaves it honest
      parserVersion: input.parserVersion,
      pagesAttempted: 1,
      pagesSucceeded: 0,
    });
    return id;
  }

  async closeRun(
    id: string,
    input: { runStatus: "success" | "partial" | "failed"; pagesSucceeded: number; notes: string }
  ) {
    await this.db
      .update(captureRuns)
      .set({
        finishedAt: new Date(),
        runStatus: input.runStatus,
        pagesSucceeded: input.pagesSucceeded,
        // Bounded: notes is diagnostic, not an audit log, and an enormous
        // provider error should not make the row unreadable.
        notes: input.notes.slice(0, 2000),
      })
      .where(eq(captureRuns.id, id));
  }

  /* -------------------------------------------------------- raw documents */

  /**
   * The provider's own response, kept.
   *
   * `storage_path` is a path by design, not a blob column — the schema was
   * built for retained HTML under a shorter retention policy than the derived
   * facts. Until an object store is configured, the JSON lives inline and the
   * path records where it would be; the content hash is what makes a
   * re-ingestion of an identical response detectable either way.
   */
  async recordRawDocument(input: {
    captureRunId: string;
    sourceUrl: string;
    body: unknown;
    fetchedAt: Date;
  }): Promise<string> {
    const serialised = JSON.stringify(input.body ?? null);
    const contentHash = createHash("sha256").update(serialised).digest("hex");
    const id = derivedId("rawdoc", input.captureRunId, contentHash);
    await this.db
      .insert(rawDocuments)
      .values({
        id,
        captureRunId: input.captureRunId,
        sourceUrl: input.sourceUrl,
        httpStatus: 200,
        fetchedAt: input.fetchedAt,
        contentHash,
        storagePath: `market-data/${input.captureRunId}/${contentHash}.json`,
      })
      .onConflictDoNothing();
    return id;
  }

  /**
   * Something arrived that could not be used. Kept with its reason.
   *
   * A rejects table turns silent attrition into a report — if matching starts
   * failing after a provider changes its title format, this is where it shows
   * up, rather than in a gradual and unexplained drop in competitor counts.
   */
  async recordRejection(input: { rawDocumentId: string | null; targetEntity: string; reason: string }) {
    await this.db.insert(rejectedRecords).values({
      id: `rej_${randomUUID()}`,
      rawDocumentId: input.rawDocumentId,
      targetEntity: input.targetEntity,
      rejectionReason: input.reason.slice(0, 1000),
      capturedAt: new Date(),
    });
  }

  /* ----------------------------------------------------------- resolution */

  /**
   * A store name from a provider to a marketplace row.
   *
   * Tries the curated six first, by name and by domain, so "Flipkart" from
   * Google Shopping lands on `mp_flipkart` and inherits its fee rules and
   * category affinities rather than becoming a duplicate. Anything else is
   * created with `is_discovered = true`, which keeps it out of every existing
   * query until something deliberately asks for it.
   */
  async resolveMarketplace(sourceName: string): Promise<ResolvedMarketplace> {
    const slug = slugify(sourceName);
    const [existing] = await this.db
      .select({ id: marketplaces.id, name: marketplaces.name, isDiscovered: marketplaces.isDiscovered })
      .from(marketplaces)
      .where(
        sql`lower(${marketplaces.name}) = ${sourceName.toLowerCase()}
            or lower(${marketplaces.websiteDomain}) like ${`${slug}.%`}
            or ${marketplaces.id} = ${`mp_${slug.replace(/-/g, "_")}`}`
      )
      .limit(1);
    if (existing) return existing;

    const row = {
      id: derivedId("mp_disc", slug),
      name: sourceName.slice(0, 120),
      countryCode: "IN",
      defaultCurrency: "INR",
      websiteDomain: `${slug}.unknown`,
      isActive: true,
      brandColor: null,
      // Honest: we do not know what kind of store this is, and borrowing a
      // curated type would state something false in a displayed column.
      marketplaceType: "unclassified" as const,
      categoryAffinity: [],
      isDiscovered: true,
    };
    await this.db.insert(marketplaces).values(row).onConflictDoNothing();
    return { id: row.id, name: row.name, isDiscovered: true };
  }

  /**
   * The storefront seller for a store.
   *
   * Google Shopping reports "Flipkart ₹23,499" — the STORE and the price, not
   * which of Flipkart's sellers is behind it. This project models sellers
   * separately and correctly, so rather than inventing one, every offer from
   * a given store is attributed to a single seller explicitly named as the
   * storefront. The limitation of the source is recorded in the data, where
   * anyone reading it can see it, instead of being hidden by a plausible
   * fabricated seller name.
   */
  async resolveStorefrontSeller(marketplaceId: string, storeName: string): Promise<string> {
    const externalSellerId = "storefront";
    const [existing] = await this.db
      .select({ id: sellers.id })
      .from(sellers)
      .where(and(eq(sellers.marketplaceId, marketplaceId), eq(sellers.externalSellerId, externalSellerId)))
      .limit(1);
    if (existing) return existing.id;

    const id = derivedId("seller_sf", marketplaceId);
    await this.db
      .insert(sellers)
      .values({
        id,
        marketplaceId,
        externalSellerId,
        name: `${storeName} (storefront)`,
        sellerType: "marketplace_owned",
        // Accurate rather than approximate: a store shipping its own orders
        // is not enrolled in any marketplace fulfilment programme.
        defaultFulfilmentType: "self_ship",
        sellerTier: null,
        onboardedAt: null,
      })
      .onConflictDoNothing();
    return id;
  }

  /* ---------------------------------------------- match candidate loading */

  /**
   * Candidate products for matching.
   *
   * Only purchasable rows: a family node such as "Samsung Galaxy M14 5G"
   * exists to group variants and cannot itself be the thing a store is
   * selling, so offering it as a match target would invite exactly the
   * wrong-variant error the matcher is built to avoid.
   *
   * Loaded once per ingestion and reused for every offer in the batch — the
   * catalogue is small enough (about 1,200 rows) that one query beats a query
   * per offer by a wide margin.
   */
  async loadMatchCandidates(): Promise<MatchCandidate[]> {
    const rows = await this.db
      .select({
        productId: products.id,
        canonicalName: products.canonicalName,
        modelName: products.modelName,
        brandName: brands.name,
        brandAliases: brands.aliasNames,
        specifications: products.specifications,
        variantAxes: products.variantAxes,
      })
      .from(products)
      .innerJoin(brands, eq(products.brandId, brands.id))
      .where(eq(products.isPurchasable, true));

    return rows.map((r) => ({
      productId: r.productId,
      canonicalName: r.canonicalName,
      modelName: r.modelName,
      brandName: r.brandName,
      brandAliases: r.brandAliases ?? [],
      specifications: r.specifications ?? null,
      variantAxes: r.variantAxes ?? null,
    }));
  }

  /* ------------------------------------------- listing / offer / observation */

  /**
   * The listing for a matched offer, created or refreshed.
   *
   * ── Which key is the natural one ──────────────────────────────────────
   * `listings` carries TWO unique constraints, and they disagree about what
   * identifies a row:
   *
   *   (marketplace_id, external_listing_id)   the platform's own id
   *   (product_id, marketplace_id)            "one listing per product per
   *                                            marketplace" — the invariant
   *                                            the rest of the system reads
   *
   * The second is the one that governs here. A provider's id for a Flipkart
   * page need not be the id already stored against that product — Google
   * Shopping's `product_id` is Google's, not Flipkart's — so keying on the
   * external id would file a SECOND Flipkart listing for a product that
   * already has one, quietly doubling that marketplace's weight in every
   * competitive calculation downstream.
   *
   * So: find by product and marketplace, update if present, insert if not.
   *
   * Returns null when the insert collides on the OTHER constraint, which
   * means the provider's external id is already in use by a different
   * product on that marketplace. That is a genuine conflict rather than a
   * duplicate, and the caller records it instead of resolving it by guess.
   */
  async upsertListing(input: {
    productId: string;
    marketplaceId: string;
    externalListingId: string | null;
    url: string | null;
    rawTitle: string;
    matchConfidence: number;
    observedOn: string;
  }): Promise<string | null> {
    const [existing] = await this.db
      .select({ id: listings.id, matchStatus: listings.matchStatus })
      .from(listings)
      .where(and(eq(listings.productId, input.productId), eq(listings.marketplaceId, input.marketplaceId)))
      .limit(1);

    if (existing) {
      /**
       * A human confirmation is never overwritten by a machine. Someone
       * looked at this listing and said what it is; a later auto-match at
       * 0.86 does not get to overrule that, and silently doing so would make
       * human review pointless. `last_seen_at` still advances — the listing
       * WAS seen, and that fact is not in dispute.
       */
      if (existing.matchStatus === "human_confirmed") {
        await this.db.update(listings).set({ lastSeenAt: input.observedOn }).where(eq(listings.id, existing.id));
      } else {
        await this.db
          .update(listings)
          .set({
            lastSeenAt: input.observedOn,
            rawTitle: input.rawTitle,
            listingUrl: input.url,
            matchStatus: "auto_matched",
            matchConfidence: input.matchConfidence,
          })
          .where(eq(listings.id, existing.id));
      }
      return existing.id;
    }

    /**
     * `external_listing_id` is NOT NULL and a provider does not always supply
     * one, so it is derived from the offer URL when present and the title
     * otherwise. Derived rather than random: a re-ingestion must land on the
     * same value, or it would insert a twin on the next run.
     */
    const externalListingId =
      input.externalListingId ?? derivedId("ext", input.marketplaceId, input.url ?? input.rawTitle);

    const inserted = await this.db
      .insert(listings)
      .values({
        id: derivedId("lst", input.productId, input.marketplaceId),
        productId: input.productId,
        marketplaceId: input.marketplaceId,
        externalListingId,
        listingUrl: input.url,
        rawTitle: input.rawTitle,
        matchStatus: "auto_matched",
        matchConfidence: input.matchConfidence,
        listingStatus: "active",
        firstSeenAt: input.observedOn,
        lastSeenAt: input.observedOn,
      })
      .onConflictDoNothing()
      .returning({ id: listings.id });

    return inserted[0]?.id ?? null;
  }

  async upsertOffer(input: {
    listingId: string;
    sellerId: string;
    condition: "new" | "renewed" | "used";
    observedOn: string;
  }): Promise<string> {
    const id = derivedId("off", input.listingId, input.sellerId, input.condition);
    await this.db
      .insert(offers)
      .values({
        id,
        listingId: input.listingId,
        sellerId: input.sellerId,
        itemCondition: input.condition,
        offerStatus: "active",
        firstSeenAt: input.observedOn,
      })
      .onConflictDoNothing({ target: [offers.listingId, offers.sellerId, offers.itemCondition] });
    return id;
  }

  /**
   * One observation per offer per day.
   *
   * `price_observations` is append-only by design — a correction is a later
   * row, never an UPDATE — and carries a unique index on (offer, date). Two
   * captures on the same day therefore keep the first, which is the right
   * reading of "what did this cost today" and makes a retry harmless.
   */
  async recordObservation(input: {
    offerId: string;
    observedOn: string;
    mrpMinor: number | null;
    sellingPriceMinor: number;
    shippingFeeMinor: number;
    currencyCode: string;
    isInStock: boolean;
    rawDocumentId: string;
    parserVersion: string;
  }): Promise<boolean> {
    const inserted = await this.db
      .insert(priceObservations)
      .values({
        id: derivedId("obs", input.offerId, input.observedOn),
        offerId: input.offerId,
        observedAt: input.observedOn,
        recordedAt: new Date(),
        mrpMinor: input.mrpMinor,
        sellingPriceMinor: input.sellingPriceMinor,
        shippingFeeMinor: input.shippingFeeMinor,
        currencyCode: input.currencyCode,
        isInStock: input.isInStock,
        // Computed from the data elsewhere, never asserted at ingestion time.
        isBuyboxWinner: false,
        rawDocumentId: input.rawDocumentId,
        parserVersion: input.parserVersion,
      })
      .onConflictDoNothing({ target: [priceObservations.offerId, priceObservations.observedAt] })
      .returning({ id: priceObservations.id });
    return inserted.length > 0;
  }
}
