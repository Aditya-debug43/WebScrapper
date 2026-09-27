# Mulya — Marketplace Pricing Intelligence

A working frontend prototype for a seller-side pricing tool: it takes what several
Indian marketplaces are charging for a product, works out what that product is
actually worth in its market, and explains how it reached that number.

The brief this was built for asked for a scraper. The evaluation criterion,
stated by the professor, was *"how you utilise data, how you organise data"* —
so the effort here went into the data model and the reasoning on top of it,
not into fetching HTML.

> **Status: frontend prototype on structured mock data.**
> There is no backend, no database and no live scraping. See
> [What is not built](#what-is-not-built) before drawing conclusions from it.

---

## The problem it addresses

A seller listing a product on Flipkart or Amazon has to pick a price. The
inputs are messy in a specific way:

- The "price" is not one number. MRP, selling price, delivery, instant
  discounts, bank offers, cashback and no-cost EMI are different things, and
  collapsing them produces a figure no real buyer ever pays.
- The same product exists as several *listings*, each with several *sellers*,
  each with their own *offer*. Counting those as separate competitors
  overstates how contested a market really is.
- Yesterday's price is not recoverable unless it was recorded at the time.

The prototype's answer is a model that keeps those distinctions and a
recommendation engine that refuses to produce a number when the evidence is
too thin to support one.

---

## Data model

Five entities, deliberately separated:

```
Product      the thing a buyer chooses — one row per real product,
             regardless of how many marketplaces sell it
  └─ Listing    one marketplace's page for that product
       └─ Offer      one seller's commercial terms on that listing
            └─ Price Observation   an immutable, timestamped reading
```

Alongside them: **Category / Product Type** (a four-level tree), an
**Attribute Definition registry** that decides which specs are legal and
filterable per product type, **Seller** (scoped to one marketplace, linked
across platforms only by `sellerGroupId`), **Review Snapshot** (per listing,
as a series), **Promotion** (per offer, classed by availability) and
**Fee Rule** (dated, per marketplace and category).

Two decisions carry most of the weight:

**Price observations are append-only.** Nothing overwrites a price. That is
the one mistake in this design that could not be repaired later — you cannot
go back and observe last month's price if you didn't record it.

**Promotions carry an availability class.** `universal` (everyone gets it at
checkout) is the only class that moves the comparison price. `conditional`
(specific bank card, coupon, exchange, membership), `deferred` (cashback) and
`financing` (no-cost EMI) are shown but never benchmarked — otherwise your
universally-available price gets compared against a rival's card-only price.

Specifications are per product type. 125 product types share no common
attribute: a saree has `saree_length_m`, dog food has `life_stage`, a pen has
`tip_size_mm`. No code anywhere knows those names — the filter sidebar and the
similarity model both read the registry.

---

## How the recommendation works

Roughly, in order:

1. **Build a competitive set.** Same product type, sharing at least one
   marketplace, scored on specifications (weighted by which attributes are
   pricing-relevant), price proximity, brand tier and marketplace overlap.
   Members are tiered *direct competitor* / *comparable* / *reference*, and
   deduplicated so one model family occupies one slot — three sellers of one
   product is one competitor, not three.
2. **Separate two markets.** The product's *own* in-stock offers (what this
   exact product sells for) are kept apart from the *competitive pool* (what
   rivals cost). They answer different questions and are held at different
   grains.
3. **Anchor.** Own market leads, reconciled against its own 90-day normal so a
   live promotion does not permanently reset the baseline.
4. **Test willingness to pay.** A least-squares regression of log(price) on the
   product type's pricing-relevant attributes across the comparable set. It
   reports its own fit and **abstains** below 5 observations or adjusted R² of
   0.5 — which, on this dataset, it does more often than it asserts.
5. **Bound it.** MRP is a legal ceiling; break-even is a floor. Three
   strategies — Fast Sale / Balanced / Premium — are produced within those
   bounds, and Premium may not rise above the product's own observed range
   without evidence from step 4.
6. **Explain it.** Every sentence on the recommendation page is generated from
   the numbers actually used, including the refusals.

The statistical component can only ever argue for a *premium offset*, never
set a price. The constraint layer sits outside it.

---

## Pages

Everything below the masthead requires a signed-in session.

| Route | What it shows |
|---|---|
| `/sign-in` | Email + password |
| `/create-account` | Registration — sends a verification code, does not sign you in |
| `/verify-email` | The six-digit code; verifying opens the session |
| `/forgot-password` | Starts a reset; answers the same whether or not the account exists |
| `/reset-password` | Code + new password; revokes every session and returns you to sign-in |
| `/` | Dashboard — the demonstration set, the chosen observation window, alerts |
| `/catalogue` | Faceted catalogue; filters are generated from the attribute registry |
| `/products/:id` | Product identity, specs, variant family, listings |
| `/products/:id/marketplaces` | The same product side by side across marketplaces |
| `/products/:id/analysis` | Cross-marketplace analysis across seven observation windows |
| `/listings/:id` | Every competing seller on one listing, with the full price ladder |
| `/listings/:id/history` | Price history, plotted on the effective-price basis |
| `/products/:id/recommendation` | The three strategies, constraints, evidence and comparable set |
| `/sources` | Capture runs, parse coverage and match confidence — the provenance layer |

