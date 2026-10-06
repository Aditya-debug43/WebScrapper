import {
  pgTable,
  pgEnum,
  text,
  integer,
  smallint,
  boolean,
  date,
  timestamp,
  jsonb,
  real,
  uuid,
  index,
  uniqueIndex,
  primaryKey,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * MULYA — RELATIONAL SCHEMA
 * =========================
 *
 * The entity chain this whole product is built on is preserved literally:
 *
 *   PRODUCT      the real-world thing, independent of where it is sold
 *     ↓
 *   LISTING      one marketplace's page for that product
 *     ↓
 *   OFFER        one seller's commercial offer on that listing
 *     ↓
 *   PRICE OBSERVATION   that offer's state on one capture day, append-only
 *
 * Three conventions carried over from the application and enforced here:
 *
 * 1. MONEY IS INTEGER MINOR UNITS (paise), in columns named `*_minor`. The
 *    dearest item in the catalogue is ₹22,490 — 2,249,000 paise — which is four
 *    orders of magnitude inside `integer`, so `bigint` would be false caution.
 *    Nothing is ever stored as a float.
 *
 * 2. OBSERVATIONS ARE BITEMPORAL AND APPEND-ONLY. `observed_at` is when the
 *    market was in this state; `recorded_at` is when we learned it. A
 *    correction is a new row, never an UPDATE, which is what
 *    `unique(offer_id, observed_at)` protects.
 *
 * 3. EXTERNAL IDENTIFIERS ARE MARKETPLACE-SCOPED. An ASIN is unique on Amazon,
 *    not across the internet. Every external id is therefore unique only in
 *    composite with its marketplace.
 *
 * Primary keys are the dataset's existing human-readable string ids
 * (`prod_dove_hair_fall`). They are stable and globally unique already, the
 * frontend keys everything by them, and they make production debugging far
 * easier than opaque UUIDs. Correct uniqueness is expressed through composite
 * constraints rather than by discarding them.
 */

/* ========================================================================== */
/* Enumerations                                                                */
/* ========================================================================== */

/**
 * Closed sets are database enums so an invalid value is rejected at write time
 * rather than trusted. Several currently hold one value in the dataset
 * (`active`); the full realistic domain is declared anyway, because these are
 * lifecycle fields that will take the other values as soon as ingestion is real
 * — and widening a live enum is more disruptive than declaring it once.
 */
export const lifecycleStatusEnum = pgEnum("lifecycle_status", ["active", "discontinued", "unreleased"]);
export const brandTierEnum = pgEnum("brand_tier", ["value", "mid", "premium"]);
export const matchStatusEnum = pgEnum("match_status", ["auto_matched", "human_confirmed", "unmatched"]);
export const listingStatusEnum = pgEnum("listing_status", ["active", "delisted", "suppressed"]);
export const sellerTypeEnum = pgEnum("seller_type", ["marketplace_owned", "third_party", "brand_direct"]);
export const fulfilmentTypeEnum = pgEnum("fulfilment_type", [
  "fba",
  "flipkart_assured",
  "amazon_easy_ship",
  "meesho_fulfilled",
  "myntra_fulfilled",
  "nykaa_fulfilled",
  "ajio_fulfilled",
  "self_ship",
]);
export const sellerTierEnum = pgEnum("seller_tier", ["anchor", "established", "small"]);
export const itemConditionEnum = pgEnum("item_condition", ["new", "renewed", "used"]);
export const offerStatusEnum = pgEnum("offer_status", ["active", "inactive"]);
export const promotionTypeEnum = pgEnum("promotion_type", [
  "instant_discount",
  "marketplace_campaign",
  "coupon",
  "bank_offer",
  "exchange",
  "cashback",
  "no_cost_emi",
]);

/**
 * The single most load-bearing enum in the system. Only a `universal`
 * promotion moves the price every buyer pays, and therefore only a universal
 * promotion may enter a competitiveness comparison. In the frontend this is
 * derived by `classOf(promotionType)`; here it is a stored, constrained column
 * so the rule lives in the schema rather than in whichever consumer remembers
 * to apply it.
 */
export const availabilityClassEnum = pgEnum("availability_class", [
  "universal",
  "conditional",
  "deferred",
  "financing",
]);

export const marketplaceTypeEnum = pgEnum("marketplace_type", [
  "horizontal",
  "value_horizontal",
  "fashion_vertical",
  "beauty_vertical",
  /**
   * A store discovered inside a data provider's response rather than modelled
   * in advance — Croma, Vijay Sales, a brand's own site.
   *
   * Added because none of the four above is TRUE of such a store, and this
   * column is displayed. Calling Croma "horizontal" would put a wrong fact on
   * screen to avoid one additive enum value, which is the worse trade. Every
   * existing row keeps its value; nothing branches on this column.
   */
  "unclassified",
]);
export const mappedByEnum = pgEnum("mapped_by", ["rule", "model", "human"]);
export const attributeDataTypeEnum = pgEnum("attribute_data_type", ["integer", "decimal", "boolean", "text"]);
export const filterTypeEnum = pgEnum("filter_type", ["range", "enum", "boolean"]);
export const runStatusEnum = pgEnum("run_status", ["success", "partial", "failed"]);

/** Where a row came from. See migration 0008 — a seeded product may already
 * carry genuine observations, so provenance has to be recorded explicitly
 * rather than inferred. */
export const rowOriginEnum = pgEnum("row_origin", ["seed", "live", "manual"]);
export const trackingStatusEnum = pgEnum("tracking_status", ["active", "paused"]);


/* ========================================================================== */
/* Identity                                                                    */
/* ========================================================================== */

/**
 * THE APPLICATION USER — not a marketplace seller.
 *
 * These are two entirely different things and the schema keeps them apart:
 * `users` is a person logging in to this product; `sellers` is a merchant
 * observed on Amazon or Flipkart. They share no key and no table.
 *
 * Deliberately minimal. Email is the identity, there is no password column at
 * all — authentication is a one-time code to that address — and there are no
 * roles, organisations or permissions, because none of those exist as product
 * concepts yet and a column that encodes an unmade decision is worse than no
 * column.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Always stored normalised (trimmed, lower-cased) — see lib/email.ts. */
    email: text("email").notNull(),
    /**
     * Argon2id digest. NEVER a password, never a reversible encoding, never
     * returned by any endpoint.
     *
     * Nullable for one reason only: accounts that predate password
     * authentication have none, and inventing one for them would be worse
     * than recording the absence. `login` refuses a null hash outright and
     * directs those users through password reset. Registration always sets it.
     */
    passwordHash: text("password_hash"),
    displayName: text("display_name"),
    /** Set the first time an OTP for this address is successfully verified. */
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // On lower(email), not on email. The application normalises before writing,
    // but uniqueness that depends on every caller remembering to normalise is
    // not uniqueness — this makes "Ada@x.com" and "ada@x.com" the same row at
    // the database level.
    uniqueIndex("users_email_lower_key").on(sql`lower(${t.email})`),
  ]
);

