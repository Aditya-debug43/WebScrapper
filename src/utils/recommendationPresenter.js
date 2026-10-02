import { formatMinor } from "./money";

/**
 * BACKEND RECOMMENDATION → WHAT THE SCREEN RENDERS
 * ================================================
 *
 * Phase 7 made the backend the source of truth for the recommendation. The
 * backend returns NUMBERS and structured facts and deliberately composes no
 * prose: a sentence cannot be checked against the database and a figure can.
 * This module is the other half of that bargain — it turns those figures into
 * the sentences `RecommendationPanel` already renders.
 *
 * ── What this is NOT ───────────────────────────────────────────────────
 * It is not a pricing engine and must never become one. It performs no
 * regression, derives no price, reconstructs no floor or ceiling, and decides
 * nothing. Every number it prints arrived in the response; the only arithmetic
 * here is formatting and the occasional ratio used INSIDE a sentence that the
 * reader can see the inputs for.
 *
 * If a sentence needs a figure the backend does not send, the fix is to send
 * it — not to compute it here. Two places deciding a price is the exact
 * failure this phase removed.
 *
 * The wording is carried over verbatim from the engine that used to run in the
 * browser, because Phase 7 was explicitly not a redesign: the same numbers
 * must read the same way. `tests/recommendation-presenter.test.js` asserts
 * that against the engine's own output.
 */

/** Unsigned — the distortion notes, where the direction is in the sentence. */
const pctOf = (v) => `${(v * 100).toFixed(1)}%`;
/** Signed — the sanity checks, where the direction IS the information. */
const signedPct = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------- competitors */

/** The panel reads a nested `product`/`brand`; the API sends a flat row. */
function toPanelComp(member) {
  return {
    product: { id: member.productId, canonicalName: member.canonicalName },
    brand: member.brandName == null && member.brandTier == null ? null : { id: member.brandId, name: member.brandName, tier: member.brandTier },
    currentPriceMinor: member.priceMinor,
    rating: member.rating,
    reviewCount: member.reviewCount,
    similarity: member.similarity,
    evidenceWeight: member.evidenceWeight,
    tier: member.tier,
    tierReason: member.tierReason,
    quality: { notes: member.qualityNotes ?? [] },
    familyAlternates: member.familyAlternates ?? [],
    marketplaceIds: member.marketplaceIds ?? [],
  };
}

/**
 * Why a candidate was refused, with the figures that decided it.
 *
 * The screen shows these in a "Why excluded" column, and a bare code is of no
 * use to a reader asking why a plausible-looking product is not a benchmark.
 * `names` maps marketplace ids to names, taken from the response's own
 * marketplace list.
 */
function exclusionReason(member, names) {
  const e = member.exclusion;
  if (!e) return member.reason;
  const label = (ids) => (ids ?? []).map((id) => names.get(id) ?? id).join(", ") || "none";

  if (e.code === "no_shared_marketplace") {
    return `sold on ${label(e.marketplaceIds)} — no marketplace in common with this product (${label(e.targetMarketplaceIds)}), so no buyer chooses between the two`;
  }
  if (e.code === "above_mrp") {
    return `priced at ${formatMinor(e.priceMinor)}, above this product's applicable MRP of ${formatMinor(e.mrpMinor)} — it cannot be matched on price, so it is not a usable benchmark`;
  }
  if (e.code === "same_model_family") {
    return `another variant of the same model (${e.keptCanonicalName}) is already in the set — one slot per model family, so variants cannot each count as a separate competitor`;
  }
  return member.reason;
}

/* ---------------------------------------------------------------- coverage */

function coverageSummary(coverage) {
  const effective = coverage.effectiveComparables.toFixed(1);
  const comparables = plural(coverage.comparableCount, "comparable product", "comparable products");
  return coverage.meetsTarget
    ? `${coverage.directCount} direct competitors and ${comparables}, worth ${effective} effective comparables after weighting for relevance and data quality.`
    : `${plural(coverage.directCount, "direct competitor", "direct competitors")} and ${comparables} against a target of ${coverage.target}, worth ${effective} effective comparables.`;
}

