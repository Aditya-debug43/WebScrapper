import { formatMinor } from "./money";

/**
 * BACKEND ANALYSIS → WHAT THE ANALYSIS SCREEN RENDERS
 * ===================================================
 *
 * Phase 8's counterpart to `recommendationPresenter`. The backend decides what
 * the findings ARE — their dimension, the direction they argue for, and the
 * figures behind them — and composes no prose. This turns those figures into
 * the sentences `CrossMarketplaceAnalysis` already renders.
 *
 * ── What this is NOT ───────────────────────────────────────────────────
 * It determines no finding, computes no price, and reaches no conclusion. If
 * a sentence needs a number the backend does not send, the fix is to send it.
 * Grouping findings the backend already directed, and formatting the figures
 * it already measured, is presentation; deciding that a product is ahead on
 * specifications is not, and does not happen here.
 *
 * The wording is carried over verbatim from the browser engine this replaces,
 * because Phase 8 was explicitly not a redesign. `tests/analysis-presenter.test.js`
 * asserts that against the engine's own output across eight products.
 */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const count = (n) => (n == null ? "—" : n.toLocaleString("en-IN"));

/* ------------------------------------------------------------ marketplaces */

/** Marketplace ids are what the API speaks; names are what a reader reads. */
function namer(marketplaceRows) {
  const names = new Map(marketplaceRows.map((r) => [r.marketplaceId, r.marketplaceName]));
  return (id) => names.get(id) ?? id;
}

/** The cheapest/dearest platforms, re-joined to the rows that name them. */
function withNames(mpAnalysis, rows) {
  if (!mpAnalysis) return null;
  const name = namer(rows);
  const row = (id) => rows.find((r) => r.marketplaceId === id) ?? null;
  const side = (key) => {
    const entry = mpAnalysis[key];
    if (!entry) return null;
    const source = row(entry.marketplaceId);
    return {
      ...entry,
      marketplaceName: name(entry.marketplaceId),
      rating: entry.rating ?? source?.rating ?? null,
      reviewCount: entry.reviewCount ?? source?.reviewCount ?? null,
    };
  };
  return { ...mpAnalysis, cheapest: side("cheapest"), dearest: side("dearest") };
}

/* ---------------------------------------------------------------- findings */

/**
 * One sentence and a list of evidence lines per finding, composed from the
 * metrics the backend measured. The `detail` and `evidence` wording is the
 * engine's, unchanged.
 */
