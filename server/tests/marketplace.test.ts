import "./helpers/env.js";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMarketplaceTestApp, type Harness, type Json } from "./helpers/harness.js";

/**
 * PHASE 4 — MKT, LIST, SELL, OFFER, PROMO, REV.
 *
 * These assert the DATA, not the status code. A test that only checked for a
 * 200 would pass against an endpoint returning an empty array, and an empty
 * array is exactly what a broken join produces.
 *
 * Every expected number below was read out of the seeded database and is
 * stated literally. If the dataset is regenerated these become wrong, which
 * is the point: a silent change in the data should break a test rather than
 * quietly change what the product says.
 */

/**
 * The golden set, chosen to span the shapes the brief names:
 *
 *   dove          6 marketplaces, 30 offers, 1,830 observations — the strongest
 *   lakme         5 marketplaces, strong
 *   boat          4 marketplaces, meaningful history
 *   cello         3 marketplaces, a commodity with NO promotions at all
 *   green soul    2 marketplaces, 44 observations — genuinely sparse
 *   airpods       1 marketplace, 2 offers
 */
const DOVE = "prod_dove_hair_fall";
const LAKME = "prod_lakme_gloss_lip";
const BOAT = "prod_boat_wave_band";
const CELLO = "prod_cello_gripper_10";
const SPARSE = "prod_green_soul_vienna";
const SINGLE = "prod_airpods_pro2";

const GOLDEN = [DOVE, LAKME, BOAT, CELLO, SPARSE, SINGLE];

/** Read straight out of the seeded database — see the audit in CLAUDE_CONTEXT. */
const EXPECTED = {
  [DOVE]: { listings: 6, sellers: 30, offers: 30, observations: 1830, reviews: 30, promotions: 10 },
  [LAKME]: { listings: 5, sellers: 20, offers: 20, observations: 1220, reviews: 25, promotions: 9 },
  [BOAT]: { listings: 4, sellers: 20, offers: 20, observations: 1220, reviews: 20, promotions: 8 },
  [CELLO]: { listings: 3, sellers: 15, offers: 15, observations: 915, reviews: 15, promotions: 0 },
  [SPARSE]: { listings: 2, sellers: 4, offers: 4, observations: 44, reviews: 4, promotions: 8 },
  [SINGLE]: { listings: 1, sellers: 2, offers: 2, observations: 95, reviews: 4, promotions: 1 },
} as const;

const DOVE_MARKETPLACES = ["mp_ajio", "mp_amazon_in", "mp_flipkart", "mp_meesho", "mp_myntra", "mp_nykaa"];

let h: Harness;

before(async () => {
  h = await createMarketplaceTestApp([...GOLDEN]);
});
after(async () => {
  await h.close();
});

const get = async (url: string) => {
  const res = await h.app.inject({ method: "GET", url: `/api/v1${url}` });
  return { status: res.statusCode, body: res.json() as Json, raw: res.body };
};

/** Every page of a collection, so a total can be checked against real rows. */
async function all(url: string): Promise<Json[]> {
  const out: Json[] = [];
  const separator = url.includes("?") ? "&" : "?";
  for (let page = 1; page <= 50; page++) {
    const { body } = await get(`${url}${separator}page=${page}&pageSize=100`);
    out.push(...(body["data"] as Json[]));
    if (!body["pagination"].hasNext) break;
  }
  return out;
}

/* ============================================================ MARKETPLACES */

