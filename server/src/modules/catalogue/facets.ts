/**
 * CATALOGUE FACETS
 * ================
 *
 * The filter sidebar, computed server-side. Pure functions over a loaded set
 * of product summaries — no database access, so every rule here is directly
 * testable against the browser engine it replaces.
 *
 * ── Why this is not SQL ───────────────────────────────────────────────────
 * Faceted search needs each group's counts computed with THAT group's own
 * selection excluded (choosing "Samsung" must not reduce the brand list to
 * Samsung), which is six differently-filtered aggregations, over a price
 * banding whose boundaries depend on the scoped set, plus spec facets read
 * from a JSONB document against the attribute registry. Expressed in SQL that
 * is a dozen correlated queries whose behaviour is hard to compare with the
 * engine it has to match.
 *
 * The scope is bounded and small — the whole catalogue is 1,172 products, and
 * a scope is a category subtree within that — so the set is loaded once and
 * the facets are computed over it. This is the same shape as the analysis
 * layer, which loads a bounded candidate set in a fixed number of queries and
 * computes in the service rather than pushing statistics into SQL.
 *
 * What matters is that the DATA comes from PostgreSQL. It does.
 */

/** One product, with everything a facet or a sort needs. */
export type CatalogueSummary = {
  productId: string;
  brandId: string;
  categoryId: string;
  productTypeId: string;
  /** Cheapest in-stock universal-effective price, or null when none is in stock. */
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
  marketplaceIds: string[];
  listingCount: number;
  offerCount: number;
  rating: number | null;
  reviewCount: number;
  inStock: boolean;
  firstSeenAt: string | null;
  canonicalName: string;
  specifications: Record<string, unknown>;
};

export type FacetSelection = {
  brandIds: string[];
  priceBucketIds: string[];
  ratingId: string | null;
  marketplaceIds: string[];
  inStockOnly: boolean;
  /** attributeKey → selected values, as strings. */
  specFilters: Record<string, string[]>;
};

/** A `range` facet's bands, as the attribute registry defines them. */
export type AttributeBucket = { label: string; min: number; max: number | null };

export type FilterableAttribute = {
  attributeKey: string;
  displayName: string;
  filterType: "range" | "enum" | "boolean";
  dataType: "integer" | "decimal" | "boolean" | "text";
  /** Appended to an enum option's label, e.g. "120 Hz". */
  unit: string | null;
  /** Present for `range` attributes, null for the others. */
  buckets: AttributeBucket[] | null;
};

export type PriceBucket = { id: string; label: string; minMinor: number; maxMinor: number | null };

/**
 * Rating thresholds, "and above".
 *
 * A fixed ladder rather than a derived one: "4★ & above" means the same thing
 * in every category, and a shopper comparing two categories should not find
 * the rating filter has quietly changed its brackets.
 */
export const RATING_OPTIONS = [
  { id: "r4", label: "4★ & above", min: 4 },
  { id: "r35", label: "3.5★ & above", min: 3.5 },
  { id: "r3", label: "3★ & above", min: 3 },
] as const;

/** ₹25,000 → "25k", ₹200,000 → "2L". Indian conventions, as the UI shows them. */
function fmt(n: number): string {
  if (n >= 100000) return `${n / 100000}L`;
  if (n >= 1000) return `${n / 1000}k`;
  return String(n);
}

/**
 * Price bands chosen to suit the set in scope.
 *
 * A fixed ladder cannot serve both shampoo and laptops: "Under ₹10,000" is
 * every shampoo and no laptop, and a band that contains everything filters
 * nothing. So the ladder is picked from the scoped maximum, and the `* 1.6`
 * slack stops a single expensive outlier from pushing an entire category onto
 * the next ladder up.
 */
