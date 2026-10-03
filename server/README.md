# Mulya server

The backend for the marketplace pricing intelligence platform.

**Phase 5** moved the competitor and cross-marketplace analysis engines here
from the frontend, behind two authenticated endpoints. **Phase 4** exposed the
marketplace data graph. **Phase 2** built the database. **Phase 3** added authentication and the API
foundation. A follow-up change replaced the credential with **email +
password**, leaving one-time codes to verify an address and authorise a
reset. Analysis, competitor and pricing-recommendation services still live in
the frontend and move server-side in a later phase.

Architecture and the reasoning behind the stack:
[`../docs/BACKEND_ARCHITECTURE.md`](../docs/BACKEND_ARCHITECTURE.md).

---

## Quick start

```bash
cd server
cp .env.example .env
# set AUTH_SECRET — the file tells you how to generate one
npm install

npm run db:migrate -- --reset             # create the schema
cd .. && node scripts/export-dataset.mjs  # materialise the legacy dataset
cd server && npm run db:seed              # load 389,534 rows
npm run db:verify                         # 37 integrity checks
npm test                                  # 54 tests
npm run dev                               # http://localhost:4000
```

The default driver is **PGlite** — PostgreSQL 17 compiled to WebAssembly,
in-process, nothing to install. It is the same engine and the same SQL as a
real server, so the migrations you run here are the migrations that run in
production. `NODE_ENV=production` refuses to start with it.

---

## Authentication

### The model

Two different things that are never merged:

| | |
|---|---|
| **`users`** | a person signing in to this product |
| **`sellers`** | a merchant observed on Amazon, Flipkart, Meesho, Myntra, AJIO or Nykaa |

They share no key and no table. Merging them would turn "which of my
competitors is also a customer" into a schema question instead of a product
one.

**The credential is email + password.** A one-time code is never a way to log
in; it does exactly two jobs, and the database enforces the difference:

| `otp_challenges.purpose` | what it authorises |
|---|---|
| `email_verification` | proving the address at signup |
| `password_reset` | replacing a forgotten password |

A `CHECK` constraint admits those two values and nothing else — `login` was
removed in `0003_password_auth.sql`. The code hash is additionally salted by
purpose, so even if the two ever met, the digest would not match.

Email uniqueness is enforced by a **functional unique index on `lower(email)`**,
not by the application remembering to normalise. `Ada@x.com` and `ada@x.com`
are one account at the database level.

### Passwords

`argon2id` via the `argon2` package, at the library defaults — 64 MiB, 3
iterations, 4 lanes — which sit on OWASP's recommendation for new
applications. They are restated explicitly in `lib/password.ts` so that
raising the cost is a visible diff rather than an inherited surprise.

Nothing is hand-rolled: the library owns the salt, the encoding and the
verification, and the digest string carries its own parameters, so the cost
can be raised later without invalidating existing hashes.

The policy is deliberately short — length 8–128, no leading or trailing
space, and a small common-password denylist:

- **No character-class rules.** They reliably produce `Password1!`. Length is
  the requirement that actually correlates with strength.
- **No confirm-password field.** It is a second chance to make the same typo,
  and it is why people pick passwords they can type twice rather than ones
  they can remember. The reveal toggle does the same job honestly.
- The 128 ceiling is **not** a strength rule. It stops a multi-megabyte
  request body becoming a memory-hard hashing job.

`password_hash` is nullable for one reason only: accounts predating password
authentication have none. `login` refuses a null digest outright and sends
those users through reset. It is **never** returned by any endpoint, and
`/auth/me` is asserted against that in the test suite.

### The flows

```
REGISTER          POST /auth/register        → 201, account created UNVERIFIED,
                                                no session, verification code sent
                  POST /auth/verify-email    → 200 { token, expiresAt, user }

SIGN IN           POST /auth/login           → 200 { token, expiresAt, user }

RESET             POST /auth/forgot-password → 202, always the same answer
                  POST /auth/verify-reset-otp→ 200 { resetToken, expiresAt }
                  POST /auth/reset-password  → 200, every session revoked
```

Registering **does not sign anybody in**: the account exists with
`email_verified_at` null and is inert until the address is proven. Verifying
does sign the user in, because reaching that point required the password
*and* control of the mailbox, which is strictly more than a login
establishes.

Re-registering an address that exists but was **never verified** replaces the
password and resends a code. It is a corrected signup, not an error, and it
does not create a second row. A *verified* address is a hard 409.

### Not telling an attacker who has an account

Two places would otherwise become membership oracles, and both are closed:

| Endpoint | What it does |
|---|---|
| `POST /auth/login` | An unknown address and a wrong password return the **same code and the same message** (`INVALID_CREDENTIALS`, 401). The unknown path still pays for a decoy Argon2id verification, because otherwise the response *time* enumerates accounts however careful the wording is. |
| `POST /auth/forgot-password` | Always 202, always the same sentence. No work is done at all when there is no account. |

`EMAIL_NOT_VERIFIED` is checked **after** the password, deliberately.
Announcing it to anyone who types an address would leak which addresses have
accounts; announcing it to someone who has already proved they know the
password leaks nothing they did not know, and they are the only person who
can act on it.

`POST /auth/resend-verification` answers identically whether the account is
missing, already verified, or genuinely waiting.

### Reset: two calls, one code

`verify-reset-otp` issues a short-lived token and **does not consume the
challenge**; `reset-password` consumes it. That keeps "one code, one password
change" true across a two-step flow, makes the token single-use and revocable
for free, and lets an abandoned reset expire on its own. The token is stored
hashed on the challenge row — a stateless signed token would need its own
invalidation story.

A completed reset **revokes every session on the account**. A reset is a
recovery action: the person performing it may not be the person signed in,
and if the account was compromised, the attacker's session is exactly what
must not survive.

### How codes are protected

| Control | Setting | Why |
|---|---|---|
| Generation | `crypto.randomInt` | a predictable code is not a second factor |
| Storage | HMAC-SHA256 under `AUTH_SECRET`, salted with `purpose:email` | six digits is a million possibilities; a bare digest falls to a lookup table the moment the database leaks. The pepper is not in the database, and the salt stops a hash being replayed for the other purpose |
| Comparison | `timingSafeEqual` | a wrong code cannot be narrowed by timing |
| Expiry | `OTP_TTL_SECONDS` (600) | |
| Single use | `consumed_at`, set by a conditional `UPDATE … WHERE consumed_at IS NULL` | two simultaneous verifications both validate, but only one `UPDATE` matches a row |
| Attempts | `OTP_MAX_ATTEMPTS` (5), counted **before** comparison | a wrong guess always costs something |
| Resend | `OTP_RESEND_COOLDOWN_SECONDS` (60) | |
| Per address | `OTP_MAX_PER_EMAIL_PER_HOUR` (5) | |
| Per caller | `AUTH_RATE_LIMIT_MAX` per IP | one attacker with many addresses and many attackers with one address are different problems and need separate bounds |
| Reset token | `RESET_TOKEN_TTL_SECONDS` (900), stored hashed | only has to cover "type a new password" |

