import { generatedOffers } from "../utils/catalogueGenerator";

// Offer = the commercial relationship between one seller and one listing.
// Deliberately holds NO price fields — current price is derived as the
// latest price_observation row, never a competing source of truth here.

const curatedOffers = [
  // ---- lst_fk_m14_6_128 : 3 competing sellers ----
  { id: "off_fk_m14_6_128_wsretail", listingId: "lst_fk_m14_6_128", sellerId: "sel_fk_wsretail", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-05-04" },
  { id: "off_fk_m14_6_128_retailnet", listingId: "lst_fk_m14_6_128", sellerId: "sel_fk_retailnet", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-05-04" },
  { id: "off_fk_m14_6_128_supercomnet", listingId: "lst_fk_m14_6_128", sellerId: "sel_fk_supercomnet", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-06-10" },

  // ---- lst_az_m14_6_128 : 3 competing sellers ----
  { id: "off_az_m14_6_128_appario", listingId: "lst_az_m14_6_128", sellerId: "sel_az_appario", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-05-06" },
  { id: "off_az_m14_6_128_cloudtail", listingId: "lst_az_m14_6_128", sellerId: "sel_az_cloudtail", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-07-01" },
  { id: "off_az_m14_6_128_supercomnet", listingId: "lst_az_m14_6_128", sellerId: "sel_az_supercomnet", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-09-15" },

  // ---- lst_fk_m14_8_256 : 2 sellers ----
  { id: "off_fk_m14_8_256_wsretail", listingId: "lst_fk_m14_8_256", sellerId: "sel_fk_wsretail", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-05-04" },
  { id: "off_fk_m14_8_256_retailnet", listingId: "lst_fk_m14_8_256", sellerId: "sel_fk_retailnet", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-05-10" },

  // ---- lst_az_m14_8_256 : 2 sellers ----
  { id: "off_az_m14_8_256_appario", listingId: "lst_az_m14_8_256", sellerId: "sel_az_appario", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-05-07" },
  { id: "off_az_m14_8_256_cloudtail", listingId: "lst_az_m14_8_256", sellerId: "sel_az_cloudtail", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-07-05" },

  // ---- comparable-set listings : single offer each ----
  { id: "off_fk_redminote13", listingId: "lst_fk_redminote13", sellerId: "sel_fk_supercomnet", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-02-12" },
  { id: "off_fk_realme12x", listingId: "lst_fk_realme12x", sellerId: "sel_fk_retailnet", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-01-22" },
  { id: "off_az_oneplusnordce4lite", listingId: "lst_az_oneplusnordce4lite", sellerId: "sel_az_appario", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-04-17" },
  { id: "off_az_vivot3x", listingId: "lst_az_vivot3x", sellerId: "sel_az_cloudtail", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-03-03" },
  { id: "off_az_iphone13", listingId: "lst_az_iphone13", sellerId: "sel_az_supercomnet", itemCondition: "new", offerStatus: "active", firstSeenAt: "2024-09-12" },

  // ---- expanded coverage on existing products ----
  { id: "off_meesho_redminote13", listingId: "lst_meesho_redminote13", sellerId: "sel_meesho_shreeenterprises", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-09-01" },
  { id: "off_fk_redminote13_electrohub", listingId: "lst_fk_redminote13", sellerId: "sel_fk_electrohub", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-10-01" },
  { id: "off_fk_oneplusnordce4lite", listingId: "lst_fk_oneplusnordce4lite", sellerId: "sel_fk_retailnet", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-05-01" },

  // ---- iPhone 15 : 2 sellers per marketplace ----
  { id: "off_fk_iphone15_wsretail", listingId: "lst_fk_iphone15", sellerId: "sel_fk_wsretail", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-09-22" },
  { id: "off_fk_iphone15_electrohub", listingId: "lst_fk_iphone15", sellerId: "sel_fk_electrohub", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-09-25" },
  { id: "off_az_iphone15_appario", listingId: "lst_az_iphone15", sellerId: "sel_az_appario", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-09-23" },
  { id: "off_az_iphone15_cloudtail", listingId: "lst_az_iphone15", sellerId: "sel_az_cloudtail", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-09-24" },

  // ---- Redmi A3 : budget tier ----
  { id: "off_meesho_redmia3", listingId: "lst_meesho_redmia3", sellerId: "sel_meesho_urbanbazaar", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-06-03" },
  { id: "off_fk_redmia3", listingId: "lst_fk_redmia3", sellerId: "sel_fk_omnitech", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-06-02" },

  // ---- Laptops ----
  { id: "off_fk_ideapad_i3_retailnet", listingId: "lst_fk_ideapad_i3", sellerId: "sel_fk_retailnet", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-07-03" },
  { id: "off_fk_ideapad_i3_electrohub", listingId: "lst_fk_ideapad_i3", sellerId: "sel_fk_electrohub", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-07-08" },
  { id: "off_fk_ideapad_i5_wsretail", listingId: "lst_fk_ideapad_i5", sellerId: "sel_fk_wsretail", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-07-03" },
  { id: "off_az_ideapad_i5_rkworld", listingId: "lst_az_ideapad_i5", sellerId: "sel_az_rkworld", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-07-10" },
  { id: "off_az_dellinspiron15_appario", listingId: "lst_az_dellinspiron15", sellerId: "sel_az_appario", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-05-22" },
  { id: "off_az_dellinspiron15_rkworld", listingId: "lst_az_dellinspiron15", sellerId: "sel_az_rkworld", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-05-28" },
  { id: "off_fk_hppavilion15_omnitech", listingId: "lst_fk_hppavilion15", sellerId: "sel_fk_omnitech", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-04-12" },
  { id: "off_fk_asusvivobook15_retailnet", listingId: "lst_fk_asusvivobook15", sellerId: "sel_fk_retailnet", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-06-17" },
  { id: "off_az_asusvivobook15_primeelectronics", listingId: "lst_az_asusvivobook15", sellerId: "sel_az_primeelectronics", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-06-20" },
  { id: "off_az_macbookair_m2_appario", listingId: "lst_az_macbookair_m2", sellerId: "sel_az_appario", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-03-05" },
  { id: "off_az_macbookair_m2_cloudtail", listingId: "lst_az_macbookair_m2", sellerId: "sel_az_cloudtail", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-03-08" },
  // lst_fk_rogstrix intentionally has NO offers — "no current seller" scenario.

  // ---- Wireless earbuds ----
  { id: "off_fk_boatairdopes141_omnitech", listingId: "lst_fk_boatairdopes141", sellerId: "sel_fk_omnitech", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-02-03" },
  { id: "off_fk_boatairdopes141_retailnet", listingId: "lst_fk_boatairdopes141", sellerId: "sel_fk_retailnet", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-02-15" },
  { id: "off_meesho_boatairdopes141", listingId: "lst_meesho_boatairdopes141", sellerId: "sel_meesho_shreeenterprises", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-02-10" },
  { id: "off_fk_realmebudst300_electrohub", listingId: "lst_fk_realmebudst300", sellerId: "sel_fk_electrohub", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-03-12" },
  { id: "off_az_oneplusbuds3_appario", listingId: "lst_az_oneplusbuds3", sellerId: "sel_az_appario", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-05-07" },
  { id: "off_az_oneplusbuds3_primeelectronics", listingId: "lst_az_oneplusbuds3", sellerId: "sel_az_primeelectronics", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-05-12" },
  { id: "off_az_galaxybudsfe_cloudtail", listingId: "lst_az_galaxybudsfe", sellerId: "sel_az_cloudtail", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-01-18" },
  { id: "off_fk_galaxybudsfe_wsretail", listingId: "lst_fk_galaxybudsfe", sellerId: "sel_fk_wsretail", itemCondition: "new", offerStatus: "active", firstSeenAt: "2025-01-20" },
  { id: "off_az_airpodspro2_appario", listingId: "lst_az_airpodspro2", sellerId: "sel_az_appario", itemCondition: "new", offerStatus: "active", firstSeenAt: "2024-11-05" },
  { id: "off_az_airpodspro2_rkworld", listingId: "lst_az_airpodspro2", sellerId: "sel_az_rkworld", itemCondition: "renewed", offerStatus: "active", firstSeenAt: "2025-01-10" },
];

export const offers = [...curatedOffers, ...generatedOffers];

const offerById = new Map(offers.map((o) => [o.id, o]));
const offersByListingId = (() => {
  const map = new Map();
  for (const o of offers) {
    let arr = map.get(o.listingId);
    if (!arr) map.set(o.listingId, (arr = []));
    arr.push(o);
  }
  return map;
})();

export function getOffer(offerId) {
  return offerById.get(offerId) ?? null;
}

export function getOffersForListing(listingId) {
  return offersByListingId.get(listingId) ?? [];
}