function presentFinding(finding, context) {
  const m = finding.metrics ?? {};
  const e = finding.evidence ?? [];
  const name = context.name;
  const unit = context.unitBasis?.unit ?? "";

  switch (finding.id) {
    case "cheapest_is_best_trusted": {
      const [cheap, dear] = e;
      return {
        detail: `At ${formatMinor(m.cheapestEffectiveMinor)} it is ${m.spreadPct}% below ${name(m.dearestMarketplaceId)} (${formatMinor(m.dearestEffectiveMinor)}), yet carries the strongest review base — ${cheap?.rating}★ from ${count(cheap?.reviewCount)} reviews. The usual assumption that the cheapest platform is the weakest does not hold here, so a higher price cannot be justified on platform trust alone.`,
        evidence: [
          `${name(cheap?.marketplaceId)}: ${formatMinor(cheap?.effectiveMinor)}, ${cheap?.rating}★ / ${count(cheap?.reviewCount)}`,
          `${name(dear?.marketplaceId)}: ${formatMinor(dear?.effectiveMinor)}, ${dear?.rating}★ / ${count(dear?.reviewCount)}`,
        ],
      };
    }

    case "price_tracks_trust":
      return {
        detail: `Price rank and trust rank correlate at ${m.priceTrustCorrelation} across ${m.pricedCount} platforms, so the price gradient is at least partly buying audience quality rather than being pure margin.`,
        evidence: [`Spearman correlation of effective price vs trust-weighted rating: ${m.priceTrustCorrelation}`],
      };

    case "platform_spread":
      return {
        detail: `${formatMinor(e[0]?.effectiveMinor)} on ${name(m.cheapestMarketplaceId)} to ${formatMinor(e[1]?.effectiveMinor)} on ${name(m.dearestMarketplaceId)}. A single "market price" for this product does not exist — which platform you are pricing for is part of the question.`,
        evidence: [`Spread ${formatMinor(m.spreadMinor)} across ${context.pricedCount} priced platforms`],
      };

    case "shipping_reorders":
      return {
        headline: "Adding delivery reorders which platform is cheapest",
        detail: `${plural(m.platformsWithPaidShipping, "platform carries", "platforms carry")} offers that charge delivery, and the cheapest headline price is not the cheapest landed price. Comparisons on the displayed price alone rank these platforms incorrectly.`,
        evidence: ["Compared on landed price (item + delivery), not the displayed price"],
      };

    case "per_unit_reversal": {
      const first = e[0] ?? {};
      const label = context.competitorName(first.productId);
      return {
        headline: `${m.reversalCount} ${m.reversalCount === 1 ? "competitor looks" : "competitors look"} cheaper but ${m.reversalCount === 1 ? "costs" : "cost"} more per ${unit || "unit"}`,
        detail: `${label} is ${Math.abs(first.priceGapPct)}% below this product on headline price, but at ${first.unitValue}${unit} it works out ${first.unitGapPct}% dearer per ${unit || "unit"}. On a like-for-like basis this product is the better value, which is evidence the current price is defensible rather than high.`,
        evidence: [
          `This product: ${m.targetUnitValue}${unit} — ${formatMinor(m.ownUnitPriceMinor * 100)} per 100${unit}`,
          `${label}: ${first.unitValue}${unit} — ${formatMinor(first.unitPriceMinor * 100)} per 100${unit}`,
        ],
      };
    }

    case "vs_comp_median":
      return {
        headline: `Priced ${Math.abs(m.gapPct)}% ${m.gapPct > 0 ? "above" : "below"} the competitive median`,
        detail: `This product's own market sits at ${formatMinor(m.ownMedianMinor)} against a competitive median of ${formatMinor(m.compMedianMinor)}, computed across ${m.compCount} screened competitors weighted by how relevant each one is.`,
        evidence: [
          `Own market median ${formatMinor(m.ownMedianMinor)} across ${e[0]?.n} in-stock offers`,
          `Competitive median ${formatMinor(m.compMedianMinor)} (evidence-weighted, ${context.effectiveComparables} effective comparables)`,
        ],
      };

    case "trust_vs_comps":
      return {
        headline: `Customer trust is ${
          m.ratingDelta > 0 ? "ahead of" : m.ratingDelta < 0 ? "behind" : "level with"
        } the competitor set`,
        detail: `${m.targetRating}★ against a competitor median of ${m.medianRating}★, on ${count(m.targetReviews)} reviews versus a median of ${count(Math.round(m.medianReviews ?? 0))}. ${
          m.reviewBaseLarger
            ? "The larger review base makes that rating the more reliable of the two, which supports holding price."
            : "The review base is not larger than the field, so the rating advantage carries less weight than it appears to."
        }`,
        evidence: [
          `Rating ${m.targetRating}★ vs comp median ${m.medianRating}★`,
          `Reviews ${count(m.targetReviews)} vs comp median ${count(Math.round(m.medianReviews ?? 0))}`,
        ],
      };

    case "spec_position": {
      const ahead = e.filter((x) => x.side === "advantage");
      const behind = e.filter((x) => x.side === "disadvantage");
      return {
        headline:
          ahead.length && !behind.length
            ? `Ahead of the field on ${ahead.map((a) => a.label).join(", ")}`
            : behind.length && !ahead.length
              ? `Behind the field on ${behind.map((a) => a.label).join(", ")}`
              : "Mixed specification position",
        detail: `Measured against the competitor median on the ${context.pricingRelevantAttributeCount} pricing-relevant attributes this product type declares. ${
          ahead.length ? `Ahead on ${ahead.length}.` : ""
        } ${behind.length ? `Behind on ${behind.length}.` : ""}`.trim(),
        evidence: [
          ...ahead.map((a) => `${a.label}: ${a.mine}${a.unit ?? ""} vs comp median ${a.compMedian}${a.unit ?? ""} — ahead`),
          ...behind.map((a) => `${a.label}: ${a.mine}${a.unit ?? ""} vs comp median ${a.compMedian}${a.unit ?? ""} — behind`),
        ],
      };
    }

    case "historical_position": {
      const range = e.find((x) => x.measure === "observed_range") ?? {};
      const promo = e.find((x) => x.measure === "promotional_days") ?? {};
      const distorted = m.distortionState !== "normal";
      return {
        headline: distorted
          ? `The current market looks ${m.distortionState}`
          : m.percentile <= 20
            ? "The cheapest offer today is near the bottom of its own 90-day range"
            : m.percentile >= 80
              ? "The cheapest offer today is near the top of its own 90-day range"
              : "The cheapest offer today sits mid-range against its own history",
        detail: distorted
          ? context.distortionNote
          : `Across ${m.observationCount} observations from ${range.from}, the cheapest in-stock price has moved between ${formatMinor(m.minMinor)} and ${formatMinor(m.maxMinor)}. Today's ${formatMinor(m.currentMinor)} sits at the ${m.percentile}th percentile of that range — ${
              m.percentile <= 20
                ? "so the entry price is currently soft, which leaves room above it rather than arguing for a cut"
                : m.percentile >= 80
                  ? "so the entry price is already near its ceiling and there is little historical headroom"
                  : "a normal position with no strong signal either way"
            }. The series is ${m.volatilityBand} (${m.volatility}% coefficient of variation)${
              context.ownMedianMinor ? `, and the own-market median across all sellers is ${formatMinor(context.ownMedianMinor)}` : ""
            }.`,
        evidence: [
          `90-day normal ${formatMinor(context.normalMinor)}`,
          `Observed range ${formatMinor(m.minMinor)} – ${formatMinor(m.maxMinor)} over ${m.observationCount} points`,
          promo.days
            ? `${promo.days} observations fell inside a promotional window (${(promo.labels ?? []).join(", ")})`
            : "No promotional windows in the captured series",
        ],
      };
    }

    case "wtp":
      return {
        detail: context.wtpVerdict,
        evidence: m.trusted
          ? [
              `Fitted on ${m.n} comparables, adjusted R² ${m.adjR2}`,
              ...e.filter((x) => x.kind === "feature").map((f) => `${f.label}: ${f.targetValue}${f.unit ?? ""} vs comp mean ${f.compMean}${f.unit ?? ""}`),
            ]
          : [`Model abstained — ${m.reason}`],
      };

    case "availability":
      return {
        headline: `${plural(m.platformsWithStockGap, "platform has", "platforms have")} offers that are currently unavailable`,
        detail:
          "Out-of-stock offers are excluded from every price statistic on this page. An unbuyable price is not a competing price, and including it would understate the market.",
        evidence: ["Only in-stock offers contribute to the own-market and competitive figures"],
      };

    case "match_confidence":
      return {
        headline: `Weakest listing match is ${Math.round(m.lowestMatchConfidence * 100)}% confident`,
        detail:
          "Not every listing is human-confirmed as this exact product. Where confidence is lower, some of the offers treated as this product's may belong to a near neighbour — which is why this feeds the evidence score rather than being ignored.",
        evidence: [
          `Lowest listing match confidence across ${context.marketplaceCount} platforms: ${Math.round(m.lowestMatchConfidence * 100)}%`,
        ],
      };

    default:
      return { detail: "", evidence: [] };
  }
}