/**
 * Why the target was missed, as a diagnosis rather than "because the database
 * said so". Composed from the backend's structured `shortfallReasons`, whose
 * counts have to add up to the candidates that did not qualify — which is why
 * reference-tier and demoted members are both named.
 */
function coverageShortfall(coverage, method) {
  if (coverage.meetsTarget) return null;
  const reasons = Object.fromEntries((coverage.shortfallReasons ?? []).map((r) => [r.reason, r.count]));
  const evaluated = method?.candidatePool ?? coverage.totalCount;

  if (reasons.product_type_too_small != null && evaluated < coverage.target) {
    return `Only ${plural(evaluated, "other product of this type is", "other products of this type are")} tracked at all, so ${coverage.target} direct competitors do not exist in the captured market yet. Capturing more of this product type is the fix — not loosening the screening.`;
  }

  const parts = [];
  if (reasons.no_shared_marketplace) {
    parts.push(plural(reasons.no_shared_marketplace, "is sold on no shared marketplace", "are sold on no shared marketplace"));
  }
  if (reasons.same_model_family) {
    parts.push(plural(reasons.same_model_family, "is another variant of this same model", "are other variants of this same model"));
  }
  if (reasons.above_mrp) {
    parts.push(plural(reasons.above_mrp, "is priced above this product's MRP", "are priced above this product's MRP"));
  }
  if (reasons.other) parts.push(plural(reasons.other, "was screened out", "were screened out"));
  if (reasons.too_far_on_price_or_spec) {
    parts.push(
      plural(
        reasons.too_far_on_price_or_spec,
        "is too far from this product on price or specification",
        "are too far from this product on price or specification"
      )
    );
  }
  if (reasons.informs_without_contesting) {
    parts.push(
      plural(
        reasons.informs_without_contesting,
        "informs the price without contesting the same purchase",
        "inform the price without contesting the same purchase"
      )
    );
  }

  const qualify = `${coverage.directCount} qualif${coverage.directCount === 1 ? "ies" : "y"} as a direct competitor`;
  return `${plural(evaluated, "product", "products")} of this type ${evaluated === 1 ? "was" : "were"} evaluated and ${qualify}. Of the rest, ${parts.join("; ")}. None is added to reach ${coverage.target}, because a padded set would report evidence that is not there.`;
}

/**
 * Diversity is DESCRIBED, never engineered. Five near-identical products are
 * weaker evidence than five across brands and platforms, and these notes say
 * so where it applies.
 */
function diversityNotes(diversity, memberCount) {
  if (!diversity) return [];
  const notes = [];
  if (diversity.brandCount === 1) {
    notes.push("every competitor is the same brand, so this measures one brand's pricing rather than the market's");
  }
  if (diversity.marketplaceCount === 1) {
    notes.push("all competitors sit on a single marketplace, so cross-platform pricing differences are invisible");
  }
  if (diversity.priceSpreadPct != null && diversity.priceSpreadPct < 8 && memberCount >= 3) {
    notes.push("competitors are tightly clustered in price, which is a commoditised market rather than a thin one");
  }
  return notes;
}

/* ---------------------------------------------------------------- evidence */

