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

| Route | What it shows |
|---|---|
| `/` | Dashboard — tracked products, 7-day movement, alerts |
| `/catalogue` | Faceted catalogue; filters are generated from the attribute registry |
| `/products/:id` | Product identity, specs, variant family, listings |
| `/products/:id/marketplaces` | The same product side by side across marketplaces |
| `/listings/:id` | Every competing seller on one listing, with the full price ladder |
| `/listings/:id/history` | Price history, plotted on the effective-price basis |
| `/products/:id/recommendation` | The three strategies, constraints, evidence and comparable set |
| `/sources` | Capture runs, parse coverage and match confidence — the provenance layer |

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

Requires Node 18+.

```bash
npm install
```

```bash
npm run dev
```

Then open the printed localhost URL. To produce a production build:

```bash
npm run build
```

```bash
npm run preview
```

---

## What is not built

Being explicit, because the screens look more finished than the system is:

- **No live scraping.** Nothing fetches a marketplace. The capture runs on
  `/sources` describe a pipeline that does not exist yet.
- **No backend and no database.** Everything is in-memory JavaScript. The
  conceptual schema is written up in the design documents, not implemented.
  `src/api/` is written as if it were a REST client so those functions can be
  repointed at a real service without touching any page.
- **No trained ML model.** The willingness-to-pay component is a small
  least-squares regression fitted per request, not a trained artefact.
- **No authentication, no persistence.** Tracked products reset on reload.
- **A fixed "today".** Price series are anchored to a hardcoded date, so
  relative phrasing like "7-day movement" is measured against that.
- **Brands and marketplaces are real; the numbers are not.** Prices, ratings,
  sellers and promotions are plausible inventions, not observations.

---

## Repository layout

```
src/
  api/          service layer — the future backend swap point
  data/         the mock "database": entities, seeds, registries
  utils/        pricing engine, competitive set, price ladder, generators
  pages/        one file per route
  components/   presentational pieces
  state/        tracked-product context
```

Deeper design notes — the entity design, the reasoning behind each decision,
and the audit history — live in `CLAUDE_CONTEXT.md` at the repository root.
