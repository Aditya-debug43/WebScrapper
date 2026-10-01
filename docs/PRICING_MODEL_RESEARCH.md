# Pricing methodology research and the ML decision

**Phase 6, Parts 10–16.** What real pricing systems do, what this dataset can
actually support, and what was consequently built. Every number here comes from
two scripts that can be re-run:

```bash
node scripts/audit-ml-feasibility.mjs
```

```bash
cd server && npx tsx src/scripts/evaluate-pricing-models.ts
```

---

## 1. The short version

A new machine-learning model that predicts a **price a buyer would pay** was
not built, because the dataset contains no record of anybody buying anything.
That is not a limitation to be modelled around; it removes one of the two
variables the question needs.

What *was* built is smaller and is supported by measurement: the attribute
model that already existed is now also available with its penalty chosen by
cross-validation and its trust gate based on **out-of-sample** error instead of
in-sample fit. Measuring that change turned up a real defect in the shipped
engine — **47% of the products currently given an attribute-driven premium are
being fitted by a model that predicts worse than simply copying the competitive
median.**

---

## 2. What real pricing systems do, and which parts apply here

Grouped by what each method actually needs, because that is what decides
whether it is available.

### Needs only competitor prices and product attributes — AVAILABLE NOW

| Method | Status here |
|---|---|
| **Competitive pricing** — position against rivals' observed prices | **In use.** The anchor is the product's own market reconciled with its 90-day normal; the comparable set is tiered and evidence-weighted. |
| **Price positioning** — where in the band to sit | **In use.** Three strategies (Fast Sale / Balanced / Premium) bounded by floor, ceiling and confidence-scaled travel. |
| **Rule-based pricing** — explicit business constraints | **In use.** MRP ceiling, break-even floor, market floor, psychological snapping. |
| **Historical price models** — normal level, volatility, position | **In use.** 90-day normal with a 60-day fallback, percentile position, distortion state. |
| **Hedonic regression** — price as a function of attributes | **In use.** OLS of log(price) on standardised pricing-relevant attributes across comparables. See §5, where it is measured for the first time. |
| **Promotion-aware pricing** — is the observed market a sale? | **In use.** Availability classes separate a universal discount from a bank offer; an evidence check fails when more than a third of compared prices are promotion-driven. |
| **Constrained optimisation** — pick a price inside hard bounds | **In use**, in its degenerate but honest form: the bounds are real and enforced, and the objective is a documented blend rather than a fitted utility. A true optimiser needs a demand curve (below). |
| **Regularized regression / elastic net** | **Implemented as `hedonic-cv-v2`.** Same features, ridge penalty selected by exact leave-one-out cross-validation. §5. |

### Needs a quantity sold at a price — REQUIRES REAL PRODUCTION DATA

| Method | What is missing |
|---|---|
| **Statistical demand modelling** | Units, sessions, or conversions. Absent. |
| **Price elasticity** | Δquantity / Δprice. The dataset has abundant Δprice and **no quantity at all**. |
| **True willingness-to-pay** | Observed accept/reject decisions at a price. Absent. Note that the shipped "WTP" component does *not* claim this — see §4. |
| **Inventory-aware pricing** | Stock levels and sell-through rate. Only a boolean `is_in_stock` exists. |
| **Dynamic pricing** | A demand response to react to, plus a repricing loop. Neither. |
| **Competitor response modelling** | Requires observing rivals reacting to *our* price changes. This dataset is read-only observation; we have never set a price in it. |
| **Gradient-boosted trees / random forest** | Not missing data so much as missing *rows* — see §3. |

The search that informed the demand-side entries is cited at the end. The
elasticity literature is blunt about it: estimation "requires not only
sufficient price variation but also unconfounded variation", and elasticity for
an item with *k* distinct recent prices is estimated from only *k* points. This
dataset has the price variation (median 28 distinct prices per product) and
none of the quantity.

---

## 3. What the data actually is

