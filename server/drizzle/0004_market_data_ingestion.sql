ALTER TYPE "public"."marketplace_type" ADD VALUE 'unclassified';--> statement-breakpoint
ALTER TABLE "capture_runs" ALTER COLUMN "marketplace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "capture_runs" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "capture_runs" ADD COLUMN "source_query" text;--> statement-breakpoint
ALTER TABLE "marketplaces" ADD COLUMN "is_discovered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "capture_runs_provider_query_idx" ON "capture_runs" USING btree ("provider","source_query","started_at" DESC NULLS LAST);