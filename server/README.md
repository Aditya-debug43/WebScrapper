# Mulya server

The backend for the marketplace pricing intelligence platform. Phase 2 of 8:
**database and data migration**. There is no HTTP layer yet — that is Phase 3
onward. What exists today is the schema, the migrations, and a verified load of
the entire legacy dataset.

See [`../docs/BACKEND_ARCHITECTURE.md`](../docs/BACKEND_ARCHITECTURE.md) for the
architecture decision and the reasoning behind the stack.

---

## Quick start

```bash
cd server
cp .env.example .env
npm install

npm run db:migrate -- --reset      # create the schema
cd .. && node scripts/export-dataset.mjs && cd server
npm run db:seed                    # load 389,534 rows
npm run db:verify                  # 37 integrity checks
```

The default driver is **PGlite** — PostgreSQL 17 compiled to WebAssembly,
running in-process against `./.pglite`. Nothing to install, no Docker, and it is
the same engine and the same SQL as a real server, so the migrations you run
here are the migrations that run in production.

## Running against a real PostgreSQL

```bash
docker compose up -d               # from the repository root
# then in server/.env:
#   DB_DRIVER=postgres
#   DATABASE_URL=postgresql://mulya:mulya@localhost:5432/mulya
npm run db:migrate
```

`NODE_ENV=production` refuses to start with `DB_DRIVER=pglite`; the environment
schema enforces it.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run db:generate` | Regenerate `drizzle/*.sql` from `src/db/schema.ts` |
| `npm run db:migrate` | Apply outstanding migrations |
| `npm run db:migrate -- --reset` | Drop the schema first (refuses in production) |
| `npm run db:seed` | Truncate the seeded tables and load from `seed-data/` |
| `npm run db:verify` | Counts, structure and domain invariants; non-zero exit on failure |
| `npm run typecheck` | `tsc --noEmit` |

---

## The migration, and why it has two steps

The legacy dataset is **not a file** — it is the output of a program. Roughly
1,100 hand-authored seed rows are expanded by a seeded PRNG at module load into
389,534 rows, and those modules use Vite-style extensionless imports that plain
Node cannot resolve.

So:

```
node scripts/export-dataset.mjs   (repo root)  Vite resolver → NDJSON
npm run db:seed                   (server/)    NDJSON → PostgreSQL
```

Splitting them keeps the server free of any build-time dependency on the
frontend source tree, and lets each half be run and inspected alone. The export
step is a **migration tool with a finite life**: when the database becomes the
source of truth, it and the generators are deleted together.

`seed-data/` is gitignored — 137 MB of derived data does not belong in version
control, and it is reproducible with one command.

---

## What the verifier actually checks

Row counts are the weakest possible check: a load can hit every count and still
have shredded the relationships. So `db:verify` asserts three things.

**Counts** — every table matches the export manifest.

**Structure** — no orphans on any foreign key, and the shape of the graph is
preserved as *distributions* rather than totals, because two products swapping a
listing would leave every total untouched:

```
listings per product   1→61  2→547  3→433  4→85  5→27  6→3
offers per listing     1→28  2→404  3→1551  4→587  5→376
```

**Domain** — the invariants the application already guarantees:

- no negative selling price or shipping fee
- nothing sells above its MRP (a legal ceiling in India, not a discount anchor)
- one observation per offer per capture day — what makes the series append-only
- one featured offer per listing per day — it is the cheapest in-stock landed
  price, so by definition there is one
- every promotion's `availability_class` matches its `promotion_type`
- a golden record: Dove Hair Fall Rescue Shampoo still has 6 listings, 30 offers
  and a cheapest landed price of ₹569 — the same figures the UI shows

One check reports rather than fails: **soft raw-document pointers**. Every
observation carries a `raw_document_id`, but raw HTML is retained under a far
shorter policy than the facts derived from it, so the target is routinely
absent. That is why the column is deliberately *not* a foreign key — a FK there
would make the retention policy fail the load.

---

## Two defects this phase surfaced

Both were found by the database asserting constraints that hold in reality and
that nothing in the frontend had ever checked.

**1. Duplicate marketplace seller ids.** 1,177 sellers produced only 949
distinct `(marketplace, external_seller_id)` pairs — 228 ids were each shared by
two genuinely different merchants ("Star Home" and "Star Home Mumbai"). The
generator truncated a 32-bit hash to its last seven base-36 characters. Nothing
read the field, so it went unnoticed. Fixed at the root in
`src/utils/sellerGenerator.js` by making the id unique by construction; the
engine regression is unchanged at 1,043 recommended with zero violations.

**2. Parent products carry no spec document.** The `products` table holds two
kinds of row: purchasable SKUs, and abstract family nodes like "Samsung Galaxy
M14 5G" that exist only to group their variants. Family nodes legitimately have
no specifications and therefore no schema version. `spec_schema_version` is
nullable, and a check constraint states the actual rule — *a thing you can buy
must declare its spec schema* — which holds on all 1,172 rows.

---

## Schema notes worth knowing before changing it

- **Money is integer minor units** in `*_minor` columns. Never a float.
- **External identifiers are marketplace-scoped.** An ASIN is unique on Amazon,
  not globally. Every external id is unique only in composite with its
  marketplace.
- **A seller row is marketplace-scoped too**, because a merchant's id, rating
  and fulfilment type are marketplace-scoped facts. `seller_group_id` carries
  cross-platform identity without pretending one row spans platforms.
- **`promotions.availability_class` is materialised, not derived.** It decides
  whether a discount may enter a price comparison, so the rule lives in the
  schema rather than in whichever consumer remembers to apply it.
- **JSONB is used in seven places only**, all genuinely schemaless by design:
  product specs, variant axes, identifiers, attribute buckets, rating
  distribution, marketplace category affinity, and promotion terms — the last
  because terms are polymorphic by promotion type across ten distinct shapes.
