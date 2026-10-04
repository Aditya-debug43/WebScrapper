/**
 * THE PRICE LADDER, AS ROWS TO RENDER.
 *
 * Pure presentation over a ladder the backend computed: it decides which rungs
 * are worth a line, what to call them, and when a zero means something. No
 * arithmetic beyond negating a discount for display, and no data imports — so
 * a screen can use it without pulling the old bundled dataset in behind it.
 *
 * It lived in `utils/priceLayers.js`, which also holds `buildPriceLayers` and
 * the fee-table lookups and therefore imports the static dataset. Keeping the
 * view helper there meant any screen wanting to render a ladder dragged the
 * whole bundled catalogue into its import graph.
 *
 * The rungs are deliberately never collapsed into one "price": MRP is a legal
 * ceiling, landed is what leaves the buyer's account, effective is what the
 * market compares on, and the conditional best is not comparable at all
 * because eligibility differs by buyer.
 */
export function describeLadder(layers) {
  if (!layers) return [];

  const rows = [
    { key: "mrp", label: "MRP", valueMinor: layers.mrpMinor, kind: "reference" },
    { key: "selling", label: "Selling price", valueMinor: layers.sellingPriceMinor, kind: "base" },
    {
      key: "shipping",
      label: "Shipping",
      valueMinor: layers.shippingFeeMinor,
      kind: "add",
      // Shown even at zero, because "Free" is information a buyer wants and an
      // omitted line would read as "not stated".
      alwaysShow: true,
      zeroLabel: "Free",
    },
    { key: "landed", label: "Landed price", valueMinor: layers.landedMinor, kind: "subtotal" },
  ];

  if (layers.universalDiscountMinor > 0) {
    rows.push({
      key: "universal",
      label: "Instant discount (everyone)",
      valueMinor: -layers.universalDiscountMinor,
      kind: "deduct",
    });
  }

  rows.push({
    key: "universalEffective",
    label: "Effective price",
    valueMinor: layers.universalEffectiveMinor,
    kind: "total",
    note: "what an ordinary buyer pays — used for market comparison",
  });

  if (layers.conditionalDiscountMinor > 0) {
    rows.push({
      key: "conditional",
      label: "Conditional benefits",
      valueMinor: -layers.conditionalDiscountMinor,
      kind: "deduct-conditional",
    });
    rows.push({
      key: "conditionalBest",
      label: "Best case, if eligible",
      valueMinor: layers.conditionalBestMinor,
      kind: "subtotal-conditional",
      note: "not comparable across sellers — eligibility differs",
    });
  }

  // A rung with no value is not a rung. Shipping opts out: see `alwaysShow`.
  return rows.filter((r) => r.alwaysShow || r.valueMinor != null);
}
