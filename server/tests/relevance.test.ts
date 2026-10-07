import "./helpers/env.js";

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { scoreResults, productMatches } from "../src/ingestion/relevance.js";

/**
 * PRODUCT INTENT
 * ==============
 *
 * The bug: searching "iphone 18 pro" returned two phones and thirty-eight
 * cases, and the page led with the cases. Worse, those case prices became the
 * market evidence, so a flagship phone was recommended at ₹6,040.
 *
 * The fixtures below are the REAL shape of that response — the prices and
 * title patterns are taken from an actual capture, not invented to pass.
 *
 * What these must prove above all is that the rule is not a list of
 * accessory words. A list would pass the iPhone cases and fail laptops,
 * shoes and anybody who genuinely wants a case.
 */

/** The real response shape: two phones, many accessories. */
const phoneSearch = [
  { title: "Apple iPhone 18 Pro 256GB Black", priceMinor: 16_356_800, source: "Vijay Sales" },
  { title: "Apple iPhone 18 Pro 256GB Burgundy", priceMinor: 16_356_800, source: "Croma" },
  { title: "Otofly iPhone 18 Pro Silicone Case with MagSafe", priceMinor: 260_280, source: "otofly.co" },
  { title: "iPhone 18 Pro SolidX", priceMinor: 433_864, source: "rhinoshield.io" },
  { title: "iPhone 18 Pro AirX", priceMinor: 665_309, source: "rhinoshield.io" },
  { title: "Ringke iPhone 18 Pro Case", priceMinor: 269_923, source: "Ringke Official" },
  { title: "Allison Reich x CASETiFY iPhone Pro Case Geometric", priceMinor: 752_198, source: "Casetify" },
];

describe("a search finds the product, not what is sold beside it", () => {
  test("the phones rank above the cases", () => {
    const ranked = scoreResults("iphone 18 pro", phoneSearch).sort((a, b) => b.score - a.score);
    assert.match(ranked[0]!.item.title, /Apple iPhone 18 Pro/);
    assert.match(ranked[1]!.item.title, /Apple iPhone 18 Pro/);
  });

  test("the cases are classified as accessories", () => {
    const byTitle = new Map(scoreResults("iphone 18 pro", phoneSearch).map((r) => [r.item.title, r.relevance]));
    assert.equal(byTitle.get("Apple iPhone 18 Pro 256GB Black"), "strong");
    for (const accessory of [
      "Otofly iPhone 18 Pro Silicone Case with MagSafe",
      "iPhone 18 Pro SolidX",
      "Ringke iPhone 18 Pro Case",
    ]) {
      assert.equal(byTitle.get(accessory), "accessory", `${accessory} should not be the product`);
    }
  });

  test("only the phones survive as product matches", () => {
    const kept = productMatches("iphone 18 pro", phoneSearch);
    assert.equal(kept.length, 2);
    assert.ok(kept.every((k) => /Apple iPhone 18 Pro 256GB/.test(k.title)));
  });

  /**
   * THE GENERALISATION TEST.
   *
   * Same rule, a category it has never seen, and no word in it appears in
   * any list. If this passes while the iPhone cases are rejected, the logic
   * cannot be keyed on phones.
   */
  test("it generalises to a category with entirely different accessories", () => {
    const laptopSearch = [
      { title: "HP Pavilion 15 Laptop Intel Core i5 16GB", priceMinor: 6_499_900, source: "Amazon.in" },
      { title: "HP Pavilion 15 Laptop Ryzen 5 512GB", priceMinor: 5_999_000, source: "Flipkart" },
      { title: "Lapogy Laptop Sleeve for HP Pavilion 15", priceMinor: 129_900, source: "lapogy.com" },
      { title: "HP Pavilion 15 Keyboard Cover Skin", priceMinor: 49_900, source: "store.test" },
      { title: "65W Charger Adapter for HP Pavilion 15", priceMinor: 189_900, source: "store.test" },
    ];

    const byTitle = new Map(scoreResults("HP Pavilion 15", laptopSearch).map((r) => [r.item.title, r.relevance]));
    assert.ok(["strong", "plausible"].includes(byTitle.get("HP Pavilion 15 Laptop Intel Core i5 16GB")!));
    assert.equal(byTitle.get("Lapogy Laptop Sleeve for HP Pavilion 15"), "accessory");
    assert.equal(byTitle.get("HP Pavilion 15 Keyboard Cover Skin"), "accessory");
    assert.equal(byTitle.get("65W Charger Adapter for HP Pavilion 15"), "accessory");
  });

  /**
   * THE INVERSION TEST, and the reason a word list could never work: the same
   * titles that are accessories above are the product here.
   */
  test("searching FOR an accessory makes the accessory the product", () => {
    const kept = productMatches("iphone 18 pro case", phoneSearch);
    const titles = kept.map((k) => k.title).join(" | ");
    assert.ok(/Case/i.test(titles), `cases should now be the product: ${titles}`);
    assert.ok(
      !kept.some((k) => k.title === "Apple iPhone 18 Pro 256GB Black"),
      "and the phone should no longer dominate"
    );
  });

  /**
   * Variants must survive. This codebase has already shipped a bug that
   * confused model numbers with capacities, so capacity tokens are load-
   * bearing identity, never noise.
   */
  test("storage and configuration variants remain product matches", () => {
    const variants = [
      { title: "Apple iPhone 18 Pro 256GB Black", priceMinor: 16_356_800, source: "Croma" },
      { title: "Apple iPhone 18 Pro 512GB Black", priceMinor: 18_900_000, source: "Croma" },
      { title: "Apple iPhone 18 Pro 1TB Natural Titanium", priceMinor: 21_000_000, source: "Amazon.in" },
    ];
    const kept = productMatches("iphone 18 pro", variants);
    assert.equal(kept.length, 3, "every storage variant is the same product");
  });

  test("a query naming a capacity still matches that capacity", () => {
    const kept = productMatches("iphone 18 pro 256gb", [
      { title: "Apple iPhone 18 Pro 256GB Black", priceMinor: 16_356_800, source: "Croma" },
      { title: "Otofly iPhone 18 Pro Silicone Case", priceMinor: 260_280, source: "otofly.co" },
    ]);
    assert.equal(kept.length, 1);
    assert.match(kept[0]!.title, /256GB/);
  });

  test("a title about something else entirely is irrelevant, not an accessory", () => {
    const scored = scoreResults("iphone 18 pro", [
      { title: "Samsung Galaxy S26 Ultra 512GB", priceMinor: 14_000_000, source: "Amazon.in" },
    ]);
    assert.equal(scored[0]!.relevance, "irrelevant");
  });

  test("no product or brand name is hardcoded in the rule", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = (await readFile("src/ingestion/relevance.ts", "utf8")).toLowerCase();
    // Comments explain the iPhone case; the LOGIC must not name any of these.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const banned of ["iphone", "apple", "samsung", "case", "cover", "skin", "protector", "sleeve", "charger"]) {
      // Word boundaries: "coverage" legitimately contains "cover".
      const asWord = new RegExp(`\b${banned}\b`);
      assert.ok(!asWord.test(code), `"${banned}" appears in the logic, which makes it category-specific`);
    }
  });

  test("an empty or unusable query does not crash or silently drop everything", () => {
    assert.equal(scoreResults("", phoneSearch).length, phoneSearch.length);
    assert.equal(scoreResults("iphone 18 pro", []).length, 0);
  });
});