/* ------------------------------------------------------------------ public */

/**
 * Present the backend analysis for `CrossMarketplaceAnalysis`.
 *
 * Takes the three envelopes the screen's argument is assembled from. The
 * recommendation and the horizons are optional: a refused recommendation and
 * an unavailable price summary each degrade one section rather than the page.
 */
export function presentAnalysis({ analysis, recommendation, horizons }) {
  const d = analysis?.data;
  if (!d) throw new Error("No analysis data in the response.");

  const rec = recommendation?.data ?? null;
  const marketplaceRows = d.marketplaceRows ?? [];
  const name = namer(marketplaceRows);

  /**
   * A single-marketplace product has no cross-marketplace story. The engine
   * refused to render one, and so does this.
   */
  if (marketplaceRows.length === 0) {
    return {
      available: false,
      reason: "No marketplace listing has been captured for this product, so there is nothing to compare.",
    };
  }

  // The competitor table shows the first three platforms, so their order is
  // visible. Sorted here rather than left to however the set was built.
  const sortMarketplaces = (rows) =>
    (rows ?? []).map((r) => ({ ...r, marketplaceIds: [...(r.marketplaceIds ?? [])].sort() }));

  const competitorName = (productId) =>
    (d.competitors?.rows ?? []).find((r) => r.id === productId)?.name ?? productId;

  const context = {
    name,
    competitorName,
    unitBasis: d.unitBasis,
    pricedCount: d.marketplaceAnalysis?.pricedCount ?? 0,
    marketplaceCount: d.marketplaceAnalysis?.marketplaceCount ?? marketplaceRows.length,
    effectiveComparables: d.coverage?.effectiveComparables ?? 0,
    pricingRelevantAttributeCount: d.strength?.pricingRelevantAttributeCount ?? 0,
    normalMinor: d.normalMinor,
    ownMedianMinor: d.ownMarket?.median ?? null,
    distortionNote: distortionNote(d),
    wtpVerdict: rec ? wtpVerdict(rec.wtp) : null,
  };

  /**
   * The attribute model is a finding of the ANALYSIS but a product of the
   * RECOMMENDATION, so the backend returns it with the latter and it is
   * merged in here — in the engine's position, after the historical finding.
   */
  const backendFindings = [...(d.findings ?? [])];
  if (rec?.wtpFinding) {
    const afterHistory = backendFindings.findIndex((f) => f.id === "historical_position");
    backendFindings.splice(afterHistory >= 0 ? afterHistory + 1 : backendFindings.length, 0, rec.wtpFinding);
  }
  const findings = backendFindings.map((f) => ({ ...f, ...presentFinding(f, context) }));
  const byId = new Map(findings.map((f) => [f.id, f]));

  /** The recommendation's own refusal is what makes the analysis "limited". */
  const limited = rec == null || rec.status !== "recommended" || d.coverage?.limited === true;

  return {
    available: true,
    limited,
    limitedReason: limited ? limitedReason(rec, d) : null,
    whatWouldHelp: limited ? whatWouldHelp(d) : [],

    target: d.product,
    recommendation: { coverage: d.coverage },
    marketplaceRows,
    marketplaceAnalysis: withNames(d.marketplaceAnalysis, marketplaceRows),
    unitBasis: d.unitBasis,
    /**
     * Below the comparable minimum the competitive section is suppressed
     * WHOLESALE, not trimmed. That is the Phase 5 honesty gate: a competitive
     * analysis built on one or two candidates reports evidence that is not
     * there, and showing the rows while withholding the conclusion would
     * invite the reader to draw it themselves.
     */
    competitors: limited ? null : d.competitors && { ...d.competitors, rows: sortMarketplaces(d.competitors.rows) },
    strength: d.strength,
    history: d.history && {
      ...d.history,
      /**
       * The 90-day normal and the distortion reading are withheld on a
       * limited analysis, matching the screen as it stands. The backend
       * computes both and they are perfectly real; the engine simply never
       * had them on this path, because its refusal shape carried no
       * recommendation to read them from. Surfacing them is an improvement
       * for a later phase to make deliberately, not a migration to smuggle in.
       */
      /**
       * The 90-day normal and the distortion reading live beside the history
       * in the API and inside it on the screen. Same numbers.
       */
      normalMinor: limited ? undefined : d.normalMinor,
      distortion: limited ? undefined : d.distortion && { ...d.distortion, note: context.distortionNote },
      ownMedianMinor: d.ownMarket?.median ?? null,
    },
    findings: limited ? [] : findings,

    /**
     * The "therefore" section. The backend partitions the findings by the
     * direction each argues for; this re-attaches the presented prose to those
     * same objects and composes the verdict sentence.
     */
    bridge: rec?.bridge
      ? {
          ...rec.bridge,
          forPremium: rec.bridge.forPremium.map((f) => byId.get(f.id) ?? f),
          forAggressive: rec.bridge.forAggressive.map((f) => byId.get(f.id) ?? f),
          neutral: rec.bridge.neutral.map((f) => byId.get(f.id) ?? f),
          verdict: rec.bridge.premiumEvidenced
            ? "The evidence supports a premium position, and the Premium strategy is extended accordingly."
            : "No evidenced premium. Premium is held at the top of this product's own observed range rather than above it.",
          collapsed: collapsedNote(rec),
          strategies: rec.bridge.strategies.map((s) => ({
            ...s,
            rationale: (rec.strategies ?? []).find((x) => x.key === s.key)?.drivers?.map((dr) => dr.note) ?? [],
          })),
        }
      : null,

    horizons: horizons?.data ? presentHorizons(horizons) : null,
  };
}