Verification targets only the **newest live** challenge, so an older
outstanding code cannot be used after a resend, and a successful verification
consumes every other outstanding code for that address.

### Sessions — why opaque tokens, not JWT

Opaque 256-bit random strings, stored only as an HMAC, sent as
`Authorization: Bearer <token>`.

The decisive reason is **logout**. Revoking a stateless JWT needs a denylist,
which is a session table with extra steps and worse failure modes. A secondary
reason: an opaque token carries no claims, so nothing sensitive can leak from
it by construction — a requirement that is satisfied here by having nothing to
leak rather than by remembering what not to put in.

A bearer header rather than a cookie because the frontend (Vercel) and the API
(Railway) are different registrable domains, where third-party cookie blocking
would make a `SameSite=None` session unreliable in several browsers.

There is deliberately **no refresh-token rotation**. A 30-day opaque session
that can be revoked server-side is the right amount of machinery for this
product today.

---

## API

Base path `/api/v1`. Every response is JSON. Every error is the same shape:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "…", "details": [ … ] } }
```

`code` is what clients branch on and never changes wording; `message` is for
humans. Nothing else is ever in an error body — no stack, no SQL, no internal
identifiers.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/health` | – | liveness only; discloses nothing about the infrastructure |
| `POST` | `/api/v1/auth/register` | – | 201; creates an UNVERIFIED account and sends a code; no session |
| `POST` | `/api/v1/auth/resend-verification` | – | 202; neutral whether the account exists or is already verified |
| `POST` | `/api/v1/auth/verify-email` | – | 200 with `{ token, expiresAt, user }` — verifies and signs in |
| `POST` | `/api/v1/auth/login` | – | 200 with `{ token, expiresAt, user }`; 401 `INVALID_CREDENTIALS`; 403 `EMAIL_NOT_VERIFIED` |
| `POST` | `/api/v1/auth/forgot-password` | – | 202; always the same answer |
| `POST` | `/api/v1/auth/verify-reset-otp` | – | 200 with `{ resetToken, expiresAt }`; does not consume the code |
| `POST` | `/api/v1/auth/reset-password` | – | 200 with `{ sessionsRevoked }`; spends the code, revokes every session |
| `POST` | `/api/v1/auth/logout` | bearer | 204; idempotent |
| `GET` | `/api/v1/auth/me` | bearer | 200 with `{ user }` |
| `GET` | `/api/v1/products` | – | page, pageSize, search, category, productType, brand, marketplace, sort |
| `GET` | `/api/v1/products/:id` | – | identity + specs + variant siblings |
| `GET` | `/api/v1/categories` | – | `?parent=root` for departments, `?level=n` |
| `GET` | `/api/v1/categories/:id` | – | + ancestors, children, product types |
| `GET` | `/api/v1/brands` | – | paginated, searchable |
| `GET` | `/api/v1/marketplaces` | – | all six |
| `GET` | `/api/v1/products/:id/marketplaces` | – | where a product is sold, and its state on each platform |
| `GET` | `/api/v1/products/:id/listings` | – | page, pageSize, marketplace, status |
| `GET` | `/api/v1/products/:id/sellers` | – | page, pageSize, marketplace |
| `GET` | `/api/v1/products/:id/offers` | – | page, pageSize, marketplace, seller, inStock, fulfilment, condition, minPrice, maxPrice, hasPromotion, sort |
| `GET` | `/api/v1/products/:id/price-history` | – | page, pageSize, window, from, to, marketplace, seller, offer |
| `GET` | `/api/v1/products/:id/price-summary` | – | windows[], marketplace — current state beside several horizons |
| `GET` | `/api/v1/products/:id/reviews` | – | page, pageSize, marketplace |
| `GET` | `/api/v1/products/:id/rating-history` | – | window, from, to, marketplace |
| `GET` | `/api/v1/products/:id/promotions` | – | page, pageSize, marketplace, offer, availabilityClass, status |
| `GET` | `/api/v1/offers/:id/price-history` | – | page, pageSize, window, from, to |
| `GET` | `/api/v1/sellers/:id/rating-history` | – | page, pageSize |
| `GET` | `/api/v1/products/:id/competitors` | **bearer** | page, pageSize, tier, marketplace, minSimilarity |
| `GET` | `/api/v1/products/:id/analysis` | **bearer** | window, from, to, marketplace |

Product **detail deliberately omits** prices, offers, reviews and competitors.
Those are separate resources with their own pagination and their own cost;
folding them in is how a detail endpoint becomes the slowest call in a system.

### Marketplace data

The endpoints above serve the **existing seeded dataset**. Nothing scrapes,
nothing fetches a marketplace, and no row is created by any of them — every
one is read-only. Live ingestion is a later phase; these are the tables it
will populate.

#### One effective price

`universalEffective` is the basis every comparison uses, and it is computed
once — in `src/lib/priceLadder.ts` as SQL, which is a translation of
`src/utils/priceLayers.js` and nothing else:

```
landed             = sellingPrice + shipping
universalEffective = landed − Σ(universal promotions active that day), floored at 0
conditionalBest    = universalEffective − Σ(conditional promotions), floored at 0
```

A promotion is active when `valid_from <= date <= valid_to`, inclusive,
treating a null bound as open. Cashback and no-cost-EMI benefits appear in
the response but enter no rung — money returned later, or interest someone
else absorbs, is not a price.

Every response carrying a price also carries `priceBasis`, so no client has
to infer which rung it received.

`tests/price-history.test.ts` asserts the SQL and the JavaScript agree on 330
real observations across ten rungs — 3,300 comparisons — with the fixture
sampled at every promotion's validity boundary, because an off-by-one there
changes the price on exactly two days in a hundred.

#### Observation windows

`?window=` accepts `1d` `2d` `3d` `7d` `15d` `1m` `3m`. A window is a date
range, **inclusive of both ends**, measured back from the dataset's most
recent capture — not from the wall clock, which would make every window
empty, and not from a constant, which would break the moment the data is
regenerated. The range actually used is always reported:

```json
"meta": { "referenceDate": "2026-08-14", "window": { "key": "7d", "days": 7 },
          "range": { "from": "2026-08-08", "to": "2026-08-14" } }
```