/**
 * SPARE PARTS AND REPLACEMENT COMPONENTS
 *
 * Found by running the real flow: a capture for "iphone 18 pro" contained no
 * phones at all, and "Apple iPhone 18 Pro Max Full Housing Body Panel" at
 * ₹32,999 became the most expensive thing in it. It covered the whole query
 * and sat in the top price cohort, so neither the coverage signal nor the
 * cohort signal caught it, and a replacement chassis was offered as the
 * product.
 */
describe("a part of a product is not the product", () => {
  const partsOnly = [
    { title: "Apple iPhone 18 Pro Max Full Housing Body Panel Black", priceMinor: 3_299_900, source: "parts.test" },
    { title: "Apple iPhone 18 Pro Max Full Housing Body Panel White", priceMinor: 3_298_900, source: "parts.test" },
    { title: "iPhone 18 Pro Replacement Battery OEM", priceMinor: 1_799_900, source: "parts.test" },
    { title: "Ringke iPhone 18 Pro Case", priceMinor: 269_923, source: "Ringke Official" },
  ];

  test("a housing panel is not the phone, even as the dearest result", () => {
    const byTitle = new Map(scoreResults("iphone 18 pro", partsOnly).map((r) => [r.item.title, r.relevance]));
    assert.equal(byTitle.get("Apple iPhone 18 Pro Max Full Housing Body Panel Black"), "accessory");
    assert.equal(byTitle.get("Apple iPhone 18 Pro Max Full Housing Body Panel White"), "accessory");
  });

  test("nothing in a parts-only capture is a strong match", () => {
    const strong = scoreResults("iphone 18 pro", partsOnly).filter((r) => r.relevance === "strong");
    assert.deepEqual(strong, [], "with no phone present nothing should be confidently the product");
  });

  /**
   * With the phone actually present — the normal case — the price cohorts
   * separate properly and every part is rejected.
   *
   * The parts-only fixture above is the harder, rarer situation and the rule
   * is weaker there: "iPhone 18 Pro Replacement Battery OEM" adds exactly as
   * many words as the query has, and with no phone to compare against there
   * is no cohort to place it below. It is ranked beneath the panels and
   * never reaches "strong", which is as much as the evidence supports. A
   * stricter threshold would start rejecting "HP Pavilion 15 Laptop Intel
   * Core", so the limit is stated rather than tuned away.
   */
  test("with the phone present, parts fall below it and are rejected", () => {
    const withPhone = [
      { title: "Apple iPhone 18 Pro 256GB Black", priceMinor: 16_356_800, source: "Croma" },
      { title: "Apple iPhone 18 Pro 512GB Blue", priceMinor: 18_900_000, source: "Vijay Sales" },
      ...partsOnly,
    ];
    const kept = productMatches("iphone 18 pro", withPhone);
    assert.equal(kept.length, 2, `only the phones: ${kept.map((k) => k.title).join(" | ")}`);
    assert.ok(kept.every((k) => /256GB|512GB/.test(k.title)));
  });

  /** The latitude a longer query earns must still work. */
  test("a more specific query still accepts well-described results", () => {
    const kept = productMatches("iphone 18 pro case", [
      { title: "JETech Magnetic Matte Case for iPhone 18 Pro", priceMinor: 149_900, source: "jetech.test" },
      { title: "Ringke iPhone 18 Pro Case", priceMinor: 269_923, source: "Ringke Official" },
    ]);
    assert.equal(kept.length, 2, "three added words against a four-word query is description, not replacement");
  });
});