---

## Authentication

The **only** part of this application backed by a real server. Everything
else still reads the generated dataset described below.

The credential is **email + password**. A one-time code is never a way to log
in: it proves an address at signup, and it authorises a password reset.

There is no fake session anywhere. There is no development bypass, no
hard-coded user, and no way to reach a protected route without a token the
backend issued and still honours:

- Only the token is stored in the browser, and it is re-validated against
  `/auth/me` on every load. Until that answers, the app is in a third state
  and renders neither the signed-in nor the signed-out interface.
- A response missing either a token or a user is refused outright rather than
  treated as a partial success.
- Signing out revokes the session on the server; the token stops working
  everywhere, not just in this tab.

The API base URL comes from `VITE_API_BASE_URL` and is never hard-coded. See
[`.env.example`](.env.example) — locally you need no env file at all, because
the dev server proxies `/api` to the backend.

---

## Mock data

Generated deterministically from a compact seed (`src/data/catalogueSeed*.js`)
by `src/utils/catalogueGenerator.js`, using a seeded PRNG so the same demo
always shows the same numbers.

| | |
|---|---|
| Departments / categories / product types | 14 / 179 / 125 |
| Products | 1,172 (1,156 purchasable + 16 variant parents) |
| Marketplaces | 6 (Flipkart, Amazon.in, Meesho, Myntra, AJIO, Nykaa) |
| Listings / Sellers / Offers | 2,947 / 1,177 / 9,717 |
| Price observations | ~355,000 |
| Review snapshots / Promotions | ~9,900 / ~6,000 |

The dataset is shaped, not padded. Commodity categories cluster tightly on
price; segmented categories span an order of magnitude; and some categories
(treadmills, action cameras, strollers, glucometers) are deliberately left
thin so the engine's refusal path has something real to refuse on.

Marketplace coverage is not uniform — verticals only carry the departments
they would actually sell.

---

## Running it

Requires Node 20+.

The catalogue, analysis and recommendation pages run entirely in the browser,
so the frontend alone is enough to look at them — but **sign-in is real**, so
you need the API running to get past the door.

Start the API first (see [`server/README.md`](server/README.md)):

```bash
cd server && npm install && npm run db:migrate && npm run dev
```

Then, in another terminal:

```bash
npm install
```

```bash
npm run dev
```

The dev server proxies `/api` to `http://localhost:4000`, so no `.env` file is
needed locally. Open the printed URL and create an account; with
`EXPOSE_OTP_IN_RESPONSE=true` the API prints the verification code to its own
console, so no mailbox is required.

To produce a production build:

```bash
npm run build
```

```bash
npm run preview
```

### Tests

```bash
npm test        # 30 interface and source-guarantee tests (Vitest)
npm run lint
npm run test:e2e   # the real app against a real API — nothing mocked
```

`test:e2e` creates a throwaway PostgreSQL, migrates it, starts the API, runs
the full register → verify → sign in → reset → sign out flow against it, and
tears everything down. It needs no running server of its own.

---

## What is not built

Being explicit, because the screens look more finished than the system is:

- **No live scraping.** Nothing fetches a marketplace. The capture runs on
  `/sources` describe a pipeline that does not exist yet.
- **The catalogue has no backend yet.** Products, listings, offers, prices and
  recommendations are in-memory JavaScript in the browser. A real database
  holding all of it exists in `server/`, but only the authentication endpoints
  are wired up so far; `src/api/*Service.js` is written as a REST client so
  those functions can be repointed without touching any page.
- **No trained ML model.** The willingness-to-pay component is a small
  least-squares regression fitted per request, not a trained artefact.
- **Authentication is real; nothing else is.** Accounts, sessions, email
  verification and password reset all go through the API and a real database.
  Tracked products are still browser state and reset on reload.
- **A fixed "today".** Price series are anchored to a hardcoded date, so
  relative phrasing like "7-day movement" is measured against that.
- **Brands and marketplaces are real; the numbers are not.** Prices, ratings,
  sellers and promotions are plausible inventions, not observations.

---

## Repository layout

```
src/
  api/          service layer — authService talks to the real API;
                the rest is the future backend swap point
  data/         the mock "database": entities, seeds, registries
  utils/        pricing engine, competitive set, price ladder, generators
  pages/        one file per route
  components/   presentational pieces
  state/        auth session, tracked products, theme
tests/          Vitest interface tests, source guarantees, and the e2e runner
server/         the Fastify + PostgreSQL API
```

Deeper design notes — the entity design, the reasoning behind each decision,
and the audit history — live in `CLAUDE_CONTEXT.md` at the repository root.
