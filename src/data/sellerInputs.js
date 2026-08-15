// Seller-provided inputs — NOT observed marketplace data. A real seller
// would type these into a form; the recommendation engine treats them as
// explicit inputs, never blended with scraped facts.
export const sellerCostInputs = [
  {
    productId: "prod_galaxy_m14_5g_6_128_blue",
    costPriceMinor: 980000, // ₹9,800 landed procurement cost incl. GST
    enteredAt: "2026-08-10",
    note: "Landed procurement cost, entered by the seller.",
  },
  {
    productId: "prod_dell_inspiron15_i5_8_512",
    costPriceMinor: 3900000, // ₹39,000 landed procurement cost incl. GST
    enteredAt: "2026-08-10",
    note: "Landed procurement cost, entered by the seller.",
  },
  {
    productId: "prod_oneplus_buds3",
    costPriceMinor: 190000, // ₹1,900 landed procurement cost incl. GST
    enteredAt: "2026-08-10",
    note: "Landed procurement cost, entered by the seller.",
  },
];

export function getSellerCost(productId) {
  return sellerCostInputs.find((s) => s.productId === productId) ?? null;
}
