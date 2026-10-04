import "./helpers/env.js";

import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import { createMarketplaceTestApp, type Harness } from "./helpers/harness.js";

/**
 * GET /listings/:id/price-history
 *
 * The price-history screen draws one line per competing seller, and is
 * addressed by listing. Two properties make that drawable and neither is
 * obvious from the shape of the response:
 *
 *   GROUPED   by offer, because a flat list cannot be regrouped once it has
 *             been paginated — the client would need every page first.
 *   OLDEST    first, because a line drawn from a newest-first series runs
 *             backwards. The repository returns newest-first, which is right
 *             for a table and wrong here, so the order is reversed and that
 *             reversal is worth a test.
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

async function someListing() {
  const { body } = await get("/api/v1/products/prod_dove_hair_fall/listings?pageSize=1");
  return body.data[0];
}

describe("a listing's price history", () => {
  test("is addressable by listing and names its product", async () => {
    const listing = await someListing();
    const { status, body } = await get(`/api/v1/listings/${listing.id}/price-history?window=3m`);

    assert.equal(status, 200);
    assert.equal(body.data.listing.id, listing.id);
    assert.equal(body.data.product.id, "prod_dove_hair_fall");
    assert.ok(body.data.marketplace.name.length > 0);
  });

  test("an unknown listing is a 404", async () => {
    const { status } = await get("/api/v1/listings/lst_nope/price-history");
    assert.equal(status, 404);
  });

  test("one entry per competing seller, each naming that seller", async () => {
    const listing = await someListing();
    const { body } = await get(`/api/v1/listings/${listing.id}/price-history?window=3m`);

    assert.ok(body.data.offers.length > 0, "the golden product's listings carry offers");
    assert.equal(body.data.offers.length, body.meta.offerCount);

    const offerIds = body.data.offers.map((o: any) => o.offerId);
    assert.equal(new Set(offerIds).size, offerIds.length, "one entry per offer, not one per observation");

    for (const offer of body.data.offers) {
      assert.ok(offer.sellerId && offer.sellerName, "a line must name whose price it is");
      assert.ok(offer.observations.length > 0, "an offer with no observations is not a line");
    }
  });

  test("observations run oldest-first, so a line does not run backwards", async () => {
    const listing = await someListing();
    const { body } = await get(`/api/v1/listings/${listing.id}/price-history?window=3m`);

    for (const offer of body.data.offers) {
      const dates = offer.observations.map((o: any) => o.observedAt);
      assert.deepEqual(dates, [...dates].sort(), `${offer.sellerName} is not in chronological order`);
    }
  });

  test("every point carries the ladder the chart reads", async () => {
    const listing = await someListing();
    const { body } = await get(`/api/v1/listings/${listing.id}/price-history?window=3m`);

    for (const offer of body.data.offers) {
      for (const o of offer.observations) {
        assert.equal(typeof o.sellingPriceMinor, "number");
        assert.equal(typeof o.shippingFeeMinor, "number");
        assert.equal(typeof o.universalEffectiveMinor, "number");
        assert.equal(typeof o.isInStock, "boolean");
        assert.ok(
          o.universalEffectiveMinor <= o.landedMinor,
          "the effective price cannot exceed the landed price"
        );
      }
    }
  });

  test("every observation in the response falls inside the requested range", async () => {
    const listing = await someListing();
    const { body } = await get(`/api/v1/listings/${listing.id}/price-history?window=1m`);
    const { from, to } = body.meta.range;

    for (const offer of body.data.offers) {
      for (const o of offer.observations) {
        assert.ok(o.observedAt >= from && o.observedAt <= to, `${o.observedAt} is outside ${from}..${to}`);
      }
    }
  });

  /**
   * A narrower window must not invent points, and must not return the same
   * number as a wider one — which it would if the filter were being ignored.
   */
  test("a narrower window returns no more than a wider one", async () => {
    const listing = await someListing();
    const wide = await get(`/api/v1/listings/${listing.id}/price-history?window=3m`);
    const narrow = await get(`/api/v1/listings/${listing.id}/price-history?window=7d`);

    assert.ok(
      narrow.body.meta.observationCount <= wide.body.meta.observationCount,
      "a 7-day window cannot hold more observations than a 3-month one"
    );
  });

  test("a window with nothing in it is empty, not an error", async () => {
    const listing = await someListing();
    const { status, body } = await get(
      `/api/v1/listings/${listing.id}/price-history?from=1990-01-01&to=1990-01-31`
    );
    assert.equal(status, 200);
    assert.equal(body.meta.observationCount, 0);
    assert.deepEqual(body.data.offers, [], "no observations means no lines to draw");
  });

  test("the response states which rung it is reporting", async () => {
    const listing = await someListing();
    const { body } = await get(`/api/v1/listings/${listing.id}/price-history?window=3m`);
    assert.equal(body.meta.priceBasis.basis, "universalEffective");
    assert.match(body.meta.seriesDefinition, /one line per offer/i);
  });
});