/** The ten evidence checks, each turned back into the sentence it describes. */
function evidenceCheckDetail(check) {
  const d = check.detail ?? {};
  switch (check.key) {
    case "competitor_breadth":
      return check.ok
        ? `${d.directCount} direct competitors compared, meeting the ${d.target}-competitor target`
        : `${plural(d.directCount, "direct competitor", "direct competitors")} against a target of ${d.target}${
            d.comparableCount ? `, plus ${plural(d.comparableCount, "weaker comparable", "weaker comparables")}` : ""
          }`;
    case "evidence_depth":
      return `${d.effectiveComparables?.toFixed(1)} effective comparables from ${plural(d.from, "product", "products")}, after weighting each by relevance and data quality`;
    case "coherence":
      return d.dispersion != null ? `interquartile spread is ${(d.dispersion * 100).toFixed(0)}% of the median` : "not measurable";
    case "history":
      return d.observationCount ? `${d.observationCount} daily observations` : "no history captured";
    case "competition":
      return `${d.inStockOfferCount} in-stock offer(s) observed`;
    case "cost":
      return d.entered ? "entered by seller" : "not entered — margin and break-even unavailable";
    case "fees":
      return d.usesDefaultRate
        ? "using marketplace default rates, not confirmed category rates"
        : "category-specific rates available";
    case "mrp":
      if (d.mrpMinor == null) return "no MRP observed";
      return d.reliability === "inflated" ? "MRP appears inflated relative to market" : "MRP observed and plausible";
    case "match_quality":
      if (d.minConfidence == null) return "no match confidence recorded on this product's listings";
      return d.minConfidence < d.floor
        ? `${d.autoMatched} of ${plural(d.total, "listing", "listings")} auto-matched, lowest confidence ${(d.minConfidence * 100).toFixed(0)}% — below the ${d.floor * 100}% needed to treat every offer as certainly this product's`
        : `all ${plural(d.total, "listing", "listings")} matched at ${(d.minConfidence * 100).toFixed(0)}%+ confidence (${d.autoMatched} auto-matched)`;
    case "promotion_visibility":
      if (!d.total) return "no prices available to check";
      return d.promoDriven === 0
        ? `none of the ${d.total} compared prices is currently cut by an instant discount`
        : `${d.promoDriven} of ${d.total} compared prices (${Math.round(d.share * 100)}%) are currently cut by a live instant discount, so the observed market is partly a sale`;
    default:
      return "";
  }
}

/* ----------------------------------------------------------- sanity checks */

/** Each pre-display check, restated with the figures that decided it. */
function sanityCheckDetail(check) {
  const m = check.metrics ?? {};
  if (check.key.startsWith("deviation_")) {
    return `${signedPct(m.deviation)} from the ${m.anchorBasis} anchor of ${formatMinor(m.anchorMinor)} — unusually far; verify the comparable set before acting on it.`;
  }
  switch (check.key) {
    case "mrp":
      return m.mrpMinor != null ? `ceiling ${formatMinor(m.mrpMinor)}` : "no MRP observed";
    case "floor":
      return `floor ${formatMinor(m.floorMinor)}`;
    case "ordered":
      return "Fast ≤ Balanced ≤ Premium";
    case "premium_evidence":
      return m.supported ? "attribute model supports a premium" : `no evidenced premium — Premium held at the top of the ${m.basis}`;
    case "premium_vs_own_market":
      return m.evidenced
        ? `dearest strategy ${formatMinor(m.dearestMinor)} against an evidenced limit of ${formatMinor(m.limitMinor)} (+${Math.round(m.capPct * 100)}% over the own-market median of ${formatMinor(m.ownMedianMinor)}); ${signedPct(m.overOwnMedianPct)} from that median`
        : `dearest strategy ${formatMinor(m.dearestMinor)} against a limit of ${formatMinor(m.limitMinor)} — the top of this product's own observed range, because no attribute premium is evidenced; ${signedPct(m.overOwnMedianPct)} from the own-market median`;
    case "market_distortion":
      return m.state === "normal" ? "current market within 10% of its 90-day normal" : `market currently ${m.state}`;
    case "viability":
      return m.known ? (m.conflict ? "market mid is below break-even" : "break-even sits below market mid") : "seller cost unknown";
    default:
      return "";
  }
}

/* --------------------------------------------------------------- the pieces */

