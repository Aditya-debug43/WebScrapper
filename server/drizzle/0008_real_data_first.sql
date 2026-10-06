-- REAL-DATA-FIRST
-- ===============
--
-- Four changes, each with a reason.
--
-- 1. raw_documents.body — the response was HASHED AND DISCARDED. The column
--    recorded a storage_path that nothing ever wrote to, so provenance could
--    prove a capture happened but could not show what it returned, and a user
--    selecting a live search result could not be resolved server-side.
--
-- 2. origin on products/listings/sellers — the database mixes seeded rows with
--    genuinely captured ones, and nothing distinguishes them. A seeded product
--    may already carry real observations, so "has real observations" is NOT a
--    safe proxy for "was originally live". Cleanup needs an explicit marker.
--
-- 3. Capture scheduling moved onto the PRODUCT. This is the change that makes
--    market data shared: a snapshot describes the market for a product, not
--    one user's view of it, so a hundred trackers are one capture and not a
--    hundred. tracked_products stays purely the user relationship.
--
-- 4. normalized_query on capture_runs — the dedup key. "iphone 17 256gb" and
--    "iPhone 17 256 GB" are the same market question.

CREATE TYPE "public"."row_origin" AS ENUM('seed', 'live', 'manual');--> statement-breakpoint
CREATE TYPE "public"."tracking_status" AS ENUM('active', 'paused');--> statement-breakpoint

-- 1 ------------------------------------------------------------------ raw body
ALTER TABLE "raw_documents" ADD COLUMN "body" jsonb;--> statement-breakpoint
-- Retention is by age, so the fetch time needs an index.
CREATE INDEX "raw_documents_fetched_idx" ON "raw_documents" USING btree ("fetched_at" DESC NULLS LAST);--> statement-breakpoint

-- 2 ------------------------------------------------------------------- origin
-- Defaulting to 'seed' is deliberate: everything that exists today predates
-- this column, and calling an unknown row 'live' would make the cleanup script
-- preserve synthetic data. The backfill promotes genuine rows afterwards.
ALTER TABLE "products" ADD COLUMN "origin" "row_origin" DEFAULT 'seed' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "origin" "row_origin" DEFAULT 'seed' NOT NULL;--> statement-breakpoint
ALTER TABLE "sellers" ADD COLUMN "origin" "row_origin" DEFAULT 'seed' NOT NULL;--> statement-breakpoint
CREATE INDEX "products_origin_idx" ON "products" USING btree ("origin");--> statement-breakpoint

-- 3 ------------------------------------------- product-level capture schedule
--
-- The query to re-run when this product's market is refreshed. Null for seeded
-- products, which have no live query behind them and are never captured.
ALTER TABLE "products" ADD COLUMN "canonical_query" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "capture_interval_hours" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "last_captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "next_capture_at" timestamp with time zone;--> statement-breakpoint
-- Demand signals. A product nobody tracks and nobody has looked at recently is
-- not worth a scheduled call, which is the single biggest saving available.
ALTER TABLE "products" ADD COLUMN "tracker_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "last_interest_at" timestamp with time zone;--> statement-breakpoint
-- The scheduler's hot query: "what is due?". Partial, because only products
-- with a schedule are ever candidates.
CREATE INDEX "products_due_idx" ON "products" USING btree ("next_capture_at")
  WHERE "next_capture_at" IS NOT NULL;--> statement-breakpoint

-- 4 ------------------------------------------------------- query dedup key
ALTER TABLE "capture_runs" ADD COLUMN "normalized_query" text;--> statement-breakpoint
CREATE INDEX "capture_runs_normalized_idx" ON "capture_runs"
  USING btree ("normalized_query", "started_at" DESC NULLS LAST);--> statement-breakpoint

-- 5 ------------------------------------------------- tracking = the user link
--
-- Deliberately NOT given its own capture schedule. Putting one here is exactly
-- how "one call per user per product per day" happens; the schedule lives on
-- the product so the market is captured once and read by everyone.
ALTER TABLE "tracked_products" ADD COLUMN "id" text;--> statement-breakpoint
ALTER TABLE "tracked_products" ADD COLUMN "status" "tracking_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "tracked_products" ADD COLUMN "search_query" text;--> statement-breakpoint
ALTER TABLE "tracked_products" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "tracked_products" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "tracked_products" SET "id" = 'trk_' || replace(gen_random_uuid()::text, '-', '') WHERE "id" IS NULL;--> statement-breakpoint
ALTER TABLE "tracked_products" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tracked_products_id_key" ON "tracked_products" USING btree ("id");--> statement-breakpoint
CREATE INDEX "tracked_products_user_idx" ON "tracked_products" USING btree ("user_id", "status");