/* ---------------------------------------------------------------- helpers */

function distortionNote(d) {
  const distortion = d.distortion;
  if (!distortion || distortion.state === "normal") return null;
  const own = d.ownMarket?.median;
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  return distortion.state === "depressed"
    ? `The product's current market (${formatMinor(own)}) sits ${pct(1 - distortion.ratio)} below its 90-day normal of ${formatMinor(d.normalMinor)} — the market looks promotionally depressed, so the recommendation leans toward the normal level rather than chasing the dip.`
    : `The current market (${formatMinor(own)}) sits ${pct(distortion.ratio - 1)} above its 90-day normal of ${formatMinor(d.normalMinor)} — treat the present level as temporarily elevated.`;
}

function wtpVerdict(wtp) {
  if (!wtp) return null;
  if (!wtp.trusted || wtp.predictedMinor == null) return wtp.reason;
  const fit = wtp.loocvR2 != null ? `held-out R² ${wtp.loocvR2}` : `adjusted R² ${wtp.adjR2}`;
  return wtp.supported
    ? `The attribute model fits well (${fit}) and values this product's attribute profile at ${formatMinor(wtp.predictedMinor)}, ${formatMinor(wtp.evidencedPremiumMinor)} above the comparable median — that premium is evidenced, not assumed.`
    : `The attribute model fits well (${fit}) but values this product at ${formatMinor(wtp.predictedMinor)}, at or below the comparable median. The market does not pay more for this product's attribute profile.`;
}