/**
 * An outstanding one-time code.
 *
 * Keyed by EMAIL rather than by user, because the whole point is that the
 * account may not exist yet: the first successful verification is what creates
 * it. Only a hash of the code is stored — see lib/otp.ts for why it is an HMAC
 * with a server-side pepper rather than a plain digest.
 */
export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    /**
     * What this code is FOR. The two purposes are deliberately separate
     * values rather than one generic code: a verification code must not be
     * usable to reset a password, and a reset code must not verify an
     * address. The check constraint is what enforces that rather than
     * convention.
     */
    purpose: text("purpose").notNull(),
    codeHash: text("code_hash").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    /**
     * Issued when a PASSWORD_RESET code is verified, and consumed by the
     * password change itself.
     *
     * Reset is two steps — verify the code, then choose a password — and
     * something has to carry proof between them. Storing a second hashed
     * secret on the challenge row keeps that proof single-use and revocable
     * for free, where a stateless signed token would need its own
     * invalidation story.
     */
    resetTokenHash: text("reset_token_hash"),
    resetTokenExpiresAt: timestamp("reset_token_expires_at", { withTimezone: true }),
    /** Kept for abuse investigation only; never used to identify a person. */
    requestIp: text("request_ip"),
  },
  (t) => [
    // "The newest live challenge for this address" is the only read path.
    index("otp_email_created_idx").on(t.email, t.createdAt.desc()),
    index("otp_expires_idx").on(t.expiresAt),
    index("otp_reset_token_idx").on(t.resetTokenHash),
    check("otp_purpose_known", sql`${t.purpose} in ('email_verification', 'password_reset')`),
    check("otp_attempts_non_negative", sql`${t.attemptCount} >= 0`),
    check("otp_expiry_after_creation", sql`${t.expiresAt} > ${t.createdAt}`),
  ]
);

