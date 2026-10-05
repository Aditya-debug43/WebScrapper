/**
 * NON-PRICE PARAMETERS
 * ====================
 *
 * The question this answers: besides price, what can a seller actually act on
 * to improve this listing's position?
 *
 * The test applied to every candidate was not "is this field in the database" —
 * most of them are — but: **can a seller name the decision this parameter
 * changes?** A number that cannot finish the sentence "…so I should ___" is a
 * column, not a parameter, and it was left out.
 *
 * ── Why this is on the server now ────────────────────────────────────────
 * It ran in the browser over the bundled dataset. That made it a second
 * analytical engine reading a second copy of the data, which is the exact
 * arrangement the recommendation and the cross-marketplace analysis were moved
 * server-side to end. The thresholds here decide what a seller is told to do;
 * they belong beside the findings they sit among.
 *
 * Pure functions over loaded inputs, like `catalogue/facets.ts` — no database
 * access, so every threshold is directly testable.
 *
 * ── What is deliberately NOT here ────────────────────────────────────────
 * `knownGaps` states the signals a production system would use and this
 * dataset cannot support. It is carried in the payload rather than omitted, so
 * the interface can state the limit instead of leaving a reader to assume it
 * was considered and dismissed.
 */

export type SignalOfferRow = {
  listingId: string;
  marketplaceId: string;
  offerId: string;
  sellerId: string;
  sellerName: string;
  fulfilmentType: string;
  isInStock: boolean;
  mrpMinor: number | null;
  sellingPriceMinor: number;
  shippingFeeMinor: number;
  landedMinor: number;
  universalEffectiveMinor: number;
};

export type FeaturedWin = {
  listingId: string;
  marketplaceId: string;
  sellerId: string;
  sellerName: string;
  wins: number;
};

export type WindowCoverage = {
  observationRows: number;
  outOfStockRows: number;
  outOfStockShare: number | null;
};

export type SignalWindow = {
  key: string | null;
  label: string;
  days: number | null;
  n: number;
  promoDays: number;
  promoLabels: string[];
  coverage: WindowCoverage;
};

export type SignalCompetitor = { id: string; name: string; marketplaceIds: string[]; velocity: number | null };

export type SignalInputs = {
  offers: SignalOfferRow[];
  listingIds: string[];
  ownMarketplaceIds: string[];
  featuredWins: FeaturedWin[];
  activePromotions: Array<{ offerId: string; availabilityClass: string; label: string }>;
  window: SignalWindow;
  /** Trust-weighted rating, from the analysis — not recomputed here. */
  trust: number | null;
  rawRating: number | null;
  reviewCount: number | null;
  /** Reviews per day, summed across this product's listings. */
  velocity: number | null;
  competitors: SignalCompetitor[];
};

/** A listing is "locked" when one seller holds the default position this often. */
export const LOCKED_SHARE = 80;

const pct1 = (v: number) => Math.round(v * 1000) / 10;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Reviews per day spans three orders of magnitude across this catalogue. */
export function formatRate(v: number | null): string {
  if (v == null) return "—";
  if (v < 10) return `${Math.round(v * 100) / 100}`;
  if (v < 100) return `${Math.round(v * 10) / 10}`;
  return `${Math.round(v).toLocaleString("en-IN")}`;
}

/** Rupees, as the interface writes them. */
function money(minor: number | null | undefined): string {
  if (minor == null) return "—";
  return `₹${Math.round(minor / 100).toLocaleString("en-IN")}`;
}

/** A platform id as prose: `mp_amazon_in` → "amazon in". */
const platformWords = (id: string) => id.replace(/^mp_/, "").replace(/_/g, " ");

export type Parameter = {
  key: string;
  label: string;
  value: number | null;
  display: string;
  unit: string | null;
  basis: "observed" | "derived";
  decision: string;
  detail: string | null;
  comparison: { label: string; value: number; display: string; deltaPct: number | null } | null;
  unavailableReason: string | null;
};

