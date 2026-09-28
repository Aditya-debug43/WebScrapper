import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * PRICE-LADDER PARITY FIXTURE
 * ===========================
 *
 * The backend computes the price ladder in SQL; the frontend computes it in
 * JavaScript. They must be the same number, because "effective price" is the
 * basis every comparison in this product rests on and two definitions of it
 * is the failure that matters most.
 *
 * Proving that in a single test is awkward — the frontend modules use
 * Vite-style extensionless imports that plain Node cannot resolve, and the
 * backend test runner has no Vite. So this script runs on the frontend side,
 * where the engine is loadable, and writes down what the ENGINE says for a
 * spread of real observations. `server/tests/price-ladder-parity.test.ts`
 * then asks the database the same questions and asserts the answers match.
 *
 * The fixture is checked in. Regenerating it is a deliberate act, and a diff
 * in it is a change to the pricing basis — which should never be quiet.
 *
 *   node scripts/export-price-parity-fixture.mjs
 */

const OUT = resolve("server/tests/fixtures/price-ladder-parity.json");

/**
 * A deliberate spread rather than the first N rows: the golden record, a
 * product on one marketplace only, a thin one, and ones whose offers carry
 * promotions of each availability class. A parity check over offers with no
 * promotions would pass against a ladder that ignored promotions entirely.
 */
const SAMPLE_PRODUCTS = [
  "prod_dove_hair_fall",        // the golden record: 6 marketplaces, 1,830 observations
  "prod_lakme_gloss_lip",       // strong coverage, 5 marketplaces
  "prod_boat_wave_band",        // meaningful history across 4 marketplaces
  "prod_cello_gripper_10",      // a commodity, tightly clustered on price
  "prod_green_soul_vienna",     // sparse: 44 observations in total
  "prod_airpods_pro2",          // a single marketplace
];

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });

try {
  const [
    { getListingsForProduct },
    { getOffersForListing },
    { getPriceHistoryForOffer },
    { getPromotionsForOffer },
    { buildPriceLayers },
    { products },
  ] = await Promise.all([
    vite.ssrLoadModule("/src/data/listings.js"),
    vite.ssrLoadModule("/src/data/offers.js"),
    vite.ssrLoadModule("/src/data/priceObservations.js"),
    vite.ssrLoadModule("/src/data/promotions.js"),
    vite.ssrLoadModule("/src/utils/priceLayers.js"),
    vite.ssrLoadModule("/src/data/products.js"),
  ]);

  const byId = new Map(products.map((p) => [p.id, p]));
  const cases = [];
  const missing = [];

  for (const productId of SAMPLE_PRODUCTS) {
    const product = byId.get(productId);
    if (!product) {
      missing.push(productId);
      continue;
    }

    for (const listing of getListingsForProduct(productId)) {
      for (const offer of getOffersForListing(listing.id)) {
        const history = getPriceHistoryForOffer(offer.id);
        if (history.length === 0) continue;

        /**
         * Newest, oldest and middle — plus, for every promotion on this
         * offer, the observations at and immediately around its validity
         * boundaries.
         *
         * The boundary picks are the point. `valid_from <= date <= valid_to`
         * is inclusive at both ends, and an off-by-one there changes the
         * effective price on exactly two days out of a hundred — invisible to
         * a sample that only looks at the newest row, and wrong in a way that
         * would quietly propagate into every comparison.
         */
        const byDate = new Map(history.map((h) => [h.observedAt, h]));
        const picks = [history[0], history[history.length - 1], history[Math.floor(history.length / 2)]];

        for (const promotion of getPromotionsForOffer(offer.id)) {
          for (const edge of [promotion.validFrom, promotion.validTo]) {
            if (!edge) continue;
            for (const delta of [-1, 0, 1]) {
              const at = new Date(Date.parse(`${edge}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
              const hit = byDate.get(at);
              if (hit) picks.push(hit);
            }
          }
        }

        for (const observation of new Set(picks)) {
          const layers = buildPriceLayers({
            observation,
            offerId: offer.id,
            categoryId: product.categoryId,
            marketplaceId: listing.marketplaceId,
          });
          if (!layers) continue;

          cases.push({
            observationId: observation.id,
            offerId: offer.id,
            productId,
            marketplaceId: listing.marketplaceId,
            observedAt: observation.observedAt,
            // Only the customer-facing rungs. Net realisation depends on fee
            // rules and seller cost, which are a later phase and not part of
            // the comparison basis.
            expected: {
              mrpMinor: layers.mrpMinor,
              sellingPriceMinor: layers.sellingPriceMinor,
              shippingFeeMinor: layers.shippingFeeMinor,
              landedMinor: layers.landedMinor,
              universalDiscountMinor: layers.universalDiscountMinor,
              universalEffectiveMinor: layers.universalEffectiveMinor,
              conditionalDiscountMinor: layers.conditionalDiscountMinor,
              conditionalBestMinor: layers.conditionalBestMinor,
              deferredBenefitMinor: layers.deferredBenefitMinor,
              financingBenefitMinor: layers.financingBenefitMinor,
            },
          });
        }
      }
    }
  }

  if (missing.length) {
    throw new Error(`These sample products are not in the catalogue: ${missing.join(", ")}`);
  }
  if (cases.length < 100) {
    throw new Error(`Only ${cases.length} parity cases were produced; the sample is too thin to be worth having.`);
  }

  const withUniversal = cases.filter((c) => c.expected.universalDiscountMinor > 0).length;
  const withConditional = cases.filter((c) => c.expected.conditionalDiscountMinor > 0).length;
  if (withUniversal === 0 || withConditional === 0) {
    throw new Error(
      `The sample must exercise discounts: ${withUniversal} universal, ${withConditional} conditional. ` +
        `A parity check over undiscounted offers would pass against a ladder that ignored promotions.`
    );
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    `${JSON.stringify(
      {
        generatedBy: "scripts/export-price-parity-fixture.mjs",
        note: "Expected values come from src/utils/priceLayers.js — the one definition of the price ladder. Regenerate deliberately; a diff here is a change to the pricing basis.",
        products: SAMPLE_PRODUCTS,
        caseCount: cases.length,
        casesWithUniversalDiscount: withUniversal,
        casesWithConditionalDiscount: withConditional,
        cases,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(`· ${cases.length} parity cases → ${OUT}`);
  console.log(`  ${withUniversal} carry a universal discount, ${withConditional} a conditional one`);
} finally {
  await vite.close();
}
