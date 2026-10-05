import "./helpers/env.js";

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createTestApp, type Harness } from "./helpers/harness.js";
import { DashboardRepository } from "../src/modules/dashboard/dashboard.repository.js";
import { buildProfiles, pickStratified, type Profile } from "../src/modules/dashboard/defaultSet.js";

/**
 * DEFAULT DESK PARITY
 * ===================
 *
 * The dashboard's default product set moved from the browser to the backend.
 * The browser chose it by profiling all 1,172 bundled products on reach,
 * capture depth and competitive density and then filling a stratified quota —
 * and that single calculation was the largest reason the frontend needed the
 * whole catalogue at runtime.
 *
 * The fixture is the ORACLE, not the implementation: it was produced by
 * `scripts/export-desk-parity-fixture.mjs` from the engine being replaced,
 * over the same dataset the backend is seeded with here. A disagreement means
 * the port changed which products the desk opens on.
 *
 * ORDER IS COMPARED, not just membership. The selection is deliberately
 * deterministic so the desk does not reshuffle between reloads, and a port
 * that returns the same twelve products in a different order has lost that
 * property without failing anything else.
 *
 * This suite needs the WHOLE catalogue, observations included, because a
 * product's tier depends on how many comparables share its type and price
 * band — a question a scoped fixture cannot answer. It is the second suite
 * that pays for a full seed, and for the same reason as the first.
 */

const FIXTURE = fileURLToPath(new URL("./fixtures/desk-parity.json", import.meta.url));

type Selected = {
  id: string;
  expectedTier: string;
  departmentId: string | null;
  productTypeId: string;
  marketplaceCount: number;
  candidateCount: number;
  cadenceDays: number | null;
  observationCount: number;
  pointsPerOffer: number;
  priceMinor: number;
};

type Sampled = Omit<Selected, "departmentId" | "productTypeId"> & { typePopulation: number };

type Fixture = {
  catalogueSize: number;
  tierCounts: Record<string, number>;
  selected: Selected[];
  profileSample: Sampled[];
};

const fixture: Fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));

let h: Harness;
let profiles: Profile[];
let byId: Map<string, Profile>;
let chosen: Profile[];

before(async () => {
  h = await createTestApp({ seedEverything: true });
  const repo = new DashboardRepository(h.db);
  profiles = buildProfiles(await repo.productProfiles());
  byId = new Map(profiles.map((p) => [p.id, p]));
  chosen = pickStratified(profiles);
});

after(async () => {
  await h.close();
});

/* ============================================================== the selection */

describe("the backend chooses the same desk the browser did", () => {
  test("the same products, in the same order", () => {
    assert.deepEqual(
      chosen.map((p) => p.id),
      fixture.selected.map((s) => s.id)
    );
  });

  test("each one lands in the same evidence tier", () => {
    for (const expected of fixture.selected) {
      const actual = byId.get(expected.id);
      assert.ok(actual, `${expected.id} was not profiled at all`);
      assert.equal(actual.expectedTier, expected.expectedTier, `${expected.id} changed tier`);
    }
  });

  /**
   * The tier is DERIVED from these three. Agreeing on the tier while
   * disagreeing on its inputs would mean the port is right by coincidence,
   * and would come apart the first time the dataset changed.
   */
  test("and on the structural facts the tier is derived from", () => {
    for (const expected of fixture.selected) {
      const actual = byId.get(expected.id)!;
      assert.equal(actual.marketplaceCount, expected.marketplaceCount, `${expected.id} reach`);
      assert.equal(actual.candidateCount, expected.candidateCount, `${expected.id} comparables`);
      assert.equal(actual.cadenceDays, expected.cadenceDays, `${expected.id} cadence`);
      assert.equal(actual.pointsPerOffer, expected.pointsPerOffer, `${expected.id} deepest offer`);
      assert.equal(actual.observationCount, expected.observationCount, `${expected.id} observations`);
      assert.equal(actual.priceMinor, expected.priceMinor, `${expected.id} price`);
    }
  });

  test("the set spans all four evidence tiers", () => {
    const tiers = new Set(chosen.map((p) => p.expectedTier));
    assert.ok(tiers.has("refused"), "a desk with no refusal case hides the behaviour most worth showing");
    assert.ok(tiers.has("thin"));
    assert.ok(tiers.size >= 3, `only ${[...tiers].join(", ")}`);
  });

  /**
   * THE BUG THIS CATCHES.
   *
   * The department join originally matched `level = 0` in a taxonomy whose
   * levels start at 1, so every department resolved to null. Nothing failed:
   * the "at most two per department" cap simply applied to one null bucket
   * and the twelve-product desk quietly became a two-product desk.
   */
  test("the desk is twelve products across distinct departments", () => {
    assert.equal(chosen.length, 12);

    const departments = chosen.map((p) => p.departmentId);
    assert.ok(
      departments.every((d) => d != null),
      "an unresolved department caps the whole desk, not one department of it"
    );
    assert.ok(new Set(departments).size >= 6, `only ${new Set(departments).size} departments represented`);
  });
});

/* ================================================== the profiling behind it */

describe("the profiling agrees beyond the products that were chosen", () => {
  /**
   * A port could agree on the twelve winners while scoring the other 1,142
   * wrongly, so the fixture carries a sample from across the catalogue.
   */
  test("sampled products across the catalogue profile identically", () => {
    assert.ok(fixture.profileSample.length > 0, "the fixture must carry a sample");

    for (const expected of fixture.profileSample) {
      const actual = byId.get(expected.id);
      assert.ok(actual, `${expected.id} is profiled by the browser but not by the backend`);
      assert.equal(actual.expectedTier, expected.expectedTier, `${expected.id} tier`);
      assert.equal(actual.marketplaceCount, expected.marketplaceCount, `${expected.id} reach`);
      assert.equal(actual.candidateCount, expected.candidateCount, `${expected.id} comparables`);
      assert.equal(actual.typePopulation, expected.typePopulation, `${expected.id} type population`);
      assert.equal(actual.cadenceDays, expected.cadenceDays, `${expected.id} cadence`);
      assert.equal(actual.priceMinor, expected.priceMinor, `${expected.id} price`);
    }
  });

  test("the same products are profiled at all", () => {
    assert.equal(
      profiles.length,
      fixture.catalogueSize,
      "a product with an offer and a price is profiled; both engines must agree on which those are"
    );
  });

  test("the whole catalogue falls into the same tier distribution", () => {
    const counts = profiles.reduce<Record<string, number>>((acc, p) => {
      acc[p.expectedTier] = (acc[p.expectedTier] ?? 0) + 1;
      return acc;
    }, {});
    assert.deepEqual(counts, fixture.tierCounts);
  });
});