function presentDistortion(distortion, ownMedianMinor, normalMinor) {
  if (!distortion) return null;
  if (distortion.state === "depressed") {
    return {
      ...distortion,
      note: `The product's current market (${formatMinor(ownMedianMinor)}) sits ${pctOf(1 - distortion.ratio)} below its 90-day normal of ${formatMinor(normalMinor)} — the market looks promotionally depressed, so the recommendation leans toward the normal level rather than chasing the dip.`,
    };
  }
  if (distortion.state === "elevated") {
    return {
      ...distortion,
      note: `The current market (${formatMinor(ownMedianMinor)}) sits ${pctOf(distortion.ratio - 1)} above its 90-day normal of ${formatMinor(normalMinor)} — treat the present level as temporarily elevated.`,
    };
  }
  return { ...distortion, note: null };
}

function presentAnchor(anchor, ownMarket, compMedianMinor, normalMinor) {
  if (ownMarket && ownMarket.n >= 2) {
    return {
      ...anchor,
      detail: `${ownMarket.n} in-stock offers for this exact product spanning ${formatMinor(ownMarket.min)}–${formatMinor(ownMarket.max)} (median ${formatMinor(ownMarket.median)}), reconciled with its 90-day normal of ${formatMinor(normalMinor)}.`,
    };
  }
  if (ownMarket && ownMarket.n === 1) {
    /**
     * Whether the blend was held inside the 10% band is visible from the
     * numbers the backend sent: the anchor would otherwise be the raw 75/25
     * blend. Stated, not recomputed as a decision.
     */
    const blended = Math.round(0.75 * ownMarket.median + 0.25 * compMedianMinor);
    const pulled = anchor.minor !== blended;
    return {
      ...anchor,
      detail: `Only one in-stock offer for this product (${formatMinor(ownMarket.median)}). It leads the anchor at 75%, with the comparable median of ${formatMinor(compMedianMinor)} contributing the rest${pulled ? ", held within 10% of the product's own listed price" : ""}.`,
    };
  }
  return {
    ...anchor,
    detail: `No in-stock offer for this product, so the comparable median of ${formatMinor(compMedianMinor)} is the only available anchor.`,
  };
}

/** The attribute model's verdict, in the model's own terms. */
function wtpVerdict(wtp) {
  if (!wtp.trusted || wtp.predictedMinor == null) return wtp.reason;
  const fit = wtp.loocvR2 != null ? `held-out R² ${wtp.loocvR2}` : `adjusted R² ${wtp.adjR2}`;
  return wtp.supported
    ? `The attribute model fits well (${fit}) and values this product's attribute profile at ${formatMinor(wtp.predictedMinor)}, ${formatMinor(wtp.evidencedPremiumMinor)} above the comparable median — that premium is evidenced, not assumed.`
    : `The attribute model fits well (${fit}) but values this product at ${formatMinor(wtp.predictedMinor)}, at or below the comparable median. The market does not pay more for this product's attribute profile.`;
}

function presentConstraintRationale(constraint, mrpReliability) {
  if (constraint.key === "mrp_ceiling") {
    if (constraint.boundMinor == null) return "No MRP was observed for this product, so no MRP ceiling could be applied.";
    const inflated =
      mrpReliability === "inflated"
        ? " Note the MRP looks inflated relative to the market, so it is a weak guide to what buyers will pay even though it still caps the price."
        : "";
    return `A product may not be sold above its printed MRP of ${formatMinor(constraint.boundMinor)}. This is a legal ceiling, not a pricing preference.${inflated}`;
  }
  if (constraint.key === "break_even_floor") {
    return constraint.boundMinor != null
      ? `Below ${formatMinor(constraint.boundMinor)} the product loses money once marketplace fees and GST are deducted, so no strategy may go there.`
      : "No seller cost entered, so no break-even floor could be computed — the floor falls back to the market.";
  }
  return "";
}