export function buildPriceBuckets(summaries: CatalogueSummary[]): PriceBucket[] {
  const prices = summaries.map((s) => s.minPriceMinor).filter((p): p is number => p != null);
  if (prices.length === 0) return [];
  const maxRupees = Math.max(...prices) / 100;

  const ladders = [
    [500, 1000, 2000, 5000],
    [1000, 2500, 5000, 10000],
    [5000, 10000, 20000, 40000],
    [10000, 25000, 50000, 100000],
    [25000, 50000, 100000, 200000],
  ];
  const ladder = ladders.find((l) => maxRupees <= l[l.length - 1]! * 1.6) ?? ladders[ladders.length - 1]!;

  const buckets: PriceBucket[] = [];
  let prev = 0;
  for (const edge of ladder) {
    buckets.push({
      id: `p_${prev}_${edge}`,
      label: prev === 0 ? `Under ₹${fmt(edge)}` : `₹${fmt(prev)} – ₹${fmt(edge)}`,
      minMinor: prev * 100,
      maxMinor: edge * 100,
    });
    prev = edge;
  }
  buckets.push({ id: `p_${prev}_max`, label: `₹${fmt(prev)} & above`, minMinor: prev * 100, maxMinor: null });
  return buckets;
}

/* ------------------------------------------------------------- predicates */

/**
 * One predicate per filter GROUP, kept separable.
 *
 * Separability is the whole mechanism: a facet's counts are computed by
 * applying every group except its own, which is only possible if the groups
 * are individually addressable. An empty selection matches everything, so an
 * untouched filter never narrows anything.
 */
const matchesBrand = (s: CatalogueSummary, ids: string[]) => ids.length === 0 || ids.includes(s.brandId);

const inBucket = (price: number, b: PriceBucket) => price >= b.minMinor && (b.maxMinor === null || price < b.maxMinor);

const matchesPrice = (s: CatalogueSummary, ids: string[], buckets: PriceBucket[]) => {
  if (ids.length === 0) return true;
  if (s.minPriceMinor == null) return false;
  const chosen = buckets.filter((b) => ids.includes(b.id));
  return chosen.some((b) => inBucket(s.minPriceMinor!, b));
};

const matchesRating = (s: CatalogueSummary, ratingId: string | null) => {
  if (!ratingId) return true;
  const opt = RATING_OPTIONS.find((r) => r.id === ratingId);
  return opt ? (s.rating ?? 0) >= opt.min : true;
};

const matchesMarketplace = (s: CatalogueSummary, ids: string[]) =>
  ids.length === 0 || s.marketplaceIds.some((m) => ids.includes(m));

const matchesAvailability = (s: CatalogueSummary, inStockOnly: boolean) => !inStockOnly || s.inStock;

/**
 * SPEC MATCHING DEPENDS ON THE FILTER TYPE, and the three are not alike.
 *
 *   enum     the selection is the value itself, compared as a string
 *   boolean  the selection is "true"/"false"
 *   range    the selection is a BUCKET LABEL from the attribute registry, and
 *            the match is numeric containment in that bucket's band
 *
 * The range case is the one that is easy to get wrong, and it was: treating
 * every spec as a raw-value enum made `storage_gb=128` match nothing, because
 * what the sidebar offers — and therefore what the client sends — is
 * "128 GB". The facet label IS the filter value for a range attribute.
 */
function specValueMatches(def: FilterableAttribute, raw: unknown, selected: string[]): boolean {
  if (raw === undefined || raw === null) return false;
  if (def.filterType === "boolean") return selected.includes(String(Boolean(raw)));
  if (def.filterType === "enum") return selected.includes(String(raw));
  if (def.filterType === "range") {
    const num = Number(raw);
    if (!Number.isFinite(num)) return false;
    return selected.some((label) => {
      const bucket = (def.buckets ?? []).find((b) => b.label === label);
      if (!bucket) return false;
      return num >= bucket.min && (bucket.max === null || num < bucket.max);
    });
  }
  return false;
}

