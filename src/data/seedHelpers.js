// Shared authoring helpers for the catalogue seed files.
//
// The seed is split across several files purely for readability — they are
// concatenated into one array by catalogueSeed.js and expanded by one
// generator. Splitting by department keeps each file scannable; it carries no
// structural meaning.

/**
 * One product.
 *
 * Positional on purpose: with several hundred rows, named keys turn every
 * product into a six-line object and the file stops being readable as a table.
 * The column order is fixed — id, name, brand, product type, price, MRP,
 * rating, reviews, marketplaces, specs — so a row can be scanned at a glance.
 *
 * `price` is the CURRENT CHEAPEST LANDED price in rupees. The generator
 * guarantees the cheapest offer's latest in-stock observation lands exactly on
 * it, so the catalogue card, the marketplace comparison and the price-history
 * chart cannot disagree.
 *
 * `mps` is a space-separated string of marketplace codes:
 *   fk Flipkart · az Amazon.in · mh Meesho · my Myntra · aj AJIO · ny Nykaa
 */
export function p(id, name, brand, ptype, price, mrp, rating, reviews, mps, specs, opts = {}) {
  return {
    id,
    name,
    brand,
    ptype,
    price,
    mrp,
    rating,
    reviews,
    mps: mps.split(" "),
    specs,
    sellers: opts.sellers ?? 2,
    trend: opts.trend ?? "flat",
    ...opts,
  };
}

/**
 * A product LINE that ships in several variants — sizes, capacities, pack
 * counts. Produces one row per variant, all sharing a `family` id, which the
 * generator turns into a non-purchasable parent product plus purchasable
 * siblings. That is the variant relationship the entity model already defines;
 * this is just a terser way to author it.
 *
 * `values` accepts either bare labels, or `{ label, delta, specs }` when a
 * variant costs more and carries different specifications (256 GB vs 128 GB).
 */
export function family(baseId, name, brand, ptype, basePrice, baseMrp, rating, reviews, mps, specs, axis, values, opts = {}) {
  return values.map((v, i) => {
    const label = typeof v === "object" ? v.label : v;
    const delta = typeof v === "object" ? (v.delta ?? 0) : 0;
    const extraSpecs = typeof v === "object" ? (v.specs ?? {}) : {};
    const slug = String(label).toLowerCase().replace(/[^a-z0-9]+/g, "");
    return {
      ...p(
        `${baseId}_${slug}`,
        // The unit belongs to the DISPLAY name only — the spec value stays numeric,
        // because the attribute registry declares it as a number and every
        // comparison downstream depends on that.
        `${name} — ${label}${opts.unit ? " " + opts.unit : ""}`,
        brand,
        ptype,
        basePrice + delta,
        baseMrp + delta,
        rating,
        // Later variants of a line carry fewer reviews than the lead variant,
        // which is what makes a variant family useful to the strength model:
        // the siblings are genuinely unequal in market traction.
        Math.max(40, Math.round(reviews * (i === 0 ? 1 : 0.45 / i))),
        mps,
        { ...specs, [axis]: label, ...extraSpecs },
        opts
      ),
      family: baseId,
      familyName: name,
      variantAxis: axis,
    };
  });
}

export const SIZES_APPAREL = ["S", "M", "L", "XL"];