function presentStrategies(d) {
  const { strategies, anchor, wtp, marketContext, constraints, evidence, premiumCeiling, commercial, policy } = d;
  const zones = marketContext.zones;
  const ownMarket = marketContext.ownMarket;
  const breakEvenFloor = constraints.hard.find((c) => c.key === "break_even_floor")?.boundMinor ?? null;
  const verdict = wtpVerdict(wtp);
  const travel = constraints.travel;
  const premiumSupported = wtp.supported === true;
  const anchorPresented = presentAnchor(anchor, ownMarket, d.competitorContext.statistics?.median, marketContext.normalMinor);

  return strategies.map((s) => {
    const common = { ...s, position: s.position, margins: s.margins };
    if (s.key === "fast_sale") {
      return {
        ...common,
        tagline: "Win on price",
        objective: "Maximise sales velocity and win the featured position",
        anchor: "a 1.5% undercut of the cheapest price in the competitive pool",
        bestWhen: [
          "Sales velocity matters more than unit margin",
          "You are entering the category with no review base yet",
          "A cheaper rival is taking the featured position",
        ],
        rationale: [
          ownMarket
            ? `The cheapest seller of this exact product is at ${formatMinor(ownMarket.min)}; this sits just under them, without chasing cheaper substitutes out of the product's own market.`
            : `The cheapest price in the competitive pool is ${formatMinor(zones.floorZoneMinor)}; this sits just under it.`,
          breakEvenFloor
            ? `Held at or above the break-even floor of ${formatMinor(breakEvenFloor)}, so it competes without losing money.`
            : "No cost was entered, so this is bounded by the market rather than by your economics — enter a cost to make it margin-safe.",
        ],
      };
    }

    if (s.key === "balanced") {
      const premium = wtp.evidencedPremiumMinor ?? 0;
      return {
        ...common,
        tagline: "Match the market, adjusted for strength",
        objective: "Best trade-off between competitiveness and margin",
        anchor: `the ${anchor.basis} anchor of ${formatMinor(anchor.minor)}${
          premium !== 0 ? ", adjusted by the evidenced attribute premium" : ", with no attribute premium claimed"
        }`,
        bestWhen: [
          "You want a defensible everyday price",
          "You are pricing in line with what this product actually commands",
          "You are not trying to buy share or harvest margin",
        ],
        rationale: [
          anchorPresented.detail,
          premium !== 0
            ? `The attribute model supports ${formatMinor(premium)} of difference against comparables; ${Math.round(travel * 60)}% of it is applied, damped by ${evidence.level} evidence.`
            : `No attribute premium is applied: ${verdict}`,
          presentDistortion(marketContext.distortion, ownMarket?.median, marketContext.normalMinor)?.note ??
            "The current market is within 10% of its 90-day normal, so the anchor is taken at face value.",
        ],
      };
    }

    const basis = premiumCeiling?.basis ?? "observed range";
    const baseMinor = premiumCeiling?.baseMinor;
    return {
      ...common,
      tagline: "Maximise margin",
      objective: "Maximise margin per unit where the market demonstrably pays for it",
      anchor: premiumSupported
        ? `the top of this product's ${basis} (${formatMinor(baseMinor)}), extended by the evidenced attribute premium`
        : `the top of this product's ${basis} (${formatMinor(baseMinor)}) — no evidenced premium to extend it with`,
      warning: premiumSupported
        ? null
        : `Premium positioning is not supported by the available evidence. ${verdict} This price therefore sits at the top of ${
            ownMarket ? "this product's own observed selling range" : "the observed competitive band"
          } rather than above it.`,
      bestWhen: premiumSupported
        ? [
            "The evidenced attribute premium holds and competition stays thin",
            "Rivals are out of stock or slow to react",
            "Margin per unit matters more than volume",
          ]
        : [
            "Competition on your listing thins out or rivals go out of stock",
            "You are testing the ceiling of the current band, not setting a standing price",
            "You accept slower velocity for a small margin gain",
          ],
      rationale: [
        ownMarket
          ? `Anchored to the dearest price this exact product currently achieves (${formatMinor(ownMarket.max)}) across ${plural(ownMarket.n, "in-stock offer", "in-stock offers")} — not to what rival products cost.`
          : `This product has no in-stock offer of its own, so the top of the comparable band (${formatMinor(zones.competitiveHighMinor)}) is the only available reference, capped at ${Math.round(policy.maxUnevidencedPremiumOverAnchor * 100)}% above the anchor.`,
        premiumCeiling?.poolQ3Suppressed
          ? `The 75th percentile of the wider pool is ${formatMinor(zones.competitiveHighMinor)}, above that. It is deliberately NOT used as the ceiling: dearer substitutes describe what other products cost, not what this one can be sold for.`
          : null,
        verdict,
        premiumSupported && premiumCeiling?.capMinor != null && s.rawPriceMinor >= premiumCeiling.capMinor
          ? `Capped at ${Math.round(policy.maxEvidencedPremiumOverOwn * 100)}% above this product's own market median of ${formatMinor(ownMarket?.median)} — the evidenced premium is real but bounded.`
          : null,
      ].filter(Boolean),
      margins: s.margins,
      commercialCost: commercial?.cost ?? null,
    };
  });
}

