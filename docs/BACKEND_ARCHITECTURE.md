# Backend architecture — decision record

**Status:** Phase 1 complete (audit + architecture). Phase 2 complete (database + migration).
**Date:** 2026-09-27

This document is the output of Phase 1. It records what the system is today, what
it becomes, and — more importantly — *why*, so that later phases and later
readers can disagree with a decision on its merits rather than guessing at intent.

---

## 1. Audit: what exists today

### 1.1 Repository shape

The git repository root **is** the frontend (`D:/advance dsa sir/frontend`). There
is no backend of any kind: no Java, no Python, no Go, no Dockerfile, no SQL, no
server directory. The `CLAUDE_CONTEXT.md` note that a "Java REST API" is next is
a statement of intent, not existing code — see §2.1, where that intent is
revisited.

Deployment is Vercel, building the Vite app from the repository root, with a
single SPA rewrite in `vercel.json`.

### 1.2 Current data flow

```
React page/component
      ↓  (useAsyncData hook)
src/api/*Service.js          ← 7 modules, already shaped like REST endpoints
      ↓  (await mockDelay(), then direct import)
src/data/*.js                ← 19 in-memory arrays, built at module load
      ↓
src/utils/*.js               ← the analytical core, reading data/ directly
```

Two properties of this layout matter enormously for the migration:

1. **The API boundary already exists.** `src/api/` modules are written as though
   they were HTTP endpoints — each has a `GET /api/...` comment, each awaits a
   simulated delay, each returns a response-shaped object. They are the seam the
   backend plugs into, and they were designed to be.
2. **The analytical core does not go through that seam.** `pricingEngine.js`,
   `competitiveSet.js`, `crossMarketplaceAnalysis.js`, `storeSignals.js`,
   `observationWindows.js` and `demoSet.js` import `src/data/` *directly*, and
   pages import several of them directly too. Moving data behind HTTP therefore
   does **not** on its own move the analysis — that is its own phase.

### 1.3 The dataset

Nineteen entity types, ~390,000 rows, dominated by one table:

| Entity | Rows | | Entity | Rows |
|---|---:|---|---|---:|
| price observations | 354,940 | | brands | 314 |
| review snapshots | 9,962 | | categories | 179 |
| offers | 9,717 | | product types | 125 |
| promotions | 5,962 | | fee rules | 13 |
| listings | 2,947 | | capture runs | 9 |
| seller rating snapshots | 2,015 | | field coverage | 24 |
| sellers | 1,177 | | raw documents | 3 |
| products | 1,172 | | rejected records | 3 |
| attribute definitions | 545 | | seller cost inputs | 3 |
| marketplace categories | 418 | | marketplaces | 6 |

Most of it is **generated deterministically at module load** from a seeded PRNG
plus ~1,100 hand-authored seed rows. That is the single most important fact about
the migration: the dataset is not a file to copy, it is the *output of a program*.
It must be materialised before it can be loaded. See §6.

### 1.4 What must be preserved

- The entity chain **Product → Listing → Seller/Offer → Price Observation**, and
  the meaning of each link.
- Money as **integer minor units (paise)** end to end; formatting only at the
  display boundary.
- The **price ladder** (MRP → selling → shipping → landed → universal effective →
  conditional → net realisation) and the rule that comparison uses the universal
  effective price.
- **Append-only** observations with bitemporal `observed_at` / `recorded_at`.
- The verified engine invariants: 1,043 recommended / 129 refused across 1,172
  products, with zero MRP, floor, ordering or CF-1 violations.

---

## 2. Architecture decision

### 2.1 Stack: Node.js + TypeScript + Fastify + PostgreSQL + Drizzle

**Runtime — Node/TypeScript, not Java.** `CLAUDE_CONTEXT.md` has said since Stage
7 that a Java REST API comes next. That is revisited here, deliberately, and the
reason is the analytical core.

There are roughly 4,300 lines of carefully tuned JavaScript in `src/utils/`
implementing weighted interpolated quantiles, a least-squares hedonic fit with a
trust gate, four sequential competitive-set gates, the promotion-class price
ladder, and the observation-window capability ladder. The project's own rules
say *do not rewrite working pricing logic* and *do not duplicate business logic
between frontend and backend*. A Java backend forces a reimplementation of all
of it, and any numerical drift silently breaks guarantees that took four stages
to establish and verify.

Choosing Node means that code can **move** rather than be **rewritten** — the
same functions, byte for byte, executing server-side, with the existing
regression suite still meaningful. That is worth more than language preference.

**HTTP — Fastify over Express.** Schema-based request validation and response
serialisation are built in, which satisfies the "strong typing and request
validation" requirement without bolting on a second library; JSON serialisation
is materially faster, which matters for endpoints that return thousands of
observations.

**ORM — Drizzle over Prisma.** Three reasons:

1. Drizzle emits **plain `.sql` migrations** that a DBA can read and a reviewer
   can diff. Prisma's migration format is less transparent.