function collapsedNote(rec) {
  const distinct = new Set((rec.strategies ?? []).map((s) => s.priceMinor)).size;
  if (distinct >= 3) return null;
  return `Constraints have collapsed ${3 - distinct + 1} strategies onto the same price. The gap between the floor (${formatMinor(rec.constraints.floorMinor)}) and ceiling (${formatMinor(rec.constraints.ceilingMinor)}) is too narrow for meaningfully different positions.`;
}

function limitedReason(rec, d) {
  if (rec == null) {
    return "The pricing recommendation could not be loaded, so the findings below are presented without the prices they argue toward.";
  }
  if (rec.reason === "no_current_price") {
    return "This product has no in-stock offer, so there is no current price to reason from.";
  }
  if (rec.constraintConflict) {
    return `No valid price exists: the ceiling (${formatMinor(rec.constraints?.ceilingMinor)}, set by ${rec.constraints?.ceilingSource}) sits below the floor (${formatMinor(rec.constraints?.floorMinor)}).`;
  }
  const coverage = d.coverage ?? {};
  return `Only ${plural(coverage.totalCount ?? 0, "comparable product", "comparable products")} could be established for this product, against a target of ${coverage.target} and a working minimum of ${coverage.minimum}. Below that the market cannot be described: a median is just the midpoint of two numbers and the spread is meaningless. Padding the set with weaker candidates would produce a number, not evidence.`;
}