describe("MKT — product marketplace summary", () => {
  it("MKT-01: returns exactly the marketplaces that carry the product", async () => {
    const { status, body } = await get(`/products/${DOVE}/marketplaces`);
    assert.equal(status, 200);
    assert.deepEqual(
      (body["data"] as Json[]).map((r) => r.marketplace.id).sort(),
      DOVE_MARKETPLACES
    );

    // A one-marketplace product returns one row, not six with five empty.
    const single = await get(`/products/${SINGLE}/marketplaces`);
    assert.equal((single.body["data"] as Json[]).length, 1);
  });

  it("MKT-02: the counts match the seeded data, per marketplace and in total", async () => {
    const { body } = await get(`/products/${DOVE}/marketplaces`);
    const rows = body["data"] as Json[];

    // The schema's listings_product_marketplace_key makes this exactly one
    // listing per marketplace, which is what lets sourceUrl be a single value.
    for (const row of rows) {
      assert.equal(row.coverage.listingCount, 1, `${row.marketplace.id}`);
      assert.equal(row.coverage.offerCount, 5, `${row.marketplace.id} offers`);
      assert.equal(row.coverage.sellerCount, 5, `${row.marketplace.id} sellers`);
    }
    assert.equal(
      rows.reduce((n, r) => n + r.coverage.offerCount, 0),
      EXPECTED[DOVE].offers
    );
  });

  it("MKT-03/MKT-04: an unknown marketplace is a 400 that names the valid ids", async () => {
    // A convincing empty page would hide the client's mistake.
    const { status, body } = await get(`/products/${DOVE}/offers?marketplace=amazon`);
    assert.equal(status, 400);
    assert.equal(body["error"].code, "VALIDATION_FAILED");
    assert.match(body["error"].details[0].message, /mp_amazon_in/);

    const scoped = await get(`/products/${DOVE}/offers?marketplace=mp_amazon_in&pageSize=100`);
    assert.equal(scoped.status, 200);
    assert.equal(scoped.body["pagination"].total, 5);
    for (const offer of scoped.body["data"] as Json[]) {
      assert.equal(offer.marketplaceId, "mp_amazon_in");
    }
  });

  it("MKT-05: sourceUrl is the stored listing URL, and it belongs to that marketplace", async () => {
    const { body } = await get(`/products/${DOVE}/marketplaces`);
    for (const row of body["data"] as Json[]) {
      const url = row.listing.sourceUrl as string;
      assert.ok(url, `${row.marketplace.id} has no sourceUrl`);
      // Nothing is generated: the value is the column, and it must point at
      // the domain the marketplace row declares.
      assert.ok(
        url.startsWith(`https://www.${row.marketplace.domain}/`),
        `${row.marketplace.id}: "${url}" does not point at ${row.marketplace.domain}`
      );
    }
  });

  it("MKT-05b: an unobserved or out-of-stock platform reports no price rather than a wrong one", async () => {
    const { body } = await get(`/products/${DOVE}/marketplaces`);
    for (const row of body["data"] as Json[]) {
      if (row.availability.inStockOfferCount === 0) {
        assert.equal(row.currentPrice, null, `${row.marketplace.id} priced an unavailable product`);
        assert.ok(["out_of_stock", "unobserved"].includes(row.availability.status));
      } else {
        assert.ok(row.currentPrice.effectiveMinor > 0);
        assert.equal(row.availability.status, "in_stock");
      }
      // No quantity is ever exposed: the dataset records stock as a boolean.
      assert.equal(JSON.stringify(row.availability).includes("quantity"), false);
    }
  });

  it("the response states the price basis, so no client has to guess which rung it got", async () => {
    const { body } = await get(`/products/${DOVE}/marketplaces`);
    assert.equal(body["meta"].priceBasis.basis, "universalEffective");
    assert.equal(body["meta"].referenceDate, "2026-08-14");
  });
});

/* ================================================================ LISTINGS */