2. It is **driver-portable**: the identical schema and migrations run against
   `node-postgres` in production and against **PGlite** — real PostgreSQL
   compiled to WebAssembly — locally and in CI. That matters concretely here:
   *this development environment has no PostgreSQL server and no Docker*, so the
   alternative was shipping migrations that had never been executed. With PGlite
   the migrations and the seed are genuinely run and genuinely verified.
3. No Rust query-engine binary to ship or match to a platform.

The honest caveat: PGlite influenced this choice. It is not a neutral
preference. But the resulting property — migrations verifiable without a
database service — is a real advantage for CI regardless of the sandbox.

### 2.2 Repository shape

Phase 2 adds a **standalone** `server/` package. Workspaces are deliberately
*not* introduced yet:

```
/                        ← the web app; unchanged, Vercel keeps building it
  src/…
  package.json
  server/                ← NEW: the API. Own package.json, own node_modules.
    src/
      db/                ← schema, client, migrations
      config/            ← env loading and validation
      scripts/           ← seed, verify
    drizzle/             ← generated .sql migrations
  scripts/               ← NEW: dataset export (runs in the web app's Vite context)
  docs/                  ← NEW: this document
```

Introducing an npm workspace root now would pull the server's dependencies into
the Vercel install for no benefit, because nothing is shared yet. Workspaces and
a `shared/` package arrive in the phase that actually extracts the analytical
core — restructuring the root before there is something to share is churn.

### 2.3 Responsibilities

**Backend owns (end state):** persistence; all queries; the analytical core
(competitive set, cross-marketplace analysis, observation windows, store
signals); the pricing recommendation engine; authentication and authorisation;
ingestion and provenance.

**Frontend owns (end state):** requesting, rendering, and UI interaction —
including URL-synced view state, which is UI concern and stays client-side.

**Explicitly not duplicated:** no analytical computation may exist on both sides.
When a module moves server-side, the client copy is deleted in the same change,
not left behind "just in case".

### 2.4 Target flow

```
React → src/api/*Service.js → HTTP → Fastify route
                                       ↓ (validated request)
                                     Controller
                                       ↓
                                     Service        ← analysis / recommendation
                                       ↓
                                     Repository
                                       ↓
                                     Drizzle → PostgreSQL
```

The frontend's `src/api/` modules keep their names and return shapes. That is the
whole point of the seam: later phases swap their bodies from
`import { products }` to `fetch('/api/products')` **without any page changing**.

---

## 3. Database strategy

### 3.1 Identifiers

The mock dataset uses stable, human-readable string ids (`prod_dove_hair_fall`,
`lst_az_dove_hair_fall`). These are **kept as primary keys** rather than replaced
with surrogate UUIDs, for two reasons: the frontend already keys everything by
them, so keeping them means later phases change no component; and they make
production debugging and support conversations dramatically easier than opaque
UUIDs.

Correct uniqueness is then expressed by **composite constraints**, which is what
the brief was pointing at:

| Constraint | Why |
|---|---|
| `unique(marketplace_id, external_listing_id)` | An ASIN is unique on Amazon, not across marketplaces. Two platforms may legitimately use the same string. |
| `unique(marketplace_id, external_seller_id)` | Same reasoning for merchant ids. |
| `unique(marketplace_id, external_node_id)` | Same for marketplace category nodes. |
| `unique(product_id, marketplace_id)` | One listing per product per marketplace — the invariant the comparison page depends on. |
| `unique(listing_id, seller_id, item_condition)` | A seller offers a given condition once per listing. |
| `unique(offer_id, observed_at)` | One observation per offer per capture day. This is what makes the series append-only rather than append-mostly. |
| `unique(listing_id, captured_at)` | One review snapshot per listing per capture. |
| `unique(product_type_id, attribute_key, schema_version)` | The attribute registry is versioned, not overwritten. |

A `seller_group_id` column (nullable, indexed) carries cross-marketplace seller
identity without pretending a seller row is global: the row is marketplace-scoped
because a merchant's id, rating and fulfilment type are marketplace-scoped facts.

### 3.2 Money and time

All monetary columns are `integer` minor units, named `*_minor`, matching the
frontend exactly. The largest value in the catalogue is ₹22,490 (2,249,000
paise), four orders of magnitude inside `integer` range, so `bigint` would be
false precaution.

`observed_at` and `captured_at` are `date` (capture grain is a day).
`recorded_at` is `timestamptz` — the bitemporal pair is preserved: *when the
market was in this state* versus *when we learned it*.

### 3.3 Where JSONB is and is not used

JSONB is used for six columns, all of them genuinely schemaless **by design**,
because the project's attribute registry is schemas-as-data:

`products.specifications`, `products.variant_axes`, `products.identifiers`,
`attribute_definitions.buckets`, `review_snapshots.rating_distribution`,
`marketplaces.category_affinity`.

