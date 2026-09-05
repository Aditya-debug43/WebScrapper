import { useMemo } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { ArrowRight, Star, Info } from "lucide-react";
import { useAsyncData } from "../utils/useAsyncData";
import { getMarketplaceComparison } from "../api/listingsService";
import LoadingState from "../components/common/LoadingState";
import { formatMinor, formatPct } from "../utils/money";
import "./MarketplaceComparison.css";

/**
 * The same product, priced across marketplaces.
 *
 * This used to be a grid of price cards, which meant the reader had to hold
 * six numbers in their head to answer "how far apart are these, really?".
 * It is now two things: a dot plot that answers that question at a glance, and
 * a matrix that carries every parameter behind it.
 *
 * The dot plot is a DOT plot rather than bars on purpose. A ₹519–₹609 spread
 * drawn as bars from a zero baseline looks like no difference at all; drawn
 * with a truncated baseline it lies. Dots on a zoomed axis do neither — they
 * need no zero, so the axis can frame the range the data actually occupies.
 *
 * Nothing here is computed beyond positioning: every figure comes from the
 * price ladder the service already built.
 */

const PROMO_LABEL = {
  universal: "everyone",
  conditional: "if eligible",
  deferred: "cashback",
  financing: "EMI",
};

export default function MarketplaceComparison() {
  const { productId } = useOutletContext();
  const { data, loading } = useAsyncData(() => getMarketplaceComparison(productId), [productId]);

  const scale = useMemo(() => {
    if (!data) return null;
    const points = [];
    for (const r of data.listingRows) {
      const l = r.cheapestOffer?.layers;
      if (!l) continue;
      points.push(l.universalEffectiveMinor, l.landedMinor);
      if (l.conditionalBestMinor != null) points.push(l.conditionalBestMinor);
    }
    if (points.length === 0) return null;
    const lo = Math.min(...points);
    const hi = Math.max(...points);
    // A flat market would divide by zero and collapse every dot onto the left
    // edge; pad it so the row still reads as "they all agree".
    const pad = Math.max((hi - lo) * 0.12, hi * 0.01, 1);
    return { lo: lo - pad, hi: hi + pad };
  }, [data]);

  if (loading || !data) return <LoadingState label="Comparing marketplaces…" />;

  const { listingRows, cheapestAcross, priceGapMinor } = data;
  const priced = listingRows.filter((r) => r.cheapestOffer?.layers);
  const ordered = [...listingRows].sort((a, b) => {
    const av = a.cheapestOffer?.effectiveMinor ?? Infinity;
    const bv = b.cheapestOffer?.effectiveMinor ?? Infinity;
    return av - bv;
  });
  const gapPct = cheapestAcross ? priceGapMinor / cheapestAcross : null;

  const pos = (minor) => {
    if (!scale || minor == null) return null;
    return ((minor - scale.lo) / (scale.hi - scale.lo)) * 100;
  };

  return (
    <div className="mc">
      <section className="mc-lede">
        <p className="mc-lede-text measure">
          One listing per marketplace, each priced independently. Rating and sellers belong to the listing, not to the
          product — averaging them across platforms would invent a number that exists nowhere.
        </p>
        <dl className="mc-lede-stats">
          <div>
            <dt>Cheapest effective</dt>
            <dd className="tabular">{cheapestAcross != null ? formatMinor(cheapestAcross) : "—"}</dd>
          </div>
          <div>
            <dt>Spread</dt>
            <dd className="tabular">
              {formatMinor(priceGapMinor)}
              {gapPct ? <em> · {formatPct(gapPct, { decimals: 1 })}</em> : null}
            </dd>
          </div>
          <div>
            <dt>Platforms</dt>
            <dd className="tabular">{listingRows.length}</dd>
          </div>
        </dl>
      </section>

      {/* --------------------------- the dot plot --------------------------- */}
      {scale && priced.length > 0 && (
        <section className="mc-plot-section">
          <div className="section-head">
            <h2 className="section-title">Where each platform sits</h2>
            <span className="mc-plot-key">
              <span className="mc-key-item">
                <span className="mc-dot-demo effective" /> effective
              </span>
              <span className="mc-key-item">
                <span className="mc-dot-demo landed" /> landed
              </span>
              <span className="mc-key-item">
                <span className="mc-dot-demo conditional" /> if eligible
              </span>
            </span>
          </div>

          <div className="mc-plot">
            <div className="mc-plot-axis" aria-hidden="true">
              <span className="tabular">{formatMinor(scale.lo)}</span>
              <span className="tabular">{formatMinor(scale.hi)}</span>
            </div>

            {ordered.map((row) => {
              const l = row.cheapestOffer?.layers;
              if (!l) {
                return (
                  <div className="mc-plot-row empty" key={row.listing.id}>
                    <span className="mc-plot-name">{row.marketplace.name}</span>
                    <div className="mc-plot-track">
                      <span className="mc-plot-none">No offer in stock</span>
                    </div>
                    <span className="mc-plot-value tabular">—</span>
                  </div>
                );
              }
              const eff = pos(l.universalEffectiveMinor);
              const landed = pos(l.landedMinor);
              const cond =
                l.conditionalBestMinor != null && l.conditionalBestMinor < l.universalEffectiveMinor
                  ? pos(l.conditionalBestMinor)
                  : null;
              const isCheapest = l.universalEffectiveMinor === cheapestAcross;
              const spanFrom = Math.min(eff, landed, cond ?? eff);
              const spanTo = Math.max(eff, landed, cond ?? eff);

              return (
                <div className={`mc-plot-row${isCheapest ? " best" : ""}`} key={row.listing.id}>
                  <span className="mc-plot-name">
                    <span className="marketplace-dot" style={{ background: row.marketplace.brandColor }} />
                    {row.marketplace.name}
                  </span>

                  <div className="mc-plot-track">
                    <span
                      className="mc-plot-span"
                      style={{ left: `${spanFrom}%`, width: `${Math.max(spanTo - spanFrom, 0)}%` }}
                    />
                    {cond != null && (
                      <span
                        className="mc-plot-dot conditional"
                        style={{ left: `${cond}%` }}
                        title={`If eligible ${formatMinor(l.conditionalBestMinor)}`}
                      />
                    )}
                    {landed !== eff && (
                      <span
                        className="mc-plot-dot landed"
                        style={{ left: `${landed}%` }}
                        title={`Landed ${formatMinor(l.landedMinor)}`}
                      />
                    )}
                    <span
                      className="mc-plot-dot effective"
                      style={{ left: `${eff}%`, background: row.marketplace.brandColor }}
                      title={`Effective ${formatMinor(l.universalEffectiveMinor)}`}
                    />
                  </div>

                  <span className="mc-plot-value tabular">{formatMinor(l.universalEffectiveMinor)}</span>
                </div>
              );
            })}
          </div>

          <p className="mc-plot-note">
            <Info size={13} strokeWidth={2} />
            Each row is one platform&rsquo;s cheapest in-stock offer, and the filled dot takes that platform&rsquo;s own
            colour. The line spans the offer&rsquo;s ladder: landed price, the effective price after discounts every
            buyer gets, and — where one exists — the best case for buyers who qualify for a conditional offer. Only the
            effective price is comparable across platforms.
          </p>
        </section>
      )}

      {/* ---------------------------- the matrix ---------------------------- */}
      <section className="mc-matrix-section">
        <div className="section-head">
          <h2 className="section-title">Every parameter, side by side</h2>
        </div>

        <div className="scroll-x">
          <table className="mc-matrix">
            <thead>
              <tr>
                <th scope="col">Marketplace</th>
                <th scope="col" className="num">Effective</th>
                <th scope="col" className="num">MRP</th>
                <th scope="col" className="num">Off MRP</th>
                <th scope="col" className="num">Delivery</th>
                <th scope="col" className="num">Sellers</th>
                <th scope="col">Cheapest seller</th>
                <th scope="col" className="num">Rating</th>
                <th scope="col" className="num">Reviews</th>
                <th scope="col">Offers</th>
                <th scope="col" className="num">Net realisation</th>
                <th scope="col" className="num">Match</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {ordered.map((row) => {
                const l = row.cheapestOffer?.layers;
                const isCheapest = l && l.universalEffectiveMinor === cheapestAcross;
                const promos = row.cheapestOffer?.activePromotions ?? [];
                const promoClasses = [...new Set(promos.map((p) => p.availabilityClass))];
                return (
                  <tr key={row.listing.id} className={isCheapest ? "best" : undefined}>
                    <th scope="row">
                      <span className="marketplace-dot" style={{ background: row.marketplace.brandColor }} />
                      {row.marketplace.name}
                      {isCheapest && <span className="mc-tag">cheapest</span>}
                    </th>
                    <td className="num tabular strong">{l ? formatMinor(l.universalEffectiveMinor) : "—"}</td>
                    <td className="num tabular muted">{l?.mrpMinor ? formatMinor(l.mrpMinor) : "—"}</td>
                    <td className="num tabular">
                      {l?.discountFromMrpPct != null ? formatPct(l.discountFromMrpPct, { decimals: 0 }) : "—"}
                    </td>
                    <td className="num tabular">
                      {l ? (l.shippingFeeMinor ? formatMinor(l.shippingFeeMinor) : "Free") : "—"}
                    </td>
                    <td className="num tabular">{row.offerCount}</td>
                    <td className="mc-seller">{row.cheapestOffer?.seller?.name ?? "—"}</td>
                    <td className="num tabular">
                      {row.rating != null ? (
                        <span className="mc-rating">
                          <Star size={10} strokeWidth={0} fill="currentColor" />
                          {row.rating.toFixed(1)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num tabular muted">
                      {row.reviewCount != null ? row.reviewCount.toLocaleString("en-IN") : "—"}
                    </td>
                    <td>
                      {promoClasses.length ? (
                        <span className="mc-promos">
                          {promoClasses.map((c) => (
                            <span key={c} className={`mc-promo ${c}`}>
                              {PROMO_LABEL[c] ?? c}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="mc-none">none</span>
                      )}
                    </td>
                    <td className="num tabular muted">
                      {row.netRealization ? formatMinor(row.netRealization.netRealizationMinor) : "—"}
                    </td>
                    <td className="num tabular muted">{Math.round(row.listing.matchConfidence * 100)}%</td>
                    <td className="mc-go">
                      <Link to={`/listings/${row.listing.id}`} aria-label={`Open ${row.marketplace.name} listing`}>
                        <ArrowRight size={14} strokeWidth={2} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mc-matrix-note">
          <strong>Net realisation</strong> is what the seller banks after that marketplace&rsquo;s referral fee and GST
          — it belongs to margin work, never to customer-facing competitiveness, which is why it sits at the far end of
          the row. <strong>Match</strong> is how confident the system is that this listing is the same product.
        </p>
      </section>

      {/* Price is one parameter. The analysis view compares the rest — sellers,
          fulfilment, trust, promotions, history — and says what they mean. */}
      <Link to={`/products/${productId}/analysis`} className="mc-next">
        <span className="mc-next-index tabular">Next</span>
        <span className="mc-next-body">
          <strong>Compare these platforms on more than price</strong>
          Sellers, fulfilment, review strength, offer conditions and history — analysed together, with what the
          combination implies for the price.
        </span>
        <ArrowRight size={16} strokeWidth={2} />
      </Link>
    </div>
  );
}
