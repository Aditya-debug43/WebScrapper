# CLAUDE_CONTEXT.md — Marketplace Pricing Intelligence Project

**Purpose of this file:** this is a long-term handoff document. If a new Claude Code conversation starts months from now and is told "read `CLAUDE_CONTEXT.md` first," it should be able to understand the entire project — its origin, its reasoning, its current implementation, and what must not be casually changed — without the user repeating any prior conversation.

**Where this file lives:** `frontend/CLAUDE_CONTEXT.md` — inside the git repository, so it is versioned and pushed with the code it describes. It used to sit one directory above the repo root, which meant every update to it was invisible to GitHub. There is exactly one copy; do not create a second at the project root.

**How to use this file:** read it in full before making any non-trivial change. Sections 6 and 17 are load-bearing — they describe decisions and rules that should not be silently overridden. Everything else is context that explains *why* those rules exist.

**Honesty policy for this file:** everything below is either (a) something explicitly stated by the user or professor, (b) something actually implemented in the repository, or (c) explicitly marked as unresolved/unknown. Nothing is invented to make this document look more complete than the project actually is.

---

## 1. Project identity

- **Working name:** "Mulya" (the frontend's product name — see `frontend/index.html` title and the `Masthead.jsx` wordmark). Sanskrit/Hindi-derived word for "price/value," chosen for thematic fit with an Indian-marketplace pricing tool. Not a formally registered project name — just what the prototype calls itself.
- **What the system is:** a marketplace **pricing intelligence** tool. Given a product, it organizes data about where that product is sold, by whom, at what price, over time — and produces a price recommendation with visible reasoning.
- **What it is trying to achieve academically:** this began as a college assignment (advanced DSA course) whose real evaluation criterion, stated explicitly by the professor, is **data organization and data utilization** — not scraping ability. See §2.
- **What it is trying to achieve practically:** the professor who assigned this owns a company and uses this course partly to scout interns. The user's stated motivation (their words, paraphrased) is that doing this well matters to them beyond the grade — it's a chance at an internship.
- **Current stage of development:** a **frontend-only working prototype** (React, running on realistic mock data), built on top of a fully worked-out conceptual database design. No backend, no real scraping, no real database exists yet. See §13/§14 for a precise done/not-done breakdown.

---

## 2. Original problem statement

The assignment was given verbally by the professor and transcribed by the user. The transcript, preserved as closely to verbatim as possible:

> "scrapping, suppose i have a product and i have to sell it on platforms like flipkart, amazon, if i want to decide the price accurately, how i can do that, using crawlify, it basically analyse and scrap the data from the platforms like amazon flipkart etc, and suggest u to price, like this product should have thi price, you have to just take one page maybe from flipkart, first page, scrap it fully, all product should come, their sku's and their sku's price, category wise try that go deep as well to organize data as much as possible, initially start for only one page, the crawlify do the same thing, there are lot of scrappers available, u can also explore at home, but what i want to see is, how u utilise data, how u organise data"

**The literal deliverable, as stated:**
- Scrape one Flipkart page (first page only).
- Collect every product on it, with SKUs and SKU prices.
- Organize the data category-wise, "go deep" on organization.
- `crawlify` (an AI-powered extraction tool) was mentioned as the kind of tool available, but not mandated — "there are lot of scrapers available, you can also explore at home."

**Why scraping is explicitly *not* the point:** the professor's own closing line frames the entire assignment — *"what I want to see is how you utilise data, how you organise data."* Scraping is a commodity skill (BeautifulSoup/Scrapy/Playwright/Apify all solve it); it carries no signal about the person doing it. Data modeling — deciding what a Product is, how it differs from a Listing, how price should be stored so it supports future analysis — cannot be looked up, and directly tests whether the person understands the underlying business problem (a seller deciding what to charge).

**The business problem underneath the literal task:** *"I have a product, I want to sell it on Flipkart or Amazon — what price should I set?"* Everything in this project traces back to answering that question well, with visible reasoning, in a way that scales past one page and one category.

---

## 3. How the project evolved

The project moved through nine identifiable stages across (at least) two conversation sessions with Claude. This section is the project's memory — later stages sometimes revise earlier ones, and both the earlier version and the revision are worth keeping on record (see §20 for specific examples).

### Stage 1 — The literal task
As given by the professor (§2): scrape one page, collect products/SKUs/prices, organize category-wise.

### Stage 2 — Reframing
The user (correctly) identified that the professor's real test was data organization and future scalability, not the scraper itself, and explicitly asked Claude to think broadly: many categories, many marketplaces, many product types, many variants, future attributes, future analysis layers — and *not* to scope the design down to "one page, one category, one marketplace."

### Stage 3 — High-level data organization diagram
Claude produced (via the `excalidraw-diagram` skill) a **presentation-style hierarchy/tree diagram**, saved as `product-data-hierarchy.png`. Two attempts were made:
1. A first attempt in a workflow/flow style (scrape → normalize → classify → analyze), which the user rejected — they explicitly asked for a *data organization* diagram, not a *process* diagram.
2. The accepted version: a root node **"MARKETPLACE PRODUCT DATA"** splitting into two shaded panels:
   - **PRODUCT** ("the real item, one identity") — containing Classification (Marketplace/Category/Subcategory/Product Type), Product Identity (Brand/Model/Variant/Product Name/Internal ID), Specifications (Technical/Physical/Feature/Category-specific) — plus a separate **Source/Metadata** panel below it.
   - **LISTING** ("one per marketplace") — containing Listing Information and Reviews/Ratings, nesting inward to **SELLER** ("many per listing") → Seller Information → **OFFER** ("one per seller") → Offer Information (Current Price, MRP, Discount, Coupon/Bank Offer, Exchange Offer, Stock Status) and **Price History** (Past Prices, Date-wise Snapshots, Discount Changes, Price Trend).

The diagram's own organizing principle, stated on the diagram itself: **the further right and further down a box sits, the faster its data changes.** Brand (top-left) never changes; price (bottom-right, deepest) changes hourly. This principle became the throughline for every later design decision.

Two supporting documents exist from this stage, both still in the repo root:
- `Future-Proof Data model for Marketplace product and price intelligence.md` — a deep research-style report grounding the design in real standards (GS1 GPC, schema.org `Offer`/`AggregateOffer`, Amazon SP-API Product Type Definitions, DataWeave's published entity-resolution approach), including sample PostgreSQL DDL and a sample resolved-product JSON. This is the most technically detailed single document in the project.
- `product-data-hierarchy.png` — the diagram itself (Excalidraw-generated, editable).

### Stage 4 — Professor feedback: "this is just an overview"
Documented in the user's own framing when requesting the next stage: the high-level diagram was understood to be exactly that — high-level. The professor's implied/expected next question was database-level: *how would this actually be stored?* The user asked Claude to move from "what data exists" to "how it should be stored," explicitly requesting **no SQL yet** — conceptual database thinking first.

### Stage 5 — Conceptual database design
Produced two documents:
- `database-entity-design.md` — the core conceptual database design. Eight design principles (see §5/§6), then an entity-by-entity breakdown (Marketplace, Product, Classification, Product Identity, Specifications, Listing, Seller, Offer, Price History, Reviews/Ratings, Source/Metadata), a relationship summary, volatility tiers, and a "what this enables later" section tying every structural decision back to a concrete future capability (price comparison, competitor analysis, price history tracking, recommendation, adding new marketplaces).
- `Marketplace-Pricing-Intelligence-Database-Design.pdf` — a formal, professor-facing rewrite of the same content: no code, no "teach me" framing, written as a document meant to be handed in or presented directly.
- `pricing-intelligence-walkthrough.md` — a ten-stage **presentation/defense preparation** document: understanding the problem, thinking like an architect, designing the data, explaining every relationship with "what breaks if merged," mapping the diagram to the database, a speakable presentation script, **40 likely professor questions**, model answers to all 40, and a final honest self-review (strengths, weaknesses, assumptions, what a real production version would need). This document was written to help the user defend the design out loud, not just hand in a report.

Whether this presentation to the professor has actually happened yet is **unknown** — see §21.

### Stage 6 — Professor's next feedback: "give a working wireframe... how it actually works with client"
The user reported this as the professor's literal next request. This is the trigger for building an actual frontend rather than continuing to refine documents.

### Stage 7 — Frontend planning
In conversation (not saved as its own file), the user asked for a short brief on how a client-facing frontend should be organized — pages, purpose of each, user flow — explicitly *not* code, mockups, or wireframe tools. Claude proposed the eight-page structure that the actual implementation now follows almost exactly: Dashboard, Product Search & Catalogue, Product Overview, Marketplace Comparison, Listing Detail, Price History, Pricing Recommendation, Data Sources & Coverage — organized as a "narrowing funnel" whose navigation mirrors the entity chain (Product → Listing → Seller/Offer → Price History → Recommendation).

### Stage 8 — Frontend implementation
A new conversation session (continuing from the above context, files re-supplied via `@` references) instructed Claude Code to actually build a working React prototype, with a large, explicit specification:
- React (Vite), not vanilla JS, not another framework.
- Explicitly **not** a Node/Express backend — the frontend must be structured so a future **Java** backend can be swapped in later without a frontend rewrite.
- Mock data standing in for a future REST API, behind an async service layer.
- The eight pages from Stage 7, wired to the Product → Listing → Offer → Price History → Recommendation flow.
- Two reference UI screenshots supplied inline in the prompt (a course-platform UI and a CRM/kanban UI), plus two more image folders (`ui inspiration/`, `photos inspiraton/`) discovered in the repo containing four additional reference screenshots (a supplement-brand landing page, a yoga-studio landing page, a beauty-clinic landing page) — six reference images in total at that point, none of which are code and none of which are to be copied for content/branding, only for visual language.

Claude built the full application in this pass: mock entity data (14 files under `frontend/src/data/`), a pricing/recommendation engine, an async service layer, layout shell, all reusable components, and all eight pages, wired with React Router. Found and fixed three real bugs surfaced during its own testing (see §15). The initial visual design was a **synthesis of all six reference images** — warm cream canvas, dark charcoal sidebar, terracotta accent, serif display headlines paired with a sans UI face.

### Stage 9 — UI/UX correction pass
In a follow-up turn, the user supplied **only two** of the six reference images again (the course-platform UI, "Creatica," and the CRM UI, "BizLink") and gave an extremely explicit instruction: the *current* frontend was not the visual target, these two references were, and the existing implementation needed to be corrected to match them as closely as possible — not "inspired by," not a synthesis, not an improvement.

On close re-inspection, Claude identified that its Stage 8 synthesis had gotten a structural fact wrong: **neither reference uses a dark sidebar.** Both use a light/near-white sidebar sitting close in tone to a near-white canvas, separated by a hairline border, with a single accent color (black in BizLink; black *and* a warm orange in Creatica) used sparingly on active states and primary buttons — not as a dominant panel color. Neither reference uses a display serif font anywhere.

This triggered a real correction, not a cosmetic tweak: `tokens.css` was rewritten (light sidebar `#fcfbf8`, canvas `#f7f6f1`, black `--accent` as primary, warm orange `--accent-2` as Creatica's secondary highlight, sans-only typography, borders replacing shadows as the primary separation device), the Sidebar was rebuilt with a solid-black active-nav pill (matching BizLink's "Customers" treatment exactly), the Header's dark blurred bar was removed, and the tab bar was rebuilt from an underlined-tab style into Creatica's **pill-tab** style (plain text + muted count bubble when inactive; solid orange pill + white text + lighter bubble when active). A real navigation bug was found and fixed during this pass (see §15). This was the visual state of the app until Stage 19, which replaced it entirely — the reference-matching work is kept here because it explains where the old design came from, not because it still describes the product.

### Stage 10 — Mock dataset expansion (test coverage)
The user asked for a richer, internally-consistent dataset so every UI state could be exercised before a demo. This added Meesho as a third marketplace, laptops and wireless earbuds as second and third product types, ~12 more products, more sellers/offers/promotions, dated fee rules per category, and deliberately-included edge cases: a listing with **zero offers** (ASUS ROG Strix), a **renewed**-condition offer, a stockout window, a rising price trend, and a mid-series promotional dip that recovers. A real `PriceHistoryPage` crash on the zero-offer case (Infinity/NaN) was found and fixed during this pass.

### Stage 11 — Catalogue depth + recommendation intelligence (current)
The user judged two areas too shallow for the project's purpose and asked for both to be deepened without touching the architecture:

**Catalogue.** Replaced a flat 3-category list with a real browsable taxonomy — 6 departments → 11 categories → 16 subcategories → 16 product types — and a faceted filtering system whose facets are generated from the attribute registry, so each product type exposes only the filters that apply to it (a phone shows RAM/Storage/5G; a running shoe shows Size/Gender/Cushioning). Product count grew from 21 to 93 purchasable via a seed + generator pair (see §10). Added sorting, live facet counts, URL-synced filter state, and a redesigned product card.

**Recommendation.** Replaced the single-number output with **three condition-based strategies** (Fast Sale / Balanced / Premium), each anchored to a *different* statistic and adjusted by a computed product-strength index — so they are not fixed percentages around one value. Added an evidence layer (market position, product strength breakdown, competition, 30/60/90-day price history, commercial viability, confidence), explicit **why-not-lower / why-not-higher** bounds, a similarity-scored comparable set with visible scores, and observed-vs-derived provenance tags on every panel.

Three real bugs were found and fixed during this stage's verification — see §15.

### Stage 12 — Pricing model rebuilt from first principles (current)
The user found a recommendation that was not merely wrong but *economically invalid*: a power bank whose offers sat at ₹1,099–₹1,250, with an **MRP of ₹1,999**, was given a Premium recommendation of **₹3,399** — 70% above its own MRP and 3× the market. They correctly refused a patch and asked for the underlying model to be reconsidered.

Reproducing it exposed four compounding structural gaps, all now closed:

| Gap | What was wrong | Fix |
|---|---|---|
| **No hard constraints** | Nothing stopped a price exceeding the applicable MRP. Selling above MRP is invalid in India, not "premium positioning". | Hard constraints (MRP ceiling, break-even floor) bound every strategy; each is reported with the rationale, and the binding one is flagged. |
| **Incoherent comparable set** | A product at **32% similarity** and 4× the price was allowed to set the Q3 premium anchor. | Four sequential gates: similarity ≥45%, absolute price band (0.45×–2.2×), **MRP reachability**, and an IQR outlier fence. Every exclusion is recorded with its reason and shown in the UI. |
| **Statistics on a dispersed set** | Q3 of a set spanning ₹1,099–₹4,999 is not a price signal. | Dispersion is measured, degrades evidence, and damps how far strategies may travel from the median. |
| **Decorative confidence** | "Medium" on that set meant nothing. | Evidence is scored across 7 weighted checks, **gates the output entirely** when too weak, and scales strategy travel. |

A fifth, deeper flaw the user identified independently: **all discounts were being treated alike**. A bank-card-only price was being compared against a universally available one. That is now modelled properly — see §5a.

**Result across all 106 purchasable products:** 0 MRP violations, 0 below-floor prices, 0 mis-ordered strategies, 87 recommended, 19 honestly refused for insufficient evidence. The power bank now recommends ₹1,099 / ₹1,399 / ₹1,599 against its ₹1,999 MRP.

### Stage 13 — The market becomes the anchor (current)
Stage 12 fixed *validity* (nothing exceeds MRP). Stage 13 fixed **defensibility**.

The user found a smartwatch whose own four in-stock offers were ₹1,299–₹1,361, being recommended ₹1,399 / ₹1,599 / ₹1,699. Diagnosis showed something worse than the symptom: **the product's own realized market price was never an input to the anchor at all.** The engine anchored entirely on two substitute watches at ₹1,499/₹1,799 and ignored four direct observations plus a ₹1,350 ninety-day median. Compounding it, product strength was −0.41 (weaker than its comparables) yet Balanced landed **+23% above its own market** — the direction was backwards because the anchor was wrong.

| Flaw | Fix |
|---|---|
| **Comparables were the anchor** | The product's **own in-stock offers** are now primary evidence; comparables are secondary corroboration, used as the anchor only when a product has no market of its own (a new listing). |
| **Premium was assumed, not measured** | A real least-squares hedonic regression (`hedonicModel.js`) estimates whether the market *actually pays* for this product's attributes. It self-reports fit and **refuses** below 5 observations or adj R² < 0.5. Only 8 of 89 products earn an evidenced premium. |
| **Bounds came from comparables** | Floor and ceiling now derive from the **competitive pool** (own offers + comparables). A floor computed from dearer substitutes had been sitting above the product's entire selling range. |
| **No promotional-distortion detection** | Current market is reconciled against the 90-day normal; a market >10% below normal is flagged `depressed` and the anchor leans toward the normal level instead of chasing the dip. |
| **Cost silently lifted the price** | Market recommendation and seller viability are now separate. When the market clears below break-even the **conflict is exposed**, not hidden by clamping the price up. |
| **No pre-display validation** | Six sanity checks run before anything renders; failures are shown rather than suppressed. |

**Result:** Balanced now sits on average **1.9%** from the product's own market median (max 17.8%). The smartwatch recommends **₹1,249 / ₹1,299 / ₹1,449** with Premium explicitly marked *not evidenced*.

### Stage 14 — Audit, and the repair it forced (current)

The user commissioned a **read-only audit** before allowing any further change. It found that Stage 13 had fixed Balanced and left the identical defect untouched in **Premium**.

The Stage 13 rule was `premiumCeiling = max(pool Q3, anchor)`, and the "not evidenced" guard only stopped the price being pushed **beyond** pool Q3 — it never stopped it **reaching** it. So Q3 of a pool containing dearer substitutes created a premium on its own. **25 of 89 products sat more than 15% above their own market median; 20 of them had no evidence at all.** A Puma running shoe selling at ₹2,558 across four offers was recommended **₹3,349** because other running shoes cost more. The smartwatch passed only because *its* pool Q3 happened to sit near its own market — the pass did not generalise.

| ID | Defect found | Repair |
|---|---|---|
| **CF-1** (critical) | Pool Q3 could set an unevidenced premium | Premium is now bounded by the **top of the product's own observed range**. Q3 is used only when the product has no market of its own, and is then capped at +10% over the anchor. An evidenced premium may extend above, capped at **+25% over the own-market median**. Asserted by a `premium_vs_own_market` sanity check. |
| **MJ-1** | History ran on **landed**, current market on **universal effective** — two definitions silently compared | One basis everywhere. `PRICE_BASIS` is exported; `getProductPriceSeries` resolves promotions per observation date; the price-history chart and page plot the same rung and name it in a footnote. |
| **MJ-2** | Engine read `getListingsForProduct(id)[0]` for rating while the catalogue aggregated — **80 of 89 products disagreed** | `utils/productMetrics.js` is the single aggregation (review-count-**weighted mean** rating, summed counts), consumed by the engine, catalogue service and products service alike. |
| **MJ-3** | Comparables were marketplace-blind — a vivo T3x on Amazon was benchmarked against four non-Amazon products | Hard gate on zero shared marketplaces, plus Jaccard overlap as a fourth similarity term (weight 0.15). |
| **MJ-4** | `specSimilarity` returned a constant **0.6** for text-spec types, so T-Shirt similarity ignored specs entirely | Per-dataType comparison over the **full** schema (pricing-relevant weighted double) returning match / partial / differ / **missing**. Missing is never scored as zero — an absent spec is unknown, not different. |
| **MJ-5** | Single-own-offer anchor blended 50/50 with comparables and drifted | 75/25 toward the product's own offer, clamped within ±10% of it. |
| **MN-1** | IQR fence needed ≥4 comps but recommendations issue at 2 | Fence threshold lowered to 3 — **28 products** now get screening they previously skipped. |
| **MN-2** | Confidence ignored `matchConfidence` and promotion visibility | Two new evidence checks: listings matched below 95% confidence, and the share of compared prices currently cut by a live instant discount. |
| **MN-3** | 0 offers out of stock, 1 of 355 with paid shipping — those paths never executed | Four seed fixtures: paid shipping, whole-product stockout, cheapest-offer-only stockout. |

**Result across all 92 recommended products:** 0 MRP violations, 0 floor violations, 0 ordering violations, **0 products with Premium >15% above own market without evidence** (was 25), 0 above the evidenced cap. Puma ₹3,349 → **₹2,599** (+1.6%). Pool Q3 is actively suppressed on **34** products, so the bound is load-bearing rather than incidental.

### Stage 15 — Competitive evidence, not a comparable count

Professor's feedback: *"Try to do comparison of your product with at least 5 competitors so it will give you proper result."*

Read narrowly that is `MIN_COMPARABLES = 5`. Measurement showed why that reading is wrong. Before this stage, across 92 recommended products: the **median comparable count was 3** and only **17 reached 5**; **9 of 16 product types held fewer than 7 products in total**, so a 5th comparable could not exist however the screening was tuned; **42 products had a competitive pool in which their own offers outnumbered the rival products**; and **4 counted a variant of themselves as an independent competitor**. Raising a constant would have forced weaker candidates through the gate until the number read five — the opposite of "proper result".

**The unit of competitive evidence is the competitive identity** (`parentProductId ?? productId`). Ten sellers undercutting each other on one listing is one product competing; the same product on three marketplaces is one product; two variants of one model are one model family. `utils/competitiveSet.js` owns this.

**Three tiers, not a boolean:**

| Tier | Test | Role |
|---|---|---|
| **Direct competitor** | similarity ≥ 0.55, price 0.6×–1.7×, shares a marketplace, not the same model family | Contests the same purchase. **This is what the "5" counts.** |
| **Comparable** | similarity ≥ 0.40, price 0.45×–2.2× | Informs market value. Weighted 0.6 of a direct competitor. |
| **Reference** | same product type, outside the comparable range | Describes the distribution. Never anchors, never votes. |

**Evidence is weighted, not counted.** Every member carries `evidenceWeight = similarity × dataQuality × tierFactor`, and market statistics are weighted by it (`weightedQuantile`). `effectiveComparables` — the sum of those weights — drives confidence, not the raw count. This is the mechanism that distinguishes 5 strong comparables from 5 weak ones, and it is why padding a set cannot buy confidence. Verified: among 18 products holding exactly 5 comparables, effective evidence ranges **2.07 → 3.91**, producing **low** vs **medium-high** confidence.

**Two pools, two grains** — the fix for the double-counting:
- **Own market (offer grain).** Every in-stock offer is a real price a buyer can pay. Anchoring and the Premium ceiling read this, unchanged.
- **Competitive pool (product grain).** One row per competitive identity — this product once (at its own median), each rival once. Q1/median/Q3 now describe the products a buyer chooses between.

**Dataset.** 105 products added, chosen to thicken **price bands that were thin**, not to raise headcount — a direct competitor must sit within 0.6×–1.7×, so eight smartwatches spread from ₹1,299 to ₹29,990 still leave the ₹1,299 model with no rivals.

**Results (203 recommended of 216):** median direct competitors **3 → 6**; products meeting the 5-target **17/92 (18%) → 141/203 (69.5%)**; average effective comparables **4.75**; coverage strong on 139, thin on 20. All Stage 14 guarantees hold: 0 MRP / floor / ordering violations, 0 CF-1 failures, 0 duplicate identities in a set, 0 own-variants counted as competitors, 0 zero-overlap comparables, 0 rating mismatches, 0 price-basis mismatches.

**Products left thin are left thin deliberately.** The 20 remaining are flagships and floor products — a ₹1.3L OLED, a ₹74k iPhone — which genuinely have few peers in their band. The system reports "0 of 5 direct competitors, thin coverage" with a diagnosis, and caps confidence. That is the correct answer, not a gap to paper over.

**Bug found during this work:** two seed ids were duplicated (`hisense_50_4k`, `philips_mg_750`), silently producing two products under one id with merged offer series. It surfaced only as a price-history/current-price mismatch — far too indirect. `catalogueGenerator.buildAll()` now throws on duplicate seed ids.

#### Stage 15 — the exact math

Every number below was pulled live from `buildRecommendation()`/`buildComparableSet()`, not hand-computed — so this is what the code does, not what it was intended to do. All formulas live in `utils/competitiveSet.js`.

**1. Per-attribute comparison — `compareAttribute(attr, a, b)`.** Branches on the attribute's `dataType`:

- `boolean`: `a === b ? 1 : 0`.
- `integer` / `decimal`: `scale = max(|a|, |b|, 1)`; `score = 1 − min(|a−b| / scale, 1)`. Verdict `match` if `score ≥ 0.98`, `differ` if `score ≤ 0.15`, else `partial`.
- `text`: exact string match (case/punctuation-normalised) → `score = 1`. Otherwise Jaccard token overlap: `score = |tokens(a) ∩ tokens(b)| / |tokens(a) ∪ tokens(b)|`.
- Either side absent → verdict `missing`, `score = null` — excluded from the average entirely, never scored as 0.

**2. Specification similarity — `specSimilarity()`.** Runs over the product type's **full** attribute schema (not only pricing-relevant attributes). Each attribute's score is weighted **2×** if it is pricing-relevant, **1×** otherwise:

```
specScore = Σ(score_i × weight_i) / Σ(weight_i)     [i ranges over attributes with score ≠ null]
```

**3. Price proximity — `priceProximity(targetPrice, candidatePrice)`.**

```
priceScore = 1 − min(|ln(target / candidate)| / ln(3), 1)
```

Symmetric in log-space, so a candidate at 2× the price and one at 0.5× score identically. `ln(3) ≈ 1.0986` is the scale — a 3× price gap drives the score to 0.

**4. Marketplace overlap — `marketplaceOverlap(targetMps, candidateMps)`.** Jaccard index of the two marketplace-id sets:

```
mpScore = |shared| / |targetMps ∪ candidateMps|
```

Zero shared marketplaces is a **hard gate** (excluded before scoring), never merely a low score — see rule 12i.

**5. Composite similarity.** The four terms above are combined with `COMPETITOR_POLICY.weights = { specifications: 0.45, priceSegment: 0.25, brandTier: 0.15, marketplaceOverlap: 0.15 }`. `tierScore = 1 − |targetTierRank − candidateTierRank| / 2` (tiers: value=0, mid=1, premium=2, so adjacent tiers score 0.5, opposite tiers score 0). Any term that is `null` (nothing comparable) has its **weight redistributed** across the rest — never filled with an invented value:

```
similarity = Σ(weight_i × score_i) / Σ(weight_i)     [i ranges over the 4 terms, score ≠ null]
```

**6. Tier assignment.** `targetPrice × band.lower ≤ candidatePrice ≤ targetPrice × band.upper`:

| | min similarity | price band |
|---|---|---|
| Direct competitor | ≥ 0.55 | 0.6× – 1.7× |
| Comparable | ≥ 0.40 | 0.45× – 2.2× |

A same-model-family candidate can never be `direct`, however high it scores — see rule 12i.

**7. Data quality — `assessDataQuality()`.** Unweighted mean of up to 5 signals, each 0–1, each skipped (not zeroed) when unmeasurable: match-confidence `clamp((minConfidence − 0.7) / 0.29, 0, 1)`; observation depth `min(observations / 90, 1)`; live availability `inStockOffers > 0 ? 1 : 0`; rating captured `rating != null ? 1 : 0`; marketplace breadth `min(marketplaceCount / 2, 1)`.

**8. Evidence weight — the number that matters most.**

```
evidenceWeight = round(similarity × quality.score × tierFactor, 3)     tierFactor = 1 (direct) or 0.6 (comparable)
```

`effectiveComparables = Σ(evidenceWeight)` across the kept set. This is what confidence is graded on (`assessEvidence`'s `competitor_breadth` and `evidence_depth` checks), never the raw count — so five weak comparables and five strong ones are legible as different amounts of evidence.

**9. Coverage level — `buildCoverage()`.** `strong` if `directCount ≥ target` AND `effectiveComparables ≥ target × 0.7`; `adequate` if `totalCount ≥ target` AND `effectiveComparables ≥ target × 0.55`; `thin` if `totalCount ≥ minimumForRecommendation (3)`; else `insufficient` → the recommendation refuses.

**Worked example — boAt Wave Call 2 smartwatch** (`prod_boat_wave`, target price ₹1,299, brand tier value, marketplaces {Flipkart, Meesho}):

*vs Noise Fit Play* (₹1,299, same tier, same 2 marketplaces): all 6 schema attributes match or near-match (`display_in` 1.83 vs 1.81 → score 0.989, everything else exact) → specScore **0.998**. priceScore = 1 (identical price). tierScore = 1. mpScore = 1. `similarity = 0.45×0.998 + 0.25×1 + 0.15×1 + 0.15×1 = 0.999`. quality = 0.952 (one listing auto-matched at 92%, everything else full marks). `evidenceWeight = 0.999 × 0.952 × 1 = 0.951`. **Tier: direct.**

*vs Fire-Boltt Ninja Call Pro* (₹1,499, same tier, same marketplaces): `battery_days` 7 vs 8 → `scale=8, score=1−1/8=0.875` → partial; `water_resistance` "IP68" vs "IP67" → no shared token → differ (score 0); the other 4 attributes match → specScore = `(2+2+1.75+2+2+0)/11 = 0.886`. priceScore: `1 − |ln(1299/1499)|/ln(3) = 1 − 0.1433/1.0986 = 0.870`. `similarity = 0.45×0.886 + 0.25×0.870 + 0.15×1 + 0.15×1 = 0.916`. `evidenceWeight = 0.916 × 0.952 × 1 = 0.872`. **Tier: direct.**

Result: 7 direct competitors, 0 comparables, `effectiveComparables = 5.6` → **strong** coverage, confidence **medium-high**.

**Worked example — Roadster round-neck T-shirt** (`prod_roadster_round_m`, ₹499, brand tier value, marketplaces {Flipkart, Meesho}) — the maximally different case: every attribute is `text`, none pricing-relevant except `fabric`.

*vs Puma Polo T-shirt* (₹999, tier mid, marketplaces {Flipkart, Amazon.in}): 3 attributes match, 2 partial (`fabric` "Cotton" vs "Cotton Blend" → shared token "cotton" → Jaccard `1/2 = 0.5`; `neck` "Round Neck" vs "Polo Neck" → shared token "neck" → Jaccard `1/3 = 0.333`), 1 differ (`size` "M" vs "L") → specScore **0.619**. priceScore: `1 − |ln(499/999)|/ln(3) = 1 − 0.694/1.099 = 0.368`. tierScore = `1 − |0−1|/2 = 0.5`. mpScore: shared {Flipkart} = 1, union {Flipkart, Meesho, Amazon.in} = 3 → `1/3 = 0.333`. `similarity = 0.45×0.619 + 0.25×0.368 + 0.15×0.5 + 0.15×0.333 = 0.496`. **Below the 0.55 direct threshold → tier: comparable**, `evidenceWeight = 0.496 × 0.952 × 0.6 = 0.283`.

*vs Jockey round-neck T-shirt* (₹599, tier mid, marketplaces {Amazon.in, Flipkart}): every attribute matches exactly → specScore = **1.0**. priceScore: `1 − |ln(499/599)|/ln(3) = 1 − 0.1823/1.0986 = 0.834`. tierScore = 0.5. mpScore = 0.333 (same union math). `similarity = 0.45×1 + 0.25×0.834 + 0.15×0.5 + 0.15×0.333 = 0.783`. **Above threshold and inside the 0.6×–1.7× band (₹599 ∈ [₹299, ₹848]) → tier: direct**, `evidenceWeight = 0.783 × 0.952 × 1 = 0.746`.

Result: 3 direct, 4 comparable, `effectiveComparables = 3.62` → **adequate** coverage, short of the 5-target. `coverage.shortfall`: *"9 products of this type were evaluated and 3 qualify as a direct competitor. Of the rest, 2 are too far from this product on price or specification; 4 inform the price without contesting the same purchase."*

**Worked example — Acer Nitro V gaming laptop** (`prod_acer_nitro_v`, ₹48,990, brand tier mid, marketplaces {Flipkart, Amazon.in}) — numeric-spec-heavy, high price, thin field:

*vs HP Victus i5* (₹57,990, same tier, same marketplaces): `ram_gb`, `storage_gb`, `gpu`, `refresh_rate_hz` match; `processor` "AMD Ryzen 5 7535HS" vs "Intel Core i5-12450H" → no shared token → differ; `weight_kg` 2.1 vs 2.29 → `scale=2.29, score=1−0.19/2.29=0.917` → partial; `display_in` excluded (not pricing-relevant, still scored at weight 1, matches exactly) → specScore **0.833**. priceScore: `1 − |ln(48990/57990)|/ln(3) = 1 − 0.1667/1.0986 = 0.848`. tierScore = 1, mpScore = 1. `similarity = 0.45×0.833 + 0.25×0.848 + 0.15×1 + 0.15×1 = 0.887`. `evidenceWeight = 0.887 × 0.952 × 1 = 0.844`. **Tier: direct.**

*vs ASUS TUF A15* (₹74,990, tier premium, same marketplaces): specs mostly `partial` (Ryzen 5 vs Ryzen 7, RTX 3050 vs RTX 4050) → specScore 0.814. priceScore: `1 − |ln(48990/74990)|/ln(3) = 1 − 0.4253/1.0986 = 0.613`. tierScore = `1 − |1−2|/2 = 0.5`. mpScore = 1. `similarity = 0.45×0.814 + 0.25×0.613 + 0.15×0.5 + 0.15×1 = 0.744`. Price band check: ₹74,990 ∈ `[0.6×48990, 1.7×48990] = [₹29,394, ₹83,283]` → inside → **tier: direct** despite the tier gap, `evidenceWeight = 0.744 × 0.952 × 1 = 0.708`.

Result: 5 direct, 1 comparable, `effectiveComparables = 3.92` → **strong** coverage (meets the 5-target) but lower effective evidence than the smartwatch's 5.6, because gaming laptops span a wider spec and price range at the same nominal competitor count — exactly the distinction weighting exists to preserve.

**Cross-category takeaway:** the same formula, unmodified, produced *specification-dominated* discrimination for the laptop (numeric near-misses on RAM/GPU/weight), *near-total token-overlap* discrimination for the T-shirt (a schema with no numerics at all), and a *near-perfect match* for the smartwatch. Nothing here is domain-specific; the schema and its `dataType`s are, and they come from `attributeDefinitions.js` — see rule 12g.

---

### Stage 16 — Catalogue at marketplace scale

Stage 15 fixed how competitors are *selected*. Stage 16 fixed what there was to select *from*: a 111-product catalogue concentrated in electronics could not demonstrate either the breadth a real marketplace has or the density its commodity categories have.

**Scale, verified in-browser against the real modules:**

| Entity | Before | Now |
|---|---|---|
| Departments | 6 | **14** |
| Categories (all levels) | 32 | **179** |
| Product types | 16 | **125** |
| Attribute definitions | ~90 | **545** |
| Brands | 57 | **314** |
| Marketplaces | 3 | **6** |
| Marketplace category mappings | 54 | **418** |
| Products | 113 | **1,172** (1,156 purchasable + 16 variant parents) |
| Listings | 194 | **2,947** |
| Sellers | 12 | **1,177** |
| Offers | 369 | **9,717** |
| Price observations | 35,178 | **354,940** |
| Review snapshots | 947 | **9,962** |
| Promotions | 21 | **5,968** |

**Breadth is the point, not the row count.** The tree now reaches grocery, pet supplies, automotive, stationery, toys, baby care and health devices. A ₹45 ballpoint pen and a ₹1.4L side-by-side refrigerator flow through the same Product → Listing → Offer → Observation graph, the same specification registry and the same pricing engine. `attributeDefinitions.js` is where this is proven: 125 product types share **no** common attribute — a Saree has `saree_length_m` and `work_type`, Dog Food has `life_stage` and `pack_weight_kg`, a Pen has `tip_size_mm`. Nothing in the engine, the catalogue service or the UI knows any of those names.

**Six marketplaces, deliberately not interchangeable.** Two horizontals (Flipkart 1,014 listings, Amazon.in 1,063) carry almost everything; Meesho (474) is value-led and thin on high-value electronics; Myntra (210), AJIO (80) and Nykaa (106) are verticals. `marketplaces.js` carries a `categoryAffinity` the generator honours, so a saree cannot appear on a beauty vertical however the seed is written. Coverage also *spreads with demand*: popular products deterministically gain platforms they did not launch on, which is how catalogue coverage actually grows. 1,095 products appear on 2+ marketplaces, 548 on 3+.

**The depth lesson — a data problem mistaken for an engine problem.** The first pass spread 825 products across 125 types, averaging six per type. Measurement was unambiguous: types holding 15+ products returned strong coverage for **100%** of their products; types holding 4–6 **refused outright**, because after the 0.6×–1.7× direct-competitor band nobody was left. 81 of 125 types were under six products, median direct competitors was 4, and 29% of products refused.

The fix was data, not thresholds. `catalogueSeedDepth.js` brings commodity and mass-market types to 10–15 products in tight price bands — because a real marketplace does not stock five ballpoint pens, it stocks hundreds. Result: median direct competitors **4 → 5**, products meeting the 5-target **40.1% → 55.8%**, strong coverage **229 → 563**, refusals **241 → 115**. Types under six products: **81 → 16**.

⚠ **The 16 remaining thin types are thin on purpose.** Treadmills, action cameras, strollers, glucometers, sofas, wardrobes, bookshelves and RC toys are left at 3–4 products each. They are the ONLY evidence that the refusal path works, and padding them would destroy it. The GoPro HERO12 correctly reports *"Only 3 other products of this type are tracked at all, so 5 direct competitors do not exist in the captured market yet. Capturing more of this product type is the fix — not loosening the screening."*

**Price shape is engineered per category**, because that shape is what the engine is being tested against: tight commodity clusters (LED bulbs, notebooks, biscuits within tens of rupees), segmented markets running an order of magnitude (running shoes ₹999–₹6,999; refrigerators ₹13k–₹82k), and thin premium tails. The Cello pen demonstrates the payoff — a ₹79/₹89/₹89 band at medium-high confidence, with the hedonic model honestly reporting **adjusted R² of −27%**: pen price genuinely is not driven by attributes, and the model says so rather than inventing a premium.

**Commercial variation is now a property of the catalogue, not a pair of fixtures.** 539 offers currently out of stock (295 products affected), 1,206 offers charging delivery, and 5,968 promotions spanning every availability class — 1,293 universal, 3,431 conditional, 700 financing, 544 deferred. Sellers who charge delivery list the item lower to compensate, so the *landed* price is unchanged and the cheapest-looking selling price is not the cheapest offer — exactly the trap the price ladder exists to handle.

**Seller ecosystem.** 1,177 accounts across six marketplaces, scoped to one marketplace each, linked across platforms only through `sellerGroupId`. Size follows a realistic top-heavy distribution (anchor / established / small), which drives how many offers each receives, so the offer distribution inherits that shape rather than spreading evenly. Average 3.3 offers per listing.

**History depth is tiered, not uniform.** Daily capture for every offer would put this dataset past 400,000 observations for no analytical gain. Real pipelines poll best-sellers every couple of days and the long tail fortnightly, because crawl budget is finite: deep (2-day) for 25k+ review products, standard (5-day), sparse (12-day). The 90-day median and the distortion check read the same signal either way.

**Integrity, audited across the full dataset — every count zero:** duplicate ids (products, listings, offers, sellers, brands, categories, product types, promotions, attributes, observations, reviews, marketplace-category mappings), orphan references (product→brand/category/product-type/parent, listing→product/marketplace, offer→listing/seller, seller→marketplace, observation→offer, review→listing, promotion→offer, mapping→marketplace/category, attribute→product type, fee rule→marketplace/category), MRP violations across all 354,940 observations, current-vs-latest-historical price mismatches, and seed landed-price invariant breaks.

**Engine guarantees hold unchanged at 9× the scale**, across all 1,041 recommended products: 0 MRP violations, 0 floor violations, 0 ordering violations, 0 CF-1 premium-invariant failures.

**Three real bugs the expansion surfaced**, each caught by the audit rather than by eye:
1. **Marketplace price bias broke the seed invariant.** Applying Meesho's 0.978 multiplier directly let a listing land 2.2% under the seed price, so the catalogue card advertised a price no offer matched — on 63 products. Multipliers are now normalised so the cheapest is exactly 1.0, preserving relative spread while pinning the minimum.
2. **The invariant guard was on the wrong offer.** Stockouts and shipping were withheld from `mpIndex === 0`, but normalisation can put the cheapest listing on a *later* marketplace — so the true cheapest offer could go out of stock, breaking the invariant on 22 products. The guard now tracks the actual minimum.
3. **A "down" trend starting 13% above today's price produced historical observations above MRP** on tight-MRP products. Selling price is now clamped to MRP at every point in the series, and per-seller uplift stops at the ceiling — on a tight-MRP product the later sellers simply pile up there, which is what actually happens.

---

### Stage 17 — Pre-delivery audit and repair

Before sharing the prototype, a full read-only audit was run against the live modules — build, routing, every page, all 1,156 products, all 354,940 observations, referential integrity on every foreign key, and an independent recomputation of five recommendation explanations. It returned **NOT READY**, on five blocking issues. All five are now fixed.

The engine itself came through clean: 0 hard-constraint violations, 0 integrity errors, 0 rating mismatches, and every price the ladder produced traced to the paisa against a hand calculation. **What failed was the data generator and the packaging around it** — which is worth recording, because three of the five defects were introduced by the Stage 16 expansion itself and none of them was visible without measuring.

| # | Defect | Cause | Fix |
|---|---|---|---|
| 1 | **Negative selling prices** — two offers rendered "−₹1 · 101% off" on the listing page | The delivery charge is carved OUT of the item price so landed stays constant; on a ₹78 pen an unguarded ₹79 fee drove the item price below zero | Delivery may now take at most 25% of landed price, is capped again against the specific offer so the residue never falls under ₹10, and is simply not charged when no realistic fee fits |
| 2 | **Same seller repeated on one listing** — 1,436 of 2,918 multi-offer listings, making the UI's "N sellers compete" literally untrue | The deterministic seller draw hashed different offer indices onto the same pool slot with no uniqueness check | `usedSellerIds` per listing; the draw probes forward from its hashed index until it finds an unused seller, which preserves the head-of-pool bias and so keeps the top-heavy offer distribution |
| 3 | **Absurd universal discounts on cheap goods** — 14 products advertised an effective price 40–64% below their own market median; one was pushed out of its own price band and refused to price at all | `Math.max(50, price × 0.04)` — a floor with no ceiling, so a flat ₹50 minimum landed on a ₹78 pen | A `capped()` helper applies the floor only when the price can carry it and enforces a per-class share ceiling (universal 10–12%, conditional 12–15%) |
| 4 | **Data Sources page half empty** — Myntra, AJIO and Nykaa carried 396 listings between them with no capture run and no field coverage, rendering a heading with nothing under it | `dataSources.js` was never extended past the original three marketplaces | Three capture runs and twelve coverage rows added; stale narratives ("Single category page — Smartphones, page 1" describing a run that produced 1,014 listings) rewritten to match the current sweep |
| 5 | **README was the default Vite template** | Never replaced | Rewritten: purpose, data model, how the recommendation works, page map, mock-data totals, install/run, and an explicit "what is not built" section |

**Post-fix verification, full dataset:** 0 negative selling prices · 0 negative shipping · 0 selling prices above MRP · 0 discounts over 95% · 0 listings with a duplicate seller · 0 universal promotions above 25% of price · 0 products with an effective price 35% under their own median landed · 0 duplicate ids and 0 orphan references across 14 entity arrays · 0 out-of-order or duplicate-grain observations · 0 current-vs-history mismatches · 0 seed landed-price invariant breaks · 0 rating mismatches.

**No recommendation regressions** — the numbers moved slightly the right way, because two products that had been distorted out of their own price band came back into it:

| | Before | After |
|---|---|---|
| Products recommending | 1,041 | **1,043** |
| Correctly refusing | 115 | **113** |
| Median direct competitors | 5 | 5 |
| Meeting the 5-competitor target | 55.8% | **56.3%** |
| Average effective comparables | 4.17 | **4.21** |
| Strong coverage | 563 | **569** |
| MRP / floor / ordering / CF-1 / break-even violations | 0 | **0** |
| Hedonic model trusted | 45.1% | 45.7% |
| Model cap violations · constraint bypasses | 0 | **0** |

**One audit finding was a false positive and is recorded here so it is not "fixed" later.** The sweep initially flagged 37 products as counting an own variant as a competitor. The code is deliberate: `competitiveSet.js` bars a same-family variant from the `direct` tier (line ~472, `!c.isSameFamily`) but admits it as a reduced-weight `comparable`, on the stated reasoning that the price gap to your own 256 GB variant genuinely informs what the upgrade is worth. Verified: **0** same-family variants are `direct`, **0** count toward the 5-target, and their average evidence weight is 0.501 against 0.645 for true competitors. See rule 12i.

**Known and accepted, not fixed:** the `useAppState` console error in dev is a Vite Fast-Refresh artefact — `AppStateContext.jsx` exports both a component and a hook, which defeats HMR state preservation (oxlint flags it). Wiring is correct and production has no HMR. Also unfixed by choice: `rawDocumentId` on observations points at documents that do not exist (3 defined vs 354,940 referenced), no promotion in the dataset is currently expired, and `membership`/`seller_campaign` promotion types have zero instances.

---

### Stage 18 — The analysis layer made visible

Professor's feedback after reviewing the deployed frontend: *"now you can take more parameters for comparison and try to create a demo for the same so it will give clear idea about analysis from different platforms."*

Read narrowly that is "add columns to the marketplace table". The actual ask is harder and more interesting: **make the analytical capability visible**. The system already held cross-marketplace data, competitor selection, promotions, history and a constrained pricing model — but nothing in the UI showed those being *reasoned over together*. The marketplace page compared prices; the recommendation page produced a number; the middle was invisible.

**New: `/products/:productId/analysis`**, an "Analysis" tab between Marketplaces and Recommendation, backed by `utils/crossMarketplaceAnalysis.js`. It adds **no entities, no state and no engine changes** — every figure derives from the same Product → Listing → Seller → Offer → Observation graph, and the strategies it shows are the engine's own (verified identical across all 1,156 products).

**The page is an argument in six steps, not a dashboard:**

| Step | Question | What it shows |
|---|---|---|
| 1 | What did we observe? | One card per marketplace: full price ladder, sellers, fulfilment, rating, trust weight, stock, promotions by class, match confidence |
| 2 | Where do platforms differ? | Price spread, price-vs-trust rank correlation, offer availability, delivery impact |
| 3 | Who does this compete with? | The competitive set with the raw price gap **decomposed** — per-unit price, trust delta, evidence weight, marketplace overlap |
| 4 | What does the combination mean? | Findings that each required ≥2 dimensions, every one carrying its own figures |
| 5 | Is today's market normal? | 90-day normal, percentile position, volatility band, promotional windows |
| 6 | Therefore — the price | Findings sorted by the posture each argues for, then the engine's three strategies and what bounded them |

**Parameters were selected, not dumped.** A parameter earns a place only if it can change how a price is *read*. Included: the price ladder, per-unit price, trust-weighted rating, seller quality and fulfilment, availability, promotion availability class, historical position, match confidence. Deliberately excluded: buy-box position (already implied by cheapest in-stock landed price) and raw MRP (a display anchor, not a market signal — it appears only as the legal ceiling).

**Three derived measures do the real analytical work:**

1. **Per-unit price.** `unitBasisFor()` divides price by the attribute that expresses *how much product you get*. This routinely reverses the headline comparison — on the showcase product, Mamaearth is 27.1% cheaper but **18.4% dearer per ml**, and Indulekha is 24% cheaper but **45.3% dearer per ml**. Comparing headline prices alone inverts the conclusion. ⚠ The attribute list is an **explicit allowlist**, not "the biggest numeric spec": that heuristic gave phones `battery_mah` and produced "₹ per mAh", which nobody buys a phone by. Only quantity-bearing attributes qualify (volume, pack weight, capacity, count, pieces).
2. **Trust-weighted rating.** Damps a rating toward 3.5 by `log10(reviews)/4`, so 4.7 from 20 reviews lands below 4.5 from 20,000 — the comparison the professor's brief called out directly.
3. **Price-vs-trust rank correlation.** Spearman across platforms, answering whether the cheapest platform is also the weakest. On the showcase product it is **−0.94**: Amazon is simultaneously the cheapest *and* the best-rated, AJIO the dearest *and* the weakest. The intuitive assumption is exactly inverted, and the finding says so.

**Showcase product: Dove Hair Fall Rescue Shampoo (650 ml)** — chosen by scoring all 1,156 products on analytical material available, not on looks. It is the only product on **all six marketplaces**, with 30 offers from 30 distinct sellers, 8 direct competitors, paid-shipping offers, a stockout, 61 history points, and a trusted hedonic fit (adj R² 0.908). Its analysis produces 10 findings: 6 supporting a higher price, 1 arguing lower, 3 context.

**Honesty is enforced structurally, not by wording.** Findings are generated only where the data supports them, so they disappear on their own:
- Single-marketplace products lose the cross-platform findings and keep the rest.
- Products with no unit-bearing attribute get no per-unit column at all.
- The provenance line names the data as **simulated** rather than "captured". The sidebar already says mock data, but the page carrying the most convincing-looking numbers is exactly the one that cannot be ambiguous about where they came from.
- When the engine refuses, the observation layers still render but sections 4 and 6 are **absent** — 0 findings, 0 scales, 0 strategies. The iPhone 15 shows its two marketplace cards and its history, then states plainly that only 2 comparables could be established against a target of 5.

**A bug this caught, worth recording.** The first version built each rung of the price ladder from `Math.min()` across offers independently, so Amazon rendered "Listed ₹553 + ₹0 delivery = ₹569 landed" — three numbers from two different sellers that did not add up. Every rung now comes from one offer (the cheapest in-stock one) and the arithmetic is verified to balance on every card. A page whose whole purpose is traceability cannot show a sum that fails.

Interestingly, fixing it also **removed a finding**: "adding delivery reorders which platform is cheapest" had been true only because of the inconsistent ladder. With the bug fixed the claim is false, and the finding correctly suppresses itself.

**Verified:** analysis builds on all 1,156 products with 0 errors; 0 contradictions between its strategies and the engine's; all prior guarantees unchanged (0 integrity errors, 0 negative prices, 0 duplicate sellers, 0 MRP/floor/ordering/CF-1 violations, 1,043 recommended / 113 refused as before); no horizontal overflow at 375 px; lint clean.

---

### Stage 19 — The redesign

A design-first rebuild of the presentation layer. **No file under `src/data/`, `src/api/` or `src/utils/` was touched** — the modules that produce every number, finding and recommendation are byte-identical, which is the strongest available guarantee that the meaning did not move. Verified after the fact anyway: 1,043 recommended / 0 engine errors / 0 MRP, floor, ordering or CF-1 violations / 0 analysis errors / **0 contradictions between the analysis and the engine**, all matching the Stage 18 baseline exactly.

**What was wrong with the old interface.** It was competent and anonymous. The token file said so out loud — it had been copied from two reference UIs ("BizLink CRM, Creatica course platform"), which is why the product looked like a CRM. Concretely:

- **Everything was a card.** `.card` — white, hairline, 16px radius — was applied to 100 elements: metric tiles, product rows, alerts, evidence panels, tables, offers, findings. A binding constraint looked exactly like a sublabel.
- **Uniform weight.** Everything was 600, everything sat between 15px and 26px. In a *pricing* product, ₹519 was rendered at the same visual authority as the word "Marketplace coverage".
- **Sixteen hues, no hierarchy.** Black accent + orange accent + 4 status + 3 series + 6 avatar colours + per-marketplace brand colours, with no rule about which meant what. Six of them — the avatar palette — were assigned by hashing a seller's name and meant nothing at all.
- **Navigation by habit.** A 250px sidebar spending a fifth of the viewport on three links, above dense analytical tables that needed the width; a top bar with a Help button that did nothing and a bell that navigated to "/".
- **The tab strip threw away the argument.** Overview → Marketplaces → Listing → History → Analysis → Recommendation is the product's whole thesis — evidence resolving into a decision — rendered as an unordered row of pills.
- **No dark mode at all.** `color-scheme: light`, no media query, no toggle.

---

**The concept: a pricing desk set like a document.** Editorial/information-driven minimalism crossed with instrument tooling. It fits because this product's value proposition is *reasoning that can be read*: the analysis page is literally a six-step argument and the recommendation page is "here is the decision and here is why". That is a document problem before it is a dashboard problem.

**Three typefaces, three jobs.** Instrument Serif carries the argument (page titles, section heads, the wordmark, the quoted raw listing title in italic). Instrument Sans carries the interface. **IBM Plex Mono carries every figure the system asserts** — this is the highest-leverage decision in the redesign, because the existing `.tabular` class was already on 40+ values, so redefining it propagated an instrument-readout treatment across the entire product in one rule.

**The colour rule, and why there is no brand hue.** Ink is the accent: primary buttons, active navigation and selected states are near-black on paper, near-white on ink. Everything chromatic is *reserved for meaning* — status, direction (argues higher / argues lower), chart series, and marketplace identity. The consequence is the idea the design is actually built on: **the palette is inherited from the data**. On the marketplace comparison the dots take each platform's own colour, so a product sold on six platforms looks different from one sold on two, because it *is* different. A brand hue would have competed with the only colour that carries information.

**Geometry.** Radii 2 / 4 / 8px — architectural, not lozenges. Content surfaces cast **no shadow at all**: elevation is reserved for things that genuinely float, which is the masthead and two sheets. Translucency likewise — the masthead is the only glass in the product, used as a functional material over scrolling content, never on a content card.

**One recurring motif** does a lot of work: a 2px rule down the left edge. It marks the hovered table row, the hovered product card, the featured offer, a direction-carrying finding, a binding constraint, and the refusal panel. One interaction language, learned once.

---

**Structural changes (routes, pages and copy all preserved):**

| Was | Is | Why |
|---|---|---|
| Sidebar + top bar | A single **masthead**, wordmark in the display serif, underline-on-active nav, search with a `/` shortcut, alerts, theme toggle | Gave the analytical tables back a fifth of the viewport. The dead Help button is gone; the sidebar's provenance note became a **colophon** in the footer, where a statement about the whole application belongs |
| Tab pills | A **numbered progression rail**, sticky under the masthead, numerals threaded by a hairline | The order is the argument. Numbering it says so |
| Grid of price cards | A **dot plot** + a full parameter matrix | "How far apart are these, really?" was a question six cards made the reader answer from memory |
| 10 evidence boxes | Ruled dossier panels, display-serif titles, dotted-leader rows | Chunking kept, weight removed |
| Three equal strategy cards | Ruled columns under one rule, then an **asymmetric verdict**: the price at 52px beside the reasoning that produced it | This is the decision layer; the number is the answer |
| Fake product thumbnails | Removed | A grey square holding two letters, standing in for photography this dataset does not have, occupying the best position on the card |
| Six hashed avatar colours | Monochrome tiles | Six hues that meant nothing, in a system where colour means something |

**The dot plot is a dot plot on purpose.** A ₹519–₹609 spread drawn as bars from a zero baseline looks like no difference at all; drawn with a truncated baseline it lies. Dots need no zero, so the axis can frame the range the data actually occupies. Each row spans one offer's ladder — landed, effective, and the conditional best case — so the reader sees not just where a platform sits but what delivery and discounts did to get it there.

---

**Dark mode is authored, not inverted.** Surfaces climb in tone as they come forward (`#0c0e11` → `#15181d` → `#1b1f25`), so depth reads without a single shadow. Text tops out at `#eef0f3` rather than pure white, which haloes on a near-black ground. Status and series hues are re-tuned — lifted in lightness, pulled back in chroma — rather than reused. Three states: light, dark, and system (the default, which follows the OS live); an inline script in `index.html` resolves the choice before first paint so a dark reader never sees a white flash.

**Four real bugs surfaced during verification**, all worth recording:

1. **A flex container makes every *element* child its own flex item.** Only bare text runs get wrapped anonymously — so `<p class="flex">` containing `<strong>` fragmented into columns. It shattered the analysis provenance line into four. Icon-plus-text paragraphs must position the icon absolutely, not lay the paragraph out as flex.
2. **A CSS transition freezes a property whose value comes from a custom property.** On theme switch, transitioned colours stayed at their pre-swap value permanently — the masthead links sat in light-theme grey on a dark ground. Fixed by suppressing transitions for one frame across the swap, which is also the better feel: 120ms of every colour cross-fading at once reads as a smear, not a switch.
3. **The off-canvas filter sheet extended the document.** Parked to the right of the viewport, it gave `/catalogue` a 705px scroll width on a 375px phone. `overflow-x: clip` on `html, body` removes the overflow without creating a scroll container — which `overflow: hidden` would, breaking the sticky masthead and rail.
4. **The progression rail silently never scrolled.** Two causes stacked: before first layout every box measures zero, so "the active step is already visible" was trivially true; and a `behavior: "smooth"` scroll issued while the page is still settling gets cancelled outright. Now: instant positioning, re-run on `document.fonts.ready` because the display face changes every step's width.

**Contrast was computed, not eyeballed.** The first audit found **180 failures** on a single route — the label grey was 2.59:1. The ink ramp was recalculated so that ink-400 and darker each clear 4.5:1 against canvas, canvas-deep, surface and surface-2 *in both themes*, and ink-300 clears the 3:1 bar for graphical objects. Final sweep: **13 routes × 2 themes, 0 contrast failures, 0 horizontal page scroll**; same at 375px and 768px. Keyboard focus shows a 2px signal ring via `:focus-visible`, and the one hover-revealed control (untrack) also reveals on focus and is always visible on small screens.

---

### Stage 20 — Ten products, seven horizons, and the parameters that are not price

Feedback after the professor reviewed the deployed build:

> "I have reviewed this so you have considered only 2 products for now but I would suggest to take atleast 10 products and I also found that you have considered only 7 days time period for your observation but I would also suggest that to take several slots like 1 days, 2days, 3, days, 7days, 15 days, 1 month, 3 months, etc — also, as a next step, try to identify which other parameters than product price you can take that can helpful to increase the review of the client store"

Both of the first two observations were literally true of the code. `DEFAULT_TRACKED_PRODUCT_IDS` held exactly two hand-written ids, and the dashboard's only horizon was a hard-coded seven-day lookback. Neither was a display limit — they were the whole of what the entry page could say.

---

#### The constraint that shaped the whole stage

Before writing anything, the actual observation density was measured across all 1,155 products with history:

| Window | 0 obs | 1 obs | 2–4 obs | 5+ obs |
|---|---|---|---|---|
| 1 / 2 / 3 days | 1 | ~870 | ~280 | 0 |
| 7 days | 1 | 202 | 663 | 289 |
| 15 days | 0 | 1 | 865 | 289 |
| 1 month | 0 | 0 | 203 | 952 |
| 3 months | 0 | 0 | 0 | 1,155 |

Capture cadence is tiered by traction (2 / 5 / 12 days), the way a real crawl budget is. So **a one-day window holds a single observation for three quarters of the catalogue**, and one observation has no direction, no range and no volatility.

That could have been hidden — draw a flat line, print "0.0%", move on. Instead it became the design. A window is not handed a fixed set of statistics; what it can support is derived from what is inside it:

| Capability | Observations | Carries |
|---|---|---|
| `none` | 0 | nothing; the window is shorter than the cadence |
| `snapshot` | 1 | a price level, and explicitly nothing else |
| `directional` | 2–4 | change first-to-last, observed range. **Not** volatility — a coefficient of variation on three points describes the sampling, not the market |
| `distributional` | 5+ | median, volatility, trend |

Every statistic a window cannot support is recorded in `withheld` **with its reason**, so the interface states why a number is absent rather than leaving a hole. Across 560 window analyses on 80 products the invariant "no statistic appears above its capability tier" holds with zero violations.

The visible consequence on the desk, and the best single answer to what different horizons actually tell you:

| Horizon | snapshot | directional | distributional | alerts raised |
|---|---|---|---|---|
| 1 day | 11 | 0 | 0 | **0** |
| 7 days | 1 | 10 | 1 | 1 |
| 1 month | 0 | 1 | 11 | 5 |
| 3 months | 0 | 0 | 12 | 11 |

At one day the system raises no alert and reports no average, because it cannot. That is the honest reading, and it is more informative than a fabricated zero.

`compareWindows()` then answers the question behind the request — temporary, emerging, persistent or stable — by comparing the shortest window that carries a direction against the three-month one: **stable**, **recent move**, **settled after a move**, **persistent trend**, **reversal**, or **not established** when the short end cannot carry a direction at all. The showcase product reads *settled after a move*: −8.9% over three months, −0.2% over the last two days.

---

#### Ten products, chosen by method

`utils/demoSet.js` profiles every product on reach, capture depth, competitive density and price, assigns an expected evidence tier, then fills a stratified quota. The competitive-density proxy is not a guess — it applies **the engine's own first gate** (same product type, price within 0.6×–1.7×), which is what decides whether a comparable set can exist at all.

Three things were learned doing it:

1. **The per-department cap had to be a hard constraint, not a scoring nudge.** Without it the strong tier filled with four beauty products — an honest reflection of the catalogue (FMCG carries the review volume that buys the deepest capture cadence) but a poor demonstration, because four shampoos cannot show the framework is not tuned to one kind of product.
2. **A refusal stratum had to be added explicitly.** The first set contained no product the engine refuses, which hides the behaviour most worth showing. Products with fewer than two candidates now form their own stratum.
3. **Selection must not touch the engine.** Running `buildRecommendation` over 1,172 products to choose twelve costs seconds of blocking work. Everything in the selector is map lookups; it completes in ~31 ms.

The resulting set: **12 products, 11 departments, at most 2 per department, ₹90 to ₹22,490**, capture cadence 2 to 12 days, 2 to 6 marketplaces, 0 to 10 direct competitors, confidence spanning *medium-high → medium → low → **refused***.

---

#### The parameters that are not price

The test applied to every candidate was not "is this field in the database" — most are — but **can a seller name the decision this parameter changes?** A number that cannot finish the sentence "…so I should ___" is a column, not a parameter.

Ten earned a place, each shipped with the decision it serves: **trust-weighted rating**, **review velocity** (demand proxy), **featured-offer lock**, **stockout exposure**, **sellers on the listing**, **marketplace fulfilment share**, **delivery as a share of landed price**, **promotional days**, **discount depth off MRP**, and **platform coverage gap**. Industry accounts of marketplace ranking name stock availability, seller rating, review velocity, delivery speed and fulfilment method as genuine non-price drivers of the default buying position, which is the corroboration for choosing these rather than the other twenty fields available.

**Rejected, and why — this list matters as much as the one above:**

- **Units sold, sales velocity, conversion, sessions, add-to-cart, search rank, impression share, returns, ad spend.** Absent from the dataset. Sales velocity is named in every industry account as a *primary* ranking signal; we do not have it. It is carried in the payload as a declared gap and printed on the page, rather than quietly omitted.
- **True price elasticity and willingness-to-pay from demand.** Both need quantity sold at more than one price. The hedonic model estimates what the market charges for *attributes* across a cross-section of products; that is not a demand curve and is never described as one.
- **Rating distribution skew.** Present in the data, but generated as a deterministic function of the average rating — so it carries no information the average does not already carry. Reporting it would imply a second, independent signal that does not exist.

One measurement bug is worth recording: the first featured-offer metric pooled buy-box wins across all platforms, so six listings each with an unchallenged winner came out as *"the top seller holds 16.7%"* — which reads as a wide-open contest and is the exact opposite of the truth. The Buy Box is a **per-listing** contest, so that is now the unit, summarised as "locked on N of M platforms".

---

#### What the research says, and why the engine was left alone

The brief asked for an assessment of the pricing engine against real practice, and explicitly warned against changing it to look more advanced.

**Already aligned with practice:** a screened competitive set rather than a category average; a 90-day reference price used to detect promotional distortion, so a dip is not mistaken for the standing level; hard constraints (MRP ceiling, break-even floor); evidence gating that refuses rather than guesses; and hedonic attribute pricing with a trust gate. Industry work on hedonic pricing warns that sparse or inconsistent price observations produce unreliable coefficients and that this is the most common reason such models underperform — which is precisely why the trust gate (n ≥ 5, adjusted R² ≥ 0.5) exists and why only a small minority of products earn an evidenced premium.

**Honestly heuristic:** the similarity weights, the 0.6×–1.7× band, how far each strategy is allowed to travel, the ±10% clamp. These are judgement calls, documented as such, not estimated from data.

**Missing versus a production system:** demand and elasticity, price experimentation, cross-price effects within a seller's own range, competitor reaction, and inventory carrying cost.

**Decision: no change to the recommendation engine.** The gap is not mathematical sophistication — it is demand data. Fitting a more elaborate model to the same cross-sectional prices would produce a more confident-looking estimate of exactly the same information, which is the failure mode this project has spent four stages avoiding. Verified after the fact: **1,043 recommended, 0 engine errors, 0 MRP / floor / ordering / CF-1 violations, 0 contradictions between analysis and engine** — identical to the Stage 18 baseline.

The non-price layer deliberately **does not feed the engine**. It sits in its own step and states how it corroborates or complicates the pricing conclusion, as a relationship rather than as arithmetic folded into a price.

---

#### Where it lives

`utils/observationWindows.js` (the horizon engine and capability ladder), `utils/storeSignals.js` (the ten parameters and their findings), `utils/demoSet.js` (stratified selection). `api/dashboardService.js` now derives its product set and accepts a window. The analysis page gains the horizon ladder inside step 5 and a new step 6, *Beyond price*; the conclusion moves to step 7.

**Note on the refusal case:** when the engine refuses, steps 4 and 7 are absent but the horizon ladder and all ten parameters still render — they are computed from the product's own observations and do not depend on a competitive set. A seller with no comparables still learns about their stockouts, their featured-offer position and their review velocity. Step numbers stay fixed, so a gap in the sequence is itself the signal that a step could not be produced.

**Future work, in order of value:** ingest a sales or units signal, which unlocks elasticity and turns the demand proxy into a demand measurement; add competitor price-change detection over windows; model competitor reaction; and add per-window competitive comparison, which today is computed only at the current moment.

---

### Stage 21 — Backend, phases 1–2: architecture and the database

The brief: convert the frontend-heavy prototype into a real full-stack application, in eight controlled phases. Phases 1 (audit + architecture) and 2 (database + migration) are specified and complete; phases 3–8 are not yet defined.

Full reasoning lives in `docs/BACKEND_ARCHITECTURE.md` and `server/README.md`. What follows is what a future reader most needs to know.

---

#### The stack decision, and why it contradicts an earlier note

This file has said since Stage 7 that a **Java REST API** comes next. That is revisited here, deliberately.

There are ~4,300 lines of tuned JavaScript in `src/utils/` — weighted interpolated quantiles, a least-squares hedonic fit with a trust gate, four sequential competitive-set gates, the promotion-class price ladder, the observation-window capability ladder. The project's own rules say *do not rewrite working pricing logic* and *do not duplicate business logic between frontend and backend*. A Java backend forces a reimplementation of all of it, and any numerical drift silently breaks guarantees that took four stages to establish.

Choosing **Node + TypeScript** means that code can *move* rather than be *rewritten*, with the existing regression suite still meaningful. Everything else follows: **Fastify** (schema-based validation and serialisation built in), **PostgreSQL**, and **Drizzle**.

Drizzle over Prisma for three reasons, one of them environmental and worth stating plainly: it emits plain reviewable `.sql`; it has no Rust engine binary; and it is driver-portable, so the identical schema and migrations run against `node-postgres` in production and against **PGlite** — real PostgreSQL 17 compiled to WebAssembly — locally. That last point decided it. *This machine has no PostgreSQL and no Docker*, so the alternative was shipping migrations that had never been executed. With PGlite the migrations and the 389,534-row seed are genuinely run and genuinely verified. The honest caveat: PGlite influenced the choice. The resulting property — migrations verifiable with no database service — is a real CI advantage regardless.

#### Repository shape

`server/` is a **standalone package** with its own `package.json` and `node_modules`. Workspaces are deliberately *not* introduced yet: declaring a workspace root now would pull the server's dependencies into the Vercel install for no benefit, because nothing is shared. Workspaces and a `shared/` package arrive in the phase that actually extracts the analytical core. The web app stays exactly where it is, so the deployment is untouched.

#### What the schema asserts that the frontend never did

22 tables, 30 foreign keys, 40 constraints. The decisions worth defending:

- **The dataset's string ids stay as primary keys** (`prod_dove_hair_fall`). They are already stable and unique, the frontend keys everything by them — so later phases change no component — and they make production debugging far easier than opaque UUIDs. Correct uniqueness is then expressed with **composite constraints**, which is the real point: `unique(marketplace_id, external_listing_id)`, because an ASIN is unique on Amazon and not across the internet.
- **A seller row is marketplace-scoped**, because a merchant's id, rating and fulfilment type are marketplace-scoped facts. `seller_group_id` carries cross-platform identity without pretending one row spans platforms.
- **`unique(offer_id, observed_at)`** is what makes the observation series append-only in practice rather than append-mostly.
- **`promotions.availability_class` is materialised**, not derived per query. It decides whether a discount may enter a price comparison at all, so the rule belongs in the schema rather than in whichever consumer remembers to apply it.
- **`price_observations.raw_document_id` is deliberately NOT a foreign key.** Every observation carries one, but raw HTML is retained far more briefly than the facts derived from it, so the target is routinely absent. A FK there would make the retention policy fail the load. The verifier reports the dangle rather than failing on it.
- **JSONB in seven places only**, all genuinely schemaless by design. `promotions.terms` earned it on evidence: ten distinct shapes across the dataset, discriminated by `promotion_type` (a bank offer carries `{bank, percent, capMinor, minSpendMinor, cardTypes}`; no-cost EMI carries `{bank, tenureMonths}`). Columns would mean twenty mostly-null fields or a table per type.

#### Two real defects the constraints caught

Both had been invisible because nothing in the frontend read the fields.

1. **Duplicate marketplace seller ids.** 1,177 sellers produced only **949** distinct `(marketplace, external_seller_id)` pairs — 228 ids each shared by two genuinely different merchants ("Star Home" and "Star Home Mumbai"). `sellerGenerator.js` truncated a 32-bit hash to its last seven base-36 characters. Fixed at the root by making the id unique by construction. Engine regression after the fix: **1,043 recommended, 0 violations** — unchanged, as expected, since nothing read the field.

2. **Parent products carry no spec document.** `products` holds two kinds of row — purchasable SKUs, and abstract family nodes like "Samsung Galaxy M14 5G" that exist only to group variants. Family nodes legitimately have no specs. `spec_schema_version` is nullable, and a check constraint states the actual rule: *a thing you can buy must declare its spec schema*. It holds on all 1,172 rows (2 products lack a schema; both are non-purchasable; zero purchasable rows lack one).

#### The migration is two steps because the dataset is a program

The legacy data is not a file — ~1,100 hand-authored seed rows expanded by a seeded PRNG at module load into 389,534 rows, through Vite-style extensionless imports Node cannot resolve. So `scripts/export-dataset.mjs` boots Vite in middleware mode and uses its own resolver to write NDJSON; `server` then loads that NDJSON with no build-time dependency on the frontend tree. The exporter is a **migration tool with a finite life** — when the database is the source of truth, it and the generators are deleted together.

Load: **389,534 rows, 20 tables, 59.8 s**, every count matching the manifest.

#### Verification is structural, not just counts

A load can hit every row count and still have shredded the relationships, which is the specific failure mode the brief warns about. `db:verify` runs **37 checks**: counts, zero orphans on every foreign key, graph shape as *distributions* rather than totals (two products swapping a listing would leave every total untouched), and the domain invariants — no negative money, nothing above MRP, one observation per offer per day, one featured offer per listing per day, promotion class matching promotion type — plus a golden record asserting that Dove Hair Fall Rescue Shampoo still has 6 listings, 30 offers and a cheapest landed price of ₹569, the same figures the UI renders. All 37 pass.

#### Phase status

Phases 1 and 2 complete. There is **no HTTP layer yet** and the frontend still reads `src/data/` — nothing about the running application changed in this stage except the one generator fix. Phases 3–8 await specification.

---

### Stage 22 — Backend phase 3: authentication and the API foundation

Phase 3 of the eight-phase backend plan: email-OTP authentication, the Fastify foundation, and the first database-backed read APIs. Full detail in `server/README.md`; this records what a future reader needs and would not guess.

> **The credential model here was replaced in Stage 23.** Passwordless OTP login is gone: the credential is now email + password, and a one-time code only verifies an address or authorises a reset. Everything below about the Fastify foundation, the session design, the OTP *mechanism*, the catalogue APIs and the five defects still stands — only "a code is how you log in" does not. The two paragraphs that state it are marked inline.

**A correction to the phase brief's premise.** It stated that Phase 1 established a "Fastify + TypeScript foundation". Phase 1 *chose* Fastify; no HTTP code existed. There was also no test runner. Both were built here.

---

#### Application user is not marketplace seller

Two concepts that share no key and no table: `users` is a person signing in to this product, `sellers` is a merchant observed on a marketplace. Phase 2 had stubbed `users` with a `password_hash` column and a three-value role enum; Phase 3 removes both, because the brief rules them out and an unused enum encodes a decision nobody has made. Email is the identity and **there is no password column at all**.

> *Superseded by Stage 23:* `password_hash` is back, deliberately and with a different meaning — an Argon2id digest, nullable, written only by registration and reset. The role enum has not come back. The user/seller separation is unchanged and is now asserted by a test.

Uniqueness is a **functional unique index on `lower(email)`**, not application discipline. Normalisation that depends on every caller remembering to normalise is not a guarantee.

#### Why opaque session tokens rather than JWT

The decisive reason is logout: revoking a stateless token requires a denylist, which is a session table with extra steps and worse failure modes. A secondary one is that an opaque random string carries no claims, so the "no sensitive data in tokens" rule is satisfied by having nothing to leak rather than by remembering what to leave out. Sent as a bearer header rather than a cookie because Vercel and Railway are different registrable domains, where third-party cookie blocking makes `SameSite=None` unreliable. No refresh rotation — a revocable 30-day session is the right amount of machinery for this product today.

#### OTP protection, and the one non-obvious choice

Codes are `crypto.randomInt`, stored as **HMAC-SHA256 under a server-side pepper**, compared in constant time, expiring in ten minutes, single-use, attempt-limited, cooldown-limited and rate-limited per address *and* per IP separately.

The pepper is the non-obvious part. Six digits is a million possibilities, so `sha256(code)` falls to a lookup table the instant the database leaks; an HMAC under a secret the database does not contain does not. Deliberately not bcrypt: the secret provides the work factor, and a deliberate 100ms on the login path is a denial-of-service lever rather than a security gain.

Single use is enforced by a **conditional update** (`set consumed_at … where consumed_at is null`), so two simultaneous verifications both validate but only one `UPDATE` matches a row. The same technique — `onConflictDoNothing` against the unique index, then re-read — is what makes repeated verification unable to create a second account.

`request-otp` answers **identically whether or not the account exists**. Saying otherwise turns the endpoint into a membership oracle, and the next step works the same either way.

> *Superseded by Stage 23:* `request-otp` and `verify-otp` no longer exist. The neutrality principle moved with the flow — `forgot-password` and `resend-verification` answer identically whether or not the account exists, and login answers identically for an unknown address and a wrong password.

---

#### Five defects found by writing the tests

Each was invisible until something asserted against it. They are the reason this phase took the time it did, and the reason the tests assert state rather than status codes.

1. **Correlated subqueries silently returned zero.** Interpolating a Drizzle column inside a raw `sql` subquery renders it **unqualified**: `where l.marketplace_id = ${marketplaces.id}` became `where l.marketplace_id = "id"`, which the inner scope resolves to `listings.id`. Every `productCount` and `listingCount` was 0. It passed a shape check (`typeof === "number"`) and only failed when a test asserted AJIO had listings.
2. **Pattern injection in search.** Binding a parameter stops SQL injection but not LIKE-pattern injection — a search for `%` returned the entire catalogue.
3. **Collation-dependent ordering.** `ORDER BY canonical_name` put "AGARO" before "Accu-Chek" under PGlite's collation, and a managed Postgres need not agree — so dev and production could order differently. Sorting on `lower(...)` makes it deterministic.
4. **Fastify strips unknown fields by default.** AJV's `removeAdditional` is on, so `additionalProperties: false` had no effect and a request with a misspelled field was accepted as correct.
5. **A custom rate-limit `errorResponseBuilder` broke the error shape**, turning every 429 into a 500.

Two further failures were my own test data violating the Phase 2 check constraints — setting `expires_at` into the past without moving `created_at`, which `otp_expiry_after_creation` correctly refuses. The constraints were right; the tests were wrong.

#### Test architecture

Node's built-in runner via `tsx`, no framework. HTTP through `app.inject()`, so nothing binds a port. **Every run gets its own PostgreSQL** — `new PGlite()` with no path is a real engine held in memory — so tests cannot reach the development database and the destructive auth tests are safe by construction. Each test uses its own email address *and its own source IP*: sharing one address made the whole file draw on a single per-IP rate budget and the suite began 429-ing partway through, which was the limiter working and the tests being wrong.

`tests/regression.test.ts` is the deliberate exception: it reads the **real** development database, because "did Phase 3 disturb Phase 2's data?" cannot be answered against a fixture.

**54 tests, all passing.** Baseline after Phase 3 is unchanged: 1,043 recommended / 0 MRP, floor, ordering or CF-1 violations / 0 contradictions, and all 37 database integrity checks still pass with every Phase 2 row count exact.

#### Scope held

No competitor engine, no cross-marketplace analysis, no historical engine, no recommendation migration, no scraping, and **no frontend API migration** — `git status` shows zero changed files under `src/`. The frontend still reads `src/data/` and is untouched.

---

### Stage 23 — Email + password, and the frontend that actually uses it

The credential becomes **email + password**. A one-time code keeps exactly two jobs — proving an address at signup, and authorising a reset — and is never a way to log in. The frontend stops being a mock-only application: the five authentication screens and the session they establish are real, and every one of them talks to the Phase 3 API over HTTP.

Full API detail in `server/README.md`. This records what a reader would not guess.

#### Two purposes, enforced by the database

`otp_challenges.purpose` was a single-valued text column with a check constraint; migration `0003_password_auth.sql` narrows it to `email_verification | password_reset` and drops `login` outright. A verification code cannot authorise a reset and a reset code cannot verify an address — and that is a constraint, not a convention.

The code hash is **salted by purpose**: `hashOtp(code, ` + "`${purpose}:${email}`" + `)`. Even if the two challenges somehow met, the digest would not match.

The migration begins with `DELETE FROM otp_challenges WHERE purpose = 'login'`, hand-added before the new CHECK is applied. Without it, applying this migration to any database with an outstanding login code fails the constraint and the deploy stops. Old migrations were not edited — a migration that may already have run is history.

#### Argon2id, and what the policy deliberately does not include

`argon2` at the library defaults (64 MiB, t=3, p=4), which sit on OWASP's recommendation, stated explicitly in `lib/password.ts` so raising the cost is a visible diff. Nothing is hand-rolled; the digest carries its own parameters, so the cost can rise later without invalidating existing hashes.

The policy is length (8–128), no leading/trailing space, and a twelve-entry common-password denylist. **No character-class rules** — they reliably produce `Password1!` and nothing else. **No confirm-password field** — it is a second chance to make the same typo, and it is why people choose passwords they can type twice rather than ones they can remember; a reveal toggle does the same job honestly. The 128 upper bound is not a strength rule: it stops a multi-megabyte body becoming a memory-hard hashing job.

#### The two places an oracle would otherwise open

1. **Login.** An unknown address and a wrong password return the same code *and the same message*, and the unknown path still pays for a decoy Argon2id verification (`equalisePasswordTiming`). Without that, response *time* enumerates accounts however careful the wording is. `EMAIL_NOT_VERIFIED` is checked **after** the password, deliberately: telling anyone who types an address that it is unverified leaks which addresses have accounts; telling someone who has already proved they know the password leaks nothing, and they are the only person who can act on it.
2. **Forgot password.** Always 202, always the same sentence, and the frontend always navigates to the same next screen. Branching in the UI would undo the server's refusal to disclose.

#### Reset is two calls and one screen

`verify-reset-otp` hands back a short-lived token and **does not consume the challenge**; `reset-password` consumes it. That keeps "one code, one password change" true across a two-step flow, makes the token single-use and revocable for free, and lets an abandoned reset expire on its own. The token is stored hashed on the challenge row — a second secret on a row that already has one, rather than a stateless signed token with its own invalidation story.

A completed reset **revokes every session** and deliberately does **not** sign the browser in. Whoever performed the reset may not be whoever was signed in, and if the account was compromised the attacker's session is exactly what must not survive; handing this browser a new session without the new password being typed once undermines the point.

#### The frontend: no fake state anywhere

- **One place adopts a session** — `adoptSession` in `AuthContext`, and it throws unless the server returned both a token and a user. A `{ user }` with no token cannot authorise a single subsequent request, so treating it as a session is precisely the fake login state the design exists to rule out. A test asserts that `state/AuthContext.jsx` is the *only* file that names the storage key.
- **A stored token proves nothing.** On load the app sits in a third state, `restoring`, until `/auth/me` answers. Rendering the signed-in shell would flash it at someone signed out; redirecting to the door would bounce a signed-in user on every reload. The guard reads `isAuthenticated`/`isRestoring` and never reads storage.
- **Only the token is persisted.** The user record is always re-fetched — a cached copy is a claim about server state that nothing keeps true.
- The pending address for a two-screen flow lives in **sessionStorage, not the URL**. An address in a query string lands in history, referrer headers and every access log on the way.
- `VITE_API_BASE_URL` is read from the environment with a **relative** `/api/v1` default; the dev server proxies `/api`, so local development needs no env file and no CORS. A test refuses any absolute origin in `src/api` or `src/state`, and any `fetch()` of an absolute URL anywhere.

#### Art direction of the door

The same system as the rest of the application, not a separate login theme: a two-column document, a hairline seam, the wordmark's three-bar price ladder, ink as the only accent. The left column carries one editorial line and a **numbered ledger** of the flow's steps — the same device as the workspace rail. Below 860px the editorial half is dropped and the ledger goes horizontal: the step count is the part that earns space on a phone.

The six-digit code is **one input**, set in tracked mono, not six boxes. Six boxes break paste, break screen readers and break the browser's own one-time-code autofill.

#### What the tests actually assert

Backend **71/71**. `tests/auth.test.ts` was rewritten for the password model and asserts state: that the stored credential matches `/^\$argon2id\$/` and does not contain the password, that a failed attempt does not spend a code, that a reset produces a *different* digest and kills the pre-reset session, that a wrong password and an unknown address are byte-identical responses.

Frontend **30/30** (Vitest + Testing Library). These assert what reaches the network and what the browser is left holding — the fake API is a stand-in for the *server*, never for the app's own client, and every test checks the actual request body.

End-to-end **7/7**, nothing mocked: `npm run test:e2e` creates a throwaway PGlite, migrates it, starts the real API, and drives the shipped React components and the shipped fetch client over real HTTP. The verification codes are read out of the server's own console email adapter, so even the six digits typed into the form are digits the server issued.

Two regression assertions from Stage 22 were **rewritten rather than deleted**: "the users table no longer carries a password column" was true then and is wrong now, so it now asserts the column exists, is text, is nullable and has a stated reason — and that `role` and a plaintext `password` column are still absent. A second asserts the purpose constraint no longer admits `login`.

Each of the three suites was mutation-checked: a deliberately planted credential-log, and a planted `DEV_USER`, each made the relevant test fail before being reverted. A test that cannot fail is not evidence.

#### Verified in a real browser

Both servers up, the full flow driven through the browser pane: register → code from the API log → verify → dashboard; reload restores the session; sign out revokes and redirects; wrong password refused; reset replaces the credential and lands signed out. Contrast audited in-page across all five screens × both themes — **158 text elements, 0 failures** — and 375px shows no horizontal overflow. The walkthrough account was then removed from the development database, which is back to 0 users / 0 sessions / 0 challenges with the catalogue untouched.

#### Scope held

No Phase 4. The catalogue, product, analysis and recommendation pages still read `src/data/` through `src/api/*Service.js` — that swap is a later phase. Nothing in the pricing engine, the observation-window analysis or the store-signal layer was touched.

---

### Stage 24 — Gmail SMTP, behind the same port

A transport, not an architecture. The `EmailAdapter` port from Stage 22 gains
a fourth implementation and the authentication service is unchanged — which
is the whole return on having had a port in the first place.

```
AuthService ──▶ EmailAdapter ──┬── memory   tests
                               ├── console  development, no mailbox
                               ├── http     a transactional-email API
                               └── smtp     Nodemailer over TLS  ← new
```

Setup instructions and the full rule table are in `server/README.md`. This
records the reasoning.

#### The one auth-side change, and why it was unavoidable

Delivery could not fail before. `memory` pushes to an array and `console`
prints; neither has a failure path, so `issueCode` wrote the challenge row
and called `send` with no thought about what happens if `send` throws.

With SMTP it throws, and then the row is still there. The resend cooldown is
measured from the newest challenge **whether or not it was consumed**, so a
failed delivery answered the user's retry with "please wait 47 seconds" — a
timer counting down for an email that never left the building.

So a failed send now **deletes** its own challenge. Not consumes: a consumed
row still sets the cooldown. A code that was not delivered was never issued,
and the row should say so. Nothing else in the auth service moved — the same
generation, hashing, expiry, attempt limits and flows.

#### Fail at boot, not at somebody's signup

`EMAIL_ADAPTER=smtp` makes `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` and
`SMTP_PASS` required, each **named individually** in the failure. "SMTP
configuration is incomplete" sends people reading their own `.env` line by
line, which is the slow way to find the one variable they forgot.

Then `buildApp` calls the adapter's optional `verify()` — a real handshake
and AUTH exchange that sends nothing and costs a few hundred milliseconds.
A wrong App Password becomes a refusal to start. An API that boots with a
broken mail path accepts registrations it cannot complete, and every one of
those users is stranded with an unverified account.

Deliberately **not** in `/health`: that endpoint is unauthenticated and
discloses nothing about the infrastructure, and an SMTP probe there would
both advertise the transport and make liveness depend on Google.

#### Two configuration rules that exist because of how Gmail behaves

- **`EMAIL_FROM` must equal `SMTP_USER`.** Gmail will not send as an address
  the authenticated account does not own — it rewrites the header *silently*,
  so the mail arrives looking wrong and nothing reports an error. Startup
  refuses the mismatch instead.
- **`EXPOSE_OTP_IN_RESPONSE` must be false with `smtp`.** The two contradict
  each other: one exists to deliver the code to an inbox, the other hands it
  to any caller. With both on, nobody would notice delivery was broken.

`SMTP_PASS` is documented everywhere as a **Google App Password**, never the
account password — Gmail refuses the latter over SMTP anyway, and putting it
in a file exposes the whole Google account rather than one revocable
credential.

#### Errors are built from the code, never the message

A provider can quote the failed `AUTH PLAIN` line back at you, credential
included. So `describe()` switches on the error's `code` and builds its own
sentence; the provider's message is never read. A test plants a fake error
whose message contains a secret and asserts it reaches neither the message,
the details, nor the log context.

The caller gets the standard envelope and a 502. The host, the port and the
SMTP dialogue stay in the log context, where the central handler's redact
list already governs them.

#### One honest trade-off, recorded rather than hidden

`forgot-password` normally answers 202 whether or not the account exists. If
SMTP is down it answers 502 — but only for addresses that *do* have an
account, because no send is attempted for the others. During a mail outage
that is a narrow membership oracle.

It is deliberate. The alternative is swallowing delivery failures and telling
every user a code is on its way when none is, which is both a worse failure
and an invisible one. The window is the length of the outage.

#### The email itself

Plain text plus HTML, no links and no images. A code typed by hand cannot be
consumed by a corporate link scanner and gives a phishing lookalike nothing
to imitate. The HTML is a single-column table with inline styles and system
fonts, because Gmail strips `<style>` blocks and web fonts and Outlook
ignores most modern layout — anything clever degrades into something worse.

Neither part carries a user id, a session, a request id or any other
internal. Subjects are "Verify your Mulya account" and "Reset your Mulya
password"; the two bodies differ because an unexpected verification code is
noise while an unexpected reset code is a warning worth acting on.

#### A defect the tests found in the test harness

The end-to-end runner's teardown signalled only the process it spawned.
Under `shell: true` on Windows, `npx tsx src/server.ts` is three processes
deep, so the actual listener survived — and the *next* run found something
answering `/health`, decided the API was up, and ran the whole suite against
a stale server with the old email format. Five tests failed for a reason
that had nothing to do with the code.

Fixed twice over: teardown kills the process tree (`taskkill /T`, or a POSIX
process group), and startup refuses to run at all if anything is already
listening on the port. A suite that can silently test the wrong server is
worse than one that fails.

#### Tests

**Backend 103/103** (71 + 32 new), **frontend 31/31**, **end-to-end 7/7**.
No automated test sends real mail: the adapter takes a transport factory so
a stub can stand in, and the configuration rules are exercised against the
exported `envSchema` directly rather than by mutating `process.env`.

Two existing assertions moved with the requirement rather than being deleted
— the email subjects changed, so the tests that asserted the old ones now
assert the new ones.

Mutation-checked: replacing `describe()` with one that interpolates the
provider's message made two tests fail before it was reverted.

---

### Stage 25 — Backend phase 4: marketplace data and historical intelligence APIs

Twelve read-only endpoints that make the database the source of truth for
marketplace data. **Data access, not decision-making**: no recommendation,
no competitor scoring, no analysis migration, no scraping. Those remain
where they are, and this is the foundation they will read from.

Full endpoint contracts in `server/README.md`. This records the reasoning.

#### The audit came first, and changed the plan twice

Two things the schema already had, which a less careful start would have
duplicated:

1. **`listings.listing_url` is populated for all 2,947 listings**, correctly
   shaped per marketplace. The brief allowed for generating a URL from the
   marketplace plus the external id; none was needed, and generating one
   would have produced a second, competing answer to a question the column
   already answers.
2. **`listings_product_marketplace_key`** makes a product's listing on a
   given platform unique. That is what lets the marketplace summary expose a
   single `sourceUrl` rather than a list, and it is why `listingCount` is
   always 1 — a fact worth stating rather than a bug worth hiding.

#### One effective price, proven rather than asserted

The whole phase turns on not inventing a second definition of "effective
price". `src/lib/priceLadder.ts` is the ladder in SQL, and it is a
translation of `src/utils/priceLayers.js` — same clamp, same inclusive
`valid_from <= date <= valid_to`, same exclusion of cashback and EMI from
every rung.

Asserting that in a test was awkward: the engine's modules use Vite-style
extensionless imports that the backend test runner cannot resolve. So
`scripts/export-price-parity-fixture.mjs` runs on the frontend side and
writes down what the ENGINE says for 330 real observations; the backend test
asks the database the same questions and compares all ten rungs — 3,300
comparisons.

The fixture samples each promotion's validity boundary, at, before and
after. That is the detail that earns its keep: making `valid_from` exclusive
as a deliberate mutation broke exactly **2 of 3,300** comparisons, and the
test caught it. A fixture sampling only the newest row would have passed.

#### Statistics are computed on the daily series, not on raw observations

A median over raw observations counts a marketplace once per offer it
happens to carry, so a platform with six sellers outvotes one with a single
seller and "the median price of this product" drifts toward whoever lists it
most. The engine's `getProductPriceSeries` already solved this — in-stock
only, cheapest effective price per capture day — and the backend reproduces
it exactly, states the rule in `meta.seriesDefinition`, and has a test that
asserts the two definitions give *different* answers so the check cannot go
blind.

What a window may claim is decided by the COUNT inside it, never by its
length: none / snapshot / directional (2–4) / distributional (5+), with
every withheld statistic carrying its reason. The same ladder as Stage 20,
now on the server.

#### A window's length and its evidence are different facts

Anchored on `max(observed_at)` — 2026-08-14 — because a wall clock would
make every window empty and a constant would break on regeneration. Both
ends inclusive, so `start = end − (days − 1)`.

The consequence is visible in the tests: Dove is captured every two days, so
the 3-day window holds exactly the same two capture days as the 2-day one.
Both report their real range and their real count. An API that made those
move together would be lying about one of them.

#### Performance: measured, and no index added

`EXPLAIN ANALYZE` over all 354,940 observations, on the heaviest product in
the catalogue: **no sequential scans anywhere**, 0.2 ms to 52 ms. The Phase 2
indexes already cover every access path this phase introduced.

So nothing was added. "Do not add dozens of indexes without understanding
their benefit" is easy to agree with and easy to ignore; the honest way to
honour it was to measure and then write down that the answer was zero.

#### What the tests assert

**Backend 173/173** (109 + 64 new). Every expected number is read out of the
seeded database and stated literally — 6 listings, 30 sellers, 30 offers,
1,830 observations for the golden record, and the equivalents for a
five-marketplace product, a commodity with no promotions at all, a 44-
observation sparse one and a single-marketplace one.

The window statistics are **re-derived inside the test** from the raw
observations the API returns, then compared with the summary it computed —
so a change to the aggregation has to agree with a change to the test before
anything passes.

A test fixture that loads the full entity graph for six products, rather
than all 390,000 rows, keeps the suite at seconds: the observation file is
134 MB, and the loader pulls the offer id out of the raw line and skips
`JSON.parse` for the 99% that miss.

#### Two failures that were not this phase's fault, and one that was

Running the suite surfaced two red tests caused by the user configuring
Gmail and registering a local account — exactly what they said they would
do. Both were *my* tests being fragile rather than their doing anything
wrong:

- `SMTP-08` asserted a hardcoded `EMAIL_FROM`. It now compares against the
  configured value, and `tests/helpers/env.ts` pins the variable so a
  developer's own `.env` cannot change what the suite asserts.
- A Phase 3 regression test asserted the `users` table was EMPTY. That was
  only ever true while nobody had used the application. Replaced with the
  invariant it was standing in for: `seed.ts` must not truncate `users`,
  `sessions`, `otp_challenges` or `tracked_products`, because a data reload
  must not sign anybody out.

The genuine one was mine: a 4,000-row insert batch exceeded PostgreSQL's
65,535 bound-parameter ceiling and failed inside the wire protocol rather
than with a readable error. 1,000 rows × 13 columns is clear of it.

#### Scope held

No analysis migration, no recommendation migration, no scraping, and **zero
changed files under the frontend's `src/`**. The baseline is unchanged:
1,156 purchasable → 1,043 recommended, 0 violations, 37/37 integrity checks,
every table count exact.

#### Known limitation, stated rather than papered over

The marketplace URLs are synthetic. They were generated at seed time with
the right shape for each platform and they do not resolve. They are the
correct field for a "View on Flipkart" link once real ingestion exists, and
the API exposes them as they are — it does not pretend they are captured.

---

### Stage 26 — Backend phase 5: the competitor engine and cross-marketplace analysis (current)

The validated frontend analysis engine moved to the backend, behind two
authenticated endpoints, with parity asserted rather than assumed.

```
Frontend ──▶ /products/:id/analysis ──▶ AnalysisService ──┐
             /products/:id/competitors ──▶ CompetitorService
                                                          ▼
                                        Phase 4 data · PostgreSQL
```

#### The audit found the migration was not cleanly bounded

`buildCrossMarketplaceAnalysis` is built ON TOP of `buildRecommendation` and
reads `rec.*` in 24 places. "Move the analysis but not the recommendation"
is therefore not separable at the top of the call graph — but it is
underneath, and the split point is natural:

| moved | left for Phase 6 |
|---|---|
| competitive set, similarity, tiers, evidence weight | the three strategy prices |
| strength index, own-market and competitive statistics | constraints, ceilings, floors |
| history, distortion, the 90-day normal | the hedonic `wtp` model |
| 11 of the 12 findings | `buildBridge` |

Part 25 of the brief explicitly permits exposing "market anchors/statistics
that Phase 6 will use" and forbids moving the recommendation calculation, so
this split is what was asked for. The two omissions are reported in every
response under `meta.notMigrated`, and the parity test requires the
difference to be **exactly** those two — anything broader would let a
genuine omission hide.

#### Parity is the deliverable, and it found five real defects

115 assertions across ten golden products, comparing structured values —
never a rendered sentence. Building it exposed five things that were wrong
in the port and would not have been found any other way:

1. **`attribute_definitions` were never loaded into the test fixture.** Every
   specification comparison found nothing to compare, so the spec term
   dropped out of the similarity, its 0.45 weight was redistributed across
   the remaining three, and the result was a plausible-looking number that
   was wrong by up to 0.24. This is the single best argument for parity
   testing in this whole project: nothing about the output looked broken.
2. **Competitive statistics were unweighted.** The engine uses
   `weightedDistribution` over evidence weight; a plain median let a padded
   set move the anchor as far as a strong one.
3. **Three finding dimensions were mislabelled** — "Shipping" for what the
   engine calls "Offer", and two variants of "Competitor".
4. **The historical direction was inverted.** A high percentile means little
   headroom left, which argues `aggressive`; I had it arguing `premium`.
   Thresholds were wrong too (75/25 against the engine's 70/30).
5. **The trust direction ignored the review base.** A rating advantage only
   argues for a premium when the review base behind it is also larger — 4.7
   from 200 reviews is the weaker claim against 4.5 from 40,000.

Plus one the mutation testing caught: the 90-day normal used `−89` where the
engine uses `cutoff(90)` with `>=`, which spans 91 days. It matched on this
dataset by luck.

#### Mutation testing found two gaps in the tests themselves

Five controlled mutations; three were caught immediately, two were not:

- **the window boundary** — because nothing asserted `normalMinor` directly,
  only finding directions downstream of it. Fixed by capturing the 90-day
  normal and the distortion ratio in the fixture and asserting them.
- **the promotion validity boundary** — because no golden product has a
  promotion ending exactly on the reference date, so the mutation was a
  no-op on this data. Fixed by cross-checking the analysis's promotion
  counts against the Phase 4 promotions endpoint, which implements the same
  rule in separate SQL.

A test that cannot fail protects nothing, and "we wrote mutation tests" is
worth nothing if the misses are not then closed.

#### The honesty gate is structural

Below three comparables the engine refuses outright — the analysis returns
`findings: []`, not the subset of findings that happen not to need a
competitor. My first port produced four findings for a product the frontend
produced none for, which is exactly the fabrication this phase exists to
prevent. It is now a single early return in `buildFindings`, with the
observation layers still returned because they are real.

Every other suppression is a guard on the block that produces the finding:
fewer than three priced marketplaces suppresses cross-marketplace findings,
no quantity-bearing attribute suppresses per-unit, fewer than four
observations suppresses history.

#### No prose on the backend

The frontend builds sentences with `formatMinor` interpolated into template
strings. The backend returns `metrics` and `evidence` as structured values
and the interface phrases them. A sentence cannot be verified against the
database; a number can — and this is what makes `DATA → CALCULATION →
FINDING → EVIDENCE` real rather than a diagram.

#### Performance: eight queries, no cache

One analysis context per request, built in eight batched queries and shared
by every finding. The frontend rebuilds pieces of it per finding because
that is free in memory; here it would be a query storm.

Nothing scales with the candidate pool: the per-candidate signals — current
price, reviews, marketplace set, data quality — are four queries over the
whole set, not four per member. The largest product type holds 29 products.

**No cache was added.** `/competitors` is ~1.0 s and `/analysis` ~0.8 s on
PGlite; a cache would need invalidating on every observation, which is
machinery bought with nothing at that cost. Measured before deciding, as
Part 17 asked.

#### Scope held

No pricing recommendation, no scraping, and no frontend migration — the
analysis pages still read `src/data/`. Baseline unchanged: all 14 table
counts exact, 1,156 purchasable → 1,043 recommended / 113 refused, 0
violations, 37/37 integrity checks.

---

### Stage 27 — Backend phase 6: the pricing recommendation (current)

The last piece of the engine moved server-side: the anchor, the constraint
layer, the three strategies, the evidence gate, the willingness-to-pay model
and the refusals. One authenticated endpoint, built entirely on top of
Phase 5 — there is no second competitor computation anywhere in the service.

```
Frontend ──▶ /products/:id/recommendation ──▶ PricingService ──▶ AnalysisService
                                                              └▶ CompetitorService
                                                                     ▼
                                                    Phase 4 data · PostgreSQL
```

#### Parity found four defects in my port, and each was a real bug

77 assertions across twelve golden products — structured values only, never a
rendered sentence. The first run was **30 of 77**. All four causes were in the
port, not the tests:

1. **`normalMinor` was computed over a window.** I had given the endpoint a
   `window` parameter, which scoped the price series, which meant the "90-day
   normal" was computed from a 30-day slice — and since the anchor blends the
   own market with that normal 65/35, every anchor was wrong. The engine never
   windows a recommendation. The parameter is gone: a window is a question
   about history, and a recommendation is not one.
2. **The evidence checks counted marketplaces where the engine counts
   offers.** `prod_dove_hair_fall` has 6 marketplaces and 29 in-stock offers,
   so the competition check and the promotion-visibility share were both
   computed against a denominator five times too small. This shifted the
   evidence score by exactly one weight-1 check on *every* product, which then
   moved the confidence level, the travel damping, the premium headroom and
   all three strategy prices. One wrong denominator, ten wrong products.
3. **MRP inflation was measured against the wrong baseline.** The engine
   compares the printed MRP to the product's own current cheapest price; I
   compared it to the comparable median. A ₹19,999 chair selling at ₹11,599 is
   marked down, not mispriced, but judged against a comparable set containing
   cheaper chairs it looked inflated — and the product lost an evidence point
   it had earned.
4. **The 90-day normal had no fallback chain.** The engine falls back 90-day →
   60-day → own market → comparable median; I had only the first.

And one **latent defect in the baseline engine itself**, found by porting it
faithfully. `candidateFeatures` filters candidates on `Number.isFinite(d.targetValue)`
while `__rating`'s target is still `NaN` — the caller substitutes the real
rating *afterwards*. So customer rating is declared a candidate feature and
**can never actually be fitted**. My port "fixed" this by accident and
produced different feature sets and different prices.

It is reproduced deliberately, with the reasoning in a comment at the point of
the quirk. Phase 6's job was to move the validated engine without changing
what it computes; correcting this silently would change the recommended price
across the catalogue with no evidence that the change is an improvement. It is
recorded as a candidate for a future model version instead.

#### Invariants, separately from parity

Parity proves agreement, not safety — both engines could agree on a price
above the legal MRP. So `server/tests/pricing.test.ts` asserts the properties
that must hold whatever the arithmetic produces: CON-01…07 (never above MRP,
never below the floor, never above the ceiling, an impossible floor refuses,
snapping stays inside the bounds, no negative price, and impossible discount
data cannot produce an impossible price), STRAT-01…05 and SPARSE-01…06.

Two of those needed data that does not occur naturally and is constructed:
a seller cost far above the MRP, so the break-even floor rises above the
ceiling and the service must refuse rather than emit a loss-making price; and
a universal discount ten times the highest observed MRP, which the price
ladder clamps to zero rather than going negative.

Writing them surfaced two gaps in the response itself, both now fixed:
`evidence` was reported on refusals but not on recommendations — the
assessment that decided a price was worth emitting was invisible on the
prices it authorised — and a refusal did not distinguish "not enough
comparables" from "no valid price exists", which are different problems for a
seller. A refusal now carries `constraintConflict` and the competitor context
it *did* have, with `statistics: null`, because a median over two comparables
is arithmetic rather than a market and publishing it under that heading would
hand back as evidence the very thing the refusal says is missing.

#### The statistical component, measured for the first time

The research and the numbers are in `docs/PRICING_MODEL_RESEARCH.md` and
summarised in §3a above. The short version: no demand model is possible
because the dataset contains no quantity; gradient boosting is rejected on a
median within-type sample of 8 products; and scoring the shipped hedonic model
against the naive competitive median showed its trust gate passes 226 fits
that fail cross-validation and predict worse than the naive baseline.

`hedonic-cv-v2` is the response — the same features and target, ridge with a
leave-one-out-selected penalty, trusted on out-of-sample R². `baseline-v1`
remains the default so parity holds, and the version is stated in every
response.

#### Mutation testing: 10 of 12, then 12 of 12

Twelve planted mutations — anchor weight, market floor, ceiling headroom, MRP
inflation ratio, evidence travel, both trust thresholds, the evidenced-premium
cap, the historical window, the λ-selection rule, the snapping floor guard and
the promotion-visibility share. Ten failed a test immediately. The two that
survived were both worth the exercise:

- **The λ-selection rule.** Swapping `loocvR2` for `inSampleR2` when choosing
  the ridge penalty passed every ML test, because none of them asserted *how*
  the penalty is chosen — only that the value came from the grid. Selecting on
  fit would always return the smallest penalty, quietly turning v2 back into
  the unregularised model it exists to replace. The selection is now split into
  an exported `selectLambda` and tested on a fixture where the two criteria
  genuinely disagree, plus an end-to-end check that some product selects a
  penalty other than the smallest.
- **The snapping floor guard**, `while (snapped < floorMinor)` → `if`. Not a
  test gap: every caller clamps into `[floor, ceiling]` before snapping, and
  snapping moves a price down by strictly less than one step, so from a clamped
  input one step always suffices and the loop can never iterate twice. The loop
  is what keeps the function correct for an *unclamped* input, so it stays and
  a test now feeds it one — a price hundreds of steps below its floor.

Both are now caught. The reasoning is recorded at the point of each, because
"the mutation survived and we deleted the code" and "the mutation survived and
the code is defensive" are different conclusions.

#### The baseline difference was the denominator, not the engine

The recorded expectation was "1,156 purchasable → 1,043 recommended / 113
refused". The run came back 1,043 recommended and **129** refused over all
1,172 products, which looks like +16 until the arithmetic is done: 113 + 16 =
129, so the total never moved. The denominator was wrong — there are **1,154**
products with a purchasable offer, not 1,156, and 18 with none at all.

Settled by asking the frontend engine the same question over the same 1,172
products (`scripts/engine-recommendation-baseline.mjs`): 1,043 recommended, 129
refused, splitting 111 `insufficient_comparables` / 18 `no_current_price`, zero
constraint conflicts. **Identical to the backend.** So the expectation was
corrected to the engine's own measured output rather than adjusted to fit, and
the script now asserts the refusal reasons too — a total that happens to match
while the reasons have shifted is exactly the kind of agreement that should not
be allowed to pass.

Running the same baseline under `hedonic-cv-v2` gives **the same 1,043 / 129,
the same 111 / 18 split and the same zero violations**. That is the design
working rather than a coincidence: the attribute model sizes an evidenced
premium and never decides whether a product can be priced, so switching models
cannot strand one.

#### Performance: 36 queries, flat

| | value |
|---|---|
| p50 / p90 / p99 / max | 511 ms / 1,084 ms / 1,732 ms / 2,098 ms |
| queries per recommendation | **36, for every one of 1,172 products** |

The query count is identical for a product with 1 comparable and one with 32,
which is the point: nothing scales with the competitor pool, so there is no
N+1. Measured by wrapping `execute`, because latency alone would hide two
hundred fast queries on a local database. The attribute model is a 3–4 column
solve on at most 32 rows and does not register against the query time.

(PGlite is WebAssembly in-process; a native server is faster.)

#### Scope held

No scraping. No UI redesign. The recommendation page still renders the browser
engine — the backend returns structured factors where the panel renders
composed prose — but it now also calls the API and shows whether the two
agree, which is the minimal integration Part 32 asked for and keeps the engine
as the oracle.

---

## 3a. Where AI/ML belongs in this system (asked explicitly at Stage 13)

A deliberate position, because "AI-powered pricing" is easy to claim and hard to defend:

| Layer | Approach | Why |
|---|---|---|
| Hard constraints, fees, MRP, statistics, zones | **Deterministic** | These are arithmetic and law. A model here would add unpredictability with no upside. |
| Willingness-to-pay / attribute premium | **Statistical (implemented)** | A least-squares hedonic regression on log(price). Genuinely a model — with coefficients, R², and a refusal threshold you can inspect. Deliberately gated: with 2–8 comparables it usually declares itself untrustworthy, which is the honest answer. |
| Explanation prose | **Template-driven from real numbers** | Deterministic and auditable. |
| LLM | **Not used anywhere** | An LLM asked to produce a price is unauditable and unfalsifiable — the exact failure mode this whole stage exists to eliminate. A future LLM layer could *narrate* model output, but must never generate the number. |

The regression is isolated behind `fitHedonicModel()`, so a properly trained model can replace it without touching a single caller. **The recommendation remains fully explainable if the statistical component is removed** — it degrades to pure market positioning, which is the intended fallback.

### Stage 27 update: this position was tested, and it held

Phase 6 asked the question properly — research the methods real pricing
systems use, audit what this dataset can support, and measure rather than
assert. `scripts/audit-ml-feasibility.mjs` and
`server/src/scripts/evaluate-pricing-models.ts` produce every number, and
`docs/PRICING_MODEL_RESEARCH.md` is the write-up. Three findings matter here:

**No demand model is possible, and that is not a tuning problem.** The
dataset has abundant price variation — a median of 28 distinct prices per
product across 151 consecutive capture days — and **zero** quantity. Searched
for units sold, orders, conversion, clicks, impressions, revenue and
inventory across every table: none exist. Elasticity needs Δquantity/Δprice;
we have one half of that ratio. Review growth is measurable for 1,156
products and is the closest proxy, but the reviews-per-purchase rate is
unknown and category-dependent, so it cannot be scaled into units and is not
used as demand.

**Gradient boosting was rejected on sample size, not on taste.** A
price-on-attributes model is only comparable *within* a product type, so the
training sample is the type's size — median 8, maximum 32 — not 1,172.
Meanwhile the naive evidence-weighted competitive median predicts the held-out
price at 16.9% MAPE with 100% coverage. There is no headroom above that which
32 rows and four features could reach without fitting noise.

**Measuring the shipped model found a real defect.** Nobody had ever scored
it, and it is scoreable: the hedonic fit never sees the target's own price, so
its prediction against that known price is genuine generalisation error,
available for 825 products. Of the 477 whose fit the in-sample adjusted-R²
gate trusts, **226 fail leave-one-out cross-validation — and on exactly those
the model predicts worse than copying the competitive median** (18.7% MAPE
against 17.8%, RMSE 29% higher). Adjusted R² does not protect against
overfitting when n is 5–32 and the features were chosen by correlation with
the same target.

So the enhancement Phase 6 shipped is not a bigger model. `hedonic-cv-v2`
keeps the same features and the same target and changes two things: ridge in
place of plain least squares, and the trust gate moved to **out-of-sample**
LOOCV R². Exact leave-one-out is what makes validation possible at these
sizes — at n = 8 there is nothing to split into folds, but for a linear
smoother every fold is available in closed form from one fit as
`eᵢ / (1 − hᵢᵢ)`.

`baseline-v1` stays the default: Phase 6's job was to move the validated
engine unchanged, and 77 parity assertions hold it to that. Promoting v2 cuts
the share of products receiving an evidenced attribute premium from 58% to
30% — the correct number, since the other 28 points do not survive
validation, but a product decision rather than a migration detail.

**The line about LLMs is unchanged and was never in question.** Nothing in the
price path is a language model. The recommendation states its own target
variable (`market_value_estimate_from_observed_listing_prices`) and labels the
attribute relationship `association_not_causation`, because the model observes
that the market prices certain attributes higher and does not establish that
those attributes cause the price.

---

## 4. Core conceptual model

The spine of the entire project, unchanged since Stage 3/5 and now implemented in the frontend's mock data relationships:

```
Product  →  Listing  →  Offer  →  Price Observation
  (1:N)      (1:N)      (1:N)
```

Read as a sentence: *one real product is sold on several marketplaces; on each marketplace several sellers make offers; each offer is priced many times over its life.*

- **Product** — the real-world item, independent of any marketplace. The "golden record."
- **Listing** — the marketplace-specific page for that product (one per marketplace, e.g. one Flipkart FSN, one Amazon ASIN).
- **Seller** — a merchant account, scoped to one marketplace.
- **Offer** — the commercial relationship between one seller and one listing. Deliberately holds **no price fields** — see §6.
- **Price Observation / Price History** — the append-only time series of what an offer's price actually was, at specific moments.
- **Recommendation** — not a stored entity; a derived output computed from the above (comparable products, market distribution, fee rules, a seller-entered cost).

Supporting/reference entities established alongside the spine:
- **Marketplace** — the platform itself (Flipkart, Amazon.in, Meesho), carrying its own dated fee rules and its own category taxonomy.
- **Classification** — a canonical category tree (Department → Category → Subcategory), plus **Product Type** as a fourth browsable level hanging off subcategories, plus each marketplace's own raw category tree and a mapping table between them. Product Type is the key the specification registry is scoped to, which is why a subcategory can host more than one (Laptops → Everyday Laptop / Gaming Laptop, with different spec schemas).
- **Product Identity** — brand, model, variant axes (storage/RAM/colour etc.), external identifiers (GTIN/EAN/MPN) — the facts that determine whether two listings are "the same product."
- **Specifications** — the product's technical/physical/feature attributes, stored flexibly (JSON-shaped) and governed by a small versioned attribute-definition registry rather than fixed columns.
- **Reviews/Ratings** — a time-series snapshot per **listing** (not per product — see §6), because review counts and ratings diverge across marketplaces.
- **Source/Metadata** — provenance: capture runs, raw documents, quarantined/rejected records, per-field parse coverage.
- **Promotion** — time-bounded, seller/offer-scoped discount terms (bank offer, coupon, exchange, no-cost EMI, cashback), kept separate from the offer because their shape varies by type.
- **Fee Rule** — a marketplace's referral %, fixed fee, and shipping basis, stored as **dated rows** (not hardcoded), because these rates genuinely change over time (the design docs specifically cite Flipkart's Nov-2025 and Amazon India's Mar-2026 zero-fee-under-₹1,000 changes as the real-world reason this matters).

---

## 5a. The price ladder and promotion classes (Stage 12 — load-bearing)

**"The price" is not one number.** Collapsing it into one is what produced the indefensible recommendation. Implemented in `src/utils/priceLayers.js`:

| Rung | Meaning | Used for |
|---|---|---|
| `mrp` | Printed maximum retail price | **A legal ceiling.** Never a discount anchor |
| `sellingPrice` | What the page displays | Display |
| `shippingFee` | Delivery charged on top | Display |
| `landed` | selling + shipping | What leaves the wallet before incentives |
| **`universalEffective`** | landed − universally available instant discounts | ★ **THE COMPARISON PRICE** — every benchmark, comp set and statistic uses this |
| `conditionalBest` | universalEffective − card/coupon/exchange/membership benefits | Displayed, **never benchmarked** |
| `deferredBenefit` | Cashback, wallet credit | Never a price |
| `financingBenefit` | No-cost EMI interest absorbed | Never a price |
| `netRealization` | After marketplace fees + GST | Seller margin only, never customer competitiveness |

**Promotion `availabilityClass`** (`src/data/promotions.js`) is what makes this work — set once per promotion type, not at each call site:

- `universal` — every buyer gets it automatically. **The only class folded into the comparison price.**
- `conditional` — needs a specific bank card, coupon code, trade-in or membership.
- `deferred` — returned after purchase (cashback/wallet).
- `financing` — changes payment terms, not the ticket price.

**Why this matters:** a seller benchmarking their universal price against a rival's HDFC-card-only price is comparing two different things. The engine now structurally cannot do that.

**Time-varying commercial state:** promotions carry validity windows and are resolved against an observation's date (`getActivePromotionsForOffer(offerId, dateIso)`). This preserves what was visible at any past moment — the requirement — without denormalising promotions into all ~28,000 observation rows. That trade-off is deliberate and should not be "simplified" away.

---

## 5. Database design (conceptual — no implementation exists yet)

This is a conceptual design (documented in `database-entity-design.md` and the PDF). **No real database has been built.** The frontend's mock data (§10) mirrors this shape in plain JS objects, not in an actual RDBMS.

For each entity: purpose, what belongs, what explicitly does not, relationships, and why it's separated.

### Marketplace
- **Purpose:** represents a selling platform and carries its *rules*, not just its name.
- **Belongs:** name, country code, default currency, website domain, active flag. A separate **Fee Rule** sub-entity (dated rows: referral %, fixed closing fee, shipping basis, effective_from/to, is_current).
- **Does NOT belong:** any product, listing, or price data; fee rates as columns on the Marketplace row itself.
- **Relationship:** 1 Marketplace → N Listings, N Sellers, N Fee Rules (versioned), N Marketplace Categories.
- **Why separated / why fee rules are dated:** hardcoded fee percentages make every historical margin calculation silently wrong the moment a marketplace changes its rate. Dated rows let margin-at-any-past-date be recomputed using the rule that was actually in force then (Slowly Changing Dimension Type 2).
- **Marketplace default rules (Stage 11):** rules with `categoryId: null` act as a per-marketplace fallback when no category-specific rate has been captured. `getCurrentFeeRule()` returns them flagged `isCategoryDefault: true`, and the UI says so — margin stays computable for all 16 product types without pretending a default is a confirmed category rate.

### Product
- **Purpose:** the real-world item, independent of marketplace. The golden record.
- **Belongs:** surrogate `product_id`, `parent_product_id` (self-reference for variant families), `is_purchasable` (false for a grouping parent), brand FK, category FK, product_type FK, canonical (cleaned) name, model name, a `specifications` document, `spec_schema_version`, lifecycle status, first/last seen.
- **Does NOT belong:** any price; ASIN/FSN or any marketplace ID; URLs; ratings/review counts; stock status; the marketplace's raw/uncleaned title.
- **Relationship:** 1 Product → N Listings, N Product Identifiers, N Variant Axes, N child Products (variant family). N Products → 1 Brand, 1 Category.
- **Why it exists:** without a shared identity, Flipkart rows and Amazon rows have nothing to join on — the sentence "this is ₹1,000 cheaper on Amazon" becomes literally inexpressible. `parent_product_id` exists because 6GB/128GB and 8GB/256GB are different products at different prices (collapsing them ruins the median) but are still clearly a family worth comparing (mirrors Amazon's non-buyable parent ASIN / buyable child ASIN pattern).

### Classification
- **Purpose:** places every product in a category hierarchy, and reconciles the fact every marketplace has its own incompatible taxonomy.
- **Belongs (three sub-tables, not one):** **Category** (canonical tree: id, parent_id, level, name, materialised path). **Marketplace Category** (each platform's own raw tree, verbatim). **Category Mapping** (crosswalk between them, with a confidence score and `mapped_by`).
- **Does NOT belong:** products, prices, spec definitions.
- **Relationship:** self-referencing Category tree; N Marketplace Categories → 1 Category via mapping.
- **Why three tables:** Flipkart's "Mobiles & Accessories" is not literally Amazon's "Electronics > Mobiles & Accessories" — forcing them into one label set either loses information or invents an equivalence you can't defend. Grounded in GS1 GPC (~40,000 categories, four tiers) and Google's Product Taxonomy (~6,600 categories) as real precedent.

### Product Identity
- **Purpose:** the set of facts that determine whether two listings are the *same* product — the matching key.
- **Belongs (splits into Product's own fields plus two sub-entities):** canonical_name/model_name/brand_id stay on Product. **Brand** is its own entity (canonical name, alias names, tier: premium/mid/value, parent company). **Product Identifier** is its own entity (type: GTIN/EAN/UPC/MPN, value, source, confidence). **Variant Axis** is its own entity (axis_name e.g. "storage," axis_value, normalised value).
- **Does NOT belong:** ASIN or FSN — **an ASIN is listing identity, not product identity.**
- **Why Variant Axis is a table, not columns:** the axes can't be predicted per category (phones vary by storage/RAM/colour; shoes by size/width) — fixed columns would mean dozens of mostly-null fields growing forever.

### Specifications
- **Purpose:** the attributes describing the physical object — the explanatory variables for any pricing model.
- **Belongs:** a `specifications` JSON document on the Product row, validated against an **Attribute Definition** registry (per product_type, per schema_version: attribute_key, display_name, data_type, unit, is_required, allowed_values, `is_pricing_relevant`). An optional **Raw Specification** table for provenance (unnormalised text as scraped).
- **Extended in Stage 11** with three fields that let the registry drive behaviour rather than just validate: `isFilterable` + `filterType` (`enum` | `range` | `boolean`) + `buckets` generate the catalogue's facets, and `higherIsBetter` tells the recommendation engine's strength scoring which direction is good (more RAM is better; more laptop weight is not). This is why neither the filter sidebar nor the strength model contains any per-category hardcoding.
- **Does NOT belong:** price, availability, or anything marketplace-specific; the resolved spec on Listing (only raw evidence text may live there).
- **Why a document + registry, not a wide table or pure EAV:** a wide table breaks at the second category; pure entity-attribute-value is flexible but every filter needs another self-join. A document field with a governing registry gets both flexibility and one-predicate querying. Directly modelled on Amazon's own SP-API Product Type Definitions (versioned JSON Schema per product type, 1,700+ types and growing).

### Listing
- **Purpose:** the marketplace page for a product — not the product itself.
- **Belongs:** surrogate `listing_id`, nullable `product_id` FK (nullable because unmatched listings must be queueable, not discarded or fabricated), marketplace_id FK, `external_listing_id` (the FSN/ASIN), listing_url, marketplace_category_id, `raw_title` (evidence, never cleaned in place), `marketplace_brand_text`, match_status (unmatched/auto_matched/human_confirmed), match_confidence, first/last seen, listing_status.
- **Does NOT belong:** price (multiple sellers compete on one listing — a single price field would be a lie); seller identity; stock status; canonical specs; the cleaned product name.
- **Natural key:** `(marketplace_id, external_listing_id)` as a **unique constraint**, never the primary key — you don't control a platform's ID scheme.
- **Relationship:** N Listings → 1 Product, 1 Marketplace. 1 Listing → N Offers, N Review Snapshots.

### Seller
- **Purpose:** a merchant account, scoped to one marketplace.
- **Belongs:** seller_id, marketplace_id (sellers are marketplace-scoped — a seller on Flipkart and the "same" business on Amazon are different accounts with different IDs/ratings), external_seller_id, name, seller_type (marketplace_owned/third_party/brand_direct), default_fulfilment_type, optional `seller_group_id` (an unresolved cross-platform identity link, kept optional so you're never blocked on solving it). A separate **Seller Rating Snapshot** time series (rating changes and *matters*, so it's a series, not a mutable column).
- **Does NOT belong:** prices, stock, or which listings they sell (that's Offer's job).

### Offer
- **Purpose:** the commercial relationship between one seller and one listing. **The single most important design decision in the whole model lives here.**
- **Belongs:** offer_id, listing_id, seller_id, item_condition (new/refurbished/renewed/open_box — part of the natural key, since the same seller can list new and renewed at different prices), first/last seen, offer_status. A separate **Promotion** sub-entity (promotion_type, a `terms` JSON block since shapes vary by type, computed `discount_value`, validity window).
- **Does NOT belong — deliberately — any price field.** No `current_price`, no `mrp`, no `discount`, no `stock_status`.
- **Why:** if price lived on the Offer row *and* in the Price Observation history, there would be two places claiming to know the price, and they will eventually disagree (a failed update, a partial run, a race condition). The clean design: Offer is *identity*, Price Observation is *fact*; "current price" is simply the latest observation, exposed as a view/query, never written independently.
- **Natural key:** `(listing_id, seller_id, item_condition)`.

### Price History / Price Observation
- **Purpose:** the append-only fact table at the centre of the system.
- **Grain, stated explicitly (say this out loud if asked):** **one row = one seller's price for one listing, in one condition, at one moment in time** — formally `(offer_id, observed_at)`.
- **Belongs:** observation_id, offer_id, `observed_at` (valid time — when it was true on the site), `recorded_at` (transaction time — when the pipeline captured it; bitemporal), mrp_minor, selling_price_minor, shipping_fee_minor (money as **integer minor units**, never float), currency_code, is_in_stock, is_buybox_winner, raw_document_id, parser_version.
- **Does NOT belong:** discount % (derivable from MRP/selling), effective price (derivable), net realisation (derivable) — the rule is *store observations, derive conclusions*, because formulas change and observations shouldn't have to.
- **Rows are never updated or deleted.** A correction is a new row with a later `recorded_at`.
- **Why this is the one truly irreversible decision in the whole design:** every other mistake is repairable by re-scraping. You cannot go back and observe last month's price if you didn't record it. This is the design's stated highest-priority rule.

### Reviews / Ratings
- **Purpose:** two jobs — reviews justify price, and **review-count growth rate is the closest available proxy for sales volume**, since no real sales data exists.
- **Belongs:** a **Listing Review Snapshot** time series (captured_at, average_rating, rating_count, review_count, rating_distribution as a small grouped object) — not a static row, because the *rate* of change (velocity) is the useful signal and is lost if the count is a single mutable column. An optional individual **Review** table for future text analysis.
- **Attaches to Listing, not Product** — the same phone can sit at different ratings/review counts on Flipkart vs Amazon (different customer populations); averaging them would invent a number that exists nowhere and hide a real signal.
- **Explicit caveat carried in the design docs:** review velocity is a *biased* proxy — it varies by category, price band, and how aggressively a seller solicits reviews. Treat it as relative-within-category, never absolute.

### Source / Metadata
- **Purpose:** provenance — separates a debuggable pipeline from one that can only be rebuilt from scratch.
- **Belongs (four sub-tables):** **Capture Run** (one row per scrape job: marketplace, started/finished, run_status, parser_version, pages attempted/succeeded). **Raw Document** (one row per fetched page: source_url, http_status, fetched_at, content_hash, storage_path — the actual HTML archive). **Rejected Record** (the quarantine: which entity it was meant for, the rejection reason, the payload preserved for recovery). **Product Image** (product/listing FK, url, perceptual hash, position).
- **Does NOT belong:** any business data — metadata describes the *act of observing*, not the product.

---

## 6. Critical database decisions (do not silently change these)

These are the load-bearing decisions of the whole design. If a future change conflicts with one of these, stop and discuss it with the user rather than overriding it silently.

1. **Product is the real-world item, independent of any marketplace.** Never merge Product and Listing — doing so makes cross-marketplace comparison, the system's core value proposition, literally inexpressible.
2. **Listing is marketplace-scoped.** One product → many listings (one per marketplace). ASIN/FSN are natural keys *of the listing*, never the product's identity.
3. **Seller is marketplace-scoped.** A seller account on Flipkart and the "same" business on Amazon are different rows with different IDs/ratings. Cross-platform identity, if ever needed, is an optional `seller_group_id`, resolved separately — never assumed.
4. **Offer represents the seller-listing relationship, and holds identity only — never price.** This is the single most important and most frequently-forgotten rule in this project. If you ever see a `current_price` column proposed directly on an Offer table/object, that is a regression — flag it.
5. **Price is historical observation data, append-only.** Never overwrite a price field. A correction is a new row with a later `recorded_at`. This is the one decision in the whole design that cannot be undone if violated — you cannot retroactively "observe" a price you didn't record at the time.
6. **Marketplace identifiers (ASIN, FSN) are not universal product identity.** They are unique constraints scoped to `(marketplace_id, external_id)`, never primary keys.
7. **Specifications must accommodate category variation** — a document field (JSON-shaped) governed by a versioned attribute-definition registry, not fixed wide-table columns, and not pure EAV.
8. **Historical/time-sensitive records are append-only:** Price Observation, Review Snapshot, Seller Rating Snapshot, Fee Rule (dated rows), Raw Document.
9. **Derived values must be computable from source observations, not stored as independent facts.** Discount %, effective price, net realisation, and the pricing recommendation itself are all *computed*, never hand-entered or cached as an independent source of truth.
10. **Nothing is hard-deleted.** Discontinued products, delisted listings, departed sellers are marked inactive with an end date, never removed — deleting orphans historical queries.

---

## 7. Frontend architecture

- **Framework:** React 19, via Vite 8. Routing via `react-router-dom` v7 (declarative `<Routes>/<Route>`, not the data-router/loader API). Charts via `recharts`. Icons via `lucide-react`. No CSS framework (no Tailwind/MUI/Bootstrap) — hand-written CSS per component, driven by CSS custom properties defined once in `src/styles/tokens.css`.
- **Explicit non-goal:** no Node/Express backend. The frontend is deliberately structured so a **Java** REST API can be substituted later for the mock service layer without touching any page or component. See `src/api/client.js` for the documented swap point.
- **Layering (top to bottom):**
  1. **Pages** (`src/pages/`) — one file per route, page-level composition only.
  2. **Components** (`src/components/`) — presentational, grouped by domain (`layout/`, `common/`, `product/`, `marketplace/`, `listing/`, `charts/`, `recommendation/`).
  3. **Service layer** (`src/api/`) — async functions (`getCatalogue()`, `getRecommendation(productId)`, etc.) that pages call. Every function is already `async` and already returns plain JSON-shaped objects, so swapping the body to call `request()` (a real `fetch`) instead of the mock joins is the entire migration to a real backend.
  4. **Data-access utilities** (`src/utils/pricingEngine.js`, `priceSeriesGenerator.js`, `catalogueGenerator.js`) — pure functions that join/derive across the mock data.
  5. **Mock entity data** (`src/data/`) — the "database," as plain JS arrays of objects, one file per entity.
- **Indexing:** the entity lookups (`getProduct`, `getListingsForProduct`, `getOffersForListing`, `getPriceHistoryForOffer`, `getReviewSnapshotsForListing`) are backed by `Map` indexes built once at module load. This became necessary at Stage 11 — the observation table is ~28,000 rows and the catalogue calls these helpers for every product on every query, so linear scans were no longer viable.
- **State handling:** mostly URL-driven — the selected product/listing is a route param, not client state, so the URL is always shareable/bookmarkable and doubles as the "current selection." A small React Context (`src/state/AppStateContext.jsx`) holds only genuinely cross-cutting, non-URL state: which products are "tracked" for the Dashboard. A small custom hook, `useAsyncData` (`src/utils/useAsyncData.js`), standardises loading/error/data state for every page's service call.
- **Cross-page navigation:** a shared layout component, `ProductWorkspaceLayout.jsx`, wraps every page that belongs to "one product's workspace" (Overview, Marketplaces, Listing, Price History, Recommendation). It resolves the active product either directly from `:productId` or indirectly via `:listingId → listing.productId`, and renders a consistent breadcrumb + pill-tab bar so the five views of one product are always one click apart.
- **Design tokens:** `src/styles/tokens.css` defines every color/spacing/radius/font as a CSS custom property; `src/styles/global.css` defines shared primitives (`.card`, `.btn`, `.pill-badge`, page shell classes) that every component/page builds on. This is what made the Stage 9 visual correction (§3) tractable as a token-level change rather than a per-component rewrite.
- **Dataviz color discipline:** chart series colors are drawn from a validated, colorblind-safe categorical palette (documented reasoning lives in the `dataviz` skill used during Stage 8), kept deliberately distinct from the UI's own black/orange accent colors so chart identity never collides with chrome.

---

## 8. Current pages

| Page | Route | Purpose | Key components used | Notes |
|---|---|---|---|---|
| **Dashboard** | `/` | Returning-user entry point: tracked products, 7-day movement, alerts | `MetricCard`, `StatusBadge` | Pre-seeded with 2 tracked products so it isn't empty on first load |
| **Catalogue** | `/catalogue` | Marketplace-style discovery: department drill-down, registry-driven faceted filters, sorting | `CategoryRail`, `FacetGroup`, `ProductCard` | All state is URL-synced (`?cat=&pt=&brand=&price=&rating=&mp=&stock=&spec_<key>=&sort=`), so a filtered view is shareable and Back returns to it. Facet counts are computed with each group's own selection excluded (proper faceted search). |
| **Product Overview** | `/products/:productId` | Product identity: brand/model/variant/specs/category, independent of marketplace | `SpecList`, sibling-variant list, "Available on" panel | Wrapped by `ProductWorkspaceLayout`; has the Track/Untrack action |
| **Marketplace Comparison** | `/products/:productId/marketplaces` | Same product, priced across marketplaces | `MarketplaceCard` | Flags the cheapest marketplace; shows per-marketplace net realisation |
| **Listing Detail** | `/listings/:listingId` | One marketplace's page: every competing seller/offer | `OfferCard` | Buy-Box/"Featured offer" is computed (lowest in-stock landed price), not hardcoded |
| **Price History** | `/listings/:listingId/history` | Price as a time series, per offer, on one listing | `PriceHistoryChart` (recharts) | Range toggle (30d/90d/All), "Show vs MRP" toggle, "View as table" toggle, promotional-window shading |
| **Cross-Marketplace Analysis** | `/products/:productId/analysis` | Six-step analytical narrative: what we observed per platform → where platforms differ → decomposed competitive set → multi-dimensional findings → historical position → the bridge to the price | `LadderCell`, finding cards, comparison table | Derived entirely by `utils/crossMarketplaceAnalysis.js`; adds no entities and cannot contradict the engine (rule 12s). Findings suppress themselves when their data is absent. |
| **Pricing Recommendation** | `/products/:productId/recommendation` | Three condition-based pricing strategies with full evidence and defensibility | `StrategyCard`, `RecommendationPanel`, `DataTable` | Strategy cards are selectable; the "Why" panel, margin table and position statement update to the selected strategy. Every number is computed live — see §10. |
| **Data Sources & Coverage** | `/sources` | Provenance/trust: capture runs, match confidence, parse coverage, quarantined records | `DataTable`, `StatusBadge` | Entirely simulated — see §9 |

All eight pages from the Stage 7 plan are implemented (plus the Stage 18 Analysis page, nine in total); none are partial stubs. `ProductWorkspaceLayout` is the shared shell for the product-scoped pages; Dashboard, Catalogue, and Data Sources are top-level (not nested under it).

---

## 9. Current data flow

```
Page component
   → calls an async function in src/api/<domain>Service.js
       → which reads/joins plain arrays in src/data/*.js
       → and/or calls a pure function in src/utils/pricingEngine.js
   → returns a plain JS object/array (the same shape a JSON API response would have)
   → page renders it via the useAsyncData hook (loading/error/data)
```

**What is real:** the React app itself, the routing, the UI interactions, the pricing/recommendation math (a real algorithm running against the mock numbers — see §10), the buy-box computation, the net-realisation/margin math, the review-velocity calculation.

**What is mocked:** every underlying fact — every product, listing, seller, offer, price observation, review snapshot, capture run, and fee rule is hand-authored or procedurally generated JS, not fetched from anywhere real.

**What is derived (computed at render/query time, not stored):** effective price, discount %, net realisation, break-even floor, the recommendation itself, review velocity, buy-box winner.

**What does not exist at all:** a real network request to any marketplace; a real backend server (Java or otherwise); a real database; authentication; persistence beyond the current browser tab's memory (tracked-product state resets on reload).

---

## 10. Mock data

### Two tiers, one model
The dataset is authored at two levels of density, both producing the *same* entity types with the same rules:

1. **Curated tier** — hand-written in `products.js` / `listings.js` / `offers.js` / `priceObservations.js`. The Galaxy M14 family and its comparables. Deliberately irregular: variant families, multi-seller listings, a listing with zero offers, a stockout window, parser-version switches, stacked promotions. This tier exists to exercise edge cases.
2. **Catalogue tier** — defined compactly in `catalogueSeed.js` (72 products) and expanded by `utils/catalogueGenerator.js` into real Products, Listings (one per marketplace), Offers (1–3 sellers each, reusing the real seller entities), full daily Price Observation series, and Review Snapshot series. This tier exists to make the catalogue browsable and the filters meaningful.

**The generator guarantees two invariants**, both audited: the cheapest current landed price for a generated product equals its seed `price` exactly (so catalogue card, marketplace comparison and price chart can never disagree), and everything is deterministic via a seeded PRNG keyed on IDs. The stockout fixtures are the deliberate exception — where the cheapest offer is unbuyable, the cheapest *in-stock* price is what surfaces, which is the behaviour those fixtures exist to prove.

### Verified totals (audited in-browser against the real modules, Stage 16)

| Entity | Count |
|---|---|
| Departments (L1) | 14 |
| Categories (all levels) | 179 |
| Product Types | 125 |
| Attribute Definitions | 545 |
| Brands | 314 |
| Marketplaces | 6 (Flipkart, Amazon.in, Meesho, Myntra, AJIO, Nykaa) |
| Marketplace category mappings | 418 |
| Products | 1,172 (1,156 purchasable + 16 non-buyable variant parents) |
| Catalogue seeds | 1,101 |
| Listings | 2,947 |
| Sellers | 1,177 |
| Seller rating snapshots | 2,015 |
| Offers | 9,717 |
| Price Observations | 354,940 |
| Review Snapshots | 9,962 |
| Promotions | 5,968 |
| Fee Rules | 13 |

**Integrity — every count zero (re-verified after the Stage 17 repairs):** negative selling prices, negative shipping, selling prices above MRP, discounts over 95%, listings with a duplicate seller, universal promotions above 25% of price, duplicate ids across all twelve entity arrays; orphan references on every foreign key in the model (product→brand/category/product-type/parent, listing→product/marketplace, offer→listing/seller, seller→marketplace, observation→offer, review→listing, promotion→offer, mapping→marketplace/category, attribute→product-type, fee-rule→marketplace/category); MRP violations across all 354,940 observations; current-vs-latest-historical price mismatches; seed landed-price invariant breaks.

**Engine — every count zero across 1,041 recommended products:** MRP violations, floor violations, ordering violations, CF-1 premium-invariant failures.

**Competitive coverage:** 1,041 of 1,156 products produce a recommendation; 115 correctly refuse. Median direct competitors **5**; 581 products (55.8%) meet the 5-competitor target; average effective comparables **4.17**. Coverage levels: 563 strong, 195 adequate, 283 thin.

**Commercial variation:** 539 offers currently out of stock (295 products affected); 1,206 offers charge delivery; promotions span every availability class — 1,293 universal, 3,431 conditional, 700 financing, 544 deferred. 1,095 products appear on 2+ marketplaces, 548 on 3+. Average 2.55 listings per product, 3.3 offers per listing.

### Per-file breakdown (HISTORICAL — describes the original 8-product prototype, kept for provenance)

> ⚠ These counts are from the first build and are no longer accurate. The live totals are the table above; this table records what the dataset looked like before the catalogue was expanded.


| File | Entity | Count |
|---|---|---|
| `marketplaces.js` | Marketplace | 2 (Flipkart, Amazon.in) |
| `brands.js` | Brand | 6 (Samsung, Apple, Redmi, OnePlus, realme, vivo) |
| `categories.js` | Category (+ marketplace category + mapping) | 1 leaf category ("Smartphones") under Electronics > Mobiles & Accessories |
| `attributeDefinitions.js` | Attribute Definition registry | 9 spec fields for `ptype_smartphone` schema `smartphone_v3` |
| `feeRules.js` | Fee Rule (dated) | 4 rows (current + one superseded row per marketplace) |
| `products.js` | Product | 8 rows (1 non-purchasable grouping parent + 7 purchasable products) |
| `listings.js` | Listing | 9 |
| `sellers.js` | Seller (+ rating snapshots) | 6 |
| `offers.js` | Offer | 15 |
| `promotions.js` | Promotion | 6 |
| `priceObservations.js` | Price Observation | generated (see below) |
| `reviewSnapshots.js` | Review Snapshot | generated (see below) |
| `sellerInputs.js` | Seller-entered cost input | 1 (for the primary demo product) |
| `dataSources.js` | Capture Run / Raw Document / Rejected Record / Field Coverage | small hand-authored set, 2 marketplaces × recent runs |

### The primary example product
**Samsung Galaxy M14 5G (6GB RAM, 128GB) — Berry Blue** (`prod_galaxy_m14_5g_6_128_blue`), grouped under a non-purchasable parent `prod_galaxy_m14_5g`, with one sibling variant **8GB/256GB — Icy Silver** (`prod_galaxy_m14_5g_8_256_silver`). This pair exists specifically to demonstrate the parent/child variant-family pattern (§5, Product entity) and the "family storage premium" insight shown on the Recommendation page.

The primary variant has:
- A Flipkart listing (`lst_fk_m14_6_128`) with 3 competing sellers/offers (WS Retail — marketplace-owned; RetailNet — third-party; SuperComNet — third-party).
- An Amazon.in listing (`lst_az_m14_6_128`) with 3 competing sellers/offers (Appario Retail — marketplace-owned/FBA; Cloudtail India — marketplace-owned/FBA; SuperComNet — third-party/self-ship, the *same* SuperComNet seller identity reused across both marketplaces via `seller_group_id`, demonstrating the optional cross-platform seller link).
- 150 days of **daily, seeded-random-walk-generated** price observations per offer on this variant (see `src/utils/priceSeriesGenerator.js`), including two scripted promotional dips ("Big Saving Days"/"Great Summer Sale," "Independence Day Sale") and one deliberate stockout window on one offer, to make the Price History chart and buy-box computation demonstrate real behaviour rather than a flat line.
- The sibling variant and five other comparable-band products (Redmi Note 13 5G, realme 12x 5G, OnePlus Nord CE4 Lite 5G, vivo T3x 5G, plus an out-of-band iPhone 13 for catalogue variety) have shorter, lighter-weight generated series (45–60 days), sufficient for "current price" and comp-set construction without the bulk of the primary series.

**Generation is seeded** (`src/utils/seededRandom.js`, a mulberry32 PRNG keyed off each offer's ID) so the dataset is stable across reloads within a given "today" — not re-randomised on every render, but note that price series are anchored to a hardcoded "today" date embedded in `priceObservations.js`/`dashboardService.js` (2026-08-14 at time of writing); if the real calendar date drifts far past that, the "last 7 days" framing in Dashboard alerts will read oddly, though the app will still function.

### How the recommendation is produced (`src/utils/pricingEngine.js`)
1. **Comparable set:** other purchasable products in the same category with the *same* RAM and storage band (currently 4 comparables for the primary product).
2. **Market distribution:** median and interquartile range of the comp set's current effective prices.
3. **Hedonic-style adjustment, computed, not hardcoded:**
   - Brand-tier adjustment = (median price of same-tier comps) − (overall comp median) — but **only applied if at least 2 same-tier comparables exist**; otherwise explicitly zeroed with a stated reason (this threshold was added after testing revealed a single-peer outlier could swing the whole recommendation — see §15).
   - Rating adjustment = an actual least-squares slope fit of price-vs-rating across the comp set, applied to the gap between this product's rating and the comp set's average rating.
4. **Family storage premium:** if a sibling variant exists, the real price gap to it is computed and shown as a per-GB figure — explicitly labelled as *not* folded into the recommendation, since the comp set already holds storage constant.
5. **Break-even/margin per marketplace:** solved algebraically from a seller-entered cost (`sellerInputs.js`) and each marketplace's current fee rule.
6. **Final number:** the fair value, clamped between the highest marketplace break-even floor and the comp-set maximum, then snapped to a psychological price ending (e.g. `₹12,629 → ₹12,599`).
7. **Confidence label:** derived from comp-set size and IQR tightness — deliberately conservative (a 4-comp set with a wide IQR reads "medium," not "high").

> **⚠️ The seven steps above describe the SUPERSEDED Stage 8 engine.** They are kept because the professor may ask how the recommendation evolved. The engine was rewritten at Stage 11 — see immediately below. The hedonic slope, the 2-peer tier threshold and the single-number output no longer exist in the code.

### How the recommendation is produced NOW (`src/utils/pricingEngine.js`, Stage 13)

**The anchor hierarchy — the single most important thing to preserve:**

1. **Own market (primary).** The product's own in-stock offers, on the universal effective basis. Anchor = `0.65 × own median + 0.35 × 90-day normal`. Requires ≥2 own offers.
2. **Single own offer + comparables (blend).** `0.75 × own + 0.25 × comparable median`, clamped within ±10% of the own offer (Stage 14 / MJ-5 — a 50/50 blend let substitutes drag the anchor a long way from the price the product is actually listed at).
3. **Comparable market (fallback only).** Used as the anchor *only* when the product has no in-stock offer of its own.

**One price basis.** `PRICE_BASIS = universal_effective`. History, current price, market statistics, recommendation inputs and the price-history chart all resolve through it. Nothing may reintroduce a second definition — see Stage 14 / MJ-1.

**Competitive set** (`utils/competitiveSet.js`, Stage 15). Hard exclusions first — zero shared marketplace, above MRP reachability — then tiering into direct / comparable / reference, then de-duplication to one slot per competitive identity, then an IQR fence (at ≥3), then ranking by `similarity × dataQuality` with direct competitors always above comparables. Similarity weights: specifications 0.45, price segment 0.25, brand tier 0.15, **marketplace overlap 0.15**. Specification scoring covers the full attribute schema by dataType, with pricing-relevant attributes weighted double; when nothing is comparable the weight is **redistributed**, never filled with a constant. Every member carries `evidenceWeight`, and all comparable statistics are weighted by it.

**Competitive pool.** Bounds and zones come from `own offers ∪ comparables`, never comparables alone. Zones: cheapest, competitive band (Q1–Q3), band midpoint, dearest, plus a concentration ratio (IQR/median) that says whether the market is commoditised.

**Willingness to pay.** `fitHedonicModel()` regresses log(price) on pricing-relevant attributes + rating + brand tier across comparables. Requires ≥5 observations and adj R² ≥ 0.5. Premium claim capped at ±25% of the anchor. When untrusted, the evidenced premium is **exactly zero** and Premium is marked `supported: false`.

**Strategy derivation:**
- **Fast Sale** = 1.5% under the cheapest seller *of this exact product* (not the pool minimum — chasing a cheaper substitute abandons the product's own market), floored at 85% of the anchor.
- **Balanced** = the anchor + `evidencedPremium × travel × 0.6`.
- **Premium** = the **top of the product's own observed range** (`max(own max, anchor)`), extended by `evidencedPremium × travel` only if evidenced, then capped at +25% over the own-market median. Pool Q3 is used **only** when the product has no market of its own, and is then capped at +10% over the anchor. ⚠ **Do not reintroduce `max(pool Q3, anchor)` here** — that expression is exactly the CF-1 defect (Stage 14).

**Promotional distortion.** Current market vs 90-day normal: ≤0.9× → `depressed`, ≥1.1× → `elevated`. The anchor's history weighting pulls a depressed market back toward normal rather than treating a dip as the new baseline.

**Viability, kept separate.** If the competitive band midpoint is below break-even, `viability.conflict` is raised and surfaced as a banner. The price is not silently lifted to a level the market will not pay.

**Seven sanity checks** run pre-display: MRP respected, floor respected, ordering, premium evidenced, **premium vs own market** (the CF-1 invariant, asserted rather than assumed), market undistorted, viability. Failures render, they do not suppress.

**Evidence checks** (nine, weighted): comparables ×2, comp-set coherence ×2, history depth, competitor coverage, seller cost, fee rates, MRP, **listing match quality**, **promotion-free comparison**.

---

### The Stage 12 pipeline (constraints layer — still fully in force)

The Stage 11 pipeline below is still broadly the shape, but Stage 12 added the parts that make it *defensible*. Read these first:

**0. Everything benchmarks on `universalEffective`** (§5a), never on landed or conditional-best prices.

**1. MRP resolves BEFORE the comparable set** — it is an input to it. `resolveApplicableMrp()` takes the highest MRP observed across the product's offers (the least restrictive defensible ceiling) and classifies reliability: an MRP more than 2.2× the market is flagged `inflated` — still a legal ceiling, but explicitly not evidence the market will bear more.

**2. Four comparable-set gates**, each recording exclusions with reasons:
   - similarity ≥ 45%
   - absolute price band 0.45×–2.2× of the target
   - **MRP reachability** — a product priced above this product's MRP × 1.15 cannot be matched on price, so it is not a usable benchmark (this gate is what stops a cheap product inheriting a floor above its own legal ceiling)
   - IQR outlier fence (1.5×) once ≥4 candidates remain

**3. Hard vs soft constraints.**
   - HARD (a violation makes the price *invalid*): applicable MRP ceiling; break-even floor.
   - SOFT (shape but do not bound): market floor, evidence-limited travel, product strength.
   - The market floor was **demoted from hard to soft** in Stage 12 and capped beneath the ceiling, because a product genuinely cheaper than its comp set was being forced above its own MRP.
   - If ceiling < floor (e.g. MRP below break-even) the engine returns a **constraint conflict** explaining that no valid price exists, rather than emitting a number.

**4. Evidence gates the output.** Seven weighted checks (comparable count, coherence, history depth, competitor coverage, cost, fee rates, MRP). Below 2 usable comparables the engine **refuses to recommend**, returns `insufficientEvidence`, and lists what would change it. Evidence level also damps strategy travel (`travel` factor 1.0 → 0.35), so weak evidence cannot produce a confident premium.

**5. Strategies are clamped and their binding constraint recorded** — the UI shows "Held at the applicable MRP" when the calculation wanted to go further. If constraints collapse strategies onto one price, that is stated rather than shown as three identical cards.

---

### The Stage 11 pipeline (still the underlying shape)

1. **Comparable set — similarity-scored, not a blunt filter.** Candidates are products of the *same product type* (not merely the same category). Each is scored `0.5 × spec similarity + 0.3 × price proximity + 0.2 × brand-tier proximity`; the top 8 above a 0.3 threshold are kept. If fewer than 3 clear it (thin category), the threshold is relaxed and the UI states that. Each comparable's similarity % is displayed.
2. **Product strength index** — one number in roughly −1…+1, from four weighted components, all measured against the comp set:
   - Customer rating (weight 0.30) — delta vs comp-set median rating
   - Review volume (0.15) — log₁₀ ratio vs comp-set median
   - Specification profile (0.35) — pricing-relevant numeric specs ahead vs behind the comp median, direction-aware via the registry's `higherIsBetter`
   - Brand tier (0.20) — tier rank vs comp-set median tier
3. **Three strategies, three different anchors.** This is the central design point: they are *not* fixed percentages around one value, so two products with the same market median but different strength get different spreads.
   - **Fast Sale** ← lower of comp-set Q1 and a 1.5% undercut of the cheapest comparable
   - **Balanced** ← comp-set **median**, shifted by `12% × strength index`
   - **Premium** ← comp-set **Q3**, extended by `15% × max(strength, 0)` — positive strength only; a weak product gets a warning instead of an extension
   Each is clamped between floor and ceiling, then snapped to a credible price ending via `snapWithFloor()`, which steps back up if snapping would push a price under its own floor.
4. **Floor / ceiling.** Floor = `max(highest break-even × 1.02, cheapest comparable × 0.92)`, tagged as driven by `break_even` or `market`. Ceiling = dearest comparable × 1.10.
5. **Evidence assembled alongside:** market position; strength component breakdown; competition (offer/seller counts, cheapest, median, spread, review velocity); price history (30/60/90-day medians, historic low/high, trend, promotional days); commercial viability (break-even and margin per marketplace).
6. **Defensibility.** `bounds.lowerReasons` / `bounds.upperReasons` are generated sentences quoting real figures, answering "why not cheaper?" and "why not dearer?".
7. **Confidence** — from comp-set size and IQR/median dispersion, returned with its *reasons*, including honest caveats ("similarity threshold was relaxed", "margin uses a marketplace default fee rate", "no seller cost entered").

### Important conventions in the mock dataset
- Money is stored as **integer minor units (paise)**, never floats, everywhere — mirroring the database design's explicit rule (§5/§6). Formatting to ₹ happens only at the display boundary (`src/utils/money.js`).
- "Effective price" on the Listing/Offer pages **excludes** conditional promotions (exchange bonus, no-cost EMI) and only nets out unconditional ones (bank offer, coupon, cashback) — see §15 for why this distinction exists.
- The Buy-Box/"Featured offer" flag is recomputed per day, per listing, as whichever in-stock offer has the lowest landed price that day — not hand-assigned.

---

## 11. UI/UX design history

### Stage 8 visual design (superseded)
The first implementation pass synthesized a design language from **six** reference screenshots (a course-platform UI, a CRM/kanban UI, an AI-chat-studio UI, and three marketing landing pages for a supplement brand/yoga studio/beauty clinic). The result: a warm cream canvas, a **dark charcoal sidebar**, a terracotta/rust accent color, and a **serif display font** (Newsreader) paired with Inter for UI text. This was internally coherent but was later determined to be an over-broad synthesis rather than a faithful reproduction of any specific reference — see Stage 9.

### Stage 9 visual design (current)
The user narrowed the reference set to exactly two images and required strict, literal fidelity — not inspiration, not improvement, not a "modern interpretation." On close re-inspection this revealed the Stage 8 design had two concrete errors: it used a dark sidebar where both real references use a light one, and it used a serif font where neither reference uses a serif anywhere. Both were corrected at the token level (§3 Stage 9, §7).

**The two current reference images** (not included in the repo as files — supplied inline in chat, described here for continuity):
1. **"Creatica"** — a course/lesson platform: light sidebar with grouped nav sections and small uppercase labels, a large rounded video card, pill-shaped tabs with count badges (Overview / Notes / Transcript / Q&A / Discussion), a warm orange accent used on the active tab and one contact-style button.
2. **"BizLink"** — a CRM/kanban dashboard: light sidebar, a solid **black** pill for the active nav item and the primary "+ Add" button, white kanban cards with small icon+text meta rows, small stat tiles (bar chart, gauge, plain numbers).

**What was intentionally taken from these references:** the light-sidebar-on-near-white-canvas structure; hairline borders as the primary separation device instead of shadows; a black-pill active-nav-state; a warm-orange pill treatment for active tabs; sans-only typography; generous but not excessive card padding; rounded (not sharp, not fully rounded) card corners (~16px); pill-shaped buttons and badges throughout.

**What was explicitly NOT taken:** any of the references' own content, branding, product names, or copy. "BizLink," "Creatica," their logos, their customer names, their course titles — none of it appears anywhere in this project. Only the *visual system* was reproduced; all content is this project's own (Product/Listing/Seller/Offer/Marketplace/Price History/Recommendation, and the specific mock products in §10).

### UX principles established and followed
- Navigation should make the entity model legible without the user needing it explained — moving from Overview → Marketplaces → Listing → Price History → Recommendation *is* a tour of Product → Listing → Offer → Price History → Recommendation.
- Every derived number (effective price, margin, the recommendation) is shown with the inputs that produced it, visibly, on the same screen — never an unexplained figure (this was an explicit build requirement from Stage 8 and remains a hard rule — see §17).
- Reduced jargon in user-facing copy where possible, though internal entity names (Listing, Offer, Seller) are used directly in the UI rather than invented friendlier synonyms, since making the data model visible was the explicit point of the exercise.

---

## 12. Professor feedback (progression)

This section exists specifically to explain *why* the project moved the way it did — each row is feedback that changed the next deliverable.

| When | Feedback (as reported by the user) | What it triggered |
|---|---|---|
| Initial assignment | "What I want to see is how you utilise data, how you organise data" — scraping explicitly downplayed | Reframing the whole project around data modeling, not extraction (§2, Stage 1–2) |
| After the high-level diagram | Understood as "just an overview" — implied expectation of database-level thinking next | Stage 4 → conceptual database design (Stage 5) |
| (Implicit, via the walkthrough doc's own framing) | Anticipated defense-style questioning about the database design | Production of the 40-question/answer defense-prep document (`pricing-intelligence-walkthrough.md`) |
| Next explicit request | "Give a working wireframe... how it actually works with client" | Stage 6 → frontend planning (Stage 7) → actual React build (Stage 8) |
| (No further professor feedback recorded yet) | — | The Stage 9 visual correction was **user-driven** (a design-fidelity requirement), not reported as professor feedback |

**Unknown:** whether the database design has actually been presented to the professor yet, and whether any feedback exists on the frontend prototype itself. See §21.

---

## 13. What has already been completed

- [x] Problem understood and reframed around data organization (not scraping)
- [x] High-level data-organization diagram (`product-data-hierarchy.png`)
- [x] Deep supporting research report on real-world data-model precedent (`Future-Proof Data model...md`)
- [x] Full conceptual database design, entity-by-entity, with reasoning (`database-entity-design.md`)
- [x] Formal professor-facing PDF of the database design
- [x] Presentation/defense-prep document with a 40-question professor Q&A (`pricing-intelligence-walkthrough.md`)
- [x] Frontend page-structure brief (agreed in conversation; implemented directly rather than saved as a separate doc)
- [x] Working React frontend prototype — all 8 planned pages implemented and routed
- [x] Mock data layer mirroring the conceptual database's entity relationships
- [x] A real (non-hardcoded) pricing recommendation engine running against the mock data
- [x] Async service layer structured for a future real-API swap
- [x] First-pass visual design (six-reference synthesis) — **superseded**
- [x] Corrected visual design matching two specific references faithfully
- [x] Production build verified clean (`npm run build`), linter clean aside from two pre-existing benign warnings
- [x] Manual verification of the full click-through flow (Dashboard → Catalogue → Product Overview → Marketplace Comparison → Listing Detail → Price History → Recommendation → Data Sources)
- [x] Mock dataset expanded to 3 marketplaces / 3 product types with deliberate edge cases (Stage 10)
- [x] Broad browsable taxonomy: 6 departments → 11 categories → 16 subcategories → 16 product types (Stage 11)
- [x] Registry-driven faceted catalogue with live counts, sorting and URL-synced state (Stage 11)
- [x] Multi-strategy evidence-based recommendation engine with defensibility bounds (Stage 11)
- [x] Programmatic dataset audit (referential integrity, price-consistency invariant, recommendation coverage) — run in-browser against the real modules, 0 errors
- [x] Price ladder with promotion availability classes; only universally-available discounts enter the comparison price (Stage 12)
- [x] Hard/soft constraint system with MRP as an enforced legal ceiling, plus explicit constraint-conflict state (Stage 12)
- [x] Comparable-set coherence gating with recorded exclusion reasons, surfaced in the UI (Stage 12)
- [x] Evidence sufficiency gate that refuses to recommend on thin data, and damps strategy travel by evidence quality (Stage 12)
- [x] Validity audit across all 106 products: **0 MRP violations, 0 below-floor prices, 0 mis-ordered strategies** (Stage 12)
- [x] Own-market anchoring with 90-day normal reconciliation and promotional-distortion detection (Stage 13)
- [x] Empirical willingness-to-pay model (hedonic regression) that refuses when data is too thin (Stage 13)
- [x] Competitive zones from the combined pool; Premium can be explicitly *not evidenced* (Stage 13)
- [x] Market recommendation separated from seller viability, with conflict surfaced (Stage 13)
- [x] Six pre-display sanity checks (Stage 13)
- [x] **All seven test cases A–G verified** with concrete dataset representatives (Stage 13) — see §15a

---

## 14. What is NOT implemented yet

**This list was written before the backend existed and had gone badly stale.
Corrected at Stage 27; the superseded entries are kept struck through so the
history is not erased.**

- Real Flipkart data source (no scraper exists at all, for any marketplace)
- Real Amazon data source
- ~~Any Java backend~~ — superseded: the backend is Node/TypeScript + Fastify, and the reasoning for not choosing Java is in `docs/BACKEND_ARCHITECTURE.md`
- ~~A real database of any kind~~ — **done (Stage 22).** PostgreSQL with Drizzle, real migrations, 389,534 rows, 37/37 integrity checks
- ~~Any real API~~ — **done (Stages 23–27).** Auth, catalogue, marketplace data, competitors, analysis and the pricing recommendation are all served over HTTP; `src/api/http.js` is the client
- ~~Authentication / user accounts~~ — **done (Stages 23–24).** Email + password with Argon2id, OTP email verification and password reset over real SMTP, opaque HMAC-hashed session tokens
- Persistence of **tracked products** beyond the browser session — accounts and sessions persist, but the tracked-product list is still browser state and resets on reload
- Repointing the catalogue, analysis and recommendation **pages** at the API — the services exist and the recommendation page calls the backend alongside the browser engine, but the screens still render from `src/data/`
- Entity resolution / product matching as a real algorithm (the design docs describe a blocking → similarity-scoring → thresholding pipeline; the mock data's `match_status`/`match_confidence` fields are hand-authored constants, not the output of a real matcher)
- Any real image assets (product photography) — the Catalogue/Product cards use a generic icon placeholder, not real product images
- Production deployment of any kind
- Bundle/multipack product modelling (explicitly flagged as an unresolved gap in the original design docs, never revisited)
- Condition-as-first-class-citizen in comp-set construction (new/refurbished/renewed are modelled in the schema via `item_condition` but the recommendation engine does not currently filter by it)

---

## 15. Current limitations

Real, known issues in the current implementation — not hypothetical:

1. **Three real bugs were found and fixed during Stage 8/9 testing** (documented here so they aren't accidentally reintroduced):
   - Exchange-bonus and no-cost-EMI promotions were originally being subtracted from "effective price" like an unconditional discount, producing a nonsensical result (a ₹17,999 phone showing as ₹2,450 effective). Fixed by splitting promotions into unconditional (bank offer/coupon/cashback — netted into effective price) vs conditional (exchange/EMI — shown separately with an explanatory note, never subtracted from the headline number).
   - The brand-tier adjustment in the recommendation engine could be swung entirely by a single same-tier comparable (an outlier). Fixed by requiring at least 2 same-tier peers before applying any adjustment.
   - One mock product (vivo T3x 5G) was originally attached to the wrong brand row (reusing realme's row to save a file edit) — fixed by adding a proper `brand_vivo` entry.
   - A `NavLink` tab (the "Listing" tab in the pill-tab bar) was staying visually active on the Price History sub-page too, because React Router's `NavLink` prefix-matches by default. Fixed by adding `end: true`.
   - **(Stage 10)** `PriceHistoryPage` rendered `Infinity` / `NaN%` for a listing with zero offers (the ASUS ROG Strix case). Fixed with an explicit empty state.
   - **(Stage 11)** `hashSeed` returns a *signed* 32-bit int, so `hash % pool.length` produced negative indexes and left **90 generated offers with an undefined seller**. Caught by the programmatic audit, not by eye. Fixed with a `positiveHash()` wrapper.
   - **(Stage 11)** Fast Sale could land *below* its own stated floor: the value was clamped above the floor and then snapped downward through it. Fixed with `snapWithFloor()`.
   - **(Stage 11)** The strength breakdown read "1 of 2 pricing-relevant specs above comp median" while silently excluding tied specs, implying only 2 existed. Reworded to "1 ahead, 1 behind, 3 tied".
   - **(Stage 11)** Generated `modelName` included the brand, so breadcrumbs rendered "Green Soul Green Soul Beast…". Fixed by stripping the brand prefix in the generator.
0. **19 of 106 products deliberately produce no recommendation.** They sit at the extremes of thin categories (MacBook Air M3, AirPods Pro 2, Garmin Forerunner, LG OLED, Redmi A3) and have no usable comparables. This is the evidence gate working as designed, not a bug — but it is worth knowing before a demo, so pick a product with a healthy comp set (Galaxy M14 5G and Dell Inspiron 15 both have high evidence).

0b. **MRP is taken as the highest observed across a product's offers.** If a marketplace prints an incorrect MRP, it becomes the enforced ceiling. There is no cross-check against a manufacturer source, because none is captured. `mrp.reliability` flags implausible values but does not override them.

2. **Dataset is curated, not large.** 106 purchasable products across 16 product types — broad enough that filtering, sorting and comparable-set construction are all meaningful, but far from a real catalogue's scale. Confidence labels on recommendations reflect this honestly (a 3-comparable set reads "medium", never "high").
3. **The mock price-history generator anchors to a hardcoded "today"** (2026-08-14) inside `priceObservations.js` and `dashboardService.js`. If read long after that date, "last 7 days" framing on the Dashboard may look stale, though nothing will break.
4. **No automated tests exist** — verification so far has been manual (dev-server click-through + console/build checks), not a test suite.
5. **Bundle size warning at build time** (~680KB minified JS, mostly `recharts` + `lucide-react`) — flagged by Vite's own build output, not yet addressed with code-splitting. Cosmetic/performance concern only, not a correctness issue.
6. **The Browser-pane visual verification tooling used during development was intermittently unreliable** (screenshots would fail with "pane not displayed" for stretches of both build sessions) — most pages were confirmed visually via screenshot, but a couple of secondary views (mobile nav open-state in Stage 8, Recommendation/Data Sources pages in the final Stage 9 pass) were only confirmed via DOM/text inspection, not a final pixel screenshot. Worth a manual glance before a live demo.
7. **`src/api/client.js`'s `request()` function is currently dead code** — written and ready as the future integration point, but no service function calls it yet (§14).

---

## 15a. Test cases A–G (verified, Stage 13)

Each has a real representative in the dataset. Re-run these after any pricing change.

| Case | Representative | Observed behaviour |
|---|---|---|
| **A — commodity, narrow band** | boAt Wave Call 2 (`prod_boat_wave`), own market ₹1,299–₹1,361 | ₹1,249 / ₹1,299 / ₹1,449. Premium *not evidenced*. Stays inside the competitive zone. |
| **B — differentiated, premium justified** | Galaxy M14 5G 6/128 | ₹11,199 / ₹13,599 / ₹15,099. Regression trusted (adj R² 0.65) → premium **evidenced** and applied. |
| **C — weak product** | realme Buds T300 (strength −0.46) | Premium *not evidenced*; no upward move claimed. |
| **D — temporary promotion** | JBL Wave Buds 2 (`promoNow` fixture), own median ₹2,353 vs ₹2,820 normal | Flagged `depressed`; anchor leans to normal; Balanced ₹2,699 — refuses to treat the dip as the baseline. |
| **E — sparse data** | Anker PowerCore 20000 (1 own offer) | Anchor blends with comparables; premium withheld; 19 thinner products refuse outright. |
| **F — MRP constraint** | Noise Fit Play (`prod_noise_basic_tightmrp`), MRP ₹1,329 | Premium bound at the **applicable MRP** and labelled as such. 3 strategies dataset-wide are MRP-bound. |
| **G — poor seller economics** | Dell Inspiron 15 (cost ₹39,000) | `viability.conflict` raised — market midpoint sits below break-even, exposed as a banner rather than resolved by raising the price. |

**Dataset-wide guard (re-run this after any engine change):** 89 recommended, 19 refused, **0 MRP violations, 0 below-floor, 0 mis-ordered**, Balanced averaging **1.9%** from each product's own market median (max 17.8%).

---

## 16. Next logical stage

Based on where the project actually stands, the next steps that follow directly from the established direction (not a new roadmap):

1. **Present/defend the current state** to the professor if that hasn't happened yet — the `pricing-intelligence-walkthrough.md` document was built for exactly this.
2. **Backend — decided and under way (Stages 21–27).** Node/TypeScript + Fastify + PostgreSQL + Drizzle, *not* Java: the reasoning is in `docs/BACKEND_ARCHITECTURE.md` and comes down to letting ~4,300 lines of verified pricing logic move server-side rather than be rewritten. Phases 1–3 (architecture, schema, migration, authentication, API foundation) are complete; Stage 23 replaced the credential with email + password and wired the frontend's auth layer to it for real, Stage 24 added a Gmail SMTP transport behind the existing email port, Stage 25 (Phase 4) exposed the marketplace data — listings, sellers, offers, price history across seven windows, reviews, seller ratings and promotions — through twelve read-only APIs, Stage 26 (Phase 5) moved the competitor and cross-marketplace analysis engines server-side behind two authenticated endpoints with parity asserted across 115 comparisons, and Stage 27 (Phase 6) moved the pricing recommendation itself — anchor, constraints, three strategies, evidence gate, willingness-to-pay model and refusals — behind `/products/:id/recommendation`, with 77 parity assertions and a measured, versioned cross-validated alternative to the attribute model. **Phase 7 has not been started and is awaiting the user's review.** `src/api/*Service.js` remains the swap point for the catalogue and pricing data, and its return shapes are the API contract; `src/api/authService.js` calls the real backend, and `src/api/recommendationService.js` now calls it alongside the browser engine so the two can be compared.
3. **Turn the conceptual database design (§5) into real DDL** and a real database (Postgres was the design docs' implicit assumption, given the JSONB-based Specifications design — but this was never explicitly finalized as a hard requirement).
4. **Build (or at minimum design) the real entity-resolution/product-matching pipeline** described in the docs but never implemented — this is explicitly flagged in the original design review as "the single biggest gap."
5. **Only after a real backend and real data exist:** revisit whether a real scraper/crawler is needed at all, versus using official marketplace APIs where available (a preference stated in the original design docs).

---

## 17. Rules for future Claude sessions

1. **Read this file in full before making architectural or database-model changes.** Read the relevant existing source file(s) before editing them — do not guess at current structure.
2. **Do not redesign the conceptual database model (§5/§6) without discussing it with the user first.** These decisions were arrived at deliberately, over multiple iterations, specifically to survive professor questioning — do not "improve" them unprompted.
3. **Never put price fields directly on an Offer object/table.** Price is always an observation, keyed to `(offer_id, observed_at)`, append-only. This is the rule most likely to be silently violated by someone who hasn't read this file.
4. **Never treat mock data as if it were real marketplace data.** If asked to "connect to Flipkart" or similar, clarify that no scraper exists and confirm scope before writing one — see the original assignment's own emphasis (§2) on data modeling over scraping; don't let a future request quietly pull the project's center of gravity back toward "just build a scraper."
5. **Preserve the separation between observed and derived values**, both in the database design and in the frontend (§6, rule 9; §9). If asked to add a new "computed" figure to the UI, compute it from existing observations rather than storing it as a new fact.
6. **Preserve the Product → Listing → Offer → Price History → Recommendation navigation spine** in the frontend unless explicitly told to restructure it — this mapping between UI navigation and the data model is a deliberate, load-bearing design choice (§3 Stage 7, §7).
7. **Do not silently change the visual design system** (§11) established in Stage 9 (light sidebar, black/orange accents, sans-only, border-first cards) back toward the superseded Stage 8 direction (dark sidebar, terracotta, serif) — that direction was explicitly rejected by the user as inaccurate to the chosen references.
8. **If asked to add a new UI number/metric, show its inputs, not just the output** — this was an explicit, repeated requirement across both build sessions ("do not present unexplained numbers").
9. **When changing frontend architecture, explain the reason and the impact before doing it**, especially anything touching `src/api/` (the future-Java-backend swap point) or `src/data/` (the mock "database").
10. **Never let a recommendation exceed the applicable MRP, or fall below break-even.** These are hard constraints (§5a, §10). If a future change makes a strategy able to violate one, that is a regression, not a feature — the ₹3,399 incident is exactly what they exist to prevent.
11. **Never fold conditional benefits into a comparison price.** Bank-card, coupon, exchange, membership and cashback benefits are shown but never benchmarked. Only `universalEffective` is comparable across sellers.
12. **Prefer refusing to recommend over recommending on thin evidence.** The `insufficientEvidence` path is a feature. If asked to "make more products show a recommendation", the correct fix is richer comparable data, never a looser gate.
12a. **The product's own market is the primary anchor — never demote it back to comparables.** This was the Stage 13 defect: four in-stock offers at ₹1,299–₹1,361 were ignored in favour of two substitutes at ₹1,499–₹1,799. If a change makes Balanced drift far from the product's own median, that is a regression. The guard: average deviation across the dataset should stay near 2%.
12b. **Never claim an attribute premium the regression does not support.** `wtp.trusted === false` must produce `evidencedPremium = 0` and `Premium.supported = false`. Do not substitute a heuristic "strength × percentage" premium — that is precisely what was removed.
12c. **Do not introduce an LLM into the pricing path.** See §3a. It may narrate output; it must never produce or adjust a price.
12d. **Premium is bounded by the product's own market, not by what rivals cost.** Pool Q3 describes what *other* products cost; on its own it is not evidence that *this* one can be sold there. `max(pool Q3, anchor)` as a premium ceiling is the CF-1 defect (Stage 14) and must not return. The `premium_vs_own_market` sanity check exists to catch its reintroduction — if it starts failing across the dataset, the ceiling logic has regressed.
12e. **One price basis, everywhere.** `PRICE_BASIS = universal_effective`. Any new series, statistic or chart must resolve through it. Comparing a landed number against an effective one is what produced false "promotionally depressed" readings before Stage 14 (MJ-1).
12f. **One source of truth for product rating and review count** — `utils/productMetrics.js`. Never read `getListingsForProduct(id)[0]` for a product-level figure; per-listing snapshots are for per-listing UI only (MJ-2).
12g. **`missing` is not `different`.** In specification similarity, an attribute absent on either side is unknown and must be excluded from the mean, not scored as zero — otherwise sparsely-captured products are penalised for a gap in our data rather than a gap in the product (MJ-4).
12h. **Never pad the competitive set to hit a number.** `COMPETITOR_POLICY.target = 5` is a target to be met honestly or missed openly. If asked to "make every product show 5 competitors", the fix is capturing more products in that price band — never lowering `direct.minSimilarity`, widening the price band, or promoting reference-tier products. Confidence is driven by `effectiveComparables` (weighted), so padding cannot buy it; that is deliberate and must stay true (Stage 15).
12i. **One slot per competitive identity.** Sellers, listings, marketplaces and variants of one model collapse to one competitor. If a change lets a model family occupy two slots, the set is over-reporting evidence breadth. `competitiveIdentityOf()` is the single definition.
12j. **Own market is offer-grained; the competitive pool is product-grained.** Never merge them into one array — that was the Stage 15 defect, where a product's own six offers outvoted three rival products in its own "market" statistics.
12k. **Thin product types are fixtures, not gaps.** Treadmills, action cameras, strollers, glucometers, sofas, wardrobes, bookshelves and RC toys are deliberately held at 3–4 products. They are the only evidence the refusal path works. If asked to "fix" the products that refuse, check whether the type is on this list first — padding it destroys the test (Stage 16).
12l. **The seed landed-price invariant is load-bearing.** The cheapest current IN-STOCK landed price for a generated product must equal its seed `price` exactly, or the catalogue card advertises a price no offer matches. Two things break it and both have already done so once: applying a marketplace price multiplier without normalising the minimum to 1.0, and letting the actual cheapest offer go out of stock or gain a delivery charge. The generator guards the offer at `invariantMpIndex`, which is NOT always `mpIndex === 0` (Stage 16).
12m. **A selling price may never exceed MRP, at any point in history.** Not just today's observation — the whole series. A "down" trend starts above today's price and will cross a tight MRP if unclamped (Stage 16).
12n. **Marketplaces are not interchangeable.** `categoryAffinity` in `marketplaces.js` decides which departments a platform carries, and the generator honours it. Do not add a product type to a vertical it would not realistically sell (Stage 16).
12o. **A generated selling price must be able to absorb its delivery charge.** Shipping is carved OUT of the item price so landed stays constant — which means the fee can only be applied where the residue stays positive. Cap it as a share of landed AND against the specific offer. Unguarded, a ₹79 fee on a ₹78 pen produced "−₹1 · 101% off" on a live page (Stage 17).
12p. **One seller, one offer, per listing.** The seller draw must track chosen ids and probe forward on collision — never re-hash, which would destroy the head-of-pool bias the offer distribution depends on. Without this, half of all multi-offer listings repeated a merchant and the UI's "N sellers compete" was false (Stage 17).
12q. **A promotion floor without a ceiling is a bug.** Minimum discount values are there so a ₹20 discount does not appear on a ₹20,000 phone — but applied to a ₹78 pen the same floor is a 64% discount. Every promotion value must pass through `capped(floor, computed, maxShare)` (Stage 17).
12r. **Provenance must cover every marketplace in the dataset.** `dataSources.js` is not generated; adding a marketplace means adding its capture run and field-coverage rows by hand, or the Data Sources page renders an empty section (Stage 17).
12s. **The analysis layer derives; it never decides.** `crossMarketplaceAnalysis.js` adds no entities and no state, and the strategies it displays are the engine's own. If the analysis page and the recommendation page ever disagree on a price, the analysis is wrong by definition (Stage 18).
12t. **Per-unit price only where the product is sold by quantity.** `UNIT_BEARING_ATTRIBUTES` is an explicit allowlist. Picking "the largest numeric spec" produces "₹ per mAh" for a phone, which is not a comparison anyone makes. Adding a product type to the allowlist means asserting that buyers genuinely purchase it by that unit (Stage 18).
12u. **A displayed price ladder must come from ONE offer.** Taking `Math.min()` of each rung independently produces a ladder that does not add up — listed + delivery ≠ landed, because they came from different sellers. On a page built for traceability this is fatal (Stage 18).
12v. **Findings must be able to disappear.** Each is generated only where its data exists, so single-marketplace products lose cross-platform findings and refused products get none at all. Never write a finding that always renders — that is narrative, not analysis (Stage 18).
12w. **Colour is reserved for meaning.** Status, direction, chart series and marketplace identity. There is deliberately no brand hue — ink is the accent — because the only chromatic information on the page belongs to the data. Adding a decorative colour takes contrast away from one that means something (Stage 19).
12x. **Content surfaces do not float.** No shadows and no translucency on anything carrying data; both are reserved for layers that genuinely sit above content (the masthead, the two sheets). Hierarchy comes from type, rule and space (Stage 19).
12y. **Contrast is computed, not eyeballed.** ink-400 and darker clear 4.5:1 against canvas, canvas-deep, surface and surface-2 in both themes; ink-300 clears 3:1 and may only carry rules, icons and chart marks. Changing a surface means re-running the check — the first audit of this redesign found 180 failures on one route (Stage 19).
12z. **Never lay out a paragraph as a flex container.** Every element child of a flex container becomes its own flex item, so any `<strong>` inside splits the sentence into columns. Position the icon absolutely instead (Stage 19).
12aa. **Suppress transitions across a theme swap.** A transitioned property whose value comes from a custom property can freeze at its pre-swap value and never arrive. `ThemeContext` adds `.theme-switching` for one frame; do not remove it (Stage 19).
12ab. **A window reports only what its observations can support.** none / snapshot / directional / distributional, derived from the count inside the window, never from the window's length. Two to four points carry a direction but not a volatility; one point carries a level and nothing else. Every withheld statistic states its reason (Stage 20).
12ac. **The Buy Box is a per-listing contest.** Pooling featured-offer wins across marketplaces turns six unchallenged winners into "one seller holds 16.7%", which says the opposite of the truth. Measure per listing, then summarise (Stage 20).
12ad. **A non-price parameter must name the decision it changes.** If it cannot finish "…so I should ___", it is a column, not a parameter, and it does not ship. The rejected list is documented alongside the shipped one (Stage 20).
12ae. **The demonstration set is selected, not written down.** `utils/demoSet.js` stratifies across evidence tiers with a hard per-department cap and an explicit refusal stratum. A demo set with no refusal case in it hides the behaviour most worth showing (Stage 20).
12af. **The non-price layer never feeds the pricing engine.** It states how it corroborates or complicates the conclusion; it does not enter the arithmetic. If a store signal ever changes a recommended price, that is a bug (Stage 20).
12ag. **External identifiers are marketplace-scoped.** An ASIN is unique on Amazon, not across the internet. Every external id — listing, seller, category node — is unique only in composite with its marketplace, and a seller row is marketplace-scoped for the same reason (Stage 21).
12ah. **`price_observations.raw_document_id` must never become a foreign key.** Raw HTML is retained far more briefly than the facts derived from it, so the target is routinely absent by design. A FK there makes the retention policy fail the load (Stage 21).
12ai. **The backend stack is Node/TypeScript, not Java.** This reverses the Stage 7 note, and the reason is that ~4,300 lines of verified pricing logic can then move rather than be rewritten. Reopening it means accepting a full reimplementation and re-verification of the engine (Stage 21).
12aj. **A seed is a load, not an append.** It truncates the tables it owns and reloads them, so running it twice yields the same database. `users` and `tracked_products` are excluded — a data reload must not sign anybody out (Stage 21).
12ak. **Verify structure, not just counts.** Row counts pass even when two products have swapped listings. Check orphans on every foreign key and compare graph shape as distributions (Stage 21).
12al. **Application user and marketplace seller are different entities.** `users` is someone signing in; `sellers` is a merchant observed on a platform. They share no key and no table, and merging them would make "which of my competitors is also a customer" a schema question instead of a product one (Stage 22).
12am. **Never interpolate a Drizzle column bare inside a raw `sql` subquery.** It renders unqualified and the inner scope captures it, producing a silently wrong zero rather than an error. Use `sql.identifier(table).sql.identifier(column)` (Stage 22).
12an. **Bound parameters stop SQL injection, not pattern injection.** A `%` inside a LIKE value is still a wildcard. Escape `%`, `_` and `\\` before building a search pattern (Stage 22).
12ao. **Order on `lower(...)`, never on the bare column.** Collation differs between PGlite and a managed Postgres, so the same query can order differently in development and production (Stage 22).
12ap. **Fastify's AJV strips unknown fields unless told not to.** `removeAdditional` must stay false, or `additionalProperties: false` is decorative and a misspelled field is accepted as correct (Stage 22).
12aq. **Test-only affordances must be refused in production by the config schema, not by convention.** `EXPOSE_OTP_IN_RESPONSE`, `DB_DRIVER=pglite` and a non-`http` email adapter are startup failures under `NODE_ENV=production`. A test convenience that *can* be switched on in production is a backdoor (Stage 22).
12ar. **A one-time code is not a credential.** It proves an address at signup and authorises a reset. Logging in is email + password, and `purpose` is a database check constraint so a code issued for one job cannot do the other. The code hash is salted by purpose as well (Stage 23).
12as. **Equalise the timing, not just the wording.** An unknown address and a wrong password return identical bodies *and* the unknown path still pays for a decoy Argon2id verification. Without that, response time is the enumeration oracle the careful wording was meant to close (Stage 23).
12at. **Order the checks so the leak is impossible, not merely unlikely.** `EMAIL_NOT_VERIFIED` is reported only after the password is correct. Before that, saying it would tell any passer-by which addresses have accounts (Stage 23).
12au. **A reset revokes every session and does not sign you in.** The person resetting may not be the person signed in; if the account was compromised, the attacker's session is exactly what must not survive (Stage 23).
12av. **A stored token is not a session.** The frontend holds a third state — `restoring` — until `/auth/me` answers. Trusting the token flashes the app at someone signed out; distrusting its absence bounces a signed-in user on every reload (Stage 23).
12aw. **One place may adopt a session, and it requires both halves.** A `{ user }` with no token cannot authorise a request, so accepting it *is* the fake login state. A test asserts only `AuthContext` names the storage key (Stage 23).
12ax. **A migration that may already have run is history.** Change the model with a new migration, and make it survive rows the old model allowed — `0003` deletes outstanding `login` challenges before adding the CHECK that would reject them (Stage 23).
12ay. **An address belongs in sessionStorage, not the URL.** A query-string email lands in history, referrer headers and every access log the request passes (Stage 23).
12az. **A test that cannot fail is not evidence.** Every source-scanning guarantee in this project was mutation-checked — a planted violation must make it go red before it is trusted (Stage 23).
12ba. **A port earns its keep when the fourth implementation changes no caller.** Adding Gmail SMTP touched the email folder, the config schema and one failure path — not the auth service, not the routes, not the frontend (Stage 24).
12bb. **A failed send must retire its own challenge.** The resend cooldown reads the newest row whether or not it was consumed, so a delivery failure otherwise answers the retry with a timer counting down for an email that never left (Stage 24).
12bc. **Build an operator-facing error from the error CODE, never the provider's message.** A mail server can quote the failed AUTH line back at you, credential included (Stage 24).
12bd. **Prove a remote credential at boot.** A handshake that sends nothing turns a wrong app password into a refusal to start, instead of a user stranded mid-signup three days later. It does not belong in an unauthenticated /health (Stage 24).
12be. **A test harness that can silently test the wrong server is worse than one that fails.** Kill the process tree, and refuse to start when the port is already answering (Stage 24).
12bf. **Audit before building: the column may already exist.** `listings.listing_url` was fully populated, so the planned URL generator would have been a second, competing answer to a question the schema already answered (Stage 25).
12bg. **A statistic is defined by the series it runs over.** A median across raw observations counts a marketplace once per offer it carries, so six sellers outvote one. The daily-series rule — in-stock, cheapest per capture day — is part of the definition, and the API states it (Stage 25).
12bh. **Prove a translated calculation against its original, at the boundaries.** The SQL price ladder is checked against the JavaScript engine on 330 observations sampled at every promotion's validity edge; a deliberate off-by-one there broke 2 comparisons of 3,300, and nothing else would have caught it (Stage 25).
12bi. **A window's length and its evidence are different facts.** A 3-day window on a product captured every two days holds the same two days as the 2-day window. Report both honestly; do not make them move together (Stage 25).
12bj. **Measure before indexing, and write down a result of zero.** Every Phase 4 access path was already covered by the Phase 2 indexes — no sequential scans, 0.2–52 ms across 354,940 rows — so none was added (Stage 25).
12bk. **A test that depends on a developer's .env is a test that will fail for the wrong reason.** Pin what the suite needs, and assert against the configured value rather than a literal (Stage 25).
12bl. **An insert batch has a parameter ceiling.** PostgreSQL binds at most 65,535 per statement; exceeding it fails inside the wire protocol with no readable error. Size batches by columns × rows (Stage 25).
12bm. **Port against a fixture generated from the original, not from reading it.** Five defects in the analysis port were invisible to inspection and to smoke-testing; all five failed a structured comparison against the engine's own output (Stage 26).
12bn. **A missing input can look like a working one.** Forgetting to load `attribute_definitions` did not throw: the specification term simply dropped out, its weight was redistributed, and similarity came back plausible and wrong. Assert the components, not just the total (Stage 26).
12bo. **Close the mutations that are missed, not just report them.** Two of five planted mutations survived — one because nothing asserted the value directly, one because no golden product exercised the boundary. Both were real gaps in the tests (Stage 26).
12bp. **Refusal is wholesale, not per-finding.** Below the comparable minimum the engine emits NO findings, not the subset that happen not to need a competitor. Producing four where the engine produced none is fabrication however individually defensible each one is (Stage 26).
12bq. **The backend returns numbers; the interface makes sentences.** A rendered claim cannot be checked against the database and a metric can, which is what makes DATA → CALCULATION → FINDING → EVIDENCE more than a diagram (Stage 26).
12br. **Build the analysis context once per request, not once per finding.** What is free in memory on the frontend is a query storm over a database. Eight batched queries, none scaling with the candidate pool (Stage 26).
12bs. **Measure before caching.** Sub-second endpoints do not earn a cache that has to be invalidated on every observation (Stage 26).

12bt. **One wrong denominator is not one wrong number.** Counting marketplaces where the engine counts offers shifted an evidence score by a single weight-1 check, which moved the confidence level, the travel damping, the premium headroom and all three strategy prices on every product. Trace a small discrepancy to its root before fixing anything downstream of it (Stage 27).

12bu. **A parameter that narrows the input is not automatically a feature.** Accepting `window` on the recommendation meant the "90-day normal" was computed from a 30-day slice, so the anchor moved. Ask what question the parameter answers; if it only removes evidence from the same question, it does not belong (Stage 27).

12bv. **Port the defect, then say so.** The engine declares customer rating as a hedonic feature and filters it out before the rating is filled in, so rating can never be fitted. Reproducing that preserves parity; silently correcting it would change prices across the catalogue with no evidence of improvement. Fix it deliberately in a new version, not accidentally in a migration (Stage 27).

12bw. **Parity is agreement, not safety.** Two engines can agree on a price above the legal MRP. Assert the invariants separately — never above MRP, never below the floor, never negative, never a claim without evidence — and construct the data for the cases the dataset does not contain (Stage 27).

12bx. **Score the model you already ship before proposing a better one.** Nobody had measured the hedonic fit. It turned out its trust gate passes 226 fits that fail cross-validation and predict worse than copying the competitive median — a finding worth more than any new model, and available only because the naive baseline was scored alongside it (Stage 27).

12by. **Adjusted R² is not validation at n = 8.** With 5–32 rows and features picked by correlation with the same target, in-sample fit overstates skill. Exact leave-one-out is available in closed form for a linear smoother (`eᵢ / (1 − hᵢᵢ)`), so honest validation costs one fit, not n (Stage 27).

12bz. **Absent data is a stop, not a modelling challenge.** There is no quantity sold anywhere in this dataset, so elasticity and true willingness-to-pay are not estimable — not poorly estimable. Name what is missing and refuse the model; a validation score on a fabricated target is worse than no model (Stage 27).
13. **Prefer understanding existing code over adding new abstractions.** The codebase is intentionally not over-engineered for its current scope (a class-project wireframe) — resist adding speculative infrastructure (e.g. a state-management library, a component library, a testing framework) unless the user's request genuinely requires it.
11. **Keep this file up to date.** If you make a decision significant enough that a future session would need to know about it, add it here — particularly to §3 (evolution), §6 (critical decisions), §14/§15 (status), and §20 (historical context) as appropriate. Don't let this file go stale while the code moves on.
12. **When in doubt about project intent, ask** rather than assume — several past requests in this project have been extremely explicit and prescriptive (see the visual-correction request that produced Stage 9); treat that as the user's established working style, not a one-off.

---

## 18. File map

```
D:\advance dsa sir\                                  ← project root
│
├── CLAUDE_CONTEXT.md                                 ← this file
├── DEMO_GUIDE.md                                      ← practical frontend walkthrough/demo script
│
├── database-entity-design.md                          ← Stage 5: core conceptual database design (read before touching §5/§6 of this file)
├── Future-Proof Data model for Marketplace product
│     and price intelligence.md                        ← Stage 3: deep research report grounding the model in real standards
├── Marketplace-Pricing-Intelligence-Database-Design.pdf← Stage 5: formal professor-facing rewrite of the database design
├── pricing-intelligence-walkthrough.md                 ← Stage 5: presentation/defense-prep doc, 40 Q&A
├── product-data-hierarchy.png                          ← Stage 3: the accepted high-level data-organization diagram
├── ui inspiration/                                     ← Stage 8/9 reference screenshots (Creatica, BizLink, + more) — design reference only, never content
├── photos inspiraton/                                  ← more Stage 8 reference screenshots (landing pages) — superseded by the narrower Stage 9 reference set
│
└── frontend/                                           ← the actual React application (Stage 8/9)
    ├── package.json                                    ← deps: react, react-router-dom, recharts, lucide-react
    ├── vite.config.js
    ├── index.html                                      ← app title "Mulya"
    ├── src/
    │   ├── main.jsx                                    ← entry point, wraps App in BrowserRouter
    │   ├── App.jsx                                      ← ALL ROUTES defined here — read this first to understand navigation
    │   │
    │   ├── styles/
    │   │   ├── tokens.css                                ← EVERY colour/spacing/radius/font/motion value as a CSS variable — the single source of truth for visual design (§11). Rewritten in Stage 19; carries the contrast contract
    │   │   └── global.css                                ← shared primitives (.card, .btn, .tabular, .eyebrow, page-shell, motion) built on tokens.css
    │   │
    │   ├── data/                                         ← the mock "database" — one file per entity, see §10 for the full list
    │   │   ├── categories.js                              ← the full taxonomy: departments → categories → subcategories → PRODUCT TYPES, plus per-marketplace category mappings
    │   │   ├── attributeDefinitions.js                    ← THE SPEC REGISTRY. Drives both the catalogue's filters (isFilterable/filterType/buckets) and the recommendation's strength scoring (isPricingRelevant/higherIsBetter). Read before adding a product type.
    │   │   ├── catalogueSeed.js                           ← seed ENTRY POINT. Concatenates the four seed files below into one array (1,101 rows). Electronics/demo spine lives here.
    │   │   ├── catalogueSeedBreadth.js                     ← seed: fashion, beauty & personal care
    │   │   ├── catalogueSeedHome.js                        ← seed: home & kitchen, furniture, remaining electronics
    │   │   ├── catalogueSeedEveryday.js                    ← seed: grocery, baby, books, auto, health, pet, tools, toys, sports
    │   │   ├── catalogueSeedDepth.js                       ← seed: DENSITY for commodity types. Added because breadth alone left 81 of 125 types under six products, which made most of the catalogue refuse (§3 Stage 16, rule 12k)
    │   │   ├── seedHelpers.js                              ← p() and family() authoring helpers shared by all four seed files
    │   │   ├── products.js                                ← START HERE to understand the mock dataset; curated products + generated ones concatenated
    │   │   ├── listings.js / sellers.js / offers.js        ← the marketplace-facing chain
    │   │   ├── priceObservations.js                        ← generated price history — imports priceSeriesGenerator.js
    │   │   ├── reviewSnapshots.js                          ← generated review time series
    │   │   ├── feeRules.js                                 ← dated marketplace fee rules + net-realisation/break-even math
    │   │   └── sellerInputs.js                             ← the one "seller-entered" (non-observed) value: cost price
    │   │
    │   ├── utils/
    │   │   ├── hedonicModel.js                             ← THE WILLINGNESS-TO-PAY MODEL. Least-squares regression estimating whether the market actually pays for this product's attributes; self-reports fit and refuses when untrustworthy. The only statistical model in the system (§3a).
    │   │   ├── priceLayers.js                              ← THE PRICE LADDER. MRP → selling → landed → universal effective → conditional best → net realisation, plus promotion-class handling. Read this before touching anything price-related (§5a).
    │   │   ├── pricingEngine.js                            ← THE RECOMMENDATION LOGIC — similarity-scored comp set, strength index, history/competition/commercial evidence, three strategies, defensibility bounds. Read before changing recommendation behaviour.
    │   │   ├── catalogueGenerator.js                       ← expands catalogueSeed.js into real Listings/Offers/Observations/Reviews/Promotions. Owns the "seed price === cheapest current IN-STOCK landed price" invariant (rule 12l), the MRP clamp (12m), marketplace affinity (12n) and the tiered history cadence.
    │   │   ├── sellerGenerator.js                          ← 1,177 sellers across 6 marketplaces, scoped per marketplace, linked cross-platform only via sellerGroupId. Size distribution is top-heavy on purpose.
    │   │   ├── priceSeriesGenerator.js                     ← seeded random-walk generator for the curated tier's price/review history
    │   │   ├── seededRandom.js                             ← the PRNG used above (mulberry32)
    │   │   ├── money.js                                    ← minor-unit ↔ ₹ formatting; ALL money display goes through here
    │   │   └── useAsyncData.js                             ← shared loading/error/data hook used by every page
    │   │
    │   ├── api/                                           ← the "service layer" — future Java-backend swap point
    │   │   ├── client.js                                   ← documents the swap (request() is unused today — see §14/§15)
    │   │   ├── catalogueService.js                          ← the catalogue read model: product summary index, faceted filtering, facet counts, sorting, taxonomy tree
    │   │   ├── productsService.js / listingsService.js /
    │   │   │   priceHistoryService.js / recommendationService.js /
    │   │   │   dashboardService.js / dataSourcesService.js  ← one file per page-domain; each wraps mock-data joins in an async function
    │   │
    │   ├── state/
    │   │   └── AppStateContext.jsx                         ← only cross-cutting state: which products are "tracked"
    │   │
    │   ├── components/
    │   │   ├── layout/                                     ← Masthead (the only global chrome), Colophon, WorkspaceTabs (the numbered progression rail), ProductWorkspaceLayout (the shared product-workspace shell — read before changing per-product navigation)
    │   │   ├── common/                                     ← MetricCard, StatusBadge, DataTable, FilterControl, Avatar, Breadcrumbs, LoadingState
    │   │   ├── product/                                    ← ProductCard, SpecList
    │   │   ├── marketplace/                                ← MarketplaceCard
    │   │   ├── listing/                                    ← OfferCard
    │   │   ├── charts/                                     ← PriceHistoryChart (recharts), Sparkline
    │   │   └── recommendation/                             ← RecommendationPanel — the recommendation card UI
    │   │
    │   └── pages/                                          ← one file (+ co-located .css) per route — see §8 table
    │
    └── dist/                                               ← production build output (git-ignorable, not source)
```

The backend is not mapped above because it postdates this tree. Its own layout
and API reference live in `server/README.md`; the pieces added by Phase 6 are:

```
frontend/
├── docs/PRICING_MODEL_RESEARCH.md          ← Parts 10–16: methodology research, the ML decision, all measurements
├── scripts/
│   ├── audit-ml-feasibility.mjs            ← what the dataset can and cannot support, by counting
│   └── export-pricing-parity-fixture.mjs   ← generates the golden fixture FROM the frontend engine
└── server/
    ├── src/modules/pricing/
    │   ├── pricing.service.ts              ← anchor, constraints, strategies, evidence, refusals, explanation
    │   ├── pricing.repository.ts           ← fee rules, seller cost, observed MRP, match quality
    │   ├── pricing.routes.ts               ← GET /products/:id/recommendation
    │   ├── hedonic.ts                      ← baseline-v1 attribute model (+ the shared feature/design-matrix helpers)
    │   └── hedonicCv.ts                    ← hedonic-cv-v2: ridge with exact leave-one-out validation
    ├── src/scripts/
    │   ├── evaluate-pricing-models.ts      ← naive vs baseline vs candidate, cross-sectional and forward
    │   └── recommendation-baseline.ts      ← all 1,172 products: counts, safety violations, latency, query counts
    └── tests/
        ├── pricing-parity.test.ts          ← REC-01…10, WTP-01…07 against the frontend engine (77)
        ├── pricing.test.ts                 ← CON-01…07, STRAT-01…05, SPARSE-01…06 invariants (19)
        ├── pricing-model.test.ts           ← ML-01…10 for the statistical component (19)
        └── fixtures/pricing-parity.json    ← the golden values; a diff here is a change to the pricing model
```

**Files to read before editing, by task:**
- Changing the recommendation math → **both** `src/utils/pricingEngine.js` and `server/src/modules/pricing/pricing.service.ts`, then regenerate the parity fixture. They are asserted to agree; changing one alone turns 77 tests red, which is the point.
- Changing the attribute model → `server/src/modules/pricing/hedonic.ts` (baseline) or `hedonicCv.ts` (v2). The shared `usableFeatures`/`designMatrix` exist so the two versions cannot drift on feature selection — a change there affects both.
- Adding a new page or changing navigation → `src/App.jsx` + `ProductWorkspaceLayout.jsx` + §7/§8.
- Changing visual design → `src/styles/tokens.css` first, component CSS second — see §11 before touching either.
- Adding a mock entity or field → the relevant `src/data/*.js` file + the matching entity section in §5, to keep the mock data and the conceptual design consistent.
- Anything about backend integration → `src/api/http.js` + `server/README.md` + §7 + §14.

---

## 19. Terminology

Defined the way *this project* uses each term — some of these (Product, Listing, Offer) have looser meanings elsewhere; use the definitions below when working on this codebase.

| Term | Meaning in this project |
|---|---|
| **Product** | The real-world item, independent of any marketplace. The "golden record." Never has a price directly. |
| **Canonical Product** | Same as Product — emphasises that it's the resolved/cleaned identity, as opposed to a marketplace's raw, possibly-inconsistent listing title. |
| **Listing** | One marketplace's page for a Product (one FSN or one ASIN). Marketplace-scoped. Never has a price directly (multiple sellers may compete on it). |
| **Seller** | A merchant account, scoped to one marketplace. Not the same seller-object across Flipkart and Amazon even if it's the same real business (unless linked via `seller_group_id`). |
| **Offer** | The commercial relationship between one Seller and one Listing (plus item condition). Identity only — deliberately holds no price field. |
| **Price Observation** | One row: one offer's price, at one specific moment. The atomic fact of the whole system. Grain: `(offer_id, observed_at)`. Append-only. |
| **Effective Price** | Landed price (selling price + shipping) minus *unconditional* instant discounts (bank offer, coupon, cashback). Excludes conditional promotions (exchange, no-cost EMI) — see §15. |
| **Landed Price** | Selling price + shipping fee. What the Buy Box algorithm is understood to actually evaluate. |
| **Net Realisation** | What the seller actually banks: selling price minus referral fee, fixed fee, shipping, and GST on those fees. |
| **Buy Box / Featured Offer** | The offer, among all in-stock offers on a listing, with the lowest landed price on a given day. Computed per day, not fixed. |
| **Classification** | The category system: a canonical tree + each marketplace's own raw tree + a mapping between them. |
| **Marketplace Category** | One marketplace's own, unmodified category path, kept as evidence even after it's mapped to the canonical tree. |
| **Specification Registry / Attribute Definition** | The versioned table of which spec keys (e.g. `ram_gb`) are valid for a given product type, with their data type/unit — governs the free-form `specifications` JSON on Product. |
| **Variant Axis** | One dimension along which a product family varies (e.g. "storage," "colour"). Stored as rows, not fixed columns, because the axes differ per category. |
| **Fee Rule** | A marketplace's dated referral %/fixed fee/shipping basis for a category and price band. Versioned (SCD Type 2) so historical margin stays computable. |
| **Promotion** | A time-bounded discount term attached to an Offer (bank offer, coupon, exchange, no-cost EMI, cashback). Conditional promotions are tracked but not netted into effective price. |
| **Product Type** | The fourth browsable level (Smartphones, Gaming Laptops, Running Shoes…) and the key the specification registry is scoped to. A subcategory may host several. Distinct from Category. |
| **Facet** | A catalogue filter group with per-option counts, generated from the attribute registry rather than hardcoded. Counts are computed with that group's own selection excluded. |
| **Comparable Set / Comp Set** | The Products used to benchmark a recommendation: same *product type*, similarity-scored on specs (50%), price segment (30%) and brand tier (20%), top 8 above threshold. |
| **Strength Index** | A single −1…+1 score of how much better or worse a product is than its comparable set, from rating, review volume, specification profile and brand tier. Drives how far the Balanced and Premium prices move off their anchors. |
| **Strategy** | One of the three recommended prices (Fast Sale / Balanced / Premium), each anchored to a different statistic and carrying its own rationale, best-when conditions and margin. |
| **Universal effective price** | Landed price minus only those discounts every buyer gets automatically. **The one price used for all market comparison.** |
| **Conditional best price** | The universal effective price minus card/coupon/exchange/membership benefits. Real for some buyers, never comparable across sellers. |
| **Availability class** | Which buyers can actually obtain a promotion: `universal`, `conditional`, `deferred` (cashback) or `financing` (EMI). Owned by the promotion entity. |
| **Hard constraint** | A bound a recommendation may never cross because doing so makes it invalid — applicable MRP (legal ceiling) and break-even (loss-making). |
| **Soft constraint** | A preference that shapes the recommendation without bounding it — market floor, evidence-limited travel, product strength. |
| **Evidence gate** | The check that refuses to produce any recommendation when fewer than 2 usable comparables survive screening. Returns `insufficientEvidence` and what would change it. |
| **Travel factor** | How far evidence quality permits a strategy to move from the market median (1.0 at high evidence, 0.35 at low). Stops weak data producing a confident premium. |
| **Own market** | The product's own in-stock offers across all its listings. **The primary pricing anchor** — the strongest evidence of what a product commands is what it is already selling for. |
| **Competitive pool** | Own offers ∪ comparable products — every price a buyer could realistically choose between. All zones and bounds derive from this, never from comparables alone. |
| **Evidenced premium** | A price premium the hedonic regression actually measures in the market. Zero whenever the model is untrusted. Distinct from *product superiority*, which alone justifies nothing. |
| **Promotional distortion** | Current market vs 90-day normal. `depressed` (≤0.9×) or `elevated` (≥1.1×) means today's prices are not the product's standing level. |
| **Viability conflict** | The competitive market clears below the seller's break-even. Surfaced explicitly rather than resolved by raising the price. |
| **Hedonic (adjustment)** | Price adjustment attributed to a specific feature/attribute (brand tier, rating) rather than the market median as a whole — computed here via group medians and a real regression slope, not hardcoded. |
| **Review Velocity** | Change in review count per day between the two most recent Review Snapshots — the project's proxy for sales demand, in the absence of real sales data. |
| **Capture Run** | One simulated scrape job (per marketplace) in the Data Sources page — metadata only, no actual scrape occurs. |
| **Raw Document** | A simulated record of one fetched page (URL, hash, storage path) — the "would-be" HTML archive; nothing is actually fetched or stored. |

---

## 20. Historical context — decisions that evolved (do not erase this on future edits)

Kept explicitly because earlier representations are still useful for explaining *why* the current design looks the way it does, especially if questioned by the professor.

| Concept | Earlier representation | Later refinement | Current implementation |
|---|---|---|---|
| **Price** | Stage 3 diagram places "Current Price, MRP, Discount, Coupon/Bank Offer, Exchange Offer, Stock Status" directly under **Offer** — conceptually correct (these *are* facts about an offer) | Stage 5 database design explicitly moves all of these out of Offer and into a separate, append-only **Price Observation** table, keeping Offer as identity-only — because storing price on both Offer *and* a history table creates two competing sources of truth | The frontend's `Offer` mock objects hold no price fields at all; every price shown in the UI is read from the latest `priceObservations.js` row for that offer. This is explicitly called out in `database-entity-design.md` as "the diagram shows price under Offer but the database doesn't" — a deliberate, explained divergence, not an inconsistency. |
| **Classification** | Stage 3 diagram shows "Classification" as one box (Marketplace/Category/Subcategory/Product Type) | Stage 5 splits this into three real tables (canonical Category tree, per-marketplace raw Marketplace Category, and a Category Mapping crosswalk) | Currently simplified in the mock data to one canonical category ("Smartphones") and one mapping per marketplace — the three-table *shape* exists in `categories.js`, but only one category is populated, since the project has always been explicitly scoped to a single category for the demo. |
| **Product Identity** | Stage 3 diagram shows one box: Brand/Model/Variant/Product Name/Internal ID | Stage 5 splits this into Product's own fields plus two real entities (Brand, Product Identifier) plus a third (Variant Axis) | Implemented in `brands.js` (Brand) and `products.js` (`variantAxes` object + `identifiers` array directly on the Product row, rather than a fully separate Product Identifier table — a frontend-mock simplification of the conceptual three-table design). |
| **Reviews/Ratings** | Stage 3 diagram attaches Reviews/Ratings under Listing (already correct at the diagram stage) | Stage 5 formalises this as a **time-series snapshot**, not a static field, specifically so review *velocity* (the rate of change) is computable, not just the current level | Implemented exactly this way — `reviewSnapshots.js` is a generated time series per listing; `getReviewVelocity()` computes the rate from the two most recent snapshots. |
| **Frontend visual design** | Stage 8: six-reference synthesis — dark charcoal sidebar, terracotta accent, serif display type | Stage 9: narrowed to two references, corrected to a light sidebar, black + orange accents, sans-only type, after the user pointed out the synthesis didn't actually match either reference closely | Current implementation follows Stage 9 exclusively. If a future session is asked to "make it look nicer" or similar vague request, do **not** drift back toward Stage 8's aesthetic without the user explicitly asking for it. |
| **Frontend page navigation** | Stage 7 brief proposed pages as a loosely connected funnel | Stage 8 implementation formalised this as a literal shared layout (`ProductWorkspaceLayout`) with a persistent pill-tab bar, so the five product-scoped views are always structurally linked, not just "reachable" | Current implementation — see §7/§8. |
| **Pricing recommendation** | Stage 8: ONE recommended price, from the comp-set median plus a hedonic-style brand-tier adjustment and a least-squares price-vs-rating slope, clamped to break-even and snapped | Stage 11: rewritten to THREE condition-based strategies anchored to different statistics (Q1-undercut / median / Q3), each moved by a composite product-strength index, with an evidence layer and explicit why-not-lower / why-not-higher bounds | Current implementation. The Stage 8 seven-step method is still documented in §10 under a superseded-notice, because it explains the evolution if the professor asks why the approach changed. |
| **Catalogue** | Stage 8–10: a flat search box + one category pill row over 7→21 products | Stage 11: a four-level browsable taxonomy with registry-driven facets, counts, sorting and URL-synced state over 93 products | Current implementation, 106 products — see §8. |
| **Discounts** | Stages 8–11: a single "effective price" that subtracted bank offers and coupons alongside instant discounts; exchange/EMI were split off ad hoc inside `listingsService` | Stage 12: a formal `availabilityClass` taxonomy (universal / conditional / deferred / financing) owned by the promotion entity, driving a seven-rung price ladder | Current implementation — see §5a. Only `universalEffective` is ever benchmarked. |
| **Pricing constraints** | Stages 8–11: the only bounds were a break-even floor and a comp-set-derived ceiling; MRP was stored but never enforced | Stage 12: MRP is a hard legal ceiling; market floor demoted to soft; explicit constraint-conflict state when no valid price exists | Current implementation — see §10. This is what makes the recommendation *valid*. |
| **Pricing anchor** | Stages 8–12: anchored on the **comparable-set median**, adjusted by a heuristic `strength × fixed %`. The product's own offers were never an input. | Stage 13: anchored on the product's **own in-stock offers** reconciled with its 90-day normal; comparables demoted to secondary evidence; the heuristic premium replaced by a measured one that can refuse | Current implementation — see §10. This is what makes the recommendation *defensible*. The Stage 12 constraint layer still runs on top of it unchanged. |
| **Attribute premium** | Stages 8–12: assumed — a strength score multiplied by a fixed percentage, so "10% stronger" meant "≈10% dearer" regardless of market behaviour | Stage 13: measured by hedonic regression, gated on ≥5 observations and adj R² ≥ 0.5, capped at ±25% of anchor, and **zero when untrusted** (which is most of the time on this dataset) | Current implementation. Only 8 of 89 products earn one. |

---

## 21. Unknowns / needs clarification

Do not fabricate answers to these — ask the user if they become relevant:

- Whether the conceptual database design (`database-entity-design.md` / the PDF) has actually been presented to the professor yet, and if so, what feedback (if any) resulted.
- Whether the current frontend prototype has been shown to the professor yet.
- The professor's name and the exact course name (only ever referred to as an "advance DSA" course).
- Any hard deadline for the assignment.
- Whether the intended production database is actually Postgres — implied strongly by the design docs' use of JSONB for Specifications, but never stated as a hard requirement.
- Which Java framework (Spring Boot or otherwise) is intended for the future backend — explicitly left open in the original build brief ("do not assume a particular Java framework such as Spring Boot unless the existing project/context explicitly requires it").
- Whether the six Stage 8 reference images (beyond the two used in Stage 9) still matter at all going forward, or should be considered fully superseded.
- Whether "D:\advance dsa sir" is intended as a permanent project location or a working/temporary path.

---

*End of file. Last written during a documentation-only session — no application code was changed while producing this file or `DEMO_GUIDE.md`.*