`?from=` and `?to=` override the window for questions the seven horizons do
not cover; the response then reports `window: null` rather than claiming one.

**A window's length and its evidence are different facts.** This dataset
captures on a tiered cadence, so a 3-day window on a product observed every
two days holds exactly the same two capture days as the 2-day window. Both
report their real range and their real count, and the two do not have to
move together.

#### What a window is allowed to claim

Statistics are computed on the **daily series** — in-stock observations only,
reduced to the cheapest effective price per capture day. That matches
`getProductPriceSeries` in the frontend engine, and the match matters: a
median over raw observations counts a marketplace once per offer it happens
to have, so a platform with six sellers would outvote one with a single
seller.

What the series supports is decided by its COUNT, never by the window's
length:

| points | capability | reported |
|---|---|---|
| 0 | `none` | nothing at all — `statistics: null`, not zeroes |
| 1 | `snapshot` | a level. No change, no spread |
| 2–4 | `directional` | change, min, max, mean |
| 5+ | `distributional` | + median, quartiles, volatility |

Every withheld statistic says why, in `withheld`, so an interface can explain
a gap rather than leave one. The median is the linear-interpolated percentile
— the same definition the frontend engine uses.

#### Source URLs

`listings.listing_url` is populated for all 2,947 listings and is exposed
directly as `sourceUrl` on the listing, marketplace-summary and offer
responses. Nothing is generated: the value is the column, and a test asserts
each one points at the domain its own marketplace row declares.

> **These URLs do not resolve.** The dataset is synthetic — the URLs were
> generated at seed time with the right shape for each marketplace, not
> captured from a real page. They are the right field to build a "View on
> Flipkart" link against once real ingestion exists, and they are not right
> to click today. Nothing in the API pretends otherwise.

Alongside the URL, every listing and offer carries `externalListingId` (the
ASIN, FSN or equivalent), `marketplaceId` and capture timestamps — the
identifiers a future URL-comparison feature needs to map a pasted link back
onto a known listing.

#### Pagination

`page` / `pageSize`, the same contract as the Phase 3 endpoints, returning
`{ data, pagination: { page, pageSize, total, totalPages, hasNext, hasPrevious } }`.
`pageSize` is capped at 100; history endpoints default to 100 rather than 24
because observations are dense.

Offset pagination rather than cursor, deliberately. Cursors win on a feed
that grows at the head while you read it; this is an append-only historical
table read in bounded windows, where a page count is genuinely useful and
nothing shifts underneath a reader. Every sort ends with an id tiebreaker, so
two rows of equal price cannot swap between pages and hide a record.

#### Filtering and sorting

Filters are validated against the database before the query runs: a
well-formed marketplace id that does not exist is a **400 that lists the
valid ids**, not an empty page — the ids are `mp_amazon_in` rather than
`amazon`, and a client that guessed deserves to be told which.

Sorts are an enum mapped to SQL from a closed table; no client string ever
reaches an `ORDER BY`. Price filters and price sorts both act on the
effective price, so a filtered list is never mis-sorted against its own
filter.

#### Performance

Measured, not assumed. `EXPLAIN ANALYZE` over the full 354,940-row
observation table, on the heaviest product in the catalogue:

| query | time | sequential scans |
|---|---|---|
| daily series, product + 1-month window | 32 ms | none |
| daily series, product + marketplace + 3 months | 9 ms | none |
| observation page, product + window | 5 ms | none |
| latest observation per offer, product | 9 ms | none |
| offer history | 0.2 ms | none |
| widest case — 3-month series, heaviest product | 52 ms | none |

**No index was added.** The Phase 2 indexes already cover every access path
this phase introduced — `listings_product_idx`, `offers_listing_idx`,
`offers_seller_idx`, `price_obs_offer_date_idx (offer_id, observed_at desc)`,
`promotions_offer_idx`, `review_snapshots_listing_idx` and
`seller_ratings_seller_idx`. Adding more without a query that needed them
would be cost with no benefit. (These numbers are PGlite, which is
WebAssembly; a native server is faster.)

### Analysis and competitors

