import { mulberry32, hashSeed } from "./seededRandom";
import { marketplaces } from "../data/marketplaces";

/**
 * SELLER ECOSYSTEM
 * ================
 *
 * A marketplace's competitive dynamics live at the SELLER layer, not the
 * product layer: the same product, on the same listing, is contested by
 * merchants with different fulfilment, different ratings and different
 * appetites for margin. A dozen hand-written sellers could not represent that,
 * so the ecosystem is generated — deterministically, from a seeded PRNG keyed
 * on the seller id, so the same demo always shows the same merchants.
 *
 * WHAT IS MODELLED, AND WHY
 * -------------------------
 *  · Sellers are SCOPED TO ONE MARKETPLACE. That is how the entity actually
 *    works: a merchant account on Flipkart is a different account, with a
 *    different rating and a different id, from the same company's Amazon
 *    account. Cross-marketplace identity is expressed through `sellerGroupId`,
 *    never by reusing a seller row across marketplaces.
 *
 *  · `sellerGroupId` links accounts belonging to one real business. Roughly a
 *    fifth of generated sellers belong to a group that trades on more than one
 *    platform. This is the only construct that lets the system say "this is the
 *    same merchant undercutting you on two marketplaces" without pretending the
 *    accounts are one row.
 *
 *  · SIZE IS A DISTRIBUTION, NOT A LABEL. Real marketplaces are extremely
 *    top-heavy: a handful of very large sellers carry a large share of the
 *    catalogue, and a long tail of small merchants each carry a few listings.
 *    `tier` (anchor / established / small) drives how many offers a seller
 *    receives in catalogueGenerator, so the offer distribution inherits that
 *    shape rather than spreading offers evenly.
 *
 *  · RATING FOLLOWS SIZE, LOOSELY. Bigger sellers rate slightly better and
 *    carry far more rating volume, but the correlation is deliberately weak —
 *    a well-run small seller outrating a large one is common, and a model that
 *    made rating a pure function of size would make seller rating useless as an
 *    independent signal.
 */

// Name construction. Real Indian marketplace seller names are overwhelmingly
// built from a small vocabulary of trade words, which is why they look
// repetitive in practice — this mirrors that rather than inventing exotica.
const PREFIXES = [
  "Shree", "Shri", "Sri", "Om", "New", "Royal", "Global", "Prime", "Star", "Metro",
  "Unique", "Perfect", "Smart", "Digital", "Modern", "National", "United", "Supreme",
  "Classic", "Elite", "Grand", "Golden", "Silver", "Crystal", "Diamond", "Pearl",
  "Kiran", "Laxmi", "Ganesh", "Krishna", "Balaji", "Sai", "Amba", "Durga", "Radha",
  "Bharat", "Hind", "Indo", "Deccan", "Konark", "Vindhya", "Ganga", "Yamuna",
];

const MIDDLES = [
  "Tech", "Trade", "Retail", "Sales", "Mart", "Bazaar", "Store", "Shop", "Hub",
  "Point", "Zone", "World", "Galaxy", "Corner", "Junction", "Plaza", "Arcade",
  "Electro", "Digi", "Fashion", "Style", "Home", "Living", "Care", "Life",
];

const SUFFIXES = [
  "Enterprises", "Traders", "Retail", "Corporation", "Industries", "Solutions",
  "Marketing", "Distributors", "Agencies", "Ventures", "Commerce", "Impex",
  "Overseas", "Associates", "& Sons", "& Co", "India", "Pvt Ltd", "LLP", "Group",
];

const CITY_TAGS = [
  "Delhi", "Mumbai", "Bengaluru", "Chennai", "Hyderabad", "Pune", "Kolkata",
  "Ahmedabad", "Jaipur", "Lucknow", "Surat", "Indore", "Nagpur", "Coimbatore",
];

// Fulfilment options differ per marketplace — this is a real structural
// difference between platforms, not cosmetic.
const FULFILMENT_BY_MARKETPLACE = {
  mp_flipkart: ["flipkart_assured", "flipkart_assured", "self_ship"],
  mp_amazon_in: ["fba", "fba", "self_ship", "amazon_easy_ship"],
  mp_meesho: ["self_ship", "meesho_fulfilled"],
  mp_myntra: ["myntra_fulfilled", "self_ship"],
  mp_ajio: ["ajio_fulfilled", "self_ship"],
  mp_nykaa: ["nykaa_fulfilled", "self_ship"],
};

// How many seller accounts each marketplace carries. Horizontals run far larger
// merchant bases than verticals, which is why the counts are not uniform.
const SELLERS_PER_MARKETPLACE = {
  mp_flipkart: 320,
  mp_amazon_in: 340,
  mp_meesho: 210,
  mp_myntra: 120,
  mp_ajio: 95,
  mp_nykaa: 80,
};

// Size distribution. Anchors are few and carry a lot; the tail is long.
const TIER_MIX = [
  { tier: "anchor", share: 0.04, maxOffers: 90, ratingBase: 4.35, ratingCountBase: 180000 },
  { tier: "established", share: 0.26, maxOffers: 26, ratingBase: 4.15, ratingCountBase: 24000 },
  { tier: "small", share: 0.7, maxOffers: 7, ratingBase: 3.95, ratingCountBase: 1800 },
];

const MARKETPLACE_OWNED = {
  mp_flipkart: ["WS Retail Services", "Omnitech Retail"],
  mp_amazon_in: ["Appario Retail Pvt Ltd", "Cloudtail India"],
  mp_myntra: ["Myntra Jabong India"],
  mp_ajio: ["Reliance Retail AJIO"],
  mp_nykaa: ["FSN E-Commerce Ventures"],
  mp_meesho: [],
};