function presentBounds(d) {
  const { constraints, marketContext, competitorContext, wtp, evidence, historicalContext } = d;
  const zones = marketContext.zones;
  const stats = competitorContext.statistics;
  const ownMarket = marketContext.ownMarket;
  const breakEven = constraints.hard.find((c) => c.key === "break_even_floor");
  const mrp = constraints.hard.find((c) => c.key === "mrp_ceiling");
  const verdict = wtpVerdict(wtp);

  const lowerReasons = [];
  if (breakEven?.binding && breakEven.boundMinor != null) {
    lowerReasons.push(`Below ${formatMinor(breakEven.boundMinor)} the product is loss-making after marketplace fees and GST.`);
  }
  lowerReasons.push(
    `The cheapest price in the competitive pool is ${formatMinor(zones.floorZoneMinor)}; going materially under it gives away margin the market is not demanding.`
  );
  if (historicalContext && stats && historicalContext.minMinor < stats.min) {
    lowerReasons.push(
      `This product has traded as low as ${formatMinor(historicalContext.minMinor)}, but inside promotional windows rather than as a standing price.`
    );
  }

  const upperReasons = [];
  if (constraints.ceilingSource === "applicable MRP") {
    upperReasons.push(
      `${formatMinor(mrp?.boundMinor)} is the applicable MRP — the product cannot legally be sold above it, whatever the market statistics suggest.`
    );
  } else {
    upperReasons.push(`The dearest comparable is ${formatMinor(stats?.max)}; above that you leave the observed distribution entirely.`);
  }
  if (wtp.supported !== true) upperReasons.push(`No evidenced willingness to pay a premium: ${verdict}`);
  if (ownMarket && ownMarket.n >= 2) {
    upperReasons.push(
      `This exact product is already selling at ${formatMinor(ownMarket.min)}–${formatMinor(ownMarket.max)} across ${ownMarket.n} in-stock offers. Pricing far above its own observed market is the single hardest position to defend.`
    );
  }
  if (evidence.level === "low" || evidence.level === "medium") {
    upperReasons.push(`Evidence is ${evidence.level}, so the engine deliberately limits how far above the median it will recommend.`);
  }
  if (marketContext.competition.inStockOfferCount > 2) {
    upperReasons.push(
      `${marketContext.competition.inStockOfferCount} in-stock offers already compete here — a high price is easily undercut.`
    );
  }

  return {
    floorMinor: constraints.floorMinor,
    ceilingMinor: constraints.ceilingMinor,
    ceilingSource: constraints.ceilingSource,
    lowerReasons,
    upperReasons,
  };
}

/* ------------------------------------------------------------------ public */

/**
 * Present a backend recommendation payload for `RecommendationPanel`.
 *
 * Takes the whole envelope (`{ data, meta }`) so the model version travels
 * with the result rather than being fetched separately.
 */
