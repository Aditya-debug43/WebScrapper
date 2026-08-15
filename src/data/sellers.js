// Seller = a merchant account, scoped to one marketplace. Ratings are a
// snapshot series (level + rate both matter), never a mutable column.

export const sellers = [
  { id: "sel_fk_retailnet", marketplaceId: "mp_flipkart", externalSellerId: "RETNET29", name: "RetailNet Commerce", sellerType: "third_party", defaultFulfilmentType: "flipkart_assured", sellerGroupId: null },
  { id: "sel_fk_supercomnet", marketplaceId: "mp_flipkart", externalSellerId: "SPCOM11", name: "SuperComNet", sellerType: "third_party", defaultFulfilmentType: "flipkart_assured", sellerGroupId: "grp_supercom" },
  { id: "sel_fk_wsretail", marketplaceId: "mp_flipkart", externalSellerId: "WSRB02", name: "WS Retail Services", sellerType: "marketplace_owned", defaultFulfilmentType: "flipkart_assured", sellerGroupId: null },
  { id: "sel_fk_electrohub", marketplaceId: "mp_flipkart", externalSellerId: "ELHB44", name: "ElectroHub India", sellerType: "third_party", defaultFulfilmentType: "flipkart_assured", sellerGroupId: null },
  { id: "sel_fk_omnitech", marketplaceId: "mp_flipkart", externalSellerId: "OMNT17", name: "OmniTech Traders", sellerType: "third_party", defaultFulfilmentType: "self_ship", sellerGroupId: null },

  { id: "sel_az_appario", marketplaceId: "mp_amazon_in", externalSellerId: "A2T8K1QJ", name: "Appario Retail Pvt Ltd", sellerType: "marketplace_owned", defaultFulfilmentType: "fba", sellerGroupId: null },
  { id: "sel_az_cloudtail", marketplaceId: "mp_amazon_in", externalSellerId: "A1P9M4XZ", name: "Cloudtail India", sellerType: "marketplace_owned", defaultFulfilmentType: "fba", sellerGroupId: null },
  { id: "sel_az_supercomnet", marketplaceId: "mp_amazon_in", externalSellerId: "A3X7QZLM", name: "SuperComNet", sellerType: "third_party", defaultFulfilmentType: "self_ship", sellerGroupId: "grp_supercom" },
  { id: "sel_az_rkworld", marketplaceId: "mp_amazon_in", externalSellerId: "A4M2P9RK", name: "RK World Infocom", sellerType: "third_party", defaultFulfilmentType: "fba", sellerGroupId: null },
  { id: "sel_az_primeelectronics", marketplaceId: "mp_amazon_in", externalSellerId: "A5Q7T3PE", name: "Prime Electronics Store", sellerType: "third_party", defaultFulfilmentType: "self_ship", sellerGroupId: null },

  { id: "sel_meesho_shreeenterprises", marketplaceId: "mp_meesho", externalSellerId: "MSH20194", name: "Shree Enterprises", sellerType: "third_party", defaultFulfilmentType: "self_ship", sellerGroupId: null },
  { id: "sel_meesho_urbanbazaar", marketplaceId: "mp_meesho", externalSellerId: "MSH38821", name: "Urban Bazaar Retail", sellerType: "third_party", defaultFulfilmentType: "self_ship", sellerGroupId: null },
];

export const sellerRatingSnapshots = [
  { id: "srs_1", sellerId: "sel_fk_retailnet", capturedAt: "2026-08-01", rating: 4.6, ratingCount: 128400 },
  { id: "srs_2", sellerId: "sel_fk_supercomnet", capturedAt: "2026-08-01", rating: 4.3, ratingCount: 54210 },
  { id: "srs_3", sellerId: "sel_fk_wsretail", capturedAt: "2026-08-01", rating: 4.7, ratingCount: 981500 },
  { id: "srs_4", sellerId: "sel_az_appario", capturedAt: "2026-08-01", rating: 4.4, ratingCount: 210500 },
  { id: "srs_5", sellerId: "sel_az_cloudtail", capturedAt: "2026-08-01", rating: 4.5, ratingCount: 189200 },
  { id: "srs_6", sellerId: "sel_az_supercomnet", capturedAt: "2026-08-01", rating: 4.1, ratingCount: 12300 },
  { id: "srs_7", sellerId: "sel_fk_electrohub", capturedAt: "2026-08-01", rating: 4.2, ratingCount: 8900 },
  { id: "srs_8", sellerId: "sel_fk_omnitech", capturedAt: "2026-08-01", rating: 4.0, ratingCount: 3400 },
  { id: "srs_9", sellerId: "sel_az_rkworld", capturedAt: "2026-08-01", rating: 4.3, ratingCount: 45200 },
  { id: "srs_10", sellerId: "sel_az_primeelectronics", capturedAt: "2026-08-01", rating: 4.1, ratingCount: 15600 },
  { id: "srs_11", sellerId: "sel_meesho_shreeenterprises", capturedAt: "2026-08-01", rating: 3.9, ratingCount: 21000 },
  { id: "srs_12", sellerId: "sel_meesho_urbanbazaar", capturedAt: "2026-08-01", rating: 4.0, ratingCount: 12800 },
];

export function getSeller(sellerId) {
  return sellers.find((s) => s.id === sellerId) ?? null;
}

export function getLatestSellerRating(sellerId) {
  const rows = sellerRatingSnapshots
    .filter((r) => r.sellerId === sellerId)
    .sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
  return rows[0] ?? null;
}