const EXTERNAL_ID_PREFIX = {
  mp_flipkart: "FKS",
  mp_amazon_in: "A",
  mp_meesho: "MSH",
  mp_myntra: "MYN",
  mp_ajio: "AJO",
  mp_nykaa: "NYK",
};

function pick(arr, rand) {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}

function buildName(rand) {
  const shape = rand();
  if (shape < 0.3) return `${pick(PREFIXES, rand)} ${pick(SUFFIXES, rand)}`;
  if (shape < 0.62) return `${pick(PREFIXES, rand)} ${pick(MIDDLES, rand)}`;
  if (shape < 0.85) return `${pick(PREFIXES, rand)} ${pick(MIDDLES, rand)} ${pick(SUFFIXES, rand)}`;
  return `${pick(MIDDLES, rand)} ${pick(SUFFIXES, rand)} ${pick(CITY_TAGS, rand)}`;
}

function tierFor(index, total) {
  const position = index / total;
  let cumulative = 0;
  for (const t of TIER_MIX) {
    cumulative += t.share;
    if (position < cumulative) return t;
  }
  return TIER_MIX[TIER_MIX.length - 1];
}

function build() {
  const sellers = [];
  const ratingSnapshots = [];
  const usedNames = new Set();
  let groupCounter = 0;

  // Multi-marketplace merchant groups, allocated first so accounts on different
  // platforms can be linked to the same underlying business.
  const groupPool = [];
  for (let g = 0; g < 140; g++) {
    groupPool.push({ id: `grp_${g.toString(36).padStart(3, "0")}`, name: null, used: [] });
  }

  for (const mp of marketplaces) {
    const count = SELLERS_PER_MARKETPLACE[mp.id] ?? 60;
    const fulfilmentOptions = FULFILMENT_BY_MARKETPLACE[mp.id] ?? ["self_ship"];
    const owned = MARKETPLACE_OWNED[mp.id] ?? [];

    for (let i = 0; i < count; i++) {
      const sellerId = `sel_${mp.id.replace("mp_", "")}_${i.toString(36).padStart(3, "0")}`;
      const rand = mulberry32(hashSeed(sellerId));
      const tierSpec = tierFor(i, count);

      // The first few accounts on each marketplace are its own retail arms.
      const isOwned = i < owned.length;
      let name = isOwned ? owned[i] : buildName(rand);

      // Names collide often given the vocabulary; disambiguate the way real
      // sellers do, with a city or a numeral, rather than by discarding.
      if (!isOwned && usedNames.has(`${mp.id}::${name}`)) {
        name = `${name} ${pick(CITY_TAGS, rand)}`;
        if (usedNames.has(`${mp.id}::${name}`)) name = `${name} ${i}`;
      }
      usedNames.add(`${mp.id}::${name}`);

      // ~18% of non-owned sellers belong to a multi-marketplace group.
      let sellerGroupId = null;
      if (!isOwned && rand() < 0.18) {
        const group = groupPool[groupCounter % groupPool.length];
        groupCounter++;
        if (!group.used.includes(mp.id)) {
          group.used.push(mp.id);
          if (group.name === null) group.name = name;
          else name = group.name; // same business, same trading name
          sellerGroupId = group.id;
        }
      }

      const rating = Math.round(
        Math.min(4.9, Math.max(3.1, tierSpec.ratingBase + (rand() - 0.45) * 0.8)) * 10
      ) / 10;
      const ratingCount = Math.max(
        12,
        Math.round(tierSpec.ratingCountBase * (0.35 + rand() * 1.6))
      );

      sellers.push({
        id: sellerId,
        marketplaceId: mp.id,
        externalSellerId: `${EXTERNAL_ID_PREFIX[mp.id]}${Math.abs(hashSeed(sellerId)).toString(36).toUpperCase().slice(-7)}`,
        name,
        sellerType: isOwned ? "marketplace_owned" : "third_party",
        defaultFulfilmentType: isOwned ? fulfilmentOptions[0] : pick(fulfilmentOptions, rand),
        sellerGroupId,
        sellerTier: tierSpec.tier,
        maxOffers: tierSpec.maxOffers,
        // Not every seller has a long history on the platform. Newer accounts
        // are exactly the ones whose rating should be trusted least, and the
        // evidence layer reads this.
        onboardedAt: `${2023 + Math.floor(rand() * 3)}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}`,
      });

      // Rating history: two snapshots for most sellers, one for the newest —
      // so `getLatestSellerRating` has something to move against, and sparse
      // seller history is represented rather than assumed away.
      const snapshotCount = tierSpec.tier === "small" && rand() < 0.4 ? 1 : 2;
      for (let s = 0; s < snapshotCount; s++) {
        const isLatest = s === snapshotCount - 1;
        ratingSnapshots.push({
          id: `srs_${sellerId}_${s}`,
          sellerId,
          capturedAt: isLatest ? "2026-08-01" : "2026-05-01",
          rating: isLatest ? rating : Math.round(Math.max(3.0, rating - (rand() * 0.3 - 0.1)) * 10) / 10,
          ratingCount: isLatest ? ratingCount : Math.round(ratingCount * (0.72 + rand() * 0.16)),
        });
      }
    }
  }

  return { sellers, ratingSnapshots };
}

const generated = build();

export const generatedSellers = generated.sellers;
export const generatedSellerRatingSnapshots = generated.ratingSnapshots;

/** Sellers available on a marketplace, largest first — the generator draws from the head. */
export function sellersForMarketplace(marketplaceId) {
  return generated.sellers.filter((s) => s.marketplaceId === marketplaceId);
}
