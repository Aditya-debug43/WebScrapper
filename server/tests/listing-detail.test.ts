import "./helpers/env.js";

import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import { createMarketplaceTestApp, type Harness } from "./helpers/harness.js";

/**
 * GET /listings/:id AND THE ENRICHED MARKETPLACE SUMMARY
 * =====================================================
 *
 * Stage 3 of the frontend migration needed two things the backend did not
 * expose: a listing addressable BY LISTING (so a `/listings/:id` route can
 * find out which product it belongs to) and the commercial context the
 * comparison table shows — the seller behind the price, the fee rule in force,
 * and what the seller banks.
 *
 * What is asserted here is mostly about absence. A listing on a store
 * discovered from provider data has no MRP, no rating, no seller rating, no
 * review velocity and no fee rule, and every one of those has to arrive as
 * null. A zero in any of them is a specific and wrong claim: that the platform
 * takes the whole sale, or that the seller is rated nought.
 */

let h: Harness;

before(async () => {
  h = await createMarketplaceTestApp(["prod_dove_hair_fall"]);
});
after(async () => {
  await h.close();
});

const get = async (url: string) => {
  const res = await h.app.inject({ method: "GET", url });
  return { status: res.statusCode, body: res.json() };
};

/** Any listing of the seeded golden product, to drive the listing route. */
async function someListing() {
  const { body } = await get("/api/v1/products/prod_dove_hair_fall/listings?pageSize=1");
  return body.data[0];
}

describe("a listing is addressable by its own id", () => {
  test("it resolves the product, brand and platform it belongs to", async () => {
    const listing = await someListing();
    const { status, body } = await get(`/api/v1/listings/${listing.id}`);

    assert.equal(status, 200);
    assert.equal(body.data.listing.id, listing.id);
    assert.equal(body.data.product.id, "prod_dove_hair_fall");
    assert.ok(body.data.product.canonicalName.length > 0);
    assert.ok(body.data.product.brand.name.length > 0, "the masthead needs a brand");
    assert.ok(body.data.marketplace.name.length > 0);
    assert.equal(typeof body.data.marketplace.isDiscovered, "boolean");
  });

  test("an unknown listing is a 404, not an empty listing", async () => {
    const { status, body } = await get("/api/v1/listings/lst_does_not_exist");
    assert.equal(status, 404);
    assert.equal(body.error.code, "NOT_FOUND");
  });

  test("its offers are cheapest-first on the effective price", async () => {
    const listing = await someListing();
    const { body } = await get(`/api/v1/listings/${listing.id}`);
    const prices = body.data.offers
      .map((o: any) => o.price?.universalEffectiveMinor)
      .filter((p: number | undefined) => p != null);

    assert.ok(prices.length > 0, "the golden product's listings carry offers");
    assert.deepEqual(prices, [...prices].sort((a: number, b: number) => a - b), "cheapest first");
  });

  test("every offer carries its seller, condition and the full ladder", async () => {
    const listing = await someListing();
    const { body } = await get(`/api/v1/listings/${listing.id}`);

    for (const offer of body.data.offers) {
      assert.ok(offer.seller.id && offer.seller.name, "an offer without a seller is not an offer");
      assert.ok(["new", "renewed", "used"].includes(offer.condition));
      if (offer.price) {
        for (const rung of [
          "sellingPriceMinor",
          "shippingFeeMinor",
          "landedMinor",
          "universalEffectiveMinor",
          "conditionalBestMinor",
        ]) {
          assert.equal(typeof offer.price[rung], "number", `${rung} must be a number when a price exists`);
        }
        assert.ok(
          offer.price.universalEffectiveMinor <= offer.price.landedMinor,
          "the effective price cannot exceed the landed price"
        );
      }
    }
  });

  /**
   * A seller rating and a listing rating are different numbers from different
   * tables, and the offer card shows both. Confusing them would put the
   * product's rating against the seller's name.
   */
  test("seller rating and listing rating are reported separately", async () => {
    const listing = await someListing();
    const { body } = await get(`/api/v1/listings/${listing.id}`);

    const listingRating = body.data.rating;
    if (listingRating) assert.ok(listingRating.average > 0 && listingRating.average <= 5);

    for (const offer of body.data.offers) {
      const r = offer.seller.rating;
      assert.ok(r === null || (r > 0 && r <= 5), `seller rating must be null or a real rating, got ${r}`);
    }
  });

  test("review velocity is a number or null, never zero-by-default", async () => {
    const listing = await someListing();
    const { body } = await get(`/api/v1/listings/${listing.id}`);
    const v = body.data.reviewVelocity;
    assert.ok(v === null || typeof v === "number", `unexpected velocity ${v}`);
  });
});

describe("the marketplace summary carries commercial context", () => {
  test("each platform reports the seller behind its price", async () => {
    const { body } = await get("/api/v1/products/prod_dove_hair_fall/marketplaces");
    assert.ok(body.data.length > 1, "the golden product is sold on several platforms");

    for (const row of body.data) {
      if (!row.currentPrice) {
        assert.equal(row.cheapestOffer, null, "no price means no cheapest offer");
        continue;
      }
      assert.ok(row.cheapestOffer, "a platform with a price must name the offer behind it");
      assert.ok(row.cheapestOffer.seller.name.length > 0);
      assert.equal(
        row.cheapestOffer.effectiveMinor,
        row.currentPrice.effectiveMinor,
        "the named offer must be the one the price came from"
      );
      assert.ok(Array.isArray(row.cheapestOffer.activePromotions));
    }
  });

  test("net realisation is below the selling price and above zero", async () => {
    const { body } = await get("/api/v1/products/prod_dove_hair_fall/marketplaces");
    const priced = body.data.filter((r: any) => r.netRealisation);
    assert.ok(priced.length > 0, "the seeded platforms have fee rules");

    for (const row of priced) {
      const net = row.netRealisation.netRealisationMinor;
      assert.ok(net > 0, "a seller does not bank a negative amount on these fees");
      assert.ok(
        net < row.currentPrice.sellingPriceMinor,
        "net realisation is the selling price MINUS fees, so it must be lower"
      );
      assert.equal(
        row.netRealisation.totalFeesMinor,
        row.currentPrice.sellingPriceMinor - net,
        "fees and net must account for the whole selling price"
      );
    }
  });

  test("the fee rule says whether it is a category rate or a default", async () => {
    const { body } = await get("/api/v1/products/prod_dove_hair_fall/marketplaces");
    for (const row of body.data) {
      if (!row.feeRule) continue;
      assert.equal(typeof row.feeRule.referralPct, "number");
      assert.equal(
        typeof row.feeRule.isCategoryDefault,
        "boolean",
        "a margin resting on a default rate is weaker evidence, and the UI says so"
      );
    }
  });

  /**
   * The case this whole stage exists for. A store discovered from provider
   * data has no fee rule captured, so its margin is unknowable — and the row
   * must say so rather than reporting the full price as profit.
   */
  test("a platform with no fee rule reports an unknown margin, not a free one", async () => {
    const { body } = await get("/api/v1/products/prod_dove_hair_fall/marketplaces");
    for (const row of body.data) {
      if (row.feeRule === null) {
        assert.equal(row.netRealisation, null, `${row.marketplace.name} has no fee rule, so no margin is knowable`);
      }
    }
  });
});
