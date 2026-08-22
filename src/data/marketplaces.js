// Reference tier — near-static, everything else joins against this.
//
// Six Indian marketplaces, chosen so the set is not just "big general
// marketplaces with the same catalogue". Two horizontals (Amazon, Flipkart)
// carry almost everything; the rest are verticals with genuinely different
// category coverage, fee structures and buyer expectations. That difference is
// the point: cross-marketplace price comparison is only interesting when the
// marketplaces are not interchangeable.
//
// `categoryAffinity` records which canonical DEPARTMENTS a marketplace
// realistically sells. The catalogue generator reads it so a saree does not
// appear on a computer-parts vertical and a gaming laptop does not appear on a
// beauty vertical. `null` means "sells across the catalogue".
export const marketplaces = [
  {
    id: "mp_flipkart",
    name: "Flipkart",
    countryCode: "IN",
    defaultCurrency: "INR",
    websiteDomain: "flipkart.com",
    isActive: true,
    brandColor: "#2874f0",
    marketplaceType: "horizontal",
    categoryAffinity: null,
  },
  {
    id: "mp_amazon_in",
    name: "Amazon.in",
    countryCode: "IN",
    defaultCurrency: "INR",
    websiteDomain: "amazon.in",
    isActive: true,
    brandColor: "#ff9900",
    marketplaceType: "horizontal",
    categoryAffinity: null,
  },
  {
    id: "mp_meesho",
    name: "Meesho",
    countryCode: "IN",
    defaultCurrency: "INR",
    websiteDomain: "meesho.com",
    isActive: true,
    brandColor: "#8b1874",
    // Value-led: strong in fashion, home and low-ticket goods; thin on high-value
    // electronics and large appliances.
    marketplaceType: "value_horizontal",
    categoryAffinity: [
      "cat_fashion",
      "cat_home_kitchen",
      "cat_home_furniture",
      "cat_beauty",
      "cat_baby_kids",
      "cat_toys_games",
      "cat_stationery_books",
      "cat_sports_fitness",
      "cat_pet_supplies",
    ],
  },
  {
    id: "mp_myntra",
    name: "Myntra",
    countryCode: "IN",
    defaultCurrency: "INR",
    websiteDomain: "myntra.com",
    isActive: true,
    brandColor: "#ff3f6c",
    marketplaceType: "fashion_vertical",
    categoryAffinity: ["cat_fashion", "cat_beauty", "cat_sports_fitness"],
  },
  {
    id: "mp_ajio",
    name: "AJIO",
    countryCode: "IN",
    defaultCurrency: "INR",
    websiteDomain: "ajio.com",
    isActive: true,
    brandColor: "#2f4054",
    marketplaceType: "fashion_vertical",
    categoryAffinity: ["cat_fashion", "cat_beauty"],
  },
  {
    id: "mp_nykaa",
    name: "Nykaa",
    countryCode: "IN",
    defaultCurrency: "INR",
    websiteDomain: "nykaa.com",
    isActive: true,
    brandColor: "#fc2779",
    marketplaceType: "beauty_vertical",
    categoryAffinity: ["cat_beauty", "cat_health_wellness"],
  },
];

const byId = new Map(marketplaces.map((m) => [m.id, m]));

export function getMarketplace(marketplaceId) {
  return byId.get(marketplaceId) ?? null;
}

/** Does this marketplace realistically carry products from this department? */
export function marketplaceCoversDepartment(marketplaceId, departmentId) {
  const mp = byId.get(marketplaceId);
  if (!mp) return false;
  return mp.categoryAffinity === null || mp.categoryAffinity.includes(departmentId);
}