function param(
  key: string,
  label: string,
  opts: Partial<Parameter> & { value: number | null; display: string; decision: string }
): Parameter {
  return {
    key,
    label,
    value: opts.value,
    display: opts.display,
    unit: opts.unit ?? null,
    basis: opts.basis ?? "observed",
    decision: opts.decision,
    detail: opts.detail ?? null,
    comparison: opts.comparison ?? null,
    unavailableReason: opts.value == null ? opts.unavailableReason ?? "Not observable for this product." : null,
  };
}

export type SignalFinding = {
  id: string;
  dimension: string;
  direction: "premium" | "aggressive" | "neutral";
  headline: string;
  detail: string;
  evidence: string[];
};

/**
 * Who holds the featured offer, and how firmly.
 *
 * Summarised from per-listing-and-seller win counts. The per-listing unit is
 * load-bearing: pooling every platform's winners into one figure turns six
 * platforms with six unchallenged winners into "the top seller holds 16.7%",
 * which reads as a wide-open contest and is the opposite of the truth.
 */
export function summariseFeatured(wins: FeaturedWin[]) {
  const byListing = new Map<string, FeaturedWin[]>();
  for (const w of wins) {
    const list = byListing.get(w.listingId) ?? [];
    list.push(w);
    byListing.set(w.listingId, list);
  }

  const perListing = [...byListing.values()]
    .map((group) => {
      const days = group.reduce((s, g) => s + g.wins, 0);
      if (days === 0) return null;
      const ranked = [...group].sort((a, b) => b.wins - a.wins || a.sellerId.localeCompare(b.sellerId));
      const top = ranked[0]!;
      return {
        listingId: top.listingId,
        marketplaceId: top.marketplaceId,
        days,
        distinctWinners: ranked.length,
        topSellerId: top.sellerId,
        topSellerName: top.sellerName,
        topShare: pct1(top.wins / days),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (perListing.length === 0) return null;

  const locked = perListing.filter((l) => l.topShare >= LOCKED_SHARE);
  // The listing where the position changes hands most often — the one worth
  // looking at, because it is the one that can still be won.
  const mostContested = [...perListing].sort((a, b) => a.topShare - b.topShare)[0]!;

  return {
    perListing,
    lockedCount: locked.length,
    contestedCount: perListing.length - locked.length,
    mostContested,
    meanTopShare: pct1(perListing.reduce((s, l) => s + l.topShare, 0) / perListing.length / 100),
    listingsMeasured: perListing.length,
  };
}

/**
 * The parameters and the findings.
 *
 * A finding is a statement that needed at least two parameters to reach, and
 * each is emitted only where the data supports it — a product with thin
 * evidence simply produces fewer of them rather than weaker ones.
 */
export function buildStoreSignals(input: SignalInputs) {
  const { offers, listingIds, ownMarketplaceIds, window: win, trust, rawRating, reviewCount, velocity } = input;

  if (offers.length === 0) {
    return {
      available: false as const,
      reason:
        "No offer has ever been observed for this product, so there is nothing to assess beyond price either.",
      parameters: [] as Parameter[],
      findings: [] as SignalFinding[],
      window: win,
      knownGaps: KNOWN_GAPS,
    };
  }

  const inStock = offers.filter((o) => o.isInStock);
  const cheapest = inStock.reduce<SignalOfferRow | null>(
    (best, o) => (best === null || o.universalEffectiveMinor < best.universalEffectiveMinor ? o : best),
    null
  );

  const promosByOffer = new Map<string, Array<{ availabilityClass: string; label: string }>>();
  for (const p of input.activePromotions) {
    const list = promosByOffer.get(p.offerId) ?? [];
    list.push({ availabilityClass: p.availabilityClass, label: p.label });
    promosByOffer.set(p.offerId, list);
  }
  const universalLive = offers.some((o) =>
    (promosByOffer.get(o.offerId) ?? []).some((p) => p.availabilityClass === "universal")
  );

  const payingShipping = offers.filter((o) => (o.shippingFeeMinor ?? 0) > 0);
  const shippingShare =
    cheapest && cheapest.landedMinor ? pct1((cheapest.shippingFeeMinor ?? 0) / cheapest.landedMinor) : null;

  // "Marketplace-fulfilled" is anything that is not the seller shipping it.
  const fulfilled = offers.filter((o) => o.fulfilmentType && o.fulfilmentType !== "self_ship");
  const fulfilmentShare = offers.length ? pct1(fulfilled.length / offers.length) : null;

  const discountDepth =
    cheapest && cheapest.mrpMinor
      ? pct1((cheapest.mrpMinor - cheapest.universalEffectiveMinor) / cheapest.mrpMinor)
      : null;

  const promoShare = win.n ? pct1(win.promoDays / win.n) : null;

  const featured = summariseFeatured(input.featuredWins);

  const compVelocities = input.competitors
    .map((c) => ({ name: c.name, v: c.velocity }))
    .filter((c): c is { name: string; v: number } => c.v != null);
  const medianCompVelocity = compVelocities.length
    ? [...compVelocities].sort((a, b) => a.v - b.v)[Math.floor(compVelocities.length / 2)]!.v
    : null;

  /**
   * A platform is a coverage gap only if MOST of the competitive set sells
   * there and this product does not. One rival on a niche platform is not a
   * gap, and reporting it as one sends a seller somewhere nobody is.
   */
  const own = new Set(ownMarketplaceIds);
  const compMarketplaceCount = new Map<string, number>();
  for (const c of input.competitors) {
    for (const id of c.marketplaceIds) compMarketplaceCount.set(id, (compMarketplaceCount.get(id) ?? 0) + 1);
  }
  const comps = input.competitors;
  const gapPlatforms = [...compMarketplaceCount.entries()]
    .filter(([id, n]) => !own.has(id) && comps.length >= 3 && n / comps.length >= 0.5)
    .map(([id]) => id);

  /* ------------------------------------------------------------ parameters */

  const parameters: Parameter[] = [
    param("trust", "Trust-weighted rating", {
      value: trust,
      display: trust != null ? `${trust}★` : "—",
      basis: "derived",
      decision: "Can this rating defend a premium, or is it a small-sample effect?",
      detail:
        reviewCount != null
          ? `${rawRating}★ raw across ${reviewCount.toLocaleString("en-IN")} reviews, damped toward 3.5 by review volume.`
          : null,
      unavailableReason: "No review snapshot has been captured for any listing of this product.",
    }),
    param("demand", "Review velocity", {
      value: velocity,
      display: velocity != null ? `${formatRate(velocity)}/day` : "—",
      decision: "Is interest in this listing growing, and how does that compare with rivals?",
      detail:
        "New reviews per day across all listings. This is the closest thing the dataset holds to a demand signal — it is a proxy, not units sold.",
      comparison:
        medianCompVelocity != null && velocity != null
          ? {
              label: "competitor median",
              value: medianCompVelocity,
              display: `${formatRate(medianCompVelocity)}/day`,
              deltaPct: medianCompVelocity ? pct1((velocity - medianCompVelocity) / medianCompVelocity) : null,
            }
          : null,
      unavailableReason: "Fewer than two review snapshots exist, so a rate of change cannot be computed.",
    }),
    param("featured", "Featured offer locked", {
      value: featured?.lockedCount ?? null,
      display: featured ? `${featured.lockedCount} of ${featured.listingsMeasured}` : "—",
      decision: "Is the default buying position contested, or already locked by one seller?",
      detail: featured
        ? `On ${featured.lockedCount} of ${featured.listingsMeasured} ${plural(featured.listingsMeasured, "platform", "platforms")} a single seller held the featured offer on ${LOCKED_SHARE}% or more of captured days. Most open: ${featured.mostContested.topSellerName} on ${featured.mostContested.topShare}% over ${featured.mostContested.days} ${plural(featured.mostContested.days, "day", "days")}.`
        : null,
      unavailableReason: "No featured-offer day was captured inside this window.",
    }),
    param("availability", "Out of stock", {
      value: win.coverage.outOfStockShare,
      display: win.coverage.outOfStockShare != null ? `${win.coverage.outOfStockShare}%` : "—",
      unit: "%",
      decision: "Am I losing the featured position to availability rather than to price?",
      detail:
        win.coverage.observationRows > 0
          ? `${win.coverage.outOfStockRows} of ${win.coverage.observationRows} offer-days in this window were out of stock. Right now ${inStock.length} of ${offers.length} offers are buyable.`
          : null,
      unavailableReason: "No offer-day was captured inside this window.",
    }),
    param("competition", "Sellers on the listing", {
      value: offers.length,
      display: `${offers.length} across ${listingIds.length} ${plural(listingIds.length, "platform", "platforms")}`,
      decision: "How many sellers are competing for the same buyer on the same page?",
      detail: `${inStock.length} currently in stock.`,
    }),
    param("fulfilment", "Marketplace-fulfilled", {
      value: fulfilmentShare,
      display: fulfilmentShare != null ? `${fulfilmentShare}%` : "—",
      unit: "%",
      decision: "Is delivery speed working for or against this listing?",
      detail: `${fulfilled.length} of ${offers.length} offers ship through the marketplace rather than the seller. Delivery speed is a documented driver of the featured position, independent of price.`,
    }),
    param("shipping", "Delivery share of price", {
      value: shippingShare,
      display: shippingShare != null ? `${shippingShare}%` : "—",
      unit: "%",
      basis: "derived",
      decision: "Would absorbing delivery move this listing up the ranking more cheaply than a price cut?",
      detail: cheapest
        ? `${payingShipping.length} of ${offers.length} offers charge for delivery. On the cheapest offer, delivery is ${money(cheapest.shippingFeeMinor ?? 0)} of a ${money(cheapest.landedMinor)} landed price.`
        : null,
      unavailableReason: "No in-stock offer, so there is no landed price to divide.",
    }),
    param("promotion", "Promotional days", {
      value: promoShare,
      display: promoShare != null ? `${promoShare}%` : "—",
      unit: "%",
      decision: "Is the current price a standing price or a promotional one?",
      detail:
        win.n > 0
          ? `${win.promoDays} of ${win.n} captured ${plural(win.n, "day", "days")} in this window fell inside a promotion${win.promoLabels.length ? ` (${win.promoLabels.join(", ")})` : ""}. A universal discount is ${universalLive ? "live right now" : "not live right now"}.`
          : null,
      unavailableReason: "No observation inside this window.",
    }),
    param("discount", "Discount off MRP", {
      value: discountDepth,
      display: discountDepth != null ? `${discountDepth}%` : "—",
      unit: "%",
      basis: "derived",
      decision: "Is the headline discount unusual for this market?",
      detail: cheapest?.mrpMinor
        ? `Cheapest effective price against an observed MRP of ${money(cheapest.mrpMinor)}.`
        : null,
      unavailableReason: "No MRP is printed on any observed offer, so depth cannot be measured.",
    }),
    param("reach", "Platforms carried", {
      value: listingIds.length,
      display: `${listingIds.length} of ${own.size + gapPlatforms.length}`,
      decision: "Are competitors selling somewhere this product is absent?",
      detail: comps.length
        ? gapPlatforms.length
          ? `${gapPlatforms.length} ${plural(gapPlatforms.length, "platform carries", "platforms carry")} most of the competitive set but not this product.`
          : "No platform carries most of the competitive set while missing this product."
        : "No competitive set was established, so coverage cannot be compared.",
    }),
  ];

  /* -------------------------------------------------------------- findings */

  const findings: SignalFinding[] = [];
  const add = (f: SignalFinding) => findings.push(f);

  // Rating strength against the base it rests on.
  if (rawRating != null && reviewCount != null && trust != null) {
    const damping = Math.round((rawRating - trust) * 100) / 100;
    if (reviewCount < 500 && damping >= 0.15) {
      add({
        id: "sig_thin_reviews",
        dimension: "Trust",
        direction: "aggressive",
        headline: `A ${rawRating}★ rating resting on only ${reviewCount.toLocaleString("en-IN")} reviews`,
        detail: `Damped for the size of the base it sits on, the rating reads ${trust}★ rather than ${rawRating}★. A high average over a small number of reviews is not yet evidence a buyer will pay more for it, and it should not be leaned on to justify a premium.`,
        evidence: [
          `Raw ${rawRating}★ across ${reviewCount.toLocaleString("en-IN")} reviews`,
          `Trust-weighted ${trust}★ — damped by ${damping}`,
        ],
      });
    } else if (reviewCount >= 5000 && trust >= 4.2) {
      add({
        id: "sig_strong_trust",
        dimension: "Trust",
        direction: "premium",
        headline: "Customer trust is backed by a substantial review base",
        detail: `${rawRating}★ across ${reviewCount.toLocaleString("en-IN")} reviews survives damping at ${trust}★. A rating this well-supported is one of the few non-price assets that genuinely sustains a higher price.`,
        evidence: [
          `Trust-weighted ${trust}★`,
          `${reviewCount.toLocaleString("en-IN")} reviews across ${listingIds.length} ${plural(listingIds.length, "listing", "listings")}`,
        ],
      });
    }
  }

  // Demand proxy against the competitive set.
  if (velocity != null && medianCompVelocity != null && medianCompVelocity > 0) {
    const delta = pct1((velocity - medianCompVelocity) / medianCompVelocity);
    if (Math.abs(delta) >= 25) {
      add({
        id: "sig_velocity",
        dimension: "Demand proxy",
        direction: delta > 0 ? "premium" : "aggressive",
        headline:
          delta > 0
            ? `Reviews are accumulating ${delta}% faster than the competitive median`
            : `Reviews are accumulating ${Math.abs(delta)}% slower than the competitive median`,
        detail:
          delta > 0
            ? `${formatRate(velocity)} new reviews a day against a competitor median of ${formatRate(medianCompVelocity)}. Review accumulation is a proxy for purchase volume, not a measurement of it — but a listing pulling well ahead of its rivals on it is not one that needs to buy attention with price.`
            : `${formatRate(velocity)} new reviews a day against a competitor median of ${formatRate(medianCompVelocity)}. Slower accumulation can mean lower volume, a younger listing, or simply less prompting — it is a reason to look, not a conclusion on its own.`,
        evidence: [
          `This product ${formatRate(velocity)}/day`,
          `Competitor median ${formatRate(medianCompVelocity)}/day across ${compVelocities.length} ${plural(compVelocities.length, "rival", "rivals")}`,
        ],
      });
    }
  }

  // Featured position × availability — the interaction that matters most.
  if (featured && win.coverage.outOfStockShare != null) {
    if (featured.lockedCount > 0) {
      const example = featured.perListing.find((l) => l.topShare >= LOCKED_SHARE)!;
      add({
        id: "sig_featured_locked",
        dimension: "Featured offer",
        direction: "neutral",
        headline: `The featured offer is locked to one seller on ${featured.lockedCount} of ${featured.listingsMeasured} ${plural(featured.listingsMeasured, "platform", "platforms")}`,
        detail: `On ${platformWords(example.marketplaceId)}, ${example.topSellerName} held the default position on ${example.topShare}% of captured days against ${example.distinctWinners - 1} other ${plural(example.distinctWinners - 1, "seller", "sellers")}. Where the position is this concentrated, matching on price rarely dislodges it — the holder simply matches back — so the lever is usually delivery, availability or seller rating rather than price.`,
        evidence: [
          `${featured.lockedCount} of ${featured.listingsMeasured} platforms above the ${LOCKED_SHARE}% lock threshold`,
          `Mean top-seller share ${featured.meanTopShare}% across platforms measured`,
          `Most contested: ${featured.mostContested.topShare}% on ${platformWords(featured.mostContested.marketplaceId)}`,
        ],
      });
    }
    if (win.coverage.outOfStockShare >= 10) {
      add({
        id: "sig_availability",
        dimension: "Availability",
        direction: "neutral",
        headline: `${win.coverage.outOfStockShare}% of offer-days in this window were out of stock`,
        detail:
          "Availability, not price, decides who can hold the default position: an unbuyable offer cannot win it at any price. Before reading the price gap as a competitiveness problem, this share is worth removing.",
        evidence: [
          `${win.coverage.outOfStockRows} of ${win.coverage.observationRows} offer-days unavailable`,
          `${inStock.length} of ${offers.length} offers buyable right now`,
        ],
      });
    }
  }

  // Promotion dependence — is the comparison price a standing price?
  if (promoShare != null && promoShare >= 30 && win.n >= 3) {
    add({
      id: "sig_promo_dependence",
      dimension: "Promotion",
      direction: "aggressive",
      headline: `${promoShare}% of captured days in this window were promotional`,
      detail:
        "A price that is discounted this often is the working price, not an exception — and the figure every competitiveness comparison on this page is built from is therefore a promotional one. Sustained discounting also teaches buyers to wait for the next one.",
      evidence: [
        `${win.promoDays} of ${win.n} captured days inside a promotion`,
        win.promoLabels.length ? `Windows: ${win.promoLabels.join(", ")}` : "Promotion window unlabelled",
      ],
    });
  }

  // Shipping as a lever separate from price.
  if (shippingShare != null && shippingShare >= 5 && cheapest) {
    add({
      id: "sig_shipping",
      dimension: "Delivery",
      direction: "aggressive",
      headline: `Delivery is ${shippingShare}% of what the buyer actually pays`,
      detail: `${money(cheapest.shippingFeeMinor)} of the ${money(cheapest.landedMinor)} landed price is delivery. Absorbing it moves the effective price by the same amount as an equivalent price cut, but leaves the headline price — and the reference point buyers anchor on — intact.`,
      evidence: [
        `${payingShipping.length} of ${offers.length} offers charge for delivery`,
        `Cheapest offer: ${money(cheapest.sellingPriceMinor)} + ${money(cheapest.shippingFeeMinor)} delivery`,
      ],
    });
  }

  // Fulfilment mix — a documented driver of the default position.
  if (fulfilmentShare != null && offers.length >= 3 && fulfilmentShare <= 34) {
    add({
      id: "sig_fulfilment",
      dimension: "Delivery",
      direction: "neutral",
      headline: `Only ${fulfilmentShare}% of offers on this product ship through the marketplace`,
      detail:
        "Self-shipped offers carry slower and less predictable delivery, which marketplaces weight when choosing a default offer. Where rivals are marketplace-fulfilled, a price advantage can be cancelled by a delivery disadvantage that no price cut addresses.",
      evidence: [`${fulfilled.length} of ${offers.length} offers marketplace-fulfilled`],
    });
  }

  // Coverage gap — a non-price growth lever.
  if (gapPlatforms.length > 0) {
    add({
      id: "sig_reach",
      dimension: "Reach",
      direction: "neutral",
      headline: `${gapPlatforms.length} ${plural(gapPlatforms.length, "platform carries", "platforms carry")} most of the competitive set but not this product`,
      detail:
        "This is demand the product is not visible to at any price. Listing where rivals already sell is usually a cheaper route to volume than competing harder on the platforms already covered.",
      evidence: [
        `Listed on ${listingIds.length} of ${own.size + gapPlatforms.length} platforms seen across this competitive set`,
        `Competitive set of ${comps.length} measured`,
      ],
    });
  }

  return {
    available: true as const,
    window: win,
    parameters,
    findings,
    context: {
      featured,
      velocity,
      medianCompVelocity,
      trust,
      rawRating,
      reviewCount,
      offerCount: offers.length,
      inStockCount: inStock.length,
      listingCount: listingIds.length,
      gapPlatforms,
    },
    knownGaps: KNOWN_GAPS,
  };
}

/**
 * Signals a production system would use and this dataset cannot support.
 *
 * Stated rather than omitted, so the interface can name the limit instead of
 * leaving a reader to assume it was considered and dismissed.
 */
const KNOWN_GAPS = [
  "Units sold and sales velocity — the primary demand signal in every industry account of marketplace ranking. Not captured here, and not inferable from price observations.",
  "Conversion rate, sessions and add-to-cart — require storefront analytics this prototype has no access to.",
  "Search rank and impression share — would show whether a listing is losing visibility rather than losing on price.",
  "Returns, cancellations and delivery-SLA breaches — the seller-performance side of the default-position decision.",
] as const;