Two endpoints, and unlike everything above them they require a **bearer
token**. Catalogue and marketplace data describe public marketplaces; this
is the derived intelligence built on top of them, which is the product
rather than the raw material.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/v1/products/:id/competitors` | bearer | page, pageSize, tier, marketplace, minSimilarity |
| `GET` | `/api/v1/products/:id/analysis` | bearer | window, from, to, marketplace |

Both are served by **one** `CompetitorService`, so the two can never
disagree about who competes with what. A test asserts it.

#### What a competitor is

Ported from `src/utils/competitiveSet.js` without alteration. The unit of
competitive evidence is the **competitive identity** — `parentProductId ??
productId` — not the product row:

- ten sellers undercutting each other on one listing is **one** product competing
- the same product on three marketplaces is still **one** product
- two variants of one model are **one** pricing decision, so they hold one slot

Seven stages: score every candidate of the same product type → hard
exclusions → tier assignment → deduplicate by identity → outlier fence →
rank and cap → evidence weight.

| Tier | Meaning |
|---|---|
| `direct` | Contests the same purchase: similarity ≥ 0.55, inside a 0.6×–1.7× price band, not the same model family |
| `comparable` | Informs what the market pays: similarity ≥ 0.40, inside 0.45×–2.2×. Real evidence, weighted at 0.6 |
| `reference` | Same product type, outside that range. Describes the distribution; never anchors, never votes |

Every non-direct member carries a `tierReason` saying which gate it missed.

**Similarity** is a weighted mean of four terms — specifications 0.45, price
segment 0.25, brand tier 0.15, marketplace overlap 0.15 — and a term that
cannot be scored has its weight **redistributed** rather than filled with an
invented value. Specification comparison runs over the full attribute
schema, with pricing-relevant attributes weighted double.

A missing attribute is `missing`, never `differ`. An absent specification is
unknown, not different, and scoring it as a difference penalises a product
for a gap in our capture rather than a gap in the product. It lowers
`coverage` instead.

**Evidence weight** is `similarity × dataQuality × tierFactor`. This is the
number that stops a padded set buying confidence: `effectiveComparables` —
the sum of weights, not the raw count — is what drives the coverage level.

A competitor sharing **no** marketplace with the target is excluded outright:
no buyer chooses between the two, so it is not evidence about this market.

#### Coverage, and refusing

| level | condition |
|---|---|
| `strong` | ≥ 5 direct competitors and ≥ 3.5 effective |
| `adequate` | ≥ 5 members and ≥ 2.75 effective |
| `thin` | ≥ 3 members |
| `insufficient` | fewer than 3 |

Below three the market cannot be described — a median is the midpoint of two
numbers and a spread is meaningless — so **the analysis returns no findings
at all**. The observation layers are still returned, because they are real;
what disappears is the interpretation. Where the target is missed, the
response carries counted `shortfallReasons` rather than a sentence, so a
client learns that four candidates shared no marketplace without parsing
prose.

#### Findings

A finding is a statement that needed at least two dimensions to reach.
Eleven are produced, each carrying the figures behind it:

`cheapest_is_best_trusted` · `price_tracks_trust` · `platform_spread` ·
`shipping_reorders` · `per_unit_reversal` · `vs_comp_median` ·
`trust_vs_comps` · `spec_position` · `historical_position` · `availability` ·
`match_confidence`

```json
{
  "id": "platform_spread",
  "dimension": "Marketplace",
  "direction": "neutral",
  "headline": "The same product spans 17.3% across platforms",
  "metrics": { "spreadPct": 17.3, "spreadMinor": 8800, "cheapestMarketplaceId": "mp_nykaa", … },
  "evidence": [ { "marketplaceId": "mp_nykaa", "effectiveMinor": 50900 }, … ]
}
```

**No prose is generated here.** The backend returns metrics and evidence; the
interface phrases them. That is what keeps a finding checkable — a sentence
cannot be verified against the database, a number can.

Every block is guarded by the evidence it needs, so a finding cannot be
produced without its support:

| Missing | Suppressed |
|---|---|
| Fewer than 3 priced marketplaces | every cross-marketplace finding |
| No quantity-bearing attribute | `per_unit_reversal` |
| Fewer than 4 observations in the window | `historical_position` |
| Fewer than 3 comparables | **all** findings |

`direction` says which pricing posture a finding argues for. Note that a
high historical percentile argues `aggressive` — little headroom left — and
a low one argues `premium`. A distorted market argues neither.

#### Windows

The same seven horizons as Phase 4, and `from`/`to` overrides them — which
is how a caller asks for the product's whole observed history. The response
reports the range it used, and `window: null` when a range was given.

Historical findings are computed over the selected window, so
`?window=7d` and `?window=3m` genuinely answer different questions rather
than relabelling one answer.

#### The analysis context

One context, built once per request in **eight batched queries**, shared by
every finding. The frontend rebuilds pieces of it per finding because that
is free in memory; here it would be a query storm. Nothing scales with the
candidate count — the largest product type holds 29 products, and the
per-candidate signals (current price, reviews, marketplace set, data
quality) are four queries over the whole set, not four per member.

#### Parity with the frontend engine

The frontend engine is the source of truth. The backend is a translation of
it, and `tests/analysis-parity.test.ts` asserts the two agree across ten
golden products — **115 assertions** over competitive-set membership, tiers,
similarity and its four components, evidence weight, data quality, spec
match counts, coverage level, marketplace rows, price/trust correlation,
historical statistics, the 90-day normal and its distortion, per-unit
figures, competitor price gaps, trust deltas, and finding presence, absence,
dimension and direction.

The fixture is generated by `scripts/export-analysis-parity-fixture.mjs`,
which runs on the frontend side because the engine's modules use Vite-style
extensionless imports the backend runner cannot resolve.

**Two things are deliberately not migrated**, and the parity test requires
the difference to be exactly these:

| Not migrated | Why |
|---|---|
| the `wtp` finding | it is the hedonic willingness-to-pay **model** |
| `buildBridge` | it maps the three strategy prices into the analysis |

Both are the pricing recommendation rather than inputs to it. They follow in
the next phase. Every response states this in `meta.notMigrated` so an
intentional omission is never mistaken for a bug.

#### Performance

Measured on the heaviest golden product, against the full 354,940-row
observation table:

| | queries | time |
|---|---|---|
| `/competitors` | 8 | ~1.0 s |
| `/analysis` | 12 | ~0.8 s |

No sequential scans. **No cache and no index were added**: the cost is
dominated by the competitive set's per-candidate work, which is already
batched, and a cache would need invalidating on every observation — for a
sub-second endpoint that is machinery bought with nothing. If the candidate
pool ever grows by an order of magnitude this is the first place to look.

(These numbers are PGlite, which is WebAssembly; a native server is faster.)

### Pricing recommendation

One endpoint, bearer token, built entirely on top of the analysis above —
there is no second competitor computation anywhere in this service.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/v1/products/:id/recommendation` | bearer | `marketplace`, `model` |

There is deliberately **no `window` parameter**. A recommendation is measured
against the product's whole observed history — its 90-day normal, its
distortion reading and its history-depth check all are — so narrowing the
history would not ask a different question, it would ask the same one with
less evidence. An earlier draft did accept a window, and it computed the
"90-day normal" from a 30-day slice and moved the anchor with it.

#### The pipeline

```
DATA → MARKET ANALYSIS → COMPETITIVE CONTEXT → HISTORICAL CONTEXT
     → VALUE SIGNALS → CONSTRAINTS → RECOMMENDATION → EXPLANATION
```

**Anchor.** A blend of the product's own in-stock market and its 90-day
normal, 65/35. With a single own offer the weight shifts to 0.75 inside a
±10% band; with none, the evidence-weighted comparable median stands in.

**Hard constraints, in this order.** Ceiling: 110% of the highest pool price,
or the applicable MRP where that is lower — the MRP is a legal ceiling, not a
preference. Floor: 92% of the cheapest pool price, capped at 85% of the
ceiling, raised to the break-even price where a seller cost exists. If the
floor ends up above the ceiling, **no price is emitted** — every legal price
would be loss-making, and a number there would be worse than useless.

**Three strategies**, each clamped into `[floor, ceiling]` and snapped to a
credible ending on a grid that coarsens with price (₹10 / ₹50 / ₹100, minus
one). Snapping steps back inside the bounds when rounding pushes it out.

**Travel.** How far any strategy may move from the anchor is capped by the
evidence level — `high` 1.0, `medium-high` 0.8, `medium` 0.55, `low` 0.35 —
so a thin comparable set produces a smaller claim rather than a bolder one.

**Evidence.** Ten weighted checks (breadth, weighted depth and coherence at
weight 2; history, competition, cost, fees, MRP, match quality and promotion
visibility at weight 1), scored out of 13 and then **capped by competitive
coverage**: a `thin` set cannot produce `high` confidence however well the
other checks score. Below three comparables the service refuses outright.

#### The attribute model, and its two versions