/**
 * A logged-in session.
 *
 * Opaque random tokens, stored only as a hash, rather than a self-contained
 * JWT. The reason is logout: revoking a stateless token needs a denylist,
 * which is a session table with extra steps. An opaque token also carries no
 * claims, so nothing sensitive can leak from it by construction.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: text("user_agent"),
    ip: text("ip"),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_key").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
    check("sessions_expiry_after_creation", sql`${t.expiresAt} > ${t.createdAt}`),
  ]
);

/* ========================================================================== */
/* Taxonomy                                                                    */
/* ========================================================================== */

/**
 * `displayOrder` carries the taxonomy's own sequence.
 *
 * Departments are listed in a merchandising order — Electronics, Home &
 * Kitchen, Fashion, Beauty — not alphabetically, and that order was previously
 * implicit in the source file's line order. A database does not preserve it and
 * `order by name` would replace it with something nobody chose. Nullable, and
 * those rows sort last.
 */
export const categories = pgTable(
  "categories",
  {
    id: text("id").primaryKey(),
    // Self-referential: department → category → subcategory. Nullable at the
    // root, which is what makes a department a department.
    parentId: text("parent_id").references((): AnyPgColumn => categories.id),
    level: smallint("level").notNull(),
    name: text("name").notNull(),
    /**
     * Materialised ancestry as a SLUG path, `/`-separated:
     * "beauty-personal-care/hair-care/shampoo". Denormalised on purpose —
     * breadcrumbs are rendered on every catalogue request and a recursive CTE
     * per request buys nothing here.
     *
     * The format is load-bearing, and this comment used to describe a
     * different one (`"Beauty > Hair Care > Shampoo"`). Code written against
     * the comment rather than the data split on " > ", matched nothing, and
     * returned empty breadcrumbs without failing.
     */
    path: text("path").notNull(),
    /** Taxonomy order, not alphabetical. See the note above the table. */
    displayOrder: integer("display_order"),
  },
  (t) => [index("categories_parent_idx").on(t.parentId), index("categories_level_idx").on(t.level)]
);

export const productTypes = pgTable(
  "product_types",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id),
    name: text("name").notNull(),
    // The attribute registry is versioned rather than overwritten, so a product
    // captured under an older schema can still be read correctly.
    schemaVersion: text("schema_version").notNull(),
  },
  (t) => [index("product_types_category_idx").on(t.categoryId)]
);

export const brands = pgTable("brands", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tier: brandTierEnum("tier").notNull(),
  parentCompany: text("parent_company"),
  // Alternate spellings seen in marketplace titles, used by listing matching.
  aliasNames: jsonb("alias_names").$type<string[]>().notNull().default([]),
});

/**
 * Schemas-as-data: what a "product type" even has as attributes is itself a
 * table, which is what lets the catalogue build facets, the similarity scorer
 * compare specs, and the hedonic model pick features, all without a code change
 * per category.
 */
export const attributeDefinitions = pgTable(
  "attribute_definitions",
  {
    id: text("id").primaryKey(),
    productTypeId: text("product_type_id")
      .notNull()
      .references(() => productTypes.id),
    schemaVersion: text("schema_version").notNull(),
    attributeKey: text("attribute_key").notNull(),
    displayName: text("display_name").notNull(),
    dataType: attributeDataTypeEnum("data_type").notNull(),
    unit: text("unit"),
    isRequired: boolean("is_required").notNull().default(false),
    isPricingRelevant: boolean("is_pricing_relevant").notNull().default(false),
    isFilterable: boolean("is_filterable").notNull().default(false),
    filterType: filterTypeEnum("filter_type"),
    /**
     * Where this attribute sits in its product type's registry.
     *
     * Editorial, not alphabetical: a phone's filters read RAM, Storage,
     * Battery, Display — most decisive first — and sorting them by key would
     * open with Battery and Charging. The order was previously implicit in the
     * source file's line order, which a database does not preserve and
     * `order by` cannot recover, so it is recorded. Nullable because a row
     * loaded without one still has to be orderable; those sort last.
     */
    displayOrder: integer("display_order"),
    // Facet buckets: [{ label, min, max }] for ranges, or value lists for enums.
    buckets: jsonb("buckets").$type<unknown[]>(),
    // Direction of goodness, so "more RAM is better" but "more weight" is not.
    higherIsBetter: boolean("higher_is_better"),
  },
  (t) => [
    uniqueIndex("attr_defs_type_key_version_key").on(t.productTypeId, t.attributeKey, t.schemaVersion),
    index("attr_defs_type_idx").on(t.productTypeId),
  ]
);

