// Marketplace fee rules — dated rows (SCD Type 2), never hardcoded percentages,
// so net realisation is computable using whichever rule was in force on a
// given date. Both rows below reflect the post zero-fee-under-₹1,000 regime
// (Flipkart from 14 Nov 2025, Amazon India from 16 Mar 2026); the demo product
// sits above that slab so the standard referral rate applies.
export const feeRules = [
  {
    id: "fee_fk_smartphones_v1",
    marketplaceId: "mp_flipkart",
    categoryId: "cat_smartphones",
    priceSlabMin: 1000,
    priceSlabMax: null,
    referralPct: 8.5,
    fixedClosingFee: 15,
    shippingFeeBasis: "weight_slab_standard",
    effectiveFrom: "2025-11-14",
    effectiveTo: null,
    isCurrent: true,
  },
  {
    id: "fee_fk_smartphones_v0",
    marketplaceId: "mp_flipkart",
    categoryId: "cat_smartphones",
    priceSlabMin: 0,
    priceSlabMax: null,
    referralPct: 9.0,
    fixedClosingFee: 20,
    shippingFeeBasis: "weight_slab_standard",
    effectiveFrom: "2024-01-01",
    effectiveTo: "2025-11-13",
    isCurrent: false,
  },
  {
    id: "fee_az_smartphones_v1",
    marketplaceId: "mp_amazon_in",
    categoryId: "cat_smartphones",
    priceSlabMin: 1000,
    priceSlabMax: null,
    referralPct: 7.0,
    fixedClosingFee: 20,
    shippingFeeBasis: "weight_slab_standard",
    effectiveFrom: "2026-03-16",
    effectiveTo: null,
    isCurrent: true,
  },
  {
    id: "fee_az_smartphones_v0",
    marketplaceId: "mp_amazon_in",
    categoryId: "cat_smartphones",
    priceSlabMin: 0,
    priceSlabMax: null,
    referralPct: 7.5,
    fixedClosingFee: 25,
    shippingFeeBasis: "weight_slab_standard",
    effectiveFrom: "2024-01-01",
    effectiveTo: "2026-03-15",
    isCurrent: false,
  },

  // ---- Laptops — a lower referral % and a higher fixed fee than phones,
  // consistent with the category's higher average order value and shipping weight ----
  {
    id: "fee_fk_laptops_v1",
    marketplaceId: "mp_flipkart",
    categoryId: "cat_laptops",
    priceSlabMin: 0,
    priceSlabMax: null,
    referralPct: 5.5,
    fixedClosingFee: 40,
    shippingFeeBasis: "weight_slab_heavy",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    isCurrent: true,
  },
  {
    id: "fee_az_laptops_v1",
    marketplaceId: "mp_amazon_in",
    categoryId: "cat_laptops",
    priceSlabMin: 0,
    priceSlabMax: null,
    referralPct: 4.5,
    fixedClosingFee: 45,
    shippingFeeBasis: "weight_slab_heavy",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    isCurrent: true,
  },

  // ---- Earbuds — small electronics accessories carry a higher referral %
  // than phones or laptops, offset by a low fixed fee ----
  {
    id: "fee_fk_earbuds_v1",
    marketplaceId: "mp_flipkart",
    categoryId: "cat_earbuds",
    priceSlabMin: 0,
    priceSlabMax: null,
    referralPct: 12.0,
    fixedClosingFee: 10,
    shippingFeeBasis: "weight_slab_light",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    isCurrent: true,
  },
  {
    id: "fee_az_earbuds_v1",
    marketplaceId: "mp_amazon_in",
    categoryId: "cat_earbuds",
    priceSlabMin: 0,
    priceSlabMax: null,
    referralPct: 11.0,
    fixedClosingFee: 12,
    shippingFeeBasis: "weight_slab_light",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    isCurrent: true,
  },

  // ---- Meesho — the platform's own well-known low/zero-commission
  // positioning, modelled as a markedly lower referral % than FK/AZ ----
  {
    id: "fee_meesho_smartphones_v1",
    marketplaceId: "mp_meesho",
    categoryId: "cat_smartphones",
    priceSlabMin: 0,
    priceSlabMax: null,
    referralPct: 2.0,
    fixedClosingFee: 8,
    shippingFeeBasis: "weight_slab_standard",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    isCurrent: true,
  },
  {
    id: "fee_meesho_earbuds_v1",
    marketplaceId: "mp_meesho",
    categoryId: "cat_earbuds",
    priceSlabMin: 0,
    priceSlabMax: null,
    referralPct: 3.0,
    fixedClosingFee: 8,
    shippingFeeBasis: "weight_slab_light",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    isCurrent: true,
  },

  // ---- Marketplace-level DEFAULT rules (categoryId: null) ----
  // Used when no category-specific rule has been captured yet. Real rate cards
  // are published per category and we only hold a handful of them, so a
  // marketplace default is the honest fallback: it keeps margin computable for
  // every category while being clearly identifiable as a default rather than a
  // confirmed category rate (see `isCategoryDefault` on the lookup result).
  {
    id: "fee_fk_default_v1",
    marketplaceId: "mp_flipkart",
    categoryId: null,
    priceSlabMin: 0,
    priceSlabMax: null,
    referralPct: 9.0,
    fixedClosingFee: 25,
    shippingFeeBasis: "weight_slab_standard",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    isCurrent: true,
  },
  {
    id: "fee_az_default_v1",
    marketplaceId: "mp_amazon_in",
    categoryId: null,
    priceSlabMin: 0,
    priceSlabMax: null,
    referralPct: 8.0,
    fixedClosingFee: 30,
    shippingFeeBasis: "weight_slab_standard",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    isCurrent: true,
  },
  {
    id: "fee_meesho_default_v1",
    marketplaceId: "mp_meesho",
    categoryId: null,
    priceSlabMin: 0,
    priceSlabMax: null,
    referralPct: 3.5,
    fixedClosingFee: 10,
    shippingFeeBasis: "weight_slab_standard",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    isCurrent: true,
  },
];