A hedonic regression of log(price) on standardised pricing-relevant
attributes across the comparable set. It answers "does the market actually
pay more for the ways in which this product is better?", and on this dataset
the answer is usually no — which it says, rather than inventing a premium.

| `model=` | fit | trusted when |
|---|---|---|
| `baseline-v1` *(default)* | OLS | in-sample adjusted R² ≥ 0.5 |
| `hedonic-cv-v2` | ridge, penalty chosen by exact leave-one-out CV | **out-of-sample** LOOCV R² ≥ 0.5 |

Same features, same target, same design matrix — the two share
`usableFeatures` and `designMatrix` precisely so any difference between them
is the fitting method and nothing else.

v2 exists because the baseline's gate was measured and found too loose: of
477 products whose attribute model it trusts, **226 fail cross-validation,
and on exactly those it predicts worse than copying the competitive median**
(18.7% MAPE against 17.8%, RMSE 29% higher). The full evaluation — including
a forward test with comparables priced 45 days before the target — is in
[`docs/PRICING_MODEL_RESEARCH.md`](../docs/PRICING_MODEL_RESEARCH.md).

`baseline-v1` remains the default because Phase 6's job was to move the
validated engine unchanged, and 77 parity assertions hold it to that.
Promoting v2 drops the share of products receiving an evidenced premium from
58% to 30%; that is the correct number, and it is a product decision rather
than a migration detail.

Whatever the version, the model may move the Balanced strategy by at most 25%
of the anchor, damped by the evidence level, and only when its own gate
passes. Every response states the version that produced it, in both
`data.model.version` and `meta.modelVersion`.

#### No model is trained, and that is deliberate

There is no training step, no stored artifact and no inference server,
because there is no global model to store. The regression is a **local fit
over one product's comparables** — 5 to 32 rows, three or four features —
solved in microseconds inside the request. A `DATA → TRAIN → VERSION → STORE
→ LOAD → INFERENCE` lifecycle would be machinery around a computation
cheaper than the query that feeds it.

What would change that is a model pooled across products, which this dataset
does not support: a price-on-attributes model is only comparable *within* a
product type, and the largest product type here holds 32 products.

#### What it will not claim

This dataset contains no units sold, no conversion rate, no inventory
quantity and no customer-level willingness to pay. So the service does not
produce an "optimal price" and does not model demand or elasticity. It states
its own target variable in every response —
`predicts: "market_value_estimate_from_observed_listing_prices"` — and the
attribute factor carries `interpretation: "association_not_causation"`,
because the model observes that the market prices certain attributes higher
and does not establish that those attributes cause the price.

#### Refusals are first-class

| `reason` | meaning |
|---|---|
| `insufficient_comparables` | fewer than three usable comparables, or the evidence checks failed |
| `no_current_price` | nothing in stock, so there is no market to price into |
| `constraint_conflict` | the floor rose above the ceiling; every legal price is loss-making |

A refusal carries `status: "insufficient_evidence"`, `recommendation: null`,
an empty `strategies`, a structured `missing` list, and the competitor
context it *did* have — with `statistics: null`, because a median over one or
two comparables is arithmetic rather than a market, and publishing it under
that heading would hand back as evidence the very thing the refusal says is
absent. `constraintConflict` distinguishes the third case from the first two:
a seller needs to know whether it is the data or their own cost blocking the
sale.

#### Explanation, not prose

Structured factors — `competitive_position`, `historical_position`,
`attribute_value`, `evidence_level` — each with a direction, an impact in
minor units where one exists, and its evidence. The backend composes no
sentences. A sentence cannot be checked against the database; a number can.

#### What the response carries, since Phase 7

The recommendation screen reads this endpoint and nothing else, so the response
has to carry everything that screen states. Added in Phase 7, all of it derived
where the price is rather than in the browser:

| field | what it is |
|---|---|
| `marketContext.zones` | the competitive pool as named bands, with its composition |
| `marketContext.competition` | offers, sellers and listings on this product |
| `marketContext.currentPriceLayers` | the cheapest offer's full ladder, MRP to effective |
| `strategies[].position` | where that price would sit among the prices a buyer chooses between |
| `strategies[].margins` | what it earns on each marketplace, net of fees and GST |
| `commercial` | seller cost, fee rule and break-even per marketplace |
| `viability` | whether the market will pay what the seller needs |
| `sanityChecks` | the checks that run before a number is shown, with their figures |
| `strength` | how this product compares on the attributes the market prices |
| `competitorContext.excluded` / `.reference` / `.diversity` / `.method` | what was screened out and why, and how the set was built |
| `policy` | the policy figures a caller may need to quote, so it keeps no copy |
| `marketplaces` | named platforms, on both the recommended and refused paths |

An excluded competitor carries a structured `exclusion` — `above_mrp` with the
price and the MRP, `no_shared_marketplace` with both marketplace sets,
`same_model_family` with the variant that kept the slot — because "why is this
not a benchmark?" deserves the figures, and the client composes the sentence.

Phase 8 added two more, both of which Phase 5 had recorded in
`meta.notMigrated` as belonging here rather than to the analysis:

| field | what it is |
|---|---|
| `bridge` | the analysis screen's "therefore": the findings partitioned by the direction each argues for, and where each strategy sits against the product's own market and the comparable median |
| `wtpFinding` | the attribute model stated as a finding, in the same shape the analysis uses, so the screen can list it beside the other nine |

Neither is new logic. The findings are the analysis service's, the prices are
already decided, and the percentages are ratios between numbers in the same
response.

#### Performance

Measured over all 1,172 products with
`npx tsx src/scripts/recommendation-baseline.ts`:

| | value |
|---|---|
| p50 / p90 / p99 / max | 542 ms / 1,155 ms / 1,741 ms / 2,089 ms |
| queries per recommendation | **36 — identical for every one of the 1,172** |
| attribute model | a 3–4 column solve on ≤32 rows; does not register |

36 for a product with one comparable and 36 for a product with thirty-two,
which is the whole point: nothing scales with the competitor pool, so there is
no N+1. The count comes from wrapping `execute`, because latency alone would
hide two hundred fast queries on a local database. The recommendation reuses
the analysis context wholesale, so the competitive set is computed **once** per
request.

(PGlite is WebAssembly in-process; a native server is faster.)

#### The catalogue-wide baseline

| | |
|---|---|
| recommended | **1,043** |
| refused | **129** — 111 `insufficient_comparables`, 18 `no_current_price` |
| MRP / floor / ceiling / ordering / CF-1 violations | **0** |
| contradictions, errors | **0** |