export function presentRecommendation(payload) {
  const d = payload?.data;
  if (!d) throw new Error("No recommendation data in the response.");

  const competitorContext = d.competitorContext ?? {};
  const coverage = competitorContext.coverage ?? null;
  const method = competitorContext.method ?? null;
  const members = (competitorContext.members ?? []).map(toPanelComp);
  const marketplaceNames = new Map((d.marketplaces ?? []).map((m) => [m.id, m.name]));
  const excludedComps = (competitorContext.excluded ?? []).map((c) => ({
    ...toPanelComp(c),
    reason: exclusionReason(c, marketplaceNames),
  }));

  const shared = {
    modelVersion: payload.meta?.modelVersion ?? d.model?.version ?? null,
    // A refusal carries the price at the top level; a recommendation nests it
    // in the market context. Both are the same number.
    currentPriceMinor: d.marketContext?.currentPriceMinor ?? d.currentPriceMinor ?? null,
    comps: members,
    excludedComps,
    compMethod: method,
    competitiveSet: { reference: (competitorContext.reference ?? []).map(toPanelComp) },
    coverage: coverage && { ...coverage, summary: coverageSummary(coverage), shortfall: coverageShortfall(coverage, method) },
    diversity:
      competitorContext.diversity && { ...competitorContext.diversity, notes: diversityNotes(competitorContext.diversity, members.length) },
    strength: d.strength ?? null,
  };

  /* ---- refusal ---------------------------------------------------------- */

  if (d.status !== "recommended") {
    const missing = Object.fromEntries((d.missing ?? []).map((m) => [m.key, m.detail]));
    const conflict = d.constraintConflict === true;
    const breakEven = d.constraints?.hard?.find?.((c) => c.key === "break_even_floor")?.boundMinor ?? null;
    const mrpMinor = d.constraints?.hard?.find?.((c) => c.key === "mrp_ceiling")?.boundMinor ?? null;

    let reason;
    if (conflict) {
      reason =
        breakEven != null && mrpMinor != null && mrpMinor < breakEven
          ? `No valid price exists. Break-even is ${formatMinor(breakEven)} but the applicable MRP caps the price at ${formatMinor(mrpMinor)} — this product cannot be sold profitably on these marketplaces at its current cost and fee structure.`
          : `No valid price exists: the ceiling (${formatMinor(d.constraints?.ceilingMinor)}, set by ${d.constraints?.ceilingSource}) sits below the floor (${formatMinor(d.constraints?.floorMinor)}).`;
    } else if (d.reason === "no_current_price") {
      reason = "This product has no in-stock offer, so there is no current price to reason from.";
    } else {
      const n = missing.competitor_coverage?.totalCount ?? coverage?.totalCount ?? 0;
      reason = `Only ${plural(n, "comparable product", "comparable products")} could be established for this product, against a target of ${coverage?.target} and a working minimum of ${coverage?.minimum}. Below that the market cannot be described: a median is just the midpoint of two numbers and the spread is meaningless. Padding the set with weaker candidates would produce a number, not evidence.`;
    }

    const whatWouldHelp = conflict
      ? [
          "Reduce procurement cost, or negotiate a lower fee tier, to bring break-even under the MRP",
          "Verify the captured MRP — an incorrectly parsed MRP would produce this conflict spuriously",
        ]
      : [
          shared.coverage?.shortfall,
          "Capture more products of the same type, on the marketplaces this product is sold on",
          excludedComps.length
            ? `${plural(excludedComps.length, "candidate was", "candidates were")} screened out — see the exclusion list for why`
            : null,
          d.commercial?.cost ? null : "Enter a seller cost so break-even and margin can bound the range",
        ].filter(Boolean);

    return {
      ...shared,
      insufficientData: true,
      insufficientEvidence: true,
      constraintConflict: conflict,
      reason,
      whatWouldHelp,
      strategies: [],
      evidence: d.evidence ?? null,
    };
  }

  /* ---- a recommendation ------------------------------------------------- */

  const marketContext = d.marketContext;
  const stats = competitorContext.statistics;
  const mrpConstraint = d.constraints.hard.find((c) => c.key === "mrp_ceiling");
  const mrpReliability = mrpConstraint?.reliability?.state ?? "unknown";
  const distortion = presentDistortion(marketContext.distortion, marketContext.ownMarket?.median, marketContext.normalMinor);
  const strategies = presentStrategies(d);
  const distinct = new Set(strategies.map((s) => s.priceMinor)).size;

  return {
    ...shared,
    insufficientData: false,
    constraintConflict: false,

    stats,
    history: d.historicalContext && {
      ...d.historicalContext,
      /**
       * `trendPct` arrives as a percentage (its name says so) and the panel
       * formats it with `formatPct`, which expects a fraction. Converted here
       * rather than renaming a Phase 5 field the analysis screens also read.
       */
      trendPct: d.historicalContext.trendPct == null ? null : d.historicalContext.trendPct / 100,
    },
    competition: marketContext.competition,
    commercial: d.commercial,
    strategies,
    bounds: presentBounds(d),
    confidence: {
      level: d.evidence.level,
      reasons: d.evidence.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${evidenceCheckDetail(c)}`),
    },
    constraints: {
      hard: d.constraints.hard.map((c) => ({ ...c, rationale: presentConstraintRationale(c, mrpReliability) })),
      soft: [
        { key: "competitiveness", label: "Stay credible against the cheapest comparable", detail: `cheapest comparable is ${formatMinor(stats?.min)}` },
        { key: "evidence_spread", label: "Travel from the median only as far as evidence supports", detail: `evidence level: ${d.evidence.level}` },
        {
          key: "strength",
          label: "Move with demonstrated product strength",
          detail: `strength index ${d.strength?.index >= 0 ? "+" : ""}${d.strength?.index?.toFixed(2)}`,
        },
      ],
      floorMinor: d.constraints.floorMinor,
      ceilingMinor: d.constraints.ceilingMinor,
      ceilingSource: d.constraints.ceilingSource,
      travel: d.constraints.travel,
    },
    mrp: {
      mrpMinor: mrpConstraint?.boundMinor ?? null,
      reliability: mrpReliability,
      note:
        mrpReliability === "inflated" && mrpConstraint?.reliability?.ratioToMarket != null
          ? `MRP is ${mrpConstraint.reliability.ratioToMarket.toFixed(1)}× the going market price, which is typical of a headline MRP set for display. It still caps what may legally be charged, but it is not evidence that the market will bear a higher price.`
          : null,
    },
    evidence: { ...d.evidence, checks: d.evidence.checks.map((c) => ({ ...c, detail: evidenceCheckDetail(c) })) },
    currentPriceLayers: marketContext.currentPriceLayers,
    collapsed:
      distinct < 3
        ? `Constraints have collapsed ${3 - distinct + 1} strategies onto the same price. The gap between the floor (${formatMinor(d.constraints.floorMinor)}) and ceiling (${formatMinor(d.constraints.ceilingMinor)}) is too narrow for meaningfully different positions.`
        : null,
    anchor: presentAnchor(d.anchor, marketContext.ownMarket, stats?.median, marketContext.normalMinor),
    ownMarket: marketContext.ownMarket,
    normalMinor: marketContext.normalMinor,
    distortion,
    wtp: { ...d.wtp, verdict: wtpVerdict(d.wtp) },
    premiumCeiling: d.premiumCeiling,
    zones: marketContext.zones,
    viability: {
      ...d.viability,
      note: !d.viability.known
        ? "No seller cost entered, so viability against the market cannot be assessed. Prices shown are market-based only."
        : d.viability.conflict
          ? `The middle of the competitive market (${formatMinor(d.viability.marketMidMinor)}) is BELOW your break-even of ${formatMinor(d.viability.breakEvenMinor)}. Prices here are held up to stay viable, which means they sit above where the market is actually clearing — expect slower velocity, and treat cost reduction as the real lever.`
          : `Break-even (${formatMinor(d.viability.breakEvenMinor)}) sits below the middle of the competitive market (${formatMinor(d.viability.marketMidMinor)}), so market-competitive pricing is also viable.`,
    },
    sanityChecks: d.sanityChecks.map((c) => ({ key: c.key, label: c.label, passed: c.passed, detail: sanityCheckDetail(c) })),
  };
}