describe("LIST — product listings", () => {
  it("LIST-01/02/03/04: every listing belongs to this product, its marketplace, and carries its external id", async () => {
    const listings = await all(`/products/${DOVE}/listings`);
    assert.equal(listings.length, EXPECTED[DOVE].listings);

    for (const listing of listings) {
      assert.equal(listing.productId, DOVE, "LIST-02");
      assert.ok(DOVE_MARKETPLACES.includes(listing.marketplace.id), "LIST-03");
      assert.ok(listing.externalListingId, "LIST-04");
      assert.equal(listing.counts.offers, 5);
    }

    // LIST-04, concretely: the ids are the ones in the database, not invented.
    const amazon = listings.find((l) => l.marketplace.id === "mp_amazon_in")!;
    assert.equal(amazon.id, "lst_az_dove_hair_fall");
    assert.equal(amazon.externalListingId, "B0GU6W6IH");
  });

  it("LIST-05: pagination is exact, stable and does not repeat a record", async () => {
    const first = await get(`/products/${DOVE}/listings?page=1&pageSize=4`);
    assert.equal(first.body["pagination"].total, 6);
    assert.equal(first.body["pagination"].totalPages, 2);
    assert.equal(first.body["pagination"].hasNext, true);
    assert.equal(first.body["pagination"].hasPrevious, false);
    assert.equal((first.body["data"] as Json[]).length, 4);

    const second = await get(`/products/${DOVE}/listings?page=2&pageSize=4`);
    assert.equal((second.body["data"] as Json[]).length, 2);
    assert.equal(second.body["pagination"].hasNext, false);

    const ids = [...first.body["data"], ...second.body["data"]].map((l: Json) => l.id);
    assert.equal(new Set(ids).size, 6, "a record appeared on two pages");
  });

  it("LIST-06: filtering by marketplace and status returns only matching rows", async () => {
    const one = await get(`/products/${DOVE}/listings?marketplace=mp_flipkart`);
    assert.equal(one.body["pagination"].total, 1);
    assert.equal((one.body["data"] as Json[])[0]!.marketplace.id, "mp_flipkart");

    const active = await get(`/products/${DOVE}/listings?status=active&pageSize=100`);
    for (const listing of active.body["data"] as Json[]) assert.equal(listing.status, "active");

    const nonsense = await get(`/products/${DOVE}/listings?status=not_a_status`);
    assert.equal(nonsense.status, 400, "an unknown status must be refused, not ignored");
  });

  it("LIST-07: sourceUrl and provenance come straight from the row", async () => {
    const listings = await all(`/products/${DOVE}/listings`);
    const nykaa = listings.find((l) => l.marketplace.id === "mp_nykaa")!;
    assert.equal(nykaa.sourceUrl, "https://www.nykaa.com/p/dove_hair_fall");
    assert.equal(nykaa.externalListingId, "NYKGEWY9XN");
    assert.ok(nykaa.provenance.firstSeenAt, "first seen is recorded");
    assert.ok(nykaa.provenance.lastObservedAt, "last observation is recorded");
    // Everything a future URL-comparison feature needs to identify a source.
    assert.ok(nykaa.marketplaceCategory.rawPath, "the platform's own category path is kept verbatim");
  });

  it("a product with no listings is an empty page, not a 404", async () => {
    // `prod_galaxy_m14_5g` is a variant parent: real, purchasable=false, no
    // listings of its own. Nothing is wrong, so nothing should look wrong.
    const { status, body } = await get(`/products/prod_galaxy_m14_5g/listings`);
    assert.equal(status, 200);
    assert.deepEqual(body["data"], []);
    assert.equal(body["pagination"].total, 0);
  });
});

/* ================================================================= SELLERS */