**`hedonic-cv-v2` produces the same 1,043 / 129 with the same 111 / 18 split
and zero violations.** That is the design working: which attribute model is in
force changes the size of an evidenced premium, never whether a product can be
priced at all. Switching models cannot strand a product.

Earlier phases recorded "1,156 purchasable → 1,043 recommended / 113 refused".
That denominator was wrong: there are **1,154** products with a purchasable
offer and 18 with none, and 113 + 16 = 129, so the total never moved. Confirmed
by asking the frontend engine the same question over the same 1,172 products
(`node scripts/engine-recommendation-baseline.mjs`) — it returns 1,043 / 129
with the same 111 / 18 split and zero constraint conflicts. The script asserts
the reasons as well as the total, because a total that matches while the reasons
have shifted is the kind of agreement that should not pass.

### Validation

Fastify JSON schema, enforced before a handler runs. Unknown query parameters
and unknown body fields are **rejected**, not ignored — Fastify's AJV defaults
to `removeAdditional: true`, which silently strips them, so that default is
turned off. A typo in a filter name is a client bug and should fail loudly.

A well-formed filter id that does not exist (`?category=cat_nope`) is a **400
with field detail**, not an empty page, for the same reason.

---

## Architecture

```
route (schema validation)
  → controller/handler
    → service          rules, shaping, what a client may see
      → repository     all SQL; nothing above this writes a WHERE clause
        → Drizzle
          → PostgreSQL
```

```
src/
  app.ts               composition root — everything is wired here and nowhere else
  server.ts            listen and shut down; no wiring
  config/env.ts        parsed and validated once; nothing reads process.env directly
  lib/                 errors, email normalisation, OTP, passwords, tokens, pagination
  email/               the port + memory / console / http adapters
  plugins/             error handling, auth decorator
  modules/
    auth/              repository · service · routes
    catalogue/         repository · service · routes
  db/                  schema, client
  scripts/             migrate, seed, verify
```

`buildApp()` being the only place that wires anything is what lets a test
construct a complete application against an in-memory database and a capturing
email adapter, with no globals to reset and no network to stub.

---

## Email

The auth service depends on an **`EmailAdapter` port**, never on a provider
SDK. It cannot tell where a message went, which is why adding SMTP changed no
authentication code — the only auth-side change was the failure path, because
delivery could not fail before.

```
AuthService ──▶ EmailAdapter ──┬── memory   tests
                               ├── console  development, no mailbox
                               ├── http     a transactional-email API
                               └── smtp     a real mail server (Gmail)
```

| Adapter | Use | Behaviour |
|---|---|---|
| `memory` | tests | captures messages in an array for assertion |
| `console` | development | logs that a message was sent, to a **masked** address. The body — which contains the code — is printed only when `EXPOSE_OTP_IN_RESPONSE` is on |
| `http` | production | posts to any transactional-email API; endpoint and key from the environment |
| `smtp` | local development, or production | Nodemailer over TLS. Verifies its connection at startup and sends real mail |

`memory` and `console` deliver nothing, so production refuses both. `http` and
`smtp` both deliver, and choosing between them is operational.

No credential appears in source. Every provider setting is read from the
environment, and tests assert that the adapters contain no literal key and
that `SMTP_PASS` is referenced exactly once — in the transport's auth block.

### Gmail SMTP for local development

Set this up once and real verification and reset codes arrive in your own
inbox, which is the only way to see the whole flow work.

**1 — Use a Gmail account you are willing to send application mail from.**
A separate account is better if you have one: an App Password grants SMTP
send on whichever account issues it.

**2 — Turn on 2-Step Verification.**
Google Account → Security → 2-Step Verification. App passwords do not exist
without it.

**3 — Create an App Password.**
Google Account → Security → 2-Step Verification → App passwords. Name it
something like `Mulya local`. Google shows a 16-character value once.

> **`SMTP_PASS` must contain a Google App Password, not your normal Gmail
> account password.** Gmail refuses the account password over SMTP anyway,
> and putting it in a file would expose the entire Google account instead of
> one credential you can revoke on its own.

**4 — Put it in `server/.env`** — never in `.env.example`, and never in a
commit:

```
EMAIL_ADAPTER=smtp
EMAIL_FROM=your-address@gmail.com

SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-address@gmail.com
SMTP_PASS=your-16-character-app-password

EXPOSE_OTP_IN_RESPONSE=false
```

**5 — Check it before relying on it.**

```bash
npm run email:check -- you@gmail.com
```

This verifies the transport and sends one real message with a placeholder
code, printing the adapter, host, masked account and delivery time. It prints
no credential. If the message does not arrive, look in spam — a brand-new
sending account is often filtered on its first message.

**6 — Start the server.** `npm run dev`. If the credential is wrong it says so
immediately, rather than at somebody's signup.

### What is enforced, and why