const matchesSpecs = (s: CatalogueSummary, filters: Record<string, string[]>, defs: FilterableAttribute[]) => {
  for (const [key, selected] of Object.entries(filters)) {
    if (!selected || selected.length === 0) continue;
    // An unknown key is ignored rather than fatal: it can only come from a
    // stale bookmark, and failing the whole query would make an old link look
    // like a broken catalogue.
    const def = defs.find((d) => d.attributeKey === key);
    if (!def) continue;
    if (!specValueMatches(def, s.specifications?.[key], selected)) return false;
  }
  return true;
};

/**
 * The option a product falls under for one attribute.
 *
 * For a range attribute that is the containing bucket's label, so the facet
 * counts are counts of bands rather than of distinct raw values — "128 GB"
 * covering 128, and "Under 50 MP" covering everything below it.
 */
function facetOptionFor(def: FilterableAttribute, raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (def.filterType === "boolean") return String(Boolean(raw));
  if (def.filterType === "enum") return String(raw);
  if (def.filterType === "range") {
    const num = Number(raw);
    if (!Number.isFinite(num)) return null;
    const bucket = (def.buckets ?? []).find((b) => num >= b.min && (b.max === null || num < b.max));
    return bucket?.label ?? null;
  }
  return null;
}

/* ----------------------------------------------------------------- facets */

export type FacetOption = { id: string; label: string; count: number };
export type SpecFacet = {
  key: string;
  label: string;
  filterType: FilterableAttribute["filterType"];
  options: FacetOption[];
};

export type CatalogueFacets = {
  brand: FacetOption[];
  price: FacetOption[];
  rating: FacetOption[];
  marketplace: FacetOption[];
  availability: FacetOption[];
  specs: SpecFacet[];
};

/**
 * Results and facet counts for one scoped set.
 *
 * `scoped` has already had category, product type and search applied — those
 * define the SCOPE and are not facets. Everything below is a facet group, and
 * each group's counts are taken from the set filtered by all OTHER groups.
 */