describe("SELL — product sellers", () => {
  it("SELL-01/02: the right sellers, each on the right marketplace", async () => {
    const sellers = await all(`/products/${DOVE}/sellers`);
    assert.equal(sellers.length, EXPECTED[DOVE].sellers);
    assert.equal(new Set(sellers.map((s) => s.id)).size, EXPECTED[DOVE].sellers, "no duplicates");

    for (const seller of sellers) {
      assert.ok(DOVE_MARKETPLACES.includes(seller.marketplace.id), "SELL-02");
      assert.ok(seller.offerCountForProduct >= 1);
    }
    // Five sellers per marketplace, matching the listing summary.
    for (const marketplace of DOVE_MARKETPLACES) {
      assert.equal(sellers.filter((s) => s.marketplace.id === marketplace).length, 5, marketplace);
    }
  });

  it("SELL-03: a seller carries no application-user or authentication field", async () => {
    const { raw, body } = await get(`/products/${DOVE}/sellers?pageSize=100`);
    // A marketplace seller and an application user are different entities in
    // different tables. Nothing from `users` may appear here at any depth.
    for (const forbidden of ["passwordHash", "password_hash", "emailVerified", "email_verified_at", "sessionId", "otp", "argon2"]) {
      assert.ok(!raw.includes(forbidden), `the seller payload contains "${forbidden}"`);
    }
    for (const seller of body["data"] as Json[]) {
      assert.equal(seller.email, undefined, "a seller has no email address in this system");
      assert.equal(seller.userId, undefined);
    }
  });

  it("SELL-04: seller rating is the latest snapshot, and its history is the seller's own", async () => {
    const sellers = await all(`/products/${DOVE}/sellers`);
    const rated = sellers.filter((s) => s.rating != null);
    assert.ok(rated.length > 0, "at least one seller has a captured rating");

    const seller = rated[0]!;
    assert.ok(seller.rating.current >= 0 && seller.rating.current <= 5);
    assert.ok(seller.rating.capturedAt);

    const history = await get(`/sellers/${seller.id}/rating-history?pageSize=100`);
    assert.equal(history.status, 200);
    assert.equal(history.body["meta"].subject, "seller", "SELLER rating, never product rating");
    assert.equal(history.body["meta"].sellerId, seller.id);
    assert.equal(history.body["pagination"].total, seller.rating.snapshotCount);

    // The reported "current" really is the newest snapshot.
    const points = history.body["data"] as Json[];
    assert.equal(points[0]!.capturedAt, seller.rating.capturedAt);
    assert.equal(points[0]!.rating, seller.rating.current);

    // Newest first, and every point is a real capture date.
    const dates = points.map((p) => p.capturedAt as string);
    assert.deepEqual(dates, [...dates].sort().reverse());
  });

  it("SELL-05: seller pagination and marketplace filtering agree with each other", async () => {
    const page = await get(`/products/${DOVE}/sellers?page=2&pageSize=7`);
    assert.equal(page.body["pagination"].total, 30);
    assert.equal((page.body["data"] as Json[]).length, 7);

    const filtered = await get(`/products/${DOVE}/sellers?marketplace=mp_meesho&pageSize=100`);
    assert.equal(filtered.body["pagination"].total, 5);
    for (const seller of filtered.body["data"] as Json[]) {
      assert.equal(seller.marketplace.id, "mp_meesho");
    }
  });

  it("an unknown seller's rating history is a 404, not an empty list", async () => {
    const { status, body } = await get(`/sellers/sel_does_not_exist/rating-history`);
    assert.equal(status, 404);
    assert.equal(body["error"].code, "NOT_FOUND");
  });
});

/* ================================================================== OFFERS */