/* ========================================================================== */
/* Product                                                                     */
/* ========================================================================== */

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    /**
     * Variant family. A 128GB and a 256GB phone are different products but one
     * competitive identity — the engine counts the family once so a rival's
     * six variants cannot crowd out five real competitors.
     */
    parentProductId: text("parent_product_id").references((): AnyPgColumn => products.id),
    isPurchasable: boolean("is_purchasable").notNull().default(true),
    /*
     * Nullable since 0009: a product discovered from a marketplace title has
     * no taxonomy yet, and inventing one would be the same class of mistake
     * as inventing a price. Null means not yet known.
     */
    brandId: text("brand_id").references(() => brands.id),
    categoryId: text("category_id").references(() => categories.id),
    productTypeId: text("product_type_id").references(() => productTypes.id),
    canonicalName: text("canonical_name").notNull(),
    modelName: text("model_name").notNull(),
    // What distinguishes this variant from its siblings ({ ram: "8GB" }).
    variantAxes: jsonb("variant_axes").$type<Record<string, string>>(),
    /**
     * Nullable, because this table holds two kinds of row. A purchasable SKU
     * always has a spec document and therefore a schema version. An abstract
     * FAMILY NODE — "Samsung Galaxy M14 5G", the parent of the 128GB and 256GB
     * variants — exists only to group them and has no specs of its own. The
     * check constraint below states exactly that rule rather than leaving it
     * as an unwritten convention.
     */
    specSchemaVersion: text("spec_schema_version"),
    /**
     * The flexible spec document, validated against `attribute_definitions`
     * rather than against a column list. GIN-indexed because spec filtering is
     * a first-class catalogue query, not an occasional one.
     */
    specifications: jsonb("specifications").$type<Record<string, unknown>>().notNull().default({}),
    // GTIN / EAN / MPN and friends.
    identifiers: jsonb("identifiers").$type<Record<string, string>>(),
    lifecycleStatus: lifecycleStatusEnum("lifecycle_status").notNull().default("active"),
    firstSeenAt: date("first_seen_at"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    /** Seeded, discovered from a live capture, or entered by hand. */
    origin: rowOriginEnum("origin").notNull().default("seed"),

    /* ------------------------------------------- the market capture schedule
     *
     * On the PRODUCT, not on the tracking row, and that is the whole point.
     * A market snapshot describes the market for a product; it does not
     * belong to whoever asked for it. Putting the schedule here means a
     * hundred users tracking one phone cost one capture rather than a
     * hundred, and every screen reads the same evidence.
     */

    /** What to ask the provider to refresh this product. Null for seeded rows. */
    canonicalQuery: text("canonical_query"),
    captureIntervalHours: integer("capture_interval_hours"),
    lastCapturedAt: timestamp("last_captured_at", { withTimezone: true }),
    nextCaptureAt: timestamp("next_capture_at", { withTimezone: true }),

    /**
     * Demand, denormalised so the scheduler can rank without a join.
     *
     * A product nobody tracks and nobody has opened recently earns no
     * scheduled call at all — the largest single saving available, because
     * most of a catalogue is cold at any moment.
     */
    trackerCount: integer("tracker_count").notNull().default(0),
    lastInterestAt: timestamp("last_interest_at", { withTimezone: true }),
  },
  (t) => [
    index("products_category_idx").on(t.categoryId),
    index("products_type_idx").on(t.productTypeId),
    index("products_brand_idx").on(t.brandId),
    index("products_parent_idx").on(t.parentProductId),
    index("products_specs_gin").using("gin", t.specifications),
    index("products_origin_idx").on(t.origin),
    // A thing you can buy must declare the schema its specs conform to.
    // A SEEDED product must declare the schema its specs conform to. A live
    // one has neither specs nor a schema yet, which is not a defect.
    check(
      "products_purchasable_has_spec_schema",
      sql`${t.origin} <> 'seed' or not ${t.isPurchasable} or ${t.specSchemaVersion} is not null`
    ),
  ]
);

/* ========================================================================== */
/* Marketplace                                                                 */
/* ========================================================================== */