export function getCurrentFeeRule(marketplaceId, categoryId, atDate = new Date()) {
  const iso = atDate instanceof Date ? atDate.toISOString().slice(0, 10) : atDate;
  const inForce = (f) => f.effectiveFrom <= iso && (f.effectiveTo === null || f.effectiveTo >= iso);

  const exact = feeRules.find((f) => f.marketplaceId === marketplaceId && f.categoryId === categoryId && inForce(f));
  if (exact) return { ...exact, isCategoryDefault: false };

  // Fall back to the marketplace's default rate card, flagged as such so the
  // UI can say the margin rests on a default rather than a confirmed rate.
  const fallback = feeRules.find((f) => f.marketplaceId === marketplaceId && f.categoryId === null && inForce(f));
  return fallback ? { ...fallback, isCategoryDefault: true } : null;
}

const GST_ON_FEES = 0.18;

/** Net realisation = selling − referral fee − fixed fee − shipping − GST on those fees. */
export function computeNetRealizationMinor({ sellingPriceMinor, shippingFeeMinor = 0, feeRule }) {
  if (!feeRule) return null;
  const referralFeeMinor = Math.round(sellingPriceMinor * (feeRule.referralPct / 100));
  const fixedFeeMinor = feeRule.fixedClosingFee * 100;
  const feesBeforeGstMinor = referralFeeMinor + fixedFeeMinor + shippingFeeMinor;
  const gstMinor = Math.round(feesBeforeGstMinor * GST_ON_FEES);
  const netMinor = sellingPriceMinor - feesBeforeGstMinor - gstMinor;
  return {
    referralFeeMinor,
    fixedFeeMinor,
    shippingFeeMinor,
    gstMinor,
    totalFeesMinor: feesBeforeGstMinor + gstMinor,
    netRealizationMinor: netMinor,
  };
}

/**
 * Inverse of computeNetRealizationMinor: the lowest selling price at which
 * net realisation still covers the seller's cost. Solved algebraically
 * rather than searched, so it stays exact as fee rules change.
 */
export function computeBreakEvenPriceMinor({ costMinor, shippingFeeMinor = 0, feeRule }) {
  if (!feeRule) return null;
  const referralFrac = feeRule.referralPct / 100;
  const fixedFeeMinor = feeRule.fixedClosingFee * 100;
  const numerator = costMinor + (fixedFeeMinor + shippingFeeMinor) * (1 + GST_ON_FEES);
  const denominator = 1 - referralFrac * (1 + GST_ON_FEES);
  return Math.round(numerator / denominator);
}