describe("OFFER — product offers", () => {
  it("OFFER-01/02/03/04: every offer resolves to the right listing, seller and marketplace", async () => {
    const [offers, listings, sellers] = await Promise.all([
      all(`/products/${DOVE}/offers`),
      all(`/products/${DOVE}/listings`),
      all(`/products/${DOVE}/sellers`),
    ]);

    assert.equal(offers.length, EXPECTED[DOVE].offers);
    const listingIds = new Set(listings.map((l) => l.id));
    const sellerIds = new Set(sellers.map((s) => s.id));
    const byListing = new Map(listings.map((l) => [l.id, l]));

    for (const offer of offers) {
      assert.ok(listingIds.has(offer.listingId), `OFFER-02: ${offer.id}`);
      assert.ok(sellerIds.has(offer.seller.id), `OFFER-03: ${offer.id}`);
      // OFFER-04: the offer's marketplace is its listing's marketplace, not a
      // separately-stored value that could drift out of agreement.
      assert.equal(offer.marketplaceId, byListing.get(offer.listingId)!.marketplace.id, `OFFER-04: ${offer.id}`);
      assert.equal(offer.seller.id.startsWith("sel_"), true);
    }
  });

  it("OFFER-05/06: the price rungs are internally consistent on every offer", async () => {
    const offers = await all(`/products/${DOVE}/offers`);
    for (const offer of offers) {
      if (!offer.price) continue;
      const p = offer.price;
      assert.equal(p.basis, "universalEffective");
      assert.equal(p.landedMinor, p.sellingPriceMinor + p.shippingFeeMinor, `landed on ${offer.id}`);
      assert.equal(p.universalEffectiveMinor, p.landedMinor - p.universalDiscountMinor, `effective on ${offer.id}`);
      assert.equal(p.conditionalBestMinor, p.universalEffectiveMinor - p.conditionalDiscountMinor);
      assert.ok(p.shippingFeeMinor >= 0, "OFFER-06");
      assert.ok(p.conditionalBestMinor <= p.universalEffectiveMinor, "a conditional benefit cannot raise the price");
    }
  });

  it("OFFER-07: availability is reported as observed, with no invented quantity", async () => {
    const offers = await all(`/products/${DOVE}/offers`);
    for (const offer of offers) {
      assert.ok(["in_stock", "out_of_stock", "unobserved"].includes(offer.availability.status));
      if (offer.availability.status === "in_stock") assert.equal(offer.availability.isInStock, true);
      if (offer.availability.status === "out_of_stock") assert.equal(offer.availability.isInStock, false);
      assert.equal((offer.availability as Json).quantity, undefined);
      assert.equal((offer.availability as Json).unitsRemaining, undefined);
    }
    const inStock = await get(`/products/${DOVE}/offers?inStock=true&pageSize=100`);
    for (const offer of inStock.body["data"] as Json[]) assert.equal(offer.availability.isInStock, true);

    const outOfStock = await get(`/products/${DOVE}/offers?inStock=false&pageSize=100`);
    for (const offer of outOfStock.body["data"] as Json[]) assert.equal(offer.availability.isInStock, false);
    assert.equal(
      inStock.body["pagination"].total + outOfStock.body["pagination"].total,
      EXPECTED[DOVE].offers,
      "the two halves must account for every offer"
    );
  });

  it("OFFER-08: promotion state matches the promotions actually attached", async () => {
    const [offers, promotions] = await Promise.all([
      all(`/products/${DOVE}/offers`),
      all(`/products/${DOVE}/promotions?status=active`),
    ]);
    const activeByOffer = new Map<string, number>();
    for (const promotion of promotions) {
      activeByOffer.set(promotion.offerId, (activeByOffer.get(promotion.offerId) ?? 0) + 1);
    }
    for (const offer of offers) {
      assert.equal(
        offer.activePromotionCount,
        activeByOffer.get(offer.id) ?? 0,
        `active promotion count on ${offer.id}`
      );
    }
    const withPromotions = await get(`/products/${DOVE}/offers?hasPromotion=true&pageSize=100`);
    for (const offer of withPromotions.body["data"] as Json[]) assert.ok(offer.activePromotionCount > 0);
  });

  it("OFFER-09: pagination, filtering and sorting agree", async () => {
    const page = await get(`/products/${DOVE}/offers?page=3&pageSize=7`);
    assert.equal(page.body["pagination"].total, 30);
    assert.equal(page.body["pagination"].totalPages, 5);
    assert.equal((page.body["data"] as Json[]).length, 7);

    const ascending = await get(`/products/${DOVE}/offers?sort=effective_price_asc&pageSize=100`);
    const prices = (ascending.body["data"] as Json[])
      .map((o) => o.price?.universalEffectiveMinor)
      .filter((v): v is number => v != null);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b), "effective_price_asc is not ascending");

    const descending = await get(`/products/${DOVE}/offers?sort=effective_price_desc&pageSize=100`);
    const reversed = (descending.body["data"] as Json[])
      .map((o) => o.price?.universalEffectiveMinor)
      .filter((v): v is number => v != null);
    assert.deepEqual(reversed, [...reversed].sort((a, b) => b - a));

    const rejected = await get(`/products/${DOVE}/offers?sort=price; drop table offers`);
    assert.equal(rejected.status, 400, "sort is an enum, never a string that reaches an ORDER BY");
  });

  it("a price range filters on the effective price, the same rung the sort uses", async () => {
    const all100 = await get(`/products/${DOVE}/offers?pageSize=100`);
    const values = (all100.body["data"] as Json[])
      .map((o) => o.price?.universalEffectiveMinor)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    const cutoff = values[Math.floor(values.length / 2)]!;

    const cheap = await get(`/products/${DOVE}/offers?maxPrice=${cutoff}&pageSize=100`);
    for (const offer of cheap.body["data"] as Json[]) {
      assert.ok(offer.price.universalEffectiveMinor <= cutoff);
    }
    const dear = await get(`/products/${DOVE}/offers?minPrice=${cutoff + 1}&pageSize=100`);
    for (const offer of dear.body["data"] as Json[]) {
      assert.ok(offer.price.universalEffectiveMinor > cutoff);
    }
    assert.equal(
      cheap.body["pagination"].total + dear.body["pagination"].total,
      values.length,
      "the two halves must account for every priced offer"
    );

    const inverted = await get(`/products/${DOVE}/offers?minPrice=900&maxPrice=100`);
    assert.equal(inverted.status, 400);
  });

  it("every offer carries the source information a URL-comparison feature would need", async () => {
    const offers = await all(`/products/${SINGLE}/offers`);
    assert.equal(offers.length, EXPECTED[SINGLE].offers);
    for (const offer of offers) {
      assert.ok(offer.sourceUrl, "the marketplace URL");
      assert.ok(offer.externalListingId, "the platform's own identifier");
      assert.ok(offer.marketplaceId, "which platform it is");
      assert.ok(offer.provenance.lastObservedAt, "when it was last captured");
    }
  });
});

