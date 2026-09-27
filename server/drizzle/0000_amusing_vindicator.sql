CREATE TYPE "public"."attribute_data_type" AS ENUM('integer', 'decimal', 'boolean', 'text');--> statement-breakpoint
CREATE TYPE "public"."availability_class" AS ENUM('universal', 'conditional', 'deferred', 'financing');--> statement-breakpoint
CREATE TYPE "public"."brand_tier" AS ENUM('value', 'mid', 'premium');--> statement-breakpoint
CREATE TYPE "public"."filter_type" AS ENUM('range', 'enum', 'boolean');--> statement-breakpoint
CREATE TYPE "public"."fulfilment_type" AS ENUM('fba', 'flipkart_assured', 'amazon_easy_ship', 'meesho_fulfilled', 'myntra_fulfilled', 'nykaa_fulfilled', 'ajio_fulfilled', 'self_ship');--> statement-breakpoint
CREATE TYPE "public"."item_condition" AS ENUM('new', 'renewed', 'used');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_status" AS ENUM('active', 'discontinued', 'unreleased');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('active', 'delisted', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."mapped_by" AS ENUM('rule', 'model', 'human');--> statement-breakpoint
CREATE TYPE "public"."marketplace_type" AS ENUM('horizontal', 'value_horizontal', 'fashion_vertical', 'beauty_vertical');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('auto_matched', 'human_confirmed', 'unmatched');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."promotion_type" AS ENUM('instant_discount', 'marketplace_campaign', 'coupon', 'bank_offer', 'exchange', 'cashback', 'no_cost_emi');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('success', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."seller_tier" AS ENUM('anchor', 'established', 'small');--> statement-breakpoint
CREATE TYPE "public"."seller_type" AS ENUM('marketplace_owned', 'third_party', 'brand_direct');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('viewer', 'seller', 'admin');--> statement-breakpoint
CREATE TABLE "attribute_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"product_type_id" text NOT NULL,
	"schema_version" text NOT NULL,
	"attribute_key" text NOT NULL,
	"display_name" text NOT NULL,
	"data_type" "attribute_data_type" NOT NULL,
	"unit" text,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_pricing_relevant" boolean DEFAULT false NOT NULL,
	"is_filterable" boolean DEFAULT false NOT NULL,
	"filter_type" "filter_type",
	"buckets" jsonb,
	"higher_is_better" boolean
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tier" "brand_tier" NOT NULL,
	"parent_company" text,
	"alias_names" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capture_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"marketplace_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"run_status" "run_status" NOT NULL,
	"parser_version" text,
	"pages_attempted" integer,
	"pages_succeeded" integer,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"level" smallint NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"marketplace_id" text NOT NULL,
	"category_id" text,
	"price_slab_min" integer,
	"price_slab_max" integer,
	"referral_pct" real NOT NULL,
	"fixed_closing_fee" integer DEFAULT 0 NOT NULL,
	"shipping_fee_basis" text,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"is_current" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_coverage" (
	"marketplace_id" text NOT NULL,
	"field" text NOT NULL,
	"coverage_pct" real NOT NULL,
	CONSTRAINT "field_coverage_marketplace_id_field_pk" PRIMARY KEY("marketplace_id","field")
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"marketplace_id" text NOT NULL,
	"external_listing_id" text NOT NULL,
	"listing_url" text,
	"marketplace_category_id" text,
	"raw_title" text,
	"marketplace_brand_text" text,
	"match_status" "match_status" NOT NULL,
	"match_confidence" real,
	"listing_status" "listing_status" DEFAULT 'active' NOT NULL,
	"first_seen_at" date,
	"last_seen_at" date,
	CONSTRAINT "listings_match_confidence_range" CHECK ("listings"."match_confidence" is null or ("listings"."match_confidence" >= 0 and "listings"."match_confidence" <= 1))
);
--> statement-breakpoint
CREATE TABLE "marketplace_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"marketplace_id" text NOT NULL,
	"external_node_id" text NOT NULL,
	"raw_path" text NOT NULL,
	"mapped_category_id" text,
	"mapping_confidence" real,
	"mapped_by" "mapped_by"
);
--> statement-breakpoint
CREATE TABLE "marketplaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country_code" text NOT NULL,
	"default_currency" text NOT NULL,
	"website_domain" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"brand_color" text,
	"marketplace_type" "marketplace_type" NOT NULL,
	"category_affinity" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"item_condition" "item_condition" DEFAULT 'new' NOT NULL,
	"offer_status" "offer_status" DEFAULT 'active' NOT NULL,
	"first_seen_at" date
);
--> statement-breakpoint
CREATE TABLE "price_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"observed_at" date NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"mrp_minor" integer,
	"selling_price_minor" integer NOT NULL,
	"shipping_fee_minor" integer DEFAULT 0 NOT NULL,
	"currency_code" text DEFAULT 'INR' NOT NULL,
	"is_in_stock" boolean NOT NULL,
	"is_buybox_winner" boolean DEFAULT false NOT NULL,
	"sale_label" text,
	"raw_document_id" text,
	"parser_version" text,
	CONSTRAINT "price_obs_selling_non_negative" CHECK ("price_observations"."selling_price_minor" >= 0),
	CONSTRAINT "price_obs_shipping_non_negative" CHECK ("price_observations"."shipping_fee_minor" >= 0),
	CONSTRAINT "price_obs_mrp_non_negative" CHECK ("price_observations"."mrp_minor" is null or "price_observations"."mrp_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_types" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"name" text NOT NULL,
	"schema_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_product_id" text,
	"is_purchasable" boolean DEFAULT true NOT NULL,
	"brand_id" text NOT NULL,
	"category_id" text NOT NULL,
	"product_type_id" text NOT NULL,
	"canonical_name" text NOT NULL,
	"model_name" text NOT NULL,
	"variant_axes" jsonb,
	"spec_schema_version" text,
	"specifications" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"identifiers" jsonb,
	"lifecycle_status" "lifecycle_status" DEFAULT 'active' NOT NULL,
	"first_seen_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_purchasable_has_spec_schema" CHECK (not "products"."is_purchasable" or "products"."spec_schema_version" is not null)
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"promotion_type" "promotion_type" NOT NULL,
	"availability_class" "availability_class" NOT NULL,
	"label" text NOT NULL,
	"terms" jsonb,
	"eligibility" text,
	"discount_value_minor" integer DEFAULT 0 NOT NULL,
	"valid_from" date,
	"valid_to" date,
	CONSTRAINT "promotions_discount_non_negative" CHECK ("promotions"."discount_value_minor" >= 0),
	CONSTRAINT "promotions_validity_ordered" CHECK ("promotions"."valid_from" is null or "promotions"."valid_to" is null or "promotions"."valid_to" >= "promotions"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "raw_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"capture_run_id" text,
	"source_url" text NOT NULL,
	"http_status" integer,
	"fetched_at" timestamp with time zone,
	"content_hash" text,
	"storage_path" text
);
--> statement-breakpoint
CREATE TABLE "rejected_records" (
	"id" text PRIMARY KEY NOT NULL,
	"raw_document_id" text,
	"target_entity" text NOT NULL,
	"rejection_reason" text NOT NULL,
	"captured_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"captured_at" date NOT NULL,
	"average_rating" real,
	"rating_count" integer,
	"review_count" integer,
	"rating_distribution" jsonb,
	CONSTRAINT "review_rating_range" CHECK ("review_snapshots"."average_rating" is null or ("review_snapshots"."average_rating" >= 0 and "review_snapshots"."average_rating" <= 5))
);
--> statement-breakpoint
CREATE TABLE "seller_cost_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"product_id" text NOT NULL,
	"cost_price_minor" integer NOT NULL,
	"entered_at" date NOT NULL,
	"note" text,
	CONSTRAINT "seller_cost_non_negative" CHECK ("seller_cost_inputs"."cost_price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "seller_rating_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"captured_at" date NOT NULL,
	"rating" real,
	"rating_count" integer
);
--> statement-breakpoint
CREATE TABLE "sellers" (
	"id" text PRIMARY KEY NOT NULL,
	"marketplace_id" text NOT NULL,
	"external_seller_id" text NOT NULL,
	"name" text NOT NULL,
	"seller_type" "seller_type" NOT NULL,
	"default_fulfilment_type" "fulfilment_type" NOT NULL,
	"seller_group_id" text,
	"seller_tier" "seller_tier",
	"max_offers" integer,
	"onboarded_at" date
);
--> statement-breakpoint
CREATE TABLE "tracked_products" (
	"user_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"tracked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracked_products_user_id_product_id_pk" PRIMARY KEY("user_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attribute_definitions" ADD CONSTRAINT "attribute_definitions_product_type_id_product_types_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_runs" ADD CONSTRAINT "capture_runs_marketplace_id_marketplaces_id_fk" FOREIGN KEY ("marketplace_id") REFERENCES "public"."marketplaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_rules" ADD CONSTRAINT "fee_rules_marketplace_id_marketplaces_id_fk" FOREIGN KEY ("marketplace_id") REFERENCES "public"."marketplaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_rules" ADD CONSTRAINT "fee_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_coverage" ADD CONSTRAINT "field_coverage_marketplace_id_marketplaces_id_fk" FOREIGN KEY ("marketplace_id") REFERENCES "public"."marketplaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_marketplace_id_marketplaces_id_fk" FOREIGN KEY ("marketplace_id") REFERENCES "public"."marketplaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_marketplace_category_id_marketplace_categories_id_fk" FOREIGN KEY ("marketplace_category_id") REFERENCES "public"."marketplace_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_categories" ADD CONSTRAINT "marketplace_categories_marketplace_id_marketplaces_id_fk" FOREIGN KEY ("marketplace_id") REFERENCES "public"."marketplaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_categories" ADD CONSTRAINT "marketplace_categories_mapped_category_id_categories_id_fk" FOREIGN KEY ("mapped_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_types" ADD CONSTRAINT "product_types_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_parent_product_id_products_id_fk" FOREIGN KEY ("parent_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_product_type_id_product_types_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_documents" ADD CONSTRAINT "raw_documents_capture_run_id_capture_runs_id_fk" FOREIGN KEY ("capture_run_id") REFERENCES "public"."capture_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejected_records" ADD CONSTRAINT "rejected_records_raw_document_id_raw_documents_id_fk" FOREIGN KEY ("raw_document_id") REFERENCES "public"."raw_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_snapshots" ADD CONSTRAINT "review_snapshots_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_cost_inputs" ADD CONSTRAINT "seller_cost_inputs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_cost_inputs" ADD CONSTRAINT "seller_cost_inputs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_rating_snapshots" ADD CONSTRAINT "seller_rating_snapshots_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_marketplace_id_marketplaces_id_fk" FOREIGN KEY ("marketplace_id") REFERENCES "public"."marketplaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_products" ADD CONSTRAINT "tracked_products_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_products" ADD CONSTRAINT "tracked_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attr_defs_type_key_version_key" ON "attribute_definitions" USING btree ("product_type_id","attribute_key","schema_version");--> statement-breakpoint
CREATE INDEX "attr_defs_type_idx" ON "attribute_definitions" USING btree ("product_type_id");--> statement-breakpoint
CREATE INDEX "capture_runs_marketplace_idx" ON "capture_runs" USING btree ("marketplace_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "categories_level_idx" ON "categories" USING btree ("level");--> statement-breakpoint
CREATE INDEX "fee_rules_marketplace_category_idx" ON "fee_rules" USING btree ("marketplace_id","category_id");--> statement-breakpoint
CREATE INDEX "fee_rules_current_idx" ON "fee_rules" USING btree ("is_current");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_marketplace_external_key" ON "listings" USING btree ("marketplace_id","external_listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_product_marketplace_key" ON "listings" USING btree ("product_id","marketplace_id");--> statement-breakpoint
CREATE INDEX "listings_product_idx" ON "listings" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "listings_marketplace_idx" ON "listings" USING btree ("marketplace_id");--> statement-breakpoint
CREATE INDEX "listings_match_status_idx" ON "listings" USING btree ("match_status");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_categories_node_key" ON "marketplace_categories" USING btree ("marketplace_id","external_node_id");--> statement-breakpoint
CREATE INDEX "mp_categories_mapped_idx" ON "marketplace_categories" USING btree ("mapped_category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_listing_seller_condition_key" ON "offers" USING btree ("listing_id","seller_id","item_condition");--> statement-breakpoint
CREATE INDEX "offers_listing_idx" ON "offers" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "offers_seller_idx" ON "offers" USING btree ("seller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_obs_offer_date_key" ON "price_observations" USING btree ("offer_id","observed_at");--> statement-breakpoint
CREATE INDEX "price_obs_offer_date_idx" ON "price_observations" USING btree ("offer_id","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "price_obs_date_idx" ON "price_observations" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "product_types_category_idx" ON "product_types" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_type_idx" ON "products" USING btree ("product_type_id");--> statement-breakpoint
CREATE INDEX "products_brand_idx" ON "products" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "products_parent_idx" ON "products" USING btree ("parent_product_id");--> statement-breakpoint
CREATE INDEX "products_specs_gin" ON "products" USING gin ("specifications");--> statement-breakpoint
CREATE INDEX "promotions_offer_idx" ON "promotions" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "promotions_validity_idx" ON "promotions" USING btree ("valid_from","valid_to");--> statement-breakpoint
CREATE INDEX "promotions_class_idx" ON "promotions" USING btree ("availability_class");--> statement-breakpoint
CREATE INDEX "raw_documents_run_idx" ON "raw_documents" USING btree ("capture_run_id");--> statement-breakpoint
CREATE INDEX "rejected_records_entity_idx" ON "rejected_records" USING btree ("target_entity");--> statement-breakpoint
CREATE UNIQUE INDEX "review_snapshots_listing_date_key" ON "review_snapshots" USING btree ("listing_id","captured_at");--> statement-breakpoint
CREATE INDEX "review_snapshots_listing_idx" ON "review_snapshots" USING btree ("listing_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "seller_cost_user_product_key" ON "seller_cost_inputs" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "seller_cost_product_idx" ON "seller_cost_inputs" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_ratings_seller_date_key" ON "seller_rating_snapshots" USING btree ("seller_id","captured_at");--> statement-breakpoint
CREATE INDEX "seller_ratings_seller_idx" ON "seller_rating_snapshots" USING btree ("seller_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sellers_marketplace_external_key" ON "sellers" USING btree ("marketplace_id","external_seller_id");--> statement-breakpoint
CREATE INDEX "sellers_marketplace_idx" ON "sellers" USING btree ("marketplace_id");--> statement-breakpoint
CREATE INDEX "sellers_group_idx" ON "sellers" USING btree ("seller_group_id");--> statement-breakpoint
CREATE INDEX "tracked_products_product_idx" ON "tracked_products" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");