```
observations              354,940
capture dates             151 consecutive days, 2026-03-17 → 2026-08-14
products                  1,172        product types   125
largest product type      32 products  median type     8 products
distinct prices/product   min 7, median 28, max 294
demand / conversion / units / orders fields found        0
review snapshots          9,962 across 1,156 products (2+ snapshots each)
```

Three consequences decide the rest of this document.

**A price model is only comparable within a product type.** A lipstick and a
laptop share no attribute worth regressing on, so the sample for a
price-on-attributes model is the product type's size — a median of **8** and a
maximum of **32** — not 1,172. Gradient boosting on 32 rows with five features
does not learn a market; it memorises one.

**Review growth is the only demand-shaped signal, and it is not scalable to
units.** 1,156 products have two or more review snapshots, so a review velocity
is measurable. But the ratio of reviews to purchases is unknown and varies by
category and marketplace, so velocity cannot be converted into quantity. It is
already used where it is honest — as a trust and momentum signal — and it is
not used as demand.

**A market-price model is nearly circular.** The recommendation's strongest
input is the competitive median of the same effective price a model would be
trained to predict. Feed competitor prices in to predict a competitor price and
the model returns its input with extra steps, while validation reports it as
skill. Excluding the leaking features — own current price, competitive median,
competitive spread, historical median — leaves attributes, brand tier and
rating. That model already exists.

---

### One residual circularity, stated rather than hidden

The attribute model is never handed the target's own price — its input carries
specifications, brand tier and rating, and no price for the product being
priced. But the target's price does reach it by one indirect route: Phase 5
admits a **direct** competitor only inside the 0.6×–1.7× band a buyer
cross-shops within, and that band is measured around the target's current
price. Moving the target's price therefore changes which products are
comparable at all, and so changes the prediction.

That band is a deliberate product decision — a ₹400 lipstick and a ₹4,000 one
are not alternatives to the same buyer — and removing it would make the
comparable set worse, not more honest. It is recorded here because it means the
prediction is not strictly independent of the target's price, and anyone
reasoning about the model's independence should know by which door the
dependence enters. The invariant that *is* enforced (ML-03) is the exact one:
the prediction may change only if the comparable set changed; with the same
comparables, the same number must come back.

## 4. The target variable question (Part 12)

Candidate targets, and what each would actually mean:

| Target | Available | What a model of it predicts |
|---|---|---|
| Observed selling price | yes, 354,940 rows | what sellers **ask** |
| Effective price (landed − universal discount) | yes, derived | what sellers ask, net of live discounts |
| Relative price position | yes, derived | where in the band a seller chose to sit |
| Price actually paid | **no** | — |
| Price a buyer would accept | **no** | — |
| Optimal price | **no** | — |

**The chosen target is log(effective price), and it is labelled a market-value
estimate, never an optimal price.** 12.3% of observations are on a live
universal promotion, so even the effective price is partly a sale price; that
is why the promotion-visibility check exists and caps confidence rather than
being silently absorbed.

This is why the shipped component is a *market-value* signal that may move the
Balanced strategy by at most 25% of the anchor, damped by the evidence level,
and only when its own fit clears a gate. It is named `hedonic-wtp` in the
response and the accompanying `interpretation` field says
`association_not_causation`. The model observes that the market prices certain
attributes higher; it does not establish that those attributes cause the price,
and nothing downstream may say that they do.

---

## 5. Measuring the model that was already shipped (Parts 13–14)

Nobody had ever measured it. The hedonic model is a genuine held-out
prediction — it is fitted on a product's comparables and never sees the
product's own price — so its error against that known price is real
generalisation error, available for all **825** products with 5+ comparables.

Three models on the same task:

- **NAIVE** — predict the evidence-weighted median of the comparables. No
  attributes, no fitting. The control that any attribute model must beat to
  justify existing.
- **BASELINE** — the shipped hedonic OLS, trusted when in-sample adjusted
  R² ≥ 0.5.
- **CANDIDATE** — identical features, ridge penalty chosen by exact
  leave-one-out cross-validation, trusted on **LOOCV R² ≥ 0.5**.