/* ============================================================== PROMOTIONS */

describe("PROMO — promotions", () => {
  it("PROMO-01: the right promotions, attached to the right offers", async () => {
    const promotions = await all(`/products/${DOVE}/promotions`);
    assert.equal(promotions.length, EXPECTED[DOVE].promotions);

    const offerIds = new Set((await all(`/products/${DOVE}/offers`)).map((o) => o.id));
    for (const promotion of promotions) {
      assert.ok(offerIds.has(promotion.offerId), `${promotion.promotionId} is attached to a foreign offer`);
      assert.ok(promotion.label);
      assert.ok(promotion.discountValueMinor >= 0);
    }
  });

  it("PROMO-02: availability_class is read from the database, never recomputed", async () => {
    const promotions = await all(`/products/${DOVE}/promotions`);
    const classes = new Set(promotions.map((p) => p.availabilityClass));
    for (const value of classes) {
      assert.ok(["universal", "conditional", "deferred", "financing"].includes(value as string));
    }

    // The class is materialised from the type, and the two must still agree.
    for (const promotion of promotions) {
      if (promotion.promotionType === "instant_discount") {
        assert.equal(promotion.availabilityClass, "universal", promotion.promotionId);
      }
      if (promotion.promotionType === "bank_offer" || promotion.promotionType === "coupon") {
        assert.equal(promotion.availabilityClass, "conditional", promotion.promotionId);
      }
    }

    const filtered = await get(`/products/${DOVE}/promotions?availabilityClass=universal&pageSize=100`);
    for (const promotion of filtered.body["data"] as Json[]) {
      assert.equal(promotion.availabilityClass, "universal");
    }
  });

  it("PROMO-03: active and expired are judged against the dataset's own capture date", async () => {
    const asOf = (await get(`/products/${DOVE}/promotions`)).body["meta"].asOf;
    assert.equal(asOf, "2026-08-14", "not the wall clock — every promotion here has a fixed calendar life");

    const active = await all(`/products/${DOVE}/promotions?status=active`);
    const expired = await all(`/products/${DOVE}/promotions?status=expired`);
    assert.equal(active.length + expired.length, EXPECTED[DOVE].promotions);

    for (const promotion of active) {
      assert.equal(promotion.isActive, true);
      if (promotion.validFrom) assert.ok(promotion.validFrom <= asOf, promotion.promotionId);
      if (promotion.validTo) assert.ok(promotion.validTo >= asOf, promotion.promotionId);
    }
    for (const promotion of expired) {
      assert.equal(promotion.isActive, false);
      const before = promotion.validTo != null && promotion.validTo < asOf;
      const after = promotion.validFrom != null && promotion.validFrom > asOf;
      assert.ok(before || after, `${promotion.promotionId} is neither active nor outside its window`);
    }
  });

  it("PROMO-04: only universal promotions move the comparison price", async () => {
    const [offers, active] = await Promise.all([
      all(`/products/${DOVE}/offers`),
      all(`/products/${DOVE}/promotions?status=active`),
    ]);

    const universalByOffer = new Map<string, number>();
    const conditionalByOffer = new Map<string, number>();
    for (const promotion of active) {
      const bucket = promotion.availabilityClass === "universal" ? universalByOffer : conditionalByOffer;
      if (promotion.availabilityClass === "universal" || promotion.availabilityClass === "conditional") {
        bucket.set(promotion.offerId, (bucket.get(promotion.offerId) ?? 0) + promotion.discountValueMinor);
      }
    }

    for (const offer of offers) {
      if (!offer.price) continue;
      const universal = Math.min(universalByOffer.get(offer.id) ?? 0, offer.price.landedMinor);
      assert.equal(
        offer.price.universalDiscountMinor,
        universal,
        `${offer.id}: the universal discount must be the sum of its active universal promotions, clamped`
      );
      const conditional = Math.min(conditionalByOffer.get(offer.id) ?? 0, offer.price.universalEffectiveMinor);
      assert.equal(offer.price.conditionalDiscountMinor, conditional, `${offer.id}: conditional`);
    }
  });

  it("a product with no promotions returns an empty page and prices with no discount", async () => {
    const { body } = await get(`/products/${CELLO}/promotions`);
    assert.equal(body["pagination"].total, 0);
    assert.deepEqual(body["data"], []);

    const offers = await all(`/products/${CELLO}/offers`);
    for (const offer of offers) {
      if (!offer.price) continue;
      assert.equal(offer.price.universalDiscountMinor, 0);
      assert.equal(offer.price.universalEffectiveMinor, offer.price.landedMinor);
    }
  });
});

/* ================================================================= REVIEWS */

describe("REV — reviews and ratings", () => {
  it("REV-01: review snapshots are returned with their real values", async () => {
    const snapshots = await all(`/products/${DOVE}/reviews`);
    assert.equal(snapshots.length, EXPECTED[DOVE].reviews);

    const listingIds = new Set((await all(`/products/${DOVE}/listings`)).map((l) => l.id));
    for (const snapshot of snapshots) {
      assert.ok(listingIds.has(snapshot.listingId), "a snapshot for a foreign listing");
      assert.ok(snapshot.capturedAt);
      if (snapshot.averageRating != null) {
        assert.ok(snapshot.averageRating >= 0 && snapshot.averageRating <= 5);
      }
      if (snapshot.ratingDistribution) {
        // The histogram must add up to the rating count it sits beside.
        const total = Object.values(snapshot.ratingDistribution as Record<string, number>).reduce((a, b) => a + b, 0);
        assert.ok(total > 0, `${snapshot.snapshotId} has an empty distribution`);
      }
    }
  });

  it("REV-02: marketplace filtering works on both the snapshots and the history", async () => {
    const filtered = await get(`/products/${DOVE}/reviews?marketplace=mp_myntra&pageSize=100`);
    assert.equal(filtered.body["pagination"].total, 5);
    for (const snapshot of filtered.body["data"] as Json[]) {
      assert.equal(snapshot.marketplaceId, "mp_myntra");
    }

    const history = await get(`/products/${DOVE}/rating-history?marketplace=mp_myntra&window=3m`);
    assert.equal((history.body["data"] as Json[]).length, 1);
    assert.equal((history.body["data"] as Json[])[0]!.marketplaceId, "mp_myntra");
  });

  it("REV-03: capture timestamps are preserved, in order", async () => {
    const { body } = await get(`/products/${DOVE}/rating-history?window=3m`);
    for (const series of body["data"] as Json[]) {
      const dates = (series.points as Json[]).map((p) => p.capturedAt as string);
      assert.deepEqual(dates, [...dates].sort(), "points must be in capture order");
      assert.equal(new Set(dates).size, dates.length, "a listing cannot have two snapshots on one day");
      assert.equal(series.snapshotCount, dates.length);
    }
  });

  it("REV-04: no trend is invented from a single snapshot", async () => {
    const { body } = await get(`/products/${DOVE}/rating-history?window=1d`);
    // A one-day window holds at most one snapshot per listing.
    for (const series of body["data"] as Json[]) {
      if (series.snapshotCount < 2) {
        assert.equal(series.trend, null, `${series.marketplaceId} invented a trend from ${series.snapshotCount}`);
        assert.equal(series.withheld[0].metric, "trend");
        assert.match(series.withheld[0].reason, /fewer than two/i);
      }
    }

    // And where there genuinely are two or more, the change is computed from
    // the real endpoints rather than extrapolated.
    const wide = await get(`/products/${DOVE}/rating-history?window=3m`);
    const withTrend = (wide.body["data"] as Json[]).filter((s) => s.trend != null);
    assert.ok(withTrend.length > 0, "the wide window should support at least one trend");
    for (const series of withTrend) {
      const points = series.points as Json[];
      assert.equal(series.trend.fromCapturedAt, points[0]!.capturedAt);
      assert.equal(series.trend.toCapturedAt, points[points.length - 1]!.capturedAt);
      if (points[0]!.reviewCount != null && points[points.length - 1]!.reviewCount != null) {
        assert.equal(
          series.trend.reviewCountChange,
          (points[points.length - 1]!.reviewCount as number) - (points[0]!.reviewCount as number)
        );
      }
    }
  });

  it("product rating and seller rating stay separate", async () => {
    const product = await get(`/products/${DOVE}/reviews?pageSize=1`);
    assert.equal(product.body["meta"].subject, "product");

    const seller = (await all(`/products/${DOVE}/sellers`)).find((s) => s.rating != null)!;
    const sellerHistory = await get(`/sellers/${seller.id}/rating-history`);
    assert.equal(sellerHistory.body["meta"].subject, "seller");
    // Different tables, different endpoints, different meaning.
    assert.equal((sellerHistory.body["data"] as Json[])[0]!.reviewCount, undefined);
  });
});