export const marketplaces = pgTable("marketplaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  countryCode: text("country_code").notNull(),
  defaultCurrency: text("default_currency").notNull(),
  websiteDomain: text("website_domain").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  // Identity colour. Real encoding in this product: the interface takes its
  // chroma from which platforms carry a product.
  brandColor: text("brand_color"),
  marketplaceType: marketplaceTypeEnum("marketplace_type").notNull(),
  /**
   * Presentation order for the curated marketplaces.
   *
   * The two horizontals lead, then the verticals — a deliberate order that was
   * implicit in the source file's line order and is not alphabetical. Left NULL
   * for discovered stores, which sort after the curated set by name: a store
   * that arrived from a provider has no editorial position, and inventing one
   * would rank it against platforms it was never compared with.
   */
  displayOrder: integer("display_order"),
  /**
   * True for a store this system learned about from a data provider rather
   * than one it was built around.
   *
   * The six curated marketplaces have category affinities, fee rules and
   * brand colours; a store that arrives inside a Google Shopping response —
   * Croma, Vijay Sales, a seller's own site — has none of that, and treating
   * the two as equivalent would quietly corrupt every screen that assumes the
   * curated set. Defaulting to false means every existing row and every
   * existing query keeps its present meaning, and a caller opts in to
   * discovered stores deliberately.
   *
   * They are still worth having: a competitor selling below you on Croma is
   * real competitive evidence, and dropping it on the floor because the store
   * was not on a list written in advance would lose genuine market signal.
   */
  isDiscovered: boolean("is_discovered").notNull().default(false),
  // Which departments this platform actually carries — a beauty vertical does
  // not sell refrigerators, and pretending otherwise distorts coverage.
  categoryAffinity: jsonb("category_affinity").$type<string[]>().notNull().default([]),
});

export const marketplaceCategories = pgTable(
  "marketplace_categories",
  {
    id: text("id").primaryKey(),
    marketplaceId: text("marketplace_id")
      .notNull()
      .references(() => marketplaces.id),
    externalNodeId: text("external_node_id").notNull(),
    rawPath: text("raw_path").notNull(),
    mappedCategoryId: text("mapped_category_id").references(() => categories.id),
    mappingConfidence: real("mapping_confidence"),
    mappedBy: mappedByEnum("mapped_by"),
  },
  (t) => [
    // A node id is unique within its marketplace, not across them.
    uniqueIndex("mp_categories_node_key").on(t.marketplaceId, t.externalNodeId),
    index("mp_categories_mapped_idx").on(t.mappedCategoryId),
  ]
);

/* ========================================================================== */
/* Listing → Seller → Offer                                                    */
/* ========================================================================== */

export const listings = pgTable(
  "listings",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    marketplaceId: text("marketplace_id")
      .notNull()
      .references(() => marketplaces.id),
    // ASIN, FSN, and equivalents.
    externalListingId: text("external_listing_id").notNull(),
    listingUrl: text("listing_url"),
    marketplaceCategoryId: text("marketplace_category_id").references(() => marketplaceCategories.id),
    // The exact string the platform published. Evidence, kept verbatim.
    rawTitle: text("raw_title"),
    marketplaceBrandText: text("marketplace_brand_text"),
    /**
     * How confident the system is that this listing is the product it is filed
     * under. Carried into the evidence score rather than assumed — an
     * auto-matched listing at 92% is weaker evidence than a confirmed one.
     */
    origin: rowOriginEnum("origin").notNull().default("seed"),
    matchStatus: matchStatusEnum("match_status").notNull(),
    matchConfidence: real("match_confidence"),
    listingStatus: listingStatusEnum("listing_status").notNull().default("active"),
    firstSeenAt: date("first_seen_at"),
    lastSeenAt: date("last_seen_at"),
  },
  (t) => [
    uniqueIndex("listings_marketplace_external_key").on(t.marketplaceId, t.externalListingId),
    // One listing per product per marketplace — the invariant the whole
    // cross-marketplace comparison rests on.
    uniqueIndex("listings_product_marketplace_key").on(t.productId, t.marketplaceId),
    index("listings_product_idx").on(t.productId),
    index("listings_marketplace_idx").on(t.marketplaceId),
    index("listings_match_status_idx").on(t.matchStatus),
    check(
      "listings_match_confidence_range",
      sql`${t.matchConfidence} is null or (${t.matchConfidence} >= 0 and ${t.matchConfidence} <= 1)`
    ),
  ]
);

/**
 * A seller row is marketplace-scoped, because a merchant's id, rating and
 * fulfilment type are marketplace-scoped facts. `seller_group_id` carries
 * cross-platform identity without pretending one row spans platforms.
 */