| Rule | Reason |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` are each required, **by name** | "SMTP configuration is incomplete" sends you reading your own `.env` line by line |
| `EMAIL_FROM` must equal `SMTP_USER` | Gmail will not send as an address the authenticated account does not own. It rewrites the header silently, so the mail arrives looking wrong and nothing reports an error |
| `EXPOSE_OTP_IN_RESPONSE` must be `false` | Returning the code as well as mailing it would hide a broken send completely |
| The transport is **verified at startup** | A handshake and an AUTH exchange, sending nothing, costing a few hundred milliseconds. A wrong App Password becomes a refusal to start, not a stranded user |
| A failed send **deletes its own challenge** | The resend cooldown is measured from the newest challenge. Without this, a failed delivery answers the user's retry with "please wait 47 seconds" for an email that never left |

Port `465` with `SMTP_SECURE=true` is implicit TLS and is the simplest thing
that works. Port `587` with `SMTP_SECURE=false` upgrades through STARTTLS and
is the fallback when 465 is blocked. Both encrypt before authenticating.

**Startup verification is not part of `/health`.** That endpoint is
unauthenticated and deliberately discloses nothing about the infrastructure;
adding an SMTP probe would both advertise the transport and make liveness
depend on a third party. Configuration is proven once, at boot, where a
failure can still stop the rollout.

### One honest trade-off

`forgot-password` normally answers `202` whether or not the account exists. If
SMTP is down it answers `502` — but only for addresses that *do* have an
account, since no send is attempted for the others. During a mail outage that
is a narrow membership oracle.

It is deliberate. The alternative is swallowing delivery failures and telling
every user a code is on its way when none is, which is a worse failure and one
nobody would notice. The window is the length of the outage, and the fix for
it is fixing the outage.

### Message content

Plain text and HTML, no links and no images. A code typed by hand cannot be
consumed by a corporate link scanner and gives a phishing lookalike nothing to
imitate. The HTML is a single-column table with inline styles and system
fonts, because Gmail strips `<style>` blocks and web fonts.

Nothing internal appears in either part — no user id, no session, no request
id. An email is the least trustworthy place a system's internals can end up.

| Purpose | Subject |
|---|---|
| `email_verification` | Verify your Mulya account |
| `password_reset` | Reset your Mulya password |

---

## CORS and logging

CORS origins come from `CORS_ORIGINS` (comma separated). Production refuses a
wildcard and refuses plain `http` for anything that is not localhost —
credentialed cross-origin requests cannot use `*`.

Logging is structured (pino) with `authorization`, `cookie`, `body.code`,
`body.otp`, `body.password`, `body.newPassword`, `body.currentPassword`,
`body.passwordHash` and `body.resetToken` redacted at the logger. Addresses are **masked** before they are
logged. A one-time code is never written to a log, because a log sink outlives
the ten-minute window the code itself is bounded by.

---

## Tests

```bash
npm test              # 444 tests
npx tsx --test tests/auth.test.ts      # one file
```

Node's built-in test runner via `tsx` — no additional framework. HTTP is
exercised with `app.inject()`, so nothing binds a port.

| File | Covers | Tests |
|---|---|---|
| `tests/auth.test.ts` | AUTH-REG, AUTH-VER, AUTH-LOGIN, AUTH-RESET, AUTH-SEC | 34 |
| `tests/email-and-api.test.ts` | EMAIL-01…04, API-01…05 | 11 |
| `tests/catalogue.test.ts` | PROD-01…12, CAT, BRAND, MARKET | 17 |
| `tests/regression.test.ts` | REG-11, REG-12, Phase 2 baseline | 9 |
| `tests/smtp.test.ts` | SMTP-01…SMTP-12 (stubbed transport) | 32 |
| `tests/smtp-socket.test.ts` | SMTP-13 — a real SMTP conversation | 6 |
| `tests/marketplace.test.ts` | MKT, LIST, SELL, OFFER, PROMO, REV + golden records | 40 |
| `tests/price-history.test.ts` | HIST, PRICE + price-ladder parity | 24 |
| `tests/analysis.test.ts` | COMP-01…12, ANALYSIS-01…12 + security | 30 |
| `tests/analysis-parity.test.ts` | PARITY-01…10 against the frontend engine | 115 |
| `tests/pricing-parity.test.ts` | REC-01…10, WTP-01…07 against the frontend engine | 77 |
| `tests/pricing.test.ts` | CON-01…07, STRAT-01…05, SPARSE-01…06 invariants | 19 |
| `tests/pricing-model.test.ts` | ML-01…10 plus the two rules mutation testing exposed | 22 |
| `tests/pricing-security.test.ts` | auth, token forgery, parameter rejection, leakage | 8 |

### Isolation

Every run gets **its own PostgreSQL**: `new PGlite()` with no path is a real
engine held entirely in memory. Tests cannot reach the development database,
which is what makes the destructive authentication tests safe. Each test uses
its own email address and its own source IP, so the suite does not depend on
execution order.

`tests/regression.test.ts` is the exception — it reads the **real** development
database, because "did Phase 3 disturb Phase 2's data?" cannot be answered
against a fixture. It only ever reads, and skips with instructions when the
database has not been seeded.

### What the tests assert

Behaviour and state, not status codes.

Registration is checked to create exactly one challenge row, store a digest
rather than the code, invoke the email port with the right recipient, and
write a credential matching `/^$argon2id$/` that does not contain the
password. A reset is checked to produce a *different* digest from the one
before it, to make the old password stop working and the new one start, and
to leave the pre-reset session token rejected by `/auth/me`. A wrong password
and an unknown address are compared with `deepEqual`, so a difference in
wording would fail. Pagination is checked to return *different records* on
page two, not merely a 200.

Two checks are about the source rather than a response: that the logger's
redact list names the credential fields, and that no module under `src/`
(outside the email adapters, which *are* the delivery channel) hands a
credential to the logger. Both were mutation-tested — a deliberately planted
`request.log.info({ userId, password })` made them fail before it was
reverted.

---

## Deploying to Railway

```
Vercel (frontend)  →  Fastify on Railway  →  PostgreSQL on Railway
```

`railway.json` sets the build, the start command and `/health` as the
healthcheck. Set the service **root directory to `server`**.

Required variables:

```
NODE_ENV=production
DB_DRIVER=postgres
DATABASE_URL=<Railway Postgres connection string>
AUTH_SECRET=<48 random bytes, base64url>
CORS_ORIGINS=https://your-frontend.vercel.app
EMAIL_ADAPTER=http
EMAIL_API_URL=<provider endpoint>
EMAIL_API_KEY=<provider key>
EMAIL_FROM=Mulya <no-reply@yourdomain>
```

Production **refuses to start** if `DB_DRIVER` is not `postgres`, if
`EXPOSE_OTP_IN_RESPONSE` is on, if `EMAIL_ADAPTER` is not `http`, or if
`CORS_ORIGINS` contains a wildcard or a non-localhost `http` origin. These are
startup failures rather than warnings, because a warning in a deploy log is a
warning nobody reads.

Migrations do not run automatically on boot — several replicas starting at once
would race. Run them as a one-off:

```bash
npm run db:migrate:prod     # node dist/scripts/migrate.js, no tsx needed
```

### Migrating is not the same as having data

**A migrated database is an empty one.** `seed-data/` is gitignored — 137 MB of
generated NDJSON that a clone deliberately does not carry — so a fresh deploy
reaches a state that looks entirely healthy and is not:

| | |
|---|---|
| migrations | 4 applied, 25 tables |
| `GET /health` | `{"status":"ok"}` |
| sign-up, OTP, login, password reset | all working — auth needs no catalogue |
| **any product page** | **"No product with id prod_…"** |

The product pages are the only ones that need the catalogue, so this failure
appears long after everything else looks right. Load the data:

```bash
# On a machine that already has seed-data/ — 137 MB, about 5 MB compressed:
tar -czf seed-data.tar.gz -C server seed-data
scp -i key.pem seed-data.tar.gz ubuntu@<host>:~/WebScrapper/server/

# On the server:
cd ~/WebScrapper/server && tar -xzf seed-data.tar.gz && rm seed-data.tar.gz
npm run db:seed:prod        # node dist/scripts/seed.js, no tsx needed
npm run db:verify:prod      # 37 integrity checks, non-zero exit on failure
```

Generating the dataset **on** the server with `node scripts/export-dataset.mjs`
also works, but it needs Vite and the frontend's dependencies installed there
and builds the whole catalogue in memory — on a 1 GB instance, copy it instead.

`npm run db:seed` and `db:verify` use `tsx`, which is a devDependency; the
`:prod` variants run the compiled `dist/` output, so they work after
`npm ci --omit=dev`. Note that `db:verify` reads `seed-data/manifest.json` to
compare row counts, so it needs the dataset present too.

`trustProxy` is on, so `request.ip` is the caller rather than the load
balancer; without it every per-IP limit would be shared by the entire internet.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | watch-mode server |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | run the built server |
| `npm test` | the full suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | regenerate `drizzle/*.sql` from the schema |
| `npm run db:migrate` | apply outstanding migrations (`-- --reset` to drop first) |
| `npm run db:migrate:prod` | same, from `dist/`, without devDependencies |
| `npm run db:seed` | truncate the seeded tables and load from `seed-data/` |
| `npm run db:seed:prod` | same, from `dist/`, without devDependencies |
| `npm run db:verify:prod` | same, from `dist/`, without devDependencies |
| `npm run db:verify` | 37 integrity checks; non-zero exit on failure |
| `npm run email:check -- you@example.com` | verify the transport and send one real test message |

Measurement scripts, run directly with `tsx`. None of them is part of the
suite, because each takes minutes and answers a question you ask on purpose:

| Command | What it does |
|---|---|
| `npx tsx src/scripts/recommendation-baseline.ts` | every product through the recommendation: 14 table counts, recommended/refused against the project baseline, the safety violations that must be zero, latency percentiles and queries per request. Add `--model hedonic-cv-v2` to score the other version. Non-zero exit on any difference. |
| `npx tsx src/scripts/analysis-performance.ts` | times the three requests the analysis screen makes and counts their queries, so an N+1 cannot hide behind a fast local database. |
| `npx tsx src/scripts/export-backend-recommendations.ts` | regenerate `tests/fixtures/backend-recommendations.json` — the real payloads the recommendation screen reads. |
| `npx tsx src/scripts/export-backend-analysis.ts` | regenerate `tests/fixtures/backend-analysis.json` — the `/analysis`, `/recommendation` and `/price-summary` payloads the analysis screen reads, with the parameters it uses. A diff in either is a change to a contract a screen depends on. |
| `npx tsx src/scripts/evaluate-pricing-models.ts` | scores the naive competitive median, `baseline-v1` and `hedonic-cv-v2` on held-out prediction across the catalogue, cross-sectionally and forward in time. This is where the numbers in `docs/PRICING_MODEL_RESEARCH.md` come from. |

Some scripts live on the frontend side, because they need Vite to resolve the
engine's extensionless imports:

| Command | What it does |
|---|---|
| `node scripts/export-price-parity-fixture.mjs` | regenerate `server/tests/fixtures/price-ladder-parity.json` from `src/utils/priceLayers.js`. A diff in that file is a change to the pricing basis — regenerate deliberately. |
| `node scripts/export-analysis-parity-fixture.mjs` | regenerate `server/tests/fixtures/analysis-parity.json` from the competitive-set and cross-marketplace engines. A diff is a change to the analytical engine. |
| `node scripts/export-pricing-parity-fixture.mjs` | regenerate `server/tests/fixtures/pricing-parity.json` from `src/utils/pricingEngine.js` — the recommendation baseline. A diff is a change to the pricing model. |
| `node scripts/audit-ml-feasibility.mjs` | counts what the dataset does and does not contain: demand signals, price variation, time structure, within-type sample sizes, target-variable candidates. |

---

## Defects found by writing this phase

Recorded because each one was invisible until something asserted against it.

**Correlated subqueries silently returned zero.** Interpolating a Drizzle
column inside a raw `sql` subquery renders it **unqualified**, so
`where l.marketplace_id = ${marketplaces.id}` became
`where l.marketplace_id = "id"` — which the inner scope resolves to
`listings.id`. Every `productCount` and `listingCount` in the catalogue was 0.
It passed a shape check (`typeof === "number"`) and only failed once a test
asserted AJIO had listings.

**Pattern injection in search.** Binding a parameter stops SQL injection but
not LIKE-pattern injection: a search for `%` returned the entire catalogue.
Metacharacters are now escaped so user input matches literally.

**Collation-dependent ordering.** `ORDER BY canonical_name` sorted "AGARO"
before "Accu-Chek" under PGlite's collation — and a managed Postgres need not
agree, so dev and production could have ordered differently. Sorting on
`lower(...)` makes it deterministic and matches what a reader expects.

**Fastify strips unknown fields by default.** `additionalProperties: false`
had no effect because AJV's `removeAdditional` was on, so a request carrying a
misspelled field was accepted as if correct.

**A custom rate-limit `errorResponseBuilder` broke the error shape**, turning
every 429 into a 500. The central error handler now renders it, so there is one
place that formats errors rather than two.

**Phase 6 — four defects in the recommendation port, all found by parity.**
The first parity run passed 30 of 77. None of the four causes was visible by
reading the code or by looking at a rendered recommendation.

- *The 90-day normal was computed over a window.* Accepting a `window`
  parameter scoped the price series, so the "90-day normal" came from a 30-day
  slice — and since the anchor blends the own market with that normal 65/35,
  every anchor was wrong. The parameter is gone.
- *The evidence checks counted marketplaces where the engine counts offers.*
  One product has 6 marketplaces and 29 in-stock offers, so the competition
  check and the promotion-visibility share used a denominator five times too
  small. That shifted the evidence score by one weight-1 check on **every**
  product, which moved the confidence level, the travel damping, the premium
  headroom and all three strategy prices.
- *MRP inflation was measured against the comparable median* instead of the
  product's own current price, so a marked-down chair looked mispriced and
  lost an evidence point it had earned.
- *The normal had no fallback chain* — 90-day, else 60-day, else own market,
  else comparable median. Only the first was implemented.

**And one latent defect in the baseline engine, reproduced deliberately.**
`candidateFeatures` filters candidates on a finite `targetValue` while the
customer-rating feature's target is still `NaN`; the caller substitutes the
real rating afterwards. Rating is therefore declared a hedonic feature and can
never be fitted. Porting it faithfully meant reproducing that, with the
reasoning recorded at the point of the quirk — correcting it silently would
change prices across the catalogue with no evidence of improvement.

**Two gaps in the response, found by writing the invariant tests.**
`evidence` was reported on refusals but not on recommendations, so the
assessment that decided a price was worth emitting was invisible on the prices
it authorised. And a refusal did not distinguish "not enough comparables" from
"no valid price exists" — different problems for a seller, since one is about
the data and the other about their own cost.