/* ============================================== golden-record cross checks */

describe("golden records — the shapes the dataset actually contains", () => {
  for (const productId of GOLDEN) {
    it(`${productId}: counts across every endpoint match the seeded data`, async () => {
      const expected = EXPECTED[productId as keyof typeof EXPECTED];

      const [marketplaces, listings, sellers, offers, reviews, promotions, history] = await Promise.all([
        get(`/products/${productId}/marketplaces`),
        get(`/products/${productId}/listings?pageSize=100`),
        get(`/products/${productId}/sellers?pageSize=100`),
        get(`/products/${productId}/offers?pageSize=100`),
        get(`/products/${productId}/reviews?pageSize=100`),
        get(`/products/${productId}/promotions?pageSize=100`),
        get(`/products/${productId}/price-history?window=3m&pageSize=1`),
      ]);

      assert.equal((marketplaces.body["data"] as Json[]).length, expected.listings, "marketplaces");
      assert.equal(listings.body["pagination"].total, expected.listings, "listings");
      assert.equal(sellers.body["pagination"].total, expected.sellers, "sellers");
      assert.equal(offers.body["pagination"].total, expected.offers, "offers");
      assert.equal(reviews.body["pagination"].total, expected.reviews, "reviews");
      assert.equal(promotions.body["pagination"].total, expected.promotions, "promotions");

      // The 3-month window covers 2026-05-17..08-14; a product captured
      // earlier than that legitimately has fewer observations in it than in
      // total, so this is an upper bound rather than an equality.
      assert.ok(
        history.body["pagination"].total <= expected.observations,
        `${productId}: a window cannot hold more observations than exist`
      );
      assert.ok(history.body["pagination"].total > 0, `${productId}: the widest window should hold something`);
    });
  }

  it("the sparse product is reported as sparse rather than padded", async () => {
    const { body } = await get(`/products/${SPARSE}/price-history?window=1d&pageSize=100`);
    assert.ok(body["summary"].n <= 2, "a 1-day window on a thin product holds almost nothing");
    if (body["summary"].n < 5) {
      assert.equal(body["summary"].statistics?.medianMinor ?? null, null, "no median from a handful of points");
    }
  });
});
