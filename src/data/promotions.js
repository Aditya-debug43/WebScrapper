// PROMOTIONS — the commercial incentives attached to an offer.
//
// The single most important idea in this file is `availabilityClass`. A naive
// model treats every incentive as "a discount" and subtracts them all to get
// an "effective price". That produces a number no ordinary customer can
// actually obtain, and — worse — it lets a seller benchmark their universally
// available price against a competitor's bank-card-only price as though the
// two were comparable. They are not.
//
//   universal   Every buyer gets it automatically at checkout. No card, code,
//               membership or trade-in required. This is the ONLY class that
//               belongs in the price used for market comparison.
//   conditional Requires something of the buyer: a specific bank card, a coupon
//               code, an exchange/trade-in, a membership. Real, but not
//               obtainable by everyone — shown separately, never benchmarked.
//   deferred    Value returned AFTER purchase (cashback, wallet credit). Not a
//               price reduction at the till at all.
//   financing   Changes how the buyer pays, not what they pay (no-cost EMI).
//               The interest is absorbed, so it has a cash value, but it never
//               reduces the ticket price.
//
// Promotions are time-bounded. Rather than denormalising active promotions
// into all ~28,000 price observations, each promotion carries a validity
// window and is resolved against an observation's date. That preserves the
// commercial state visible at any past moment — the requirement — without
// duplicating promotion rows per day.

export const PROMOTION_CLASS = {
  universal: {
    key: "universal",
    label: "Instant, everyone",
    description: "Applied at checkout for every buyer with no further condition.",
    countsTowardEffectivePrice: true,
  },
  conditional: {
    key: "conditional",
    label: "Conditional",
    description: "Requires a specific card, coupon, exchange or membership.",
    countsTowardEffectivePrice: false,
  },
  deferred: {
    key: "deferred",
    label: "Deferred",
    description: "Returned after purchase as cashback or wallet credit.",
    countsTowardEffectivePrice: false,
  },
  financing: {
    key: "financing",
    label: "Financing",
    description: "Changes payment terms, not the ticket price.",
    countsTowardEffectivePrice: false,
  },
};

/** Which class a promotion type falls into. Set once, here, not at each call site. */
const CLASS_BY_TYPE = {
  instant_discount: "universal",
  marketplace_campaign: "universal",
  seller_campaign: "universal",
  bank_offer: "conditional",
  coupon: "conditional",
  exchange: "conditional",
  membership: "conditional",
  cashback: "deferred",
  no_cost_emi: "financing",
};

export function classOf(promotionType) {
  return CLASS_BY_TYPE[promotionType] ?? "conditional";
}