### Cross-sectional — comparables and target both priced on the reference date

| Model | coverage | MAE | RMSE | MAPE | median APE | R²(log) |
|---|---|---|---|---|---|---|
| NAIVE weighted median | 825 (100%) | ₹1,015 | ₹3,212 | 16.9% | 15.1% | 0.982 |
| BASELINE hedonic OLS | 477 (58%) | ₹1,108 | ₹2,929 | 17.2% | **13.0%** | 0.976 |
| CANDIDATE ridge+LOOCV | 251 (30%) | ₹1,016 | **₹2,436** | **14.9%** | **12.3%** | 0.983 |

### Head to head — only the 251 products both attribute models will answer

| Model | MAE | RMSE | MAPE | median APE | R²(log) |
|---|---|---|---|---|---|
| BASELINE | ₹1,068 | ₹2,529 | 15.8% | 12.5% | 0.981 |
| CANDIDATE | ₹1,016 | ₹2,436 | 14.9% | 12.3% | 0.983 |

### The decisive test — the 226 fits only the baseline trusts

These cleared in-sample adjusted R² ≥ 0.5 and failed cross-validation.

| Model, on these 226 products | MAE | RMSE | MAPE | median APE | R²(log) |
|---|---|---|---|---|---|
| BASELINE | ₹1,153 | ₹3,318 | **18.7%** | 13.2% | 0.970 |
| NAIVE, same products | ₹1,007 | ₹2,572 | 17.8% | 15.4% | 0.979 |
| BASELINE, on the 251 it shares with the candidate | ₹1,068 | ₹2,529 | 15.8% | 12.5% | 0.981 |

**On those 226 products the attribute model predicts worse than copying the
competitive median** — 18.7% MAPE against 17.8%, and RMSE 29% higher. It is
also much worse than its own performance on the fits that survive validation
(18.7% against 15.8%).

226 of 477, or **47%**, of currently-trusted attribute models are claiming an
evidenced premium on a fit with no demonstrable out-of-sample skill. The
in-sample adjusted R² gate is too loose at these sample sizes, which is exactly
what adjusted R² is known to do when *n* is 5–32 and features are selected by
correlation with the target on the same data.

### Forward validation — comparables priced 2026-06-30, target priced 2026-08-14

45 days apart, so no model can be reading a contemporaneous market back to us.

| Model | coverage | MAE | RMSE | MAPE | median APE | R²(log) |
|---|---|---|---|---|---|---|
| NAIVE weighted median | 823 | ₹982 | ₹2,979 | 17.5% | 15.3% | 0.983 |
| BASELINE hedonic OLS | 464 | ₹1,261 | ₹3,765 | 18.3% | 13.1% | 0.975 |
| CANDIDATE ridge+LOOCV | 259 | ₹1,111 | ₹2,587 | 15.5% | 12.2% | 0.983 |

Degradation from cross-sectional to forward, by RMSE: naive −7% (it improves
slightly), **baseline +29%**, candidate +6%. The unregularised model loses the
most when its comparables' prices are 45 days stale; the cross-validated one
barely moves. Training and test windows are documented in the script and are
split strictly by date, so no later observation informs an earlier prediction.

### Reading these numbers honestly

**R²(log) near 0.98 for every model, including the naive one, is not skill.**
Catalogue prices span ₹79 to ₹45,000, so explaining the variance of log price
across product types is close to free. MAPE and RMSE are the metrics that
discriminate here, and R²(log) is reported only so it cannot be quoted out of
context later.

**The naive competitive median is a strong model.** At 16.9% MAPE with 100%
coverage it beats the shipped attribute model on MAPE, RMSE and R². The
attribute model's genuine advantage is median APE (13.0% against 15.1%): it is
better on the typical product and worse in the tails. This is the correct
reason to keep it as a bounded adjustment to a market-based anchor rather than
as the anchor itself — which is what the engine already does.

---

## 6. The decision

**Not built, and deliberately:**

- Any model of demand, elasticity, conversion or true willingness-to-pay. The
  data for it does not exist, and a model of an absent target is a fabrication
  however good its validation score looks.