export function computeFacets(input: {
  scoped: CatalogueSummary[];
  selection: FacetSelection;
  buckets: PriceBucket[];
  specDefs: FilterableAttribute[];
  brandsById: Map<string, string>;
  marketplacesById: Map<string, string>;
}): { results: CatalogueSummary[]; facets: CatalogueFacets } {
  const { scoped, selection, buckets, specDefs, brandsById, marketplacesById } = input;

  const predicates = {
    brand: (s: CatalogueSummary) => matchesBrand(s, selection.brandIds),
    price: (s: CatalogueSummary) => matchesPrice(s, selection.priceBucketIds, buckets),
    rating: (s: CatalogueSummary) => matchesRating(s, selection.ratingId),
    marketplace: (s: CatalogueSummary) => matchesMarketplace(s, selection.marketplaceIds),
    availability: (s: CatalogueSummary) => matchesAvailability(s, selection.inStockOnly),
    specs: (s: CatalogueSummary) => matchesSpecs(s, selection.specFilters, specDefs),
  };

  const entries = Object.entries(predicates) as Array<[keyof typeof predicates, (s: CatalogueSummary) => boolean]>;
  const applyAllExcept = (except: keyof typeof predicates | null) =>
    scoped.filter((s) => entries.every(([key, fn]) => key === except || fn(s)));

  const results = applyAllExcept(null);

  // ---- brand
  const brandPool = applyAllExcept("brand");
  const brandCounts = new Map<string, number>();
  /**
   * A product with no brand contributes no brand facet.
   *
   * Live products have none — a marketplace title does not state one, and
   * migration 0009 made the column nullable rather than inventing it. Counted
   * blindly, the null became a facet option whose label was null, and sorting
   * the options called `localeCompare` on it and took the whole catalogue
   * endpoint down with a 500.
   *
   * Skipping is the honest behaviour either way: "no brand" is not a brand
   * somebody would filter by, and showing it as one would invite a click that
   * means nothing.
   */
  for (const s of brandPool) {
    if (!s.brandId) continue;
    brandCounts.set(s.brandId, (brandCounts.get(s.brandId) ?? 0) + 1);
  }
  /**
   * ---- brand
   *
   * By count, then label — 304 brands have no meaningful fixed order, so
   * ranking them is the useful thing.
   *
   * The id is the final tiebreak, and it is load-bearing: two brands can share
   * a DISPLAY NAME. `brand_xiaomi` and `brand_redmi` both read "Redmi" in this
   * catalogue, so count and label together do not separate them, and without a
   * third key their order is whatever the input happened to be. Over a
   * paginated or cached response that is a row that moves for no reason.
   */
  const brand = [...brandCounts]
    .map(([id, count]) => ({ id, label: brandsById.get(id) ?? id, count }))
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));

  // ---- price
  const pricePool = applyAllExcept("price");
  const price = buckets
    .map((b) => ({
      id: b.id,
      label: b.label,
      count: pricePool.filter((s) => s.minPriceMinor != null && inBucket(s.minPriceMinor, b)).length,
    }))
    .filter((f) => f.count > 0);

  // ---- rating
  const ratingPool = applyAllExcept("rating");
  const rating = RATING_OPTIONS.map((r) => ({
    id: r.id,
    label: r.label,
    count: ratingPool.filter((s) => (s.rating ?? 0) >= r.min).length,
  })).filter((f) => f.count > 0);

  /**
   * ---- marketplace
   *
   * In the marketplaces' OWN order, not by count. `marketplacesById` is built
   * from the ordered query — curated platforms in their editorial sequence,
   * discovered stores after them — and a Map preserves that insertion order.
   *
   * Deliberately unsorted: a platform list that reshuffles as filters change
   * is hard to use, and the brand facet (which IS count-ordered, because 304
   * brands have no meaningful fixed order) is the case that needs ranking.
   */
  const marketplacePool = applyAllExcept("marketplace");
  const mpCounts = new Map<string, number>();
  for (const s of marketplacePool) {
    for (const id of new Set(s.marketplaceIds)) mpCounts.set(id, (mpCounts.get(id) ?? 0) + 1);
  }
  const marketplace = [...marketplacesById]
    .map(([id, label]) => ({ id, label, count: mpCounts.get(id) ?? 0 }))
    .filter((f) => f.count > 0);

  /**
   * ---- availability
   *
   * Always present, even at zero. It is a single toggle rather than a list of
   * choices, and hiding it when nothing is in stock would remove the control
   * that explains why — the user would be left unable to see that the filter
   * exists, let alone that it matches nothing.
   */
  const availabilityPool = applyAllExcept("availability");
  const availability = [
    { id: "in_stock", label: "In stock", count: availabilityPool.filter((s) => s.inStock).length },
  ];

  /**
   * ---- specs
   *
   * Option ORDER differs per filter type, deliberately, and matches the engine:
   *
   *   range    registry order, so "Up to 64 GB" precedes "128 GB" precedes
   *            "256 GB". Sorting these by count would scramble a ladder the
   *            reader expects to ascend.
   *   enum     by count, then label — there is no natural order for a
   *            processor name.
   *   boolean  Yes then No, always.
   *
   * An option matching nothing is dropped in every case, ranges included: a
   * band with no products in it is a filter that can only empty the results,
   * and offering it invites exactly that.
   */
  const specPool = applyAllExcept("specs");
  const specs: SpecFacet[] = specDefs
    .map((def) => {
      const valueOf = (s: CatalogueSummary) => s.specifications?.[def.attributeKey];
      let options: FacetOption[];

      if (def.filterType === "boolean") {
        options = [
          { id: "true", label: "Yes", count: specPool.filter((s) => valueOf(s) === true).length },
          { id: "false", label: "No", count: specPool.filter((s) => valueOf(s) === false).length },
        ];
      } else if (def.filterType === "enum") {
        const values = [...new Set(specPool.map(valueOf).filter((v) => v != null))];
        options = values
          .map((v) => ({
            id: String(v),
            label: def.unit ? `${v} ${def.unit}` : String(v),
            count: specPool.filter((s) => String(valueOf(s)) === String(v)).length,
          }))
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      } else {
        options = (def.buckets ?? []).map((b) => ({
          id: b.label,
          label: b.label,
          count: specPool.filter((s) => facetOptionFor(def, valueOf(s)) === b.label).length,
        }));
      }

      return {
        key: def.attributeKey,
        label: def.displayName,
        filterType: def.filterType,
        options: options.filter((o) => o.count > 0),
      };
    })
    // A facet offering one option filters nothing; showing it implies a choice
    // that does not exist.
    .filter((f) => f.options.length > 1);

  return { results, facets: { brand, price, rating, marketplace, availability, specs } };
}

