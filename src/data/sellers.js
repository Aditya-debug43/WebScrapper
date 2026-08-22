import { generatedSellers, generatedSellerRatingSnapshots } from "../utils/sellerGenerator";

// Seller = a merchant account, SCOPED TO ONE MARKETPLACE. Ratings are a
// snapshot series (level + rate both matter), never a mutable column.
//
// The curated sellers below are the ones the hand-authored demo products
// (Galaxy M14 family and their comparables) trade through. They are kept
// verbatim because their offers, promotions and price histories are
// hand-authored against these exact ids. Everything else comes from
// utils/sellerGenerator — see that file for how the ecosystem is shaped.
//
// `sellerGroupId` is the ONLY way one business is expressed across
// marketplaces: "SuperComNet" below is two separate accounts, on Flipkart and
// Amazon, linked by `grp_supercom`. The engine treats them as two competing
// offers, because that is what a buyer sees, while the group id preserves the
// fact that one merchant is behind both.
const curatedSellers = [
  { id: "sel_fk_retailnet", marketplaceId: "mp_flipkart", externalSellerId: "RETNET29", name: "RetailNet Commerce", sellerType: "third_party", defaultFulfilmentType: "flipkart_assured", sellerGroupId: null, sellerTier: "established", maxOffers: 30, onboardedAt: "2023-04-11" },
  { id: "sel_fk_supercomnet", marketplaceId: "mp_flipkart", externalSellerId: "SPCOM11", name: "SuperComNet", sellerType: "third_party", defaultFulfilmentType: "flipkart_assured", sellerGroupId: "grp_supercom", sellerTier: "established", maxOffers: 30, onboardedAt: "2023-07-02" },
  { id: "sel_fk_wsretail", marketplaceId: "mp_flipkart", externalSellerId: "WSRB02", name: "WS Retail Services", sellerType: "marketplace_owned", defaultFulfilmentType: "flipkart_assured", sellerGroupId: null, sellerTier: "anchor", maxOffers: 90, onboardedAt: "2023-01-05" },
  { id: "sel_fk_electrohub", marketplaceId: "mp_flipkart", externalSellerId: "ELHB44", name: "ElectroHub India", sellerType: "third_party", defaultFulfilmentType: "flipkart_assured", sellerGroupId: null, sellerTier: "established", maxOffers: 26, onboardedAt: "2024-02-19" },
  { id: "sel_fk_omnitech", marketplaceId: "mp_flipkart", externalSellerId: "OMNT17", name: "OmniTech Traders", sellerType: "third_party", defaultFulfilmentType: "self_ship", sellerGroupId: null, sellerTier: "small", maxOffers: 8, onboardedAt: "2024-09-30" },

  { id: "sel_az_appario", marketplaceId: "mp_amazon_in", externalSellerId: "A2T8K1QJ", name: "Appario Retail Pvt Ltd", sellerType: "marketplace_owned", defaultFulfilmentType: "fba", sellerGroupId: null, sellerTier: "anchor", maxOffers: 90, onboardedAt: "2023-01-08" },
  { id: "sel_az_cloudtail", marketplaceId: "mp_amazon_in", externalSellerId: "A1P9M4XZ", name: "Cloudtail India", sellerType: "marketplace_owned", defaultFulfilmentType: "fba", sellerGroupId: null, sellerTier: "anchor", maxOffers: 90, onboardedAt: "2023-01-08" },
  { id: "sel_az_supercomnet", marketplaceId: "mp_amazon_in", externalSellerId: "A3X7QZLM", name: "SuperComNet", sellerType: "third_party", defaultFulfilmentType: "self_ship", sellerGroupId: "grp_supercom", sellerTier: "small", maxOffers: 9, onboardedAt: "2024-03-14" },
  { id: "sel_az_rkworld", marketplaceId: "mp_amazon_in", externalSellerId: "A4M2P9RK", name: "RK World Infocom", sellerType: "third_party", defaultFulfilmentType: "fba", sellerGroupId: null, sellerTier: "established", maxOffers: 26, onboardedAt: "2023-11-22" },
  { id: "sel_az_primeelectronics", marketplaceId: "mp_amazon_in", externalSellerId: "A5Q7T3PE", name: "Prime Electronics Store", sellerType: "third_party", defaultFulfilmentType: "self_ship", sellerGroupId: null, sellerTier: "small", maxOffers: 9, onboardedAt: "2025-01-17" },

  { id: "sel_meesho_shreeenterprises", marketplaceId: "mp_meesho", externalSellerId: "MSH20194", name: "Shree Enterprises", sellerType: "third_party", defaultFulfilmentType: "self_ship", sellerGroupId: null, sellerTier: "established", maxOffers: 26, onboardedAt: "2023-06-04" },
  { id: "sel_meesho_urbanbazaar", marketplaceId: "mp_meesho", externalSellerId: "MSH38821", name: "Urban Bazaar Retail", sellerType: "third_party", defaultFulfilmentType: "self_ship", sellerGroupId: null, sellerTier: "small", maxOffers: 8, onboardedAt: "2024-08-12" },
];

const curatedRatingSnapshots = [
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

export const sellers = [...curatedSellers, ...generatedSellers];
export const sellerRatingSnapshots = [...curatedRatingSnapshots, ...generatedSellerRatingSnapshots];

const sellerById = new Map(sellers.map((s) => [s.id, s]));

const latestRatingBySeller = (() => {
  const map = new Map();
  for (const row of sellerRatingSnapshots) {
    const existing = map.get(row.sellerId);
    if (!existing || existing.capturedAt < row.capturedAt) map.set(row.sellerId, row);
  }
  return map;
})();

const sellersByMarketplace = (() => {
  const map = new Map();
  for (const s of sellers) {
    if (!map.has(s.marketplaceId)) map.set(s.marketplaceId, []);
    map.get(s.marketplaceId).push(s);
  }
  return map;
})();

export function getSeller(sellerId) {
  return sellerById.get(sellerId) ?? null;
}

export function getLatestSellerRating(sellerId) {
  return latestRatingBySeller.get(sellerId) ?? null;
}

export function getSellersForMarketplace(marketplaceId) {
  return sellersByMarketplace.get(marketplaceId) ?? [];
}

/** Every seller account belonging to the same underlying business. */
export function getSellerGroupMembers(sellerGroupId) {
  if (!sellerGroupId) return [];
  return sellers.filter((s) => s.sellerGroupId === sellerGroupId);
}
