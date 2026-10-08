import "../config/env.js";
import { createDb } from "../db/client.js";

/**
 * CLEAR MRP VALUES THAT ARE BELOW THEIR OWN SELLING PRICE
 * =======================================================
 *
 * A printed maximum is a legal ceiling in India: nothing may be sold above
 * it. A stored MRP beneath the price actually charged therefore records
 * something that cannot have happened, and it got there by misparsing — the
 * provider's "old price" field occasionally carries a figure that is not a
 * list price at all.
 *
 * Production held two: a curtain selling at ₹1,160 against an "MRP" of ₹20,
 * and another at ₹724 against ₹50. Every number is individually plausible,
 * which is why the parser took them; only their relationship is impossible,
 * which is why the verification script caught them and nothing earlier did.
 *
 * THIS IS NOT REWRITING HISTORY. The observation is the SELLING PRICE, and it
 * is not touched. What is cleared is a field that was mis-read at parse time,
 * set to null — not known — which is what the corrected parser now stores.
 * The alternative readings are both worse: clamping the ceiling up to the
 * selling price would invent a fact, and leaving it feeds a 5,700% discount
 * into anything that renders one.
 *
 *   npm run db:repair-mrp            report what would change
 *   npm run db:repair-mrp -- --apply write it
 */

async function main() {
  const apply = process.argv.includes("--apply");
  const conn = await createDb();

  try {
    console.log(`· driver ${conn.driver}${apply ? "" : "  (DRY RUN — pass --apply to write)"}`);

    const offending = await conn.query<{
      id: string;
      observed_at: string;
      selling_price_minor: number;
      mrp_minor: number;
      seller: string;
      marketplace: string;
      title: string;
    }>(`
      select po.id,
             po.observed_at::text as observed_at,
             po.selling_price_minor,
             po.mrp_minor,
             s.name as seller,
             m.name as marketplace,
             left(coalesce(l.raw_title, p.canonical_name), 60) as title
        from price_observations po
        join offers o       on o.id = po.offer_id
        join listings l     on l.id = o.listing_id
        join products p     on p.id = l.product_id
        join sellers s      on s.id = o.seller_id
        join marketplaces m on m.id = l.marketplace_id
       where po.mrp_minor is not null
         and po.selling_price_minor > po.mrp_minor
       order by po.observed_at
    `);

    if (offending.length === 0) {
      console.log("· no observation claims a maximum below its own selling price");
      return;
    }

    for (const r of offending) {
      const money = (m: number) => (m / 100).toFixed(2);
      console.log(
        `  ${r.observed_at}  selling ${money(r.selling_price_minor)} against an "MRP" of ${money(r.mrp_minor)}` +
          `  —  ${r.seller} / ${r.marketplace}  "${r.title}"`
      );
    }
    console.log(`· ${offending.length} observation(s) affected`);

    if (!apply) {
      console.log("· nothing written");
      return;
    }

    /**
     * Only `mrp_minor` is touched, and only on the rows listed above. The
     * selling price, the date, the provenance pointer and the offer are all
     * left exactly as captured.
     */
    const ids = offending.map((r) => `'${r.id.replace(/'/g, "''")}'`).join(", ");
    await conn.exec(`update price_observations set mrp_minor = null where id in (${ids})`);

    const left = await conn.query<{ n: number }>(
      `select count(*)::int as n from price_observations
        where mrp_minor is not null and selling_price_minor > mrp_minor`
    );
    if (left[0]!.n !== 0) {
      throw new Error(`${left[0]!.n} row(s) still violate the rule after the update — refusing to report success.`);
    }
    console.log(`· cleared the maximum on ${offending.length} observation(s); none remain`);
  } finally {
    await conn.close();
  }
}

main().catch((error) => {
  console.error("repair failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