export const sellers = pgTable(
  "sellers",
  {
    id: text("id").primaryKey(),
    marketplaceId: text("marketplace_id")
      .notNull()
      .references(() => marketplaces.id),
    externalSellerId: text("external_seller_id").notNull(),
    name: text("name").notNull(),
    origin: rowOriginEnum("origin").notNull().default("seed"),
    sellerType: sellerTypeEnum("seller_type").notNull(),
    defaultFulfilmentType: fulfilmentTypeEnum("default_fulfilment_type").notNull(),
    sellerGroupId: text("seller_group_id"),
    sellerTier: sellerTierEnum("seller_tier"),
    maxOffers: integer("max_offers"),
    onboardedAt: date("onboarded_at"),
  },
  (t) => [
    uniqueIndex("sellers_marketplace_external_key").on(t.marketplaceId, t.externalSellerId),
    index("sellers_marketplace_idx").on(t.marketplaceId),
    index("sellers_group_idx").on(t.sellerGroupId),
  ]
);

export const sellerRatingSnapshots = pgTable(
  "seller_rating_snapshots",
  {
    id: text("id").primaryKey(),
    sellerId: text("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "cascade" }),
    capturedAt: date("captured_at").notNull(),
    rating: real("rating"),
    ratingCount: integer("rating_count"),
  },
  (t) => [
    uniqueIndex("seller_ratings_seller_date_key").on(t.sellerId, t.capturedAt),
    index("seller_ratings_seller_idx").on(t.sellerId, t.capturedAt),
  ]
);

export const offers = pgTable(
  "offers",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    sellerId: text("seller_id")
      .notNull()
      .references(() => sellers.id),
    itemCondition: itemConditionEnum("item_condition").notNull().default("new"),
    offerStatus: offerStatusEnum("offer_status").notNull().default("active"),
    firstSeenAt: date("first_seen_at"),
  },
  (t) => [
    // A seller offers a given condition once per listing; the same seller may
    // legitimately list new and renewed side by side.
    uniqueIndex("offers_listing_seller_condition_key").on(t.listingId, t.sellerId, t.itemCondition),
    index("offers_listing_idx").on(t.listingId),
    index("offers_seller_idx").on(t.sellerId),
  ]
);

/* ========================================================================== */
/* Observations — the append-only fact table                                   */
/* ========================================================================== */

export const priceObservations = pgTable(
  "price_observations",
  {
    id: text("id").primaryKey(),
    offerId: text("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    observedAt: date("observed_at").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    // The printed maximum. A legal ceiling in India, not a discount anchor.
    mrpMinor: integer("mrp_minor"),
    sellingPriceMinor: integer("selling_price_minor").notNull(),
    shippingFeeMinor: integer("shipping_fee_minor").notNull().default(0),
    currencyCode: text("currency_code").notNull().default("INR"),
    isInStock: boolean("is_in_stock").notNull(),
    // Cheapest in-stock landed price on this listing that day — computed from
    // the data, never hand-assigned.
    isBuyboxWinner: boolean("is_buybox_winner").notNull().default(false),
    saleLabel: text("sale_label"),
    /**
     * Soft provenance pointer into the raw-document store. Deliberately NOT a
     * foreign key: every observation carries one, but raw HTML is retained
     * under a shorter policy than the derived facts, so the target is routinely
     * absent. A FK here would make the retention policy fail the load.
     */
    rawDocumentId: text("raw_document_id"),
    parserVersion: text("parser_version"),
  },
  (t) => [
    // Append-only in practice: one observation per offer per capture day. A
    // correction is a later row, never an UPDATE.
    uniqueIndex("price_obs_offer_date_key").on(t.offerId, t.observedAt),
    // The hottest path in the application — latest state, and per-offer series.
    index("price_obs_offer_date_idx").on(t.offerId, t.observedAt.desc()),
    // Window queries sweeping the catalogue at a horizon.
    index("price_obs_date_idx").on(t.observedAt),
    check("price_obs_selling_non_negative", sql`${t.sellingPriceMinor} >= 0`),
    check("price_obs_shipping_non_negative", sql`${t.shippingFeeMinor} >= 0`),
    check("price_obs_mrp_non_negative", sql`${t.mrpMinor} is null or ${t.mrpMinor} >= 0`),
  ]
);

export const reviewSnapshots = pgTable(
  "review_snapshots",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    capturedAt: date("captured_at").notNull(),
    averageRating: real("average_rating"),
    ratingCount: integer("rating_count"),
    reviewCount: integer("review_count"),
    // Star histogram { "1": n, … "5": n }.
    ratingDistribution: jsonb("rating_distribution").$type<Record<string, number>>(),
  },
  (t) => [
    uniqueIndex("review_snapshots_listing_date_key").on(t.listingId, t.capturedAt),
    index("review_snapshots_listing_idx").on(t.listingId, t.capturedAt.desc()),
    check(
      "review_rating_range",
      sql`${t.averageRating} is null or (${t.averageRating} >= 0 and ${t.averageRating} <= 5)`
    ),
  ]
);