function whatWouldHelp(d) {
  const reasons = Object.fromEntries((d.coverage?.shortfallReasons ?? []).map((r) => [r.reason, r.count]));
  return [
    reasons.no_shared_marketplace
      ? `${plural(reasons.no_shared_marketplace, "candidate is", "candidates are")} sold on no shared marketplace — capturing this product on their platforms would make them comparable`
      : null,
    reasons.product_type_too_small
      ? "Capture more products of the same type, on the marketplaces this product is sold on"
      : "Capture more products of the same type, on the marketplaces this product is sold on",
    reasons.too_far_on_price_or_spec
      ? `${plural(reasons.too_far_on_price_or_spec, "candidate sits", "candidates sit")} too far away on price or specification to be a benchmark`
      : null,
  ].filter(Boolean);
}

/**
 * The seven observation horizons, and what the shortest and longest of them
 * say together. The capability ladder and every statistic are the backend's;
 * the persistence sentence is composed from the directions it reported.
 */
function presentHorizons(horizons) {
  const windows = (horizons.data.windows ?? []).map((w) => ({
    key: w.window,
    label: w.label,
    days: w.days,
    from: w.range.from,
    to: w.range.to,
    capability: w.capability,
    capabilityNote: w.capabilityNote,
    n: w.observationCount,
    minMinor: w.statistics?.minMinor ?? null,
    maxMinor: w.statistics?.maxMinor ?? null,
    medianMinor: w.statistics?.medianMinor ?? null,
    currentMinor: horizons.data.current?.effectiveMinor ?? null,
    changePct: w.statistics?.changePct ?? null,
    volatility: w.statistics?.volatilityPct ?? null,
    volatilityBand: w.volatilityBand,
    coverage: w.coverage,
    withheld: w.withheld ?? [],
  }));

  const cadenceDays = horizons.meta?.cadenceDays ?? null;
  const directional = windows.filter((w) => w.changePct != null && w.capability !== "none" && w.capability !== "snapshot");
  const shortest = directional[0] ?? null;
  const longest = directional[directional.length - 1] ?? null;

  let persistence = { state: "unestablished", label: "Not established", detail: "", shortWindow: null, longWindow: null };
  if (shortest && longest && shortest.key !== longest.key) {
    const sameWay = Math.sign(shortest.changePct) === Math.sign(longest.changePct);
    persistence = {
      state: sameWay ? "persistent" : "reverting",
      label: sameWay ? "Persistent" : "Short-term reversal",
      detail: sameWay
        ? `The ${shortest.label} and ${longest.label} windows move the same way (${shortest.changePct}% and ${longest.changePct}%), so the recent movement is part of a longer trend rather than noise.`
        : `The ${shortest.label} window moves ${shortest.changePct}% against the ${longest.label} window's ${longest.changePct}%, so recent movement runs counter to the longer trend and should not be read as a new direction yet.`,
      shortWindow: shortest.key,
      longWindow: longest.key,
    };
  } else {
    persistence.detail = "Too few horizons carry a direction for short-term movement to be placed in context.";
  }

  return { windows, cadenceDays, persistence };
}
