-- A LIVE PRODUCT HAS NO TAXONOMY, AND SAYING OTHERWISE WOULD BE A FABRICATION
-- ===========================================================================
--
-- `brand_id`, `category_id` and `product_type_id` were NOT NULL because every
-- product came from a seed file that had already classified it. A product
-- discovered from a marketplace title has none of them: "Apple iPhone 15
-- (128GB) — Blue" states a brand if you squint, and says nothing at all about
-- which category tree node it belongs under.
--
-- The alternatives were both worse than widening the column:
--
--   - invent an "Unclassified" brand/category/type and point every live
--     product at it, which puts three fake taxonomy rows in the database and
--     makes "unclassified" look like a real category in every facet;
--   - guess from the title, which is the same class of mistake as guessing a
--     price.
--
-- Null means "not yet known", which is the truth. Classification can happen
-- later, from evidence, without a migration.
--
-- Widening a NOT NULL constraint is safe: every existing row already
-- satisfies the looser rule, and nothing is rewritten.

ALTER TABLE "products" ALTER COLUMN "brand_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "category_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "product_type_id" DROP NOT NULL;--> statement-breakpoint

-- The spec-schema check assumed a classified product. A live product is
-- purchasable and has no spec schema, which the old rule forbade.
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_purchasable_has_spec_schema";--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_purchasable_has_spec_schema"
  CHECK ("origin" <> 'seed' OR NOT "is_purchasable" OR "spec_schema_version" IS NOT NULL);