export const promotions = [
  // ---------------- Galaxy M14 / Flipkart ----------------
  {
    id: "promo_wsretail_bank",
    offerId: "off_fk_m14_6_128_wsretail",
    promotionType: "bank_offer",
    label: "10% off with HDFC Bank credit cards",
    terms: { bank: "HDFC Bank", percent: 10, capMinor: 100000, minSpendMinor: 500000, cardTypes: ["credit"] },
    eligibility: "HDFC Bank credit card, min spend ₹5,000",
    discountValueMinor: 100000,
    validFrom: "2026-08-01",
    validTo: "2026-08-31",
  },
  {
    id: "promo_wsretail_emi",
    offerId: "off_fk_m14_6_128_wsretail",
    promotionType: "no_cost_emi",
    label: "No-cost EMI for 6 months",
    terms: { tenureMonths: 6, bank: "ICICI Bank" },
    eligibility: "ICICI Bank card, 6-month tenure",
    discountValueMinor: 45000,
    validFrom: "2026-07-01",
    validTo: null,
  },
  {
    id: "promo_wsretail_instant",
    offerId: "off_fk_m14_6_128_wsretail",
    promotionType: "instant_discount",
    label: "Independence Day instant discount",
    terms: { flatMinor: 25000 },
    eligibility: null,
    discountValueMinor: 25000,
    validFrom: "2026-08-08",
    validTo: "2026-08-18",
  },
  {
    id: "promo_retailnet_coupon",
    offerId: "off_fk_m14_6_128_retailnet",
    promotionType: "coupon",
    label: "₹300 off with code SAVE300",
    terms: { code: "SAVE300", minSpendMinor: 1000000 },
    eligibility: "Apply code SAVE300 at checkout",
    discountValueMinor: 30000,
    validFrom: "2026-08-05",
    validTo: "2026-08-20",
  },

  // ---------------- Galaxy M14 / Amazon ----------------
  {
    id: "promo_appario_bank",
    offerId: "off_az_m14_6_128_appario",
    promotionType: "bank_offer",
    label: "10% off with SBI Card",
    terms: { bank: "SBI Card", percent: 10, capMinor: 125000, minSpendMinor: 500000, cardTypes: ["credit", "debit"] },
    eligibility: "SBI credit or debit card, min spend ₹5,000",
    discountValueMinor: 125000,
    validFrom: "2026-08-01",
    validTo: "2026-08-31",
  },
  {
    id: "promo_appario_exchange",
    offerId: "off_az_m14_6_128_appario",
    promotionType: "exchange",
    label: "Up to ₹8,000 exchange bonus",
    terms: { maxBonusMinor: 800000 },
    eligibility: "Requires an eligible device in working condition",
    discountValueMinor: 800000,
    validFrom: null,
    validTo: null,
  },
  {
    id: "promo_cloudtail_cashback",
    offerId: "off_az_m14_6_128_cloudtail",
    promotionType: "cashback",
    label: "3% back as Amazon Pay balance",
    terms: { wallet: "Amazon Pay", percent: 3, capMinor: 60000 },
    eligibility: "Credited to wallet after delivery",
    discountValueMinor: 60000,
    validFrom: "2026-08-01",
    validTo: "2026-08-31",
  },

  // ---------------- iPhone 15 ----------------
  {
    id: "promo_iphone15_wsretail_bank",
    offerId: "off_fk_iphone15_wsretail",
    promotionType: "bank_offer",
    label: "5% off with HDFC Bank credit cards",
    terms: { bank: "HDFC Bank", percent: 5, capMinor: 400000, minSpendMinor: 2000000, cardTypes: ["credit"] },
    eligibility: "HDFC Bank credit card, min spend ₹20,000",
    discountValueMinor: 400000,
    validFrom: "2026-08-01",
    validTo: "2026-08-31",
  },
  {
    id: "promo_iphone15_wsretail_emi",
    offerId: "off_fk_iphone15_wsretail",
    promotionType: "no_cost_emi",
    label: "No-cost EMI for 9 months",
    terms: { tenureMonths: 9, bank: "HDFC Bank" },
    eligibility: "HDFC Bank card, 9-month tenure",
    discountValueMinor: 210000,
    validFrom: "2026-07-01",
    validTo: null,
  },
  {
    id: "promo_iphone15_appario_bank",
    offerId: "off_az_iphone15_appario",
    promotionType: "bank_offer",
    label: "5% off with ICICI Bank credit cards",
    terms: { bank: "ICICI Bank", percent: 5, capMinor: 350000, minSpendMinor: 2000000, cardTypes: ["credit"] },
    eligibility: "ICICI Bank credit card, min spend ₹20,000",
    discountValueMinor: 350000,
    validFrom: "2026-08-01",
    validTo: "2026-08-31",
  },
  {
    id: "promo_iphone15_appario_exchange",
    offerId: "off_az_iphone15_appario",
    promotionType: "exchange",
    label: "Up to ₹15,000 exchange bonus",
    terms: { maxBonusMinor: 1500000 },
    eligibility: "Requires an eligible device in working condition",
    discountValueMinor: 1500000,
    validFrom: null,
    validTo: null,
  },

  // ---------------- budget phones ----------------
  {
    id: "promo_redmia3_coupon",
    offerId: "off_fk_redmia3",
    promotionType: "coupon",
    label: "₹200 off with code NEW50",
    terms: { code: "NEW50", minSpendMinor: 500000 },
    eligibility: "Apply code NEW50 at checkout",
    discountValueMinor: 20000,
    validFrom: "2026-08-01",
    validTo: "2026-09-30",
  },
  {
    id: "promo_meesho_redminote13_coupon",
    offerId: "off_meesho_redminote13",
    promotionType: "coupon",
    label: "₹200 off with code MEESHO200",
    terms: { code: "MEESHO200", minSpendMinor: 900000 },
    eligibility: "Apply code MEESHO200 at checkout",
    discountValueMinor: 20000,
    validFrom: "2026-08-01",
    validTo: "2026-08-31",
  },

  // ---------------- laptops ----------------
  {
    id: "promo_dellinspiron15_appario_bank",
    offerId: "off_az_dellinspiron15_appario",
    promotionType: "bank_offer",
    label: "8% off with SBI Card",
    terms: { bank: "SBI Card", percent: 8, capMinor: 300000, minSpendMinor: 3000000, cardTypes: ["credit"] },
    eligibility: "SBI credit card, min spend ₹30,000",
    discountValueMinor: 300000,
    validFrom: "2026-08-01",
    validTo: "2026-08-31",
  },
  {
    id: "promo_dellinspiron15_appario_emi",
    offerId: "off_az_dellinspiron15_appario",
    promotionType: "no_cost_emi",
    label: "No-cost EMI for 12 months",
    terms: { tenureMonths: 12, bank: "HDFC Bank" },
    eligibility: "HDFC Bank card, 12-month tenure",
    discountValueMinor: 280000,
    validFrom: "2026-06-01",
    validTo: null,
  },
  {
    id: "promo_macbookair_appario_exchange",
    offerId: "off_az_macbookair_m2_appario",
    promotionType: "exchange",
    label: "Up to ₹10,000 exchange bonus",
    terms: { maxBonusMinor: 1000000 },
    eligibility: "Requires an eligible device in working condition",
    discountValueMinor: 1000000,
    validFrom: null,
    validTo: null,
  },
  {
    id: "promo_hppavilion15_coupon",
    offerId: "off_fk_hppavilion15_omnitech",
    promotionType: "coupon",
    label: "₹1,000 off with code LAPTOP1K",
    terms: { code: "LAPTOP1K", minSpendMinor: 3000000 },
    eligibility: "Apply code LAPTOP1K at checkout",
    discountValueMinor: 100000,
    validFrom: "2026-08-05",
    validTo: "2026-08-25",
  },

  // ---------------- audio / accessories ----------------
  {
    id: "promo_oneplusbuds3_appario_cashback",
    offerId: "off_az_oneplusbuds3_appario",
    promotionType: "cashback",
    label: "5% back as Amazon Pay balance",
    terms: { wallet: "Amazon Pay", percent: 5, capMinor: 15000 },
    eligibility: "Credited to wallet after delivery",
    discountValueMinor: 15000,
    validFrom: "2026-08-01",
    validTo: "2026-08-31",
  },
  {
    id: "promo_boatairdopes141_omnitech_coupon",
    offerId: "off_fk_boatairdopes141_omnitech",
    promotionType: "coupon",
    label: "₹99 off with code AUDIO99",
    terms: { code: "AUDIO99", minSpendMinor: 80000 },
    eligibility: "Apply code AUDIO99 at checkout",
    discountValueMinor: 9900,
    validFrom: "2026-08-01",
    validTo: "2026-08-31",
  },
  {
    id: "promo_airpodspro2_appario_bank",
    offerId: "off_az_airpodspro2_appario",
    promotionType: "bank_offer",
    label: "5% off with SBI Card",
    terms: { bank: "SBI Card", percent: 5, capMinor: 100000, minSpendMinor: 1000000, cardTypes: ["credit", "debit"] },
    eligibility: "SBI credit or debit card, min spend ₹10,000",
    discountValueMinor: 100000,
    validFrom: "2026-08-01",
    validTo: "2026-08-31",
  },

  // ---------------- a genuine universal instant discount, for contrast ----------------
  {
    id: "promo_mi_pb_instant",
    offerId: "off_fk_mi_pb_10000_0",
    promotionType: "instant_discount",
    label: "₹100 instant discount",
    terms: { flatMinor: 10000 },
    eligibility: null,
    discountValueMinor: 10000,
    validFrom: "2026-08-01",
    validTo: "2026-08-31",
  },
];

const byOfferId = (() => {
  const map = new Map();
  for (const p of promotions) {
    const enriched = { ...p, availabilityClass: classOf(p.promotionType) };
    let arr = map.get(p.offerId);
    if (!arr) map.set(p.offerId, (arr = []));
    arr.push(enriched);
  }
  return map;
})();

export function getPromotionsForOffer(offerId) {
  return byOfferId.get(offerId) ?? [];
}

/** Promotions visible on a given date — the commercial state as it was then. */
export function getActivePromotionsForOffer(offerId, dateIso) {
  return getPromotionsForOffer(offerId).filter(
    (p) => (!p.validFrom || p.validFrom <= dateIso) && (!p.validTo || p.validTo >= dateIso)
  );
}

/** Total benefit of one availability class, on a given date. */
export function sumPromotionsByClass(offerId, dateIso, availabilityClass) {
  return getActivePromotionsForOffer(offerId, dateIso)
    .filter((p) => p.availabilityClass === availabilityClass)
    .reduce((sum, p) => sum + p.discountValueMinor, 0);
}