/* ------------------------------------------------------------------ sorts */

export type CatalogueSort =
  | "relevance"
  | "price_asc"
  | "price_desc"
  | "rating"
  | "reviews"
  | "recent"
  | "name_asc"
  | "name_desc";

/**
 * Ordering, applied after facets.
 *
 * Each primary comparator is the browser engine's, value for value, including
 * its null conventions: a missing price sorts last in BOTH directions (±
 * Infinity, not zero), and a missing rating is read as 0 rather than excluded.
 * Those are the behaviours the catalogue already has, and this migration
 * changes where data comes from, not how it is ordered.
 *
 * ONE DELIBERATE DIFFERENCE: every comparator falls back to the product id.
 *
 * The browser engine sorts a complete in-memory array and never paginates, so
 * ties resolve to whatever order the summary index happened to be built in
 * and nobody notices. Over a paginated API they are a real defect — two
 * products with equal review counts can swap between requests, and a row is
 * then served twice or skipped. The existing backend `orderFor` already adds
 * exactly this tiebreak for the same reason.
 */
export function sortSummaries(rows: CatalogueSummary[], sort: CatalogueSort): CatalogueSummary[] {
  const byId = (a: CatalogueSummary, b: CatalogueSummary) => a.productId.localeCompare(b.productId);
  const reviews = (s: CatalogueSummary) => s.reviewCount ?? 0;

  const sorted = [...rows];
  switch (sort) {
    case "price_asc":
      return sorted.sort(
        (a, b) => (a.minPriceMinor ?? Infinity) - (b.minPriceMinor ?? Infinity) || byId(a, b)
      );
    case "price_desc":
      return sorted.sort(
        (a, b) => (b.minPriceMinor ?? -Infinity) - (a.minPriceMinor ?? -Infinity) || byId(a, b)
      );
    case "rating":
      return sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || byId(a, b));
    case "recent":
      // Descending by first-seen date. `localeCompare` on the ISO string
      // rather than the engine's `<` comparison, which has no answer for a
      // null date; nulls sort last here instead of unpredictably.
      return sorted.sort((a, b) => (b.firstSeenAt ?? "").localeCompare(a.firstSeenAt ?? "") || byId(a, b));
    case "name_desc":
      return sorted.sort(
        (a, b) => b.canonicalName.toLowerCase().localeCompare(a.canonicalName.toLowerCase()) || byId(a, b)
      );
    case "name_asc":
      return sorted.sort(
        (a, b) => a.canonicalName.toLowerCase().localeCompare(b.canonicalName.toLowerCase()) || byId(a, b)
      );
    case "reviews":
    case "relevance":
    default:
      // The engine ranks relevance and reviews identically. With no query to
      // score against there is nothing else to rank by, and inventing a
      // scoring signal here would be a behaviour change dressed as a port.
      return sorted.sort((a, b) => reviews(b) - reviews(a) || byId(a, b));
  }
}