- Gradient-boosted trees, random forests, or any higher-capacity tabular
  learner. Within-type samples of 8–32 rows, and a naive median already at
  16.9% MAPE, leave no headroom that is not noise.
- An LLM anywhere in the price path. A language model asked for a price cannot
  be audited, cannot be falsified, and cannot refuse for a stated reason.
- "Optimal price" as a label for anything. Nothing here is optimal; these are
  market-value estimates under stated constraints.

**Built:**

`hedonic-cv-v2` — the same features and the same target as `baseline-v1`, with
the ridge penalty chosen by exact leave-one-out cross-validation and the trust
gate moved from in-sample adjusted R² to out-of-sample LOOCV R². Exact LOOCV is
not an optimisation here, it is what makes validation possible at all: at *n* =
8, splitting into folds leaves nothing to fit on, whereas the closed form
`eᵢ / (1 − hᵢᵢ)` gives every fold from a single fit.

**`baseline-v1` remains the default.** Two reasons, and neither is timidity.
Phase 6's stated purpose is to move the validated engine without changing what
it computes, and parity with the frontend is asserted by 77 tests. Separately,
promoting v2 is a product decision with a visible consequence: the share of
products receiving an evidenced attribute premium falls from 58% to 30%. That
is the *correct* number — the other 28 points were not evidence — but it should
be chosen knowingly rather than arriving as a silent regression in someone's
dashboard.

v2 is selectable per request, reports its own `loocvR2`, `lambda` and
`foldCount`, and falls back to the baseline's behaviour of claiming nothing
when it cannot validate. The version that produced any given price is always
stated in the response.

### Switching models cannot strand a product

Run over the whole catalogue, both versions return **1,043 recommended and 129
refused**, with the refusals splitting 111 `insufficient_comparables` / 18
`no_current_price` and zero MRP, floor, ceiling, ordering or
unevidenced-premium violations. That is not a coincidence: the attribute model
sizes an evidenced premium and never decides whether a product can be priced.
The 58% → 30% figure is the share of products receiving a *premium*, not the
share receiving a *price*.

```bash
cd server && npx tsx src/scripts/recommendation-baseline.ts --model hedonic-cv-v2
```

---

## 7. Explainability (Part 16)

Structured factors, never generated prose. Each carries a direction, an
impact in minor units where one exists, and the evidence behind it:

```
competitive_position · historical_position · attribute_value · evidence_level
```

The `attribute_value` factor reports `modelTrusted`, `adjR2` (or `loocvR2` for
v2), `n`, `predictedMinor` and `interpretation: "association_not_causation"`.
When the model is untrusted its direction is `neutral` and its impact is zero,
and the Premium strategy carries a `no_evidenced_premium` driver rather than a
silent absence. The interface turns factors into sentences; a sentence cannot
be checked against the data and a factor can.

---

## Sources

- [Hedonic pricing method: definition, formula, and examples — Competera](https://competera.ai/resources/glossary/hedonic-pricing)
- [Machine Learning, Deep Learning, and Hedonic Methods for Real Estate Price Prediction](https://arxiv.org/pdf/2110.07151)
- [Hedonic Prices and Quality Adjusted Price Indices Powered by AI](https://arxiv.org/pdf/2305.00044)
- [ACT, WAIT, or EXPERIMENT: A Causal Governance Framework for Retail Price Optimization Under Abstentions](https://arxiv.org/pdf/2609.10615)
- [Scalable Nonparametric Price Elasticity Estimation — UT Dallas](https://bpb-us-e2.wpmucdn.com/sites.utdallas.edu/dist/8/1090/files/2023/02/scalable_nonparametric_price_elasticity_estimation.pdf)
- [Price Elasticity: Estimate It From Sales Data (+ Pitfalls)](https://mcpanalytics.ai/articles/price-elasticity-practical-guide-for-data-driven-decisions)
- [Understanding price elasticity in retail — RELEX Solutions](https://www.relexsolutions.com/resources/price-elasticity/)
