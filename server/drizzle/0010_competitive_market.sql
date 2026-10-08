/*
 * COMPETITIVE MARKET
 * ==================
 *
 * A product's price cannot be argued from one seller's listing, which is all
 * the previous arrangement could hold. Two things were missing, and both are
 * about identity.
 *
 * 1. THE PROVIDER'S CATALOGUE IDENTITY. Every shopping result carries a
 *    catalogue id, and a second endpoint turns that id into the list of
 *    stores selling it. Without somewhere to keep the id there was no way to
 *    re-open a product's market later — only to re-run a text search, which
 *    answers a different question.
 *
 * 2. THE FACT THAT ONE PRODUCT HAS MANY CATALOGUE IDS. A search for one pair
 *    of headphones returns the same headphones under four different ids,
 *    each exposing a different two or three stores. Measured: one id yields
 *    three sellers, four ids yield ten. Treating a single id as the market
 *    undercounts competition by roughly a factor of three, silently.
 *
 * `product_catalog_ids` is therefore the CLUSTER — every provider id believed
 * to denote this product, with the evidence for believing it.
 *
 * `product_market_snapshots` is the daily competitive aggregate. Per-seller
 * series already live in `price_observations`, but sellers churn: one
 * appearing or dropping out would otherwise look like a price movement. The
 * aggregate is what a trend can honestly be drawn from.
 */

alter table products add column if not exists external_product_id text;
--> statement-breakpoint
comment on column products.external_product_id is
  'The provider catalogue id used to re-open this product''s market. Null for seeded rows.';
--> statement-breakpoint
create unique index if not exists products_external_product_key
  on products (external_product_id) where external_product_id is not null;
--> statement-breakpoint

create table if not exists product_catalog_ids (
  id                  text primary key,
  product_id          text not null references products(id) on delete cascade,
  provider            text not null,
  external_product_id text not null,
  /* The title under that id, kept verbatim: the evidence for the clustering. */
  title               text,
  /* The id search resolved to. The others were clustered onto it. */
  is_primary          boolean not null default false,
  /* Why this id is believed to be the same product. */
  match_confidence    real,
  /* How many stores it yielded last time, so low-yield ids can be skipped. */
  seller_count        integer,
  first_seen_at       timestamptz not null default now(),
  last_fetched_at     timestamptz
);
--> statement-breakpoint
create unique index if not exists product_catalog_ids_provider_key
  on product_catalog_ids (provider, external_product_id);
--> statement-breakpoint
create index if not exists product_catalog_ids_product_idx
  on product_catalog_ids (product_id);
--> statement-breakpoint
alter table product_catalog_ids add constraint product_catalog_ids_confidence_range
  check (match_confidence is null or (match_confidence >= 0 and match_confidence <= 1));
--> statement-breakpoint

create table if not exists product_market_snapshots (
  id                 text primary key,
  product_id         text not null references products(id) on delete cascade,
  captured_on        date not null,
  recorded_at        timestamptz not null,
  /* Distinct sellers, by provider merchant id, priced and usable. */
  seller_count       integer not null,
  /* Distinct stores those sellers trade on. */
  marketplace_count  integer not null,
  in_stock_count     integer not null,
  low_minor          integer not null,
  p25_minor          integer not null,
  median_minor       integer not null,
  p75_minor          integer not null,
  high_minor         integer not null,
  currency_code      text not null default 'INR',
  cheapest_seller_id text references sellers(id),
  /* How many catalogue ids were opened, and what it cost, for every row. */
  catalog_ids_used   integer not null default 1,
  provider_calls     integer not null default 0
);
--> statement-breakpoint
create unique index if not exists product_market_snapshot_day_key
  on product_market_snapshots (product_id, captured_on);
--> statement-breakpoint
create index if not exists product_market_snapshot_product_idx
  on product_market_snapshots (product_id, captured_on desc);
--> statement-breakpoint
alter table product_market_snapshots add constraint product_market_snapshots_ordered
  check (low_minor <= p25_minor and p25_minor <= median_minor
     and median_minor <= p75_minor and p75_minor <= high_minor);
--> statement-breakpoint
alter table product_market_snapshots add constraint product_market_snapshots_counts
  check (seller_count > 0 and marketplace_count > 0 and in_stock_count >= 0);