export const promotions = pgTable(
  "promotions",
  {
    id: text("id").primaryKey(),
    offerId: text("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    promotionType: promotionTypeEnum("promotion_type").notNull(),
    /**
     * Materialised from `promotion_type`. Stored rather than derived per query
     * because it decides whether a discount may enter a price comparison at
     * all, and that rule should be enforced by the database.
     */
    availabilityClass: availabilityClassEnum("availability_class").notNull(),
    label: text("label").notNull(),
    /**
     * Genuinely polymorphic by promotion type — ten distinct shapes across the
     * dataset: a bank offer carries { bank, percent, capMinor, minSpendMinor,
     * cardTypes }, no-cost EMI carries { bank, tenureMonths }, a coupon
     * carries { code, minSpendMinor }. Flattening that into columns would mean
     * twenty mostly-null fields or a table per promotion type; the discriminator
     * is `promotion_type`, and the payload belongs with it.
     */
    terms: jsonb("terms").$type<Record<string, unknown>>(),
    eligibility: text("eligibility"),
    discountValueMinor: integer("discount_value_minor").notNull().default(0),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
  },
  (t) => [
    index("promotions_offer_idx").on(t.offerId),
    // "Active on date D" — resolved per observation date, so it is hot.
    index("promotions_validity_idx").on(t.validFrom, t.validTo),
    index("promotions_class_idx").on(t.availabilityClass),
    check("promotions_discount_non_negative", sql`${t.discountValueMinor} >= 0`),
    check(
      "promotions_validity_ordered",
      sql`${t.validFrom} is null or ${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`
    ),
  ]
);

/* ========================================================================== */
/* Commercial                                                                  */
/* ========================================================================== */

export const feeRules = pgTable(
  "fee_rules",
  {
    id: text("id").primaryKey(),
    marketplaceId: text("marketplace_id")
      .notNull()
      .references(() => marketplaces.id),
    // Nullable: a marketplace-wide default rate applies where no category rule
    // has been captured, and the engine flags margins computed from one.
    categoryId: text("category_id").references(() => categories.id),
    priceSlabMin: integer("price_slab_min"),
    priceSlabMax: integer("price_slab_max"),
    referralPct: real("referral_pct").notNull(),
    fixedClosingFee: integer("fixed_closing_fee").notNull().default(0),
    shippingFeeBasis: text("shipping_fee_basis"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    isCurrent: boolean("is_current").notNull().default(true),
  },
  (t) => [
    index("fee_rules_marketplace_category_idx").on(t.marketplaceId, t.categoryId),
    index("fee_rules_current_idx").on(t.isCurrent),
  ]
);

/**
 * What the seller paid. `user_id` is nullable so the three rows that exist
 * today load before authentication exists; once it does, cost is a per-user
 * fact and the column becomes required.
 */
export const sellerCostInputs = pgTable(
  "seller_cost_inputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    costPriceMinor: integer("cost_price_minor").notNull(),
    enteredAt: date("entered_at").notNull(),
    note: text("note"),
  },
  (t) => [
    uniqueIndex("seller_cost_user_product_key").on(t.userId, t.productId),
    index("seller_cost_product_idx").on(t.productId),
    check("seller_cost_non_negative", sql`${t.costPriceMinor} >= 0`),
  ]
);

/** Replaces the tracked-product ids currently held in React state. */
/**
 * WHO IS FOLLOWING WHAT — and deliberately nothing else.
 *
 * This table carries no capture schedule. That absence is the design: a
 * per-user schedule is precisely how "one SerpApi call per user per product
 * per day" happens, and the market does not belong to whoever asked about it.
 * The schedule lives on `products`, so a hundred people following one phone
 * cost one capture and read the same evidence.
 *
 * Three distinct ideas, kept apart:
 *   tracked_products     this user wants to follow this product
 *   capture_runs         the market was asked about at time T
 *   price_observations   marketplace Y offered it at price Z at time T
 */
export const trackedProducts = pgTable(
  "tracked_products",
  {
    id: text("id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    status: trackingStatusEnum("status").notNull().default("active"),
    /** What the user searched to find it — kept for provenance, not for scheduling. */
    searchQuery: text("search_query"),
    /** The offer they chose, so the interface can link back to what they saw. */
    sourceUrl: text("source_url"),
    trackedAt: timestamp("tracked_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per user per product: following something twice is following it.
    primaryKey({ columns: [t.userId, t.productId] }),
    uniqueIndex("tracked_products_id_key").on(t.id),
    index("tracked_products_product_idx").on(t.productId),
    index("tracked_products_user_idx").on(t.userId, t.status),
  ]
);

/* ========================================================================== */
/* Provenance — how the data got here, and what failed on the way              */
/* ========================================================================== */

export const captureRuns = pgTable(
  "capture_runs",
  {
    id: text("id").primaryKey(),
    /**
     * Nullable since the market-data providers landed.
     *
     * It was NOT NULL under one assumption: a run is a crawler pointed at one
     * platform. That holds for a Flipkart scraper and fails for an aggregator
     * — a single Google Shopping response carries Flipkart, Croma and Vijay
     * Sales together, and there is no honest single value to put here.
     * Marketplace is a property of each observation, which is where it is
     * actually recorded. A per-marketplace run still sets it.
     */
    marketplaceId: text("marketplace_id").references(() => marketplaces.id),
    /** Which adapter produced this run: `serpapi`, `fixture`, a scraper name. */
    provider: text("provider"),
    /** The query that was asked, for a provider that takes one. */
    sourceQuery: text("source_query"),
    /**
     * The dedup key.
     *
     * "iphone 17 256gb" and "iPhone 17 256 GB" are the same market question
     * and must not cost two calls. Normalisation collapses formatting only —
     * storage, RAM and model numbers are meaning, not formatting.
     */
    normalizedQuery: text("normalized_query"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    runStatus: runStatusEnum("run_status").notNull(),
    parserVersion: text("parser_version"),
    pagesAttempted: integer("pages_attempted"),
    pagesSucceeded: integer("pages_succeeded"),
    notes: text("notes"),
  },
  (t) => [
    index("capture_runs_marketplace_idx").on(t.marketplaceId, t.startedAt.desc()),
    // Freshness lookup: "has this query been captured recently enough to reuse?"
    index("capture_runs_provider_query_idx").on(t.provider, t.sourceQuery, t.startedAt.desc()),
  ]
);

export const rawDocuments = pgTable(
  "raw_documents",
  {
    id: text("id").primaryKey(),
    captureRunId: text("capture_run_id").references(() => captureRuns.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull(),
    httpStatus: integer("http_status"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    contentHash: text("content_hash"),
    storagePath: text("storage_path"),
    /**
     * The response as received.
     *
     * Added in 0008. Before it the body was hashed and thrown away: the hash
     * proved a capture had happened but could not show what it returned, so a
     * parser fixed later could not be re-run over it, and a user selecting a
     * live search result could not be resolved server-side. `storage_path`
     * recorded a path nothing ever wrote to.
     */
    body: jsonb("body"),
  },
  (t) => [
    index("raw_documents_run_idx").on(t.captureRunId),
    // Retention prunes by age.
    index("raw_documents_fetched_idx").on(t.fetchedAt.desc()),
  ]
);

/**
 * Rows that failed validation are kept, not dropped. A rejects table turns a
 * silent gap into a report.
 */
export const rejectedRecords = pgTable(
  "rejected_records",
  {
    id: text("id").primaryKey(),
    rawDocumentId: text("raw_document_id").references(() => rawDocuments.id, { onDelete: "set null" }),
    targetEntity: text("target_entity").notNull(),
    rejectionReason: text("rejection_reason").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
  },
  (t) => [index("rejected_records_entity_idx").on(t.targetEntity)]
);

export const fieldCoverage = pgTable(
  "field_coverage",
  {
    marketplaceId: text("marketplace_id")
      .notNull()
      .references(() => marketplaces.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    coveragePct: real("coverage_pct").notNull(),
  },
  (t) => [primaryKey({ columns: [t.marketplaceId, t.field] })]
);

/* ========================================================================== */

export const schema = {
  users,
  otpChallenges,
  sessions,
  categories,
  productTypes,
  brands,
  attributeDefinitions,
  products,
  marketplaces,
  marketplaceCategories,
  listings,
  sellers,
  sellerRatingSnapshots,
  offers,
  priceObservations,
  reviewSnapshots,
  promotions,
  feeRules,
  sellerCostInputs,
  trackedProducts,
  captureRuns,
  rawDocuments,
  rejectedRecords,
  fieldCoverage,
};