Everything else is a proper column with a proper type. The instruction not to
"copy the mock JSON into one giant table" is respected: this is 20 normalised
tables with 30 foreign keys, and the JSONB columns are the narrow set where a
relational shape would mean a table per product type.

`products.specifications` is indexed with a **GIN** index, because spec filtering
is a first-class query pattern on the catalogue page.

### 3.4 Enumerations

Closed sets use PostgreSQL enums rather than free text, so the database rejects
an invalid `match_status` or `availability_class` rather than trusting every
writer: lifecycle status, match status, listing status, seller type, fulfilment
type, item condition, offer status, promotion type, promotion availability class,
capture run status, attribute data type, filter type, mapping method, user role.

`promotions.availability_class` deserves special mention: it is **derived** in
the frontend by `classOf(promotionType)`, and it decides whether a discount moves
the comparison price. It is materialised as a stored, constrained column so the
rule lives in the schema rather than in whichever consumer remembers to apply it.

### 3.5 Indexes

Chosen from the query patterns actually present in `src/api/` and `src/utils/`,
not speculatively:

- `listings (product_id)` — every product page.
- `listings (marketplace_id)`, `listings (match_status)` — the sources page.
- `offers (listing_id)`, `offers (seller_id)`.
- `price_observations (offer_id, observed_at DESC)` — the single hottest path:
  latest observation per offer, and per-offer history.
- `price_observations (observed_at)` — window queries across the catalogue.
- `review_snapshots (listing_id, captured_at DESC)`.
- `promotions (offer_id)`, `promotions (valid_from, valid_to)` — active-on-date.
- `products (category_id)`, `(product_type_id)`, `(brand_id)`,
  `(parent_product_id)` — catalogue faceting and variant families.
- `sellers (marketplace_id)`, `sellers (seller_group_id)`.
- GIN on `products.specifications`.

### 3.6 Entities added beyond the mock data

- **`users`** — email, password hash, role, timestamps. No user data exists in
  the mock set; the table is modelled now so Phase 3 has something to
  authenticate against.
- **`tracked_products`** — the join table behind the frontend's
  `AppStateContext`, which currently holds tracked ids in React state.
- **`seller_cost_inputs`** gains a nullable `user_id`. Cost is a per-seller fact,
  and once there are users it belongs to one; nullable keeps the three existing
  rows loadable today.

---

## 4. API strategy

REST, versioned under `/api/v1`, resource-shaped, mirroring the existing service
modules one-to-one so the swap is mechanical:

| Existing frontend service | Endpoint |
|---|---|
| `catalogueService.getCatalogue` | `GET /api/v1/catalogue` |
| `productsService.getProductDetail` | `GET /api/v1/products/:id` |
| `listingsService.getMarketplaceComparison` | `GET /api/v1/products/:id/marketplaces` |
| `listingsService.getListingDetail` | `GET /api/v1/listings/:id` |
| `priceHistoryService.getPriceHistoryForListing` | `GET /api/v1/listings/:id/price-history` |
| `recommendationService.getRecommendation` | `GET /api/v1/products/:id/recommendation` |
| `dashboardService.*` | `GET /api/v1/dashboard/*` |
| `dataSourcesService.*` | `GET /api/v1/sources` |
| *(new, from Stage 18/20)* | `GET /api/v1/products/:id/analysis` |
| *(new, from Stage 20)* | `GET /api/v1/products/:id/signals`, `…/windows` |

Rule 7 — do not expose the database directly — is enforced by never returning a
row: every endpoint returns the same purpose-built response object the frontend
service returns today. There is no generic `/api/table/:name`.

---

## 5. Migration strategy (mock → PostgreSQL)

The dataset is generated at module load, and the generators use Vite-style
extensionless imports that Node cannot resolve. So the migration is two explicit
steps, each independently runnable:

```
npm run export:dataset     (repo root)  Vite resolver → NDJSON in server/seed-data/
npm run db:seed            (server/)    NDJSON → PostgreSQL, batched, FK order
npm run db:verify          (server/)    counts + referential + domain invariants
```

Splitting them keeps the server free of any build-time dependency on the
frontend source tree. The export step is a **migration tool with a finite life**:
once the database is the source of truth it is deleted, not maintained.

Verification is not just row counts. It re-asserts the domain invariants the
project already guarantees — no negative selling price, no effective price above
MRP, no duplicate `(offer, observed_at)`, no orphaned foreign keys — because a
seed that loads 390,000 rows and quietly drops a relationship is worse than one
that fails.

---

## 6. Phase status

- **Phase 1 — audit + architecture.** Complete; this document.
- **Phase 2 — database + migration.** Complete; see §3 and §5, and
  `server/README.md` for how to run it.
- **Phases 3–8** — not yet specified by the brief. Expected shape: authentication,
  read APIs, moving the analytical core server-side, the recommendation service,
  ingestion, and deployment.
