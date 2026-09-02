import { useMemo } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Info,
  Layers,
  Store,
  Users,
  Tag,
  History as HistoryIcon,
  Scale,
} from "lucide-react";
import { buildCrossMarketplaceAnalysis } from "../utils/crossMarketplaceAnalysis";
import { formatMinor } from "../utils/money";
import { getMarketplace } from "../data/marketplaces";
import "./CrossMarketplaceAnalysis.css";

/**
 * The analysis page reads top to bottom as an argument, not a dashboard:
 *
 *   1. WHAT WE OBSERVED     the same product across every platform, at each
 *                           rung of the price ladder
 *   2. WHAT DIFFERS         where the platforms genuinely diverge
 *   3. WHO WE COMPETE WITH  the competitive set, with the raw price gap
 *                           decomposed into the dimensions that explain it
 *   4. WHAT IT MEANS        findings that needed more than one dimension
 *   5. HISTORY              whether today's market is normal
 *   6. THEREFORE            how those findings become the recommended price
 *
 * Every number rendered here comes from `buildCrossMarketplaceAnalysis`, which
 * derives from the same entity graph the rest of the app reads. Nothing is
 * computed in this file.
 */

const DIRECTION_META = {
  premium: { label: "Supports a higher price", icon: TrendingUp, tone: "up" },
  aggressive: { label: "Argues for a lower price", icon: TrendingDown, tone: "down" },
  neutral: { label: "Context", icon: Minus, tone: "flat" },
};

const DIMENSION_ICON = {
  Marketplace: Store,
  Offer: Tag,
  Competitor: Users,
  Trust: Scale,
  Specification: Layers,
  History: HistoryIcon,
  "Willingness to pay": TrendingUp,
  Availability: AlertTriangle,
  "Data quality": Info,
};

function LadderCell({ label, value, muted, total }) {
  if (value == null) return null;
  return (
    <div className={`ladder-cell${muted ? " muted" : ""}${total ? " total" : ""}`}>
      <span className="ladder-label">{label}</span>
      <span className="ladder-value tabular">{formatMinor(value)}</span>
    </div>
  );
}

export default function CrossMarketplaceAnalysis() {
  const { productId } = useOutletContext();
  const analysis = useMemo(() => buildCrossMarketplaceAnalysis(productId), [productId]);

  if (!analysis.available) {
    return <div className="card cma-empty">{analysis.reason}</div>;
  }

  const { marketplaceRows, marketplaceAnalysis: mp, competitors, history, findings, bridge, unitBasis, recommendation } =
    analysis;

  const singlePlatform = marketplaceRows.length < 2;

  return (
    <div className="cma">
      {/* ------------------------------------------------------------------ */}
      <section className="cma-intro card">
        <p>
          This page works through the evidence behind the price, in the order the system uses it: what was observed on each
          platform, where those platforms genuinely differ, who the product actually competes with, what the combination of
          those signals means, and only then what to charge.
        </p>
        <p className="cma-provenance">
          <Info size={13} strokeWidth={2} />
          Observed values come from this prototype&rsquo;s <strong>simulated</strong> listings and offers — realistic in
          structure, not captured from the live marketplaces. Everything labelled a finding is derived. Prices compare on the{" "}
          <strong>effective price</strong> — what any buyer pays, with no card, coupon or trade-in.
        </p>
      </section>

      {/* ---------------------------- 1. OBSERVED -------------------------- */}
      <section className="cma-section">
        <header className="cma-head">
          <span className="cma-step">1</span>
          <div>
            <h2>What we observed</h2>
            <p>
              The same product on {marketplaceRows.length} platform{marketplaceRows.length === 1 ? "" : "s"}, at every rung of
              the price ladder. Rating and sellers are per listing — they are observed separately on each platform, so
              averaging them would invent a number that exists nowhere.
            </p>
          </div>
        </header>

        {singlePlatform && (
          <p className="cma-note warn">
            <AlertTriangle size={14} strokeWidth={2} />
            This product is listed on one marketplace only, so there is no cross-platform comparison to make. The competitor
            and history sections below still apply.
          </p>
        )}

        <div className="cma-mp-grid">
          {marketplaceRows.map((row, i) => {
            const meta = getMarketplace(row.marketplaceId);
            const isCheapest = i === 0 && row.effectiveMinor != null;
            const promoTotal =
              row.promoCount.universal + row.promoCount.conditional + row.promoCount.deferred + row.promoCount.financing;
            return (
              <article key={row.listingId} className={`cma-mp-card${isCheapest ? " cheapest" : ""}`}>
                <div className="cma-mp-top">
                  <span className="cma-mp-dot" style={{ background: meta?.brandColor ?? "var(--ink-300)" }} />
                  <strong>{row.marketplaceName}</strong>
                  {isCheapest && <span className="cma-chip accent">Cheapest effective</span>}
                  {row.allOutOfStock && <span className="cma-chip warn">All offers unavailable</span>}
                </div>

                {/* Every rung below describes the SAME offer — the cheapest
                    in-stock one — so the arithmetic visibly adds up. */}
                <div className="cma-ladder">
                  <LadderCell label="Listed" value={row.headlineMinor} />
                  <LadderCell
                    label={row.shippingMinor ? "+ Delivery" : "Delivery"}
                    value={row.shippingMinor}
                    muted={!row.shippingMinor}
                  />
                  <LadderCell label="= Landed" value={row.landedMinor} />
                  {row.universalDiscountMinor > 0 && (
                    <LadderCell label="− Instant discount" value={row.universalDiscountMinor} muted />
                  )}
                  <LadderCell label="= Effective" value={row.effectiveMinor} total />
                  {row.conditionalBestMinor != null && row.conditionalBestMinor < row.effectiveMinor && (
                    <LadderCell label="If eligible" value={row.conditionalBestMinor} muted />
                  )}
                </div>

                <dl className="cma-mp-facts">
                  <div>
                    <dt>Sellers</dt>
                    <dd>
                      {row.inStockCount} of {row.offerCount} in stock
                    </dd>
                  </div>
                  <div>
                    <dt>Cheapest from</dt>
                    <dd>
                      {row.bestSeller ?? "—"}
                      {row.bestSellerRating != null && <span className="cma-sub"> · {row.bestSellerRating}★</span>}
                    </dd>
                  </div>
                  <div>
                    <dt>Fulfilment</dt>
                    <dd>{(row.bestSellerFulfilment ?? "—").replace(/_/g, " ")}</dd>
                  </div>
                  <div>
                    <dt>Listing rating</dt>
                    <dd>
                      {row.rating != null ? `${row.rating}★` : "—"}
                      {row.reviewCount != null && (
                        <span className="cma-sub"> · {row.reviewCount.toLocaleString("en-IN")} reviews</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Trust-weighted</dt>
                    <dd>{row.trustRating != null ? `${row.trustRating}★` : "—"}</dd>
                  </div>
                  <div>
                    <dt>Match confidence</dt>
                    <dd>{row.matchConfidence != null ? `${Math.round(row.matchConfidence * 100)}%` : "—"}</dd>
                  </div>
                </dl>

                {promoTotal > 0 ? (
                  <div className="cma-promos">
                    {row.promoCount.universal > 0 && (
                      <span className="cma-chip universal">{row.promoCount.universal} everyone</span>
                    )}
                    {row.promoCount.conditional > 0 && (
                      <span className="cma-chip conditional">{row.promoCount.conditional} conditional</span>
                    )}
                    {row.promoCount.deferred > 0 && <span className="cma-chip">{row.promoCount.deferred} cashback</span>}
                    {row.promoCount.financing > 0 && <span className="cma-chip">{row.promoCount.financing} EMI</span>}
                  </div>
                ) : (
                  <div className="cma-promos">
                    <span className="cma-chip muted">No active offers</span>
                  </div>
                )}

                <Link className="cma-mp-link" to={`/listings/${row.listingId}`}>
                  Inspect sellers <ArrowRight size={12} strokeWidth={2.25} />
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      {/* --------------------------- 2. DIFFERENCES ------------------------ */}
      {mp && mp.pricedCount >= 2 && (
        <section className="cma-section">
          <header className="cma-head">
            <span className="cma-step">2</span>
            <div>
              <h2>Where the platforms differ</h2>
              <p>
                Two platforms carrying the same product are not the same commercial environment. These are the differences
                that change how the price should be read.
              </p>
            </div>
          </header>

          <div className="cma-diff-grid">
            <div className="cma-diff card">
              <span className="cma-diff-label">Price spread</span>
              <strong className="tabular">{mp.spreadPct}%</strong>
              <p>
                {formatMinor(mp.cheapest.effectiveMinor)} on {mp.cheapest.marketplaceName} to{" "}
                {formatMinor(mp.dearest.effectiveMinor)} on {mp.dearest.marketplaceName}.
              </p>
            </div>

            {mp.priceTrustCorrelation != null && (
              <div className="cma-diff card">
                <span className="cma-diff-label">Price vs trust</span>
                <strong className="tabular">{mp.priceTrustCorrelation}</strong>
                <p>
                  Rank correlation between effective price and trust-weighted rating.{" "}
                  {mp.priceTrustCorrelation < -0.5
                    ? "Strongly negative — the dearer platforms are the weaker-rated ones."
                    : mp.priceTrustCorrelation > 0.5
                      ? "Positive — paying more does buy a better-rated audience."
                      : "Weak — price and platform trust move independently here."}
                </p>
              </div>
            )}

            <div className="cma-diff card">
              <span className="cma-diff-label">Offer availability</span>
              <strong className="tabular">
                {mp.platformsWithUniversalPromo} of {mp.pricedCount}
              </strong>
              <p>
                platforms carry a discount every buyer gets. {mp.platformsWithAnyPromo} carry some kind of offer, but only
                universal ones move the comparison price.
              </p>
            </div>

            <div className="cma-diff card">
              <span className="cma-diff-label">Delivery</span>
              <strong className="tabular">{mp.platformsWithPaidShipping}</strong>
              <p>
                platform{mp.platformsWithPaidShipping === 1 ? " has" : "s have"} offers that charge for delivery.
                {mp.shippingReordersRanking ? " Including it changes which platform is cheapest." : " Ranking is unaffected."}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* --------------------------- 3. COMPETITORS ------------------------ */}
      <section className="cma-section">
        <header className="cma-head">
          <span className="cma-step">3</span>
          <div>
            <h2>Who this competes with</h2>
            <p>
              {analysis.limited
                ? "The competitive set could not be established for this product."
                : `${recommendation.coverage.directCount} direct competitor${
                    recommendation.coverage.directCount === 1 ? "" : "s"
                  } and ${recommendation.coverage.comparableCount} looser comparable${
                    recommendation.coverage.comparableCount === 1 ? "" : "s"
                  }, screened on specification, price band, brand tier and shared marketplace. The raw price gap is broken
                  down into what actually explains it.`}
            </p>
          </div>
        </header>

        {analysis.limited ? (
          <div className="card cma-limited">
            <p className="cma-limited-reason">{analysis.limitedReason}</p>
            {analysis.whatWouldHelp.length > 0 && (
              <>
                <span className="cma-limited-label">What would change this</span>
                <ul>
                  {analysis.whatWouldHelp.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="cma-note">
              <Info size={14} strokeWidth={2} />
              The observations above are still real. What is missing is enough comparable evidence to interpret them — and
              inventing that interpretation would be worse than saying so.
            </p>
          </div>
        ) : (
          <>
            {unitBasis && (
              <p className="cma-note">
                <Info size={14} strokeWidth={2} />
                Prices are also shown per {unitBasis.unit ?? "unit"}, because this product type is sold in different{" "}
                {unitBasis.label.toLowerCase()}s. A cheaper pack is not automatically better value.
              </p>
            )}

            <div className="cma-table-wrap">
              <table className="cma-table">
                <thead>
                  <tr>
                    <th>Competitor</th>
                    <th>Tier</th>
                    <th className="num">Price</th>
                    <th className="num">vs this</th>
                    {unitBasis && <th className="num">Per {unitBasis.unit ?? "unit"}</th>}
                    {unitBasis && <th className="num">vs this</th>}
                    <th className="num">Rating</th>
                    <th className="num">Reviews</th>
                    <th className="num">Weight</th>
                    <th>Sold on</th>
                  </tr>
                </thead>
                <tbody>
                  {competitors.rows.map((c) => (
                    <tr key={c.id} className={c.cheaperButDearerPerUnit ? "reversal" : ""}>
                      <td>
                        <Link to={`/products/${c.id}/analysis`} className="cma-comp-name">
                          {c.name}
                        </Link>
                        {c.brandTier && <span className="cma-sub"> · {c.brandTier}</span>}
                      </td>
                      <td>
                        <span className={`cma-chip tier-${c.tier}`}>{c.tier}</span>
                      </td>
                      <td className="num tabular">{formatMinor(c.priceMinor)}</td>
                      <td className={`num tabular ${c.priceGapPct > 0 ? "up" : "down"}`}>
                        {c.priceGapPct > 0 ? "+" : ""}
                        {c.priceGapPct}%
                      </td>
                      {unitBasis && (
                        <td className="num tabular">
                          {c.unitPriceMinor != null ? `${formatMinor(c.unitPriceMinor * 100)}/100${unitBasis.unit ?? ""}` : "—"}
                        </td>
                      )}
                      {unitBasis && (
                        <td className={`num tabular ${c.unitGapPct > 0 ? "up" : "down"}`}>
                          {c.unitGapPct != null ? `${c.unitGapPct > 0 ? "+" : ""}${c.unitGapPct}%` : "—"}
                        </td>
                      )}
                      <td className="num tabular">{c.rating != null ? `${c.rating}★` : "—"}</td>
                      <td className="num tabular">{c.reviewCount != null ? c.reviewCount.toLocaleString("en-IN") : "—"}</td>
                      <td className="num tabular">{c.evidenceWeight}</td>
                      <td className="cma-mps">
                        {c.marketplaceIds.slice(0, 4).map((id) => (
                          <span
                            key={id}
                            className="cma-mp-pip"
                            style={{ background: getMarketplace(id)?.brandColor ?? "var(--ink-300)" }}
                            title={getMarketplace(id)?.name ?? id}
                          />
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {competitors.reversals.length > 0 && unitBasis && (
              <p className="cma-note accent">
                <AlertTriangle size={14} strokeWidth={2} />
                <span>
                  <strong>
                    {competitors.reversals.length} competitor{competitors.reversals.length === 1 ? "" : "s"} priced below this
                    product {competitors.reversals.length === 1 ? "is" : "are"} more expensive per{" "}
                    {unitBasis.unit ?? "unit"}
                  </strong>{" "}
                  — {competitors.reversals.map((r) => r.name).join(", ")}. Comparing headline prices alone reverses this
                  conclusion, which is the most common error in marketplace price comparison.
                </span>
              </p>
            )}

            <p className="cma-legend">
              <strong>Weight</strong> is relevance × data quality — how much each competitor counts toward the market
              statistics. A <strong>direct</strong> competitor contests the same purchase; a <strong>comparable</strong>{" "}
              informs value without contesting it, and counts for less.
            </p>
          </>
        )}
      </section>

      {/* ---------------------------- 4. FINDINGS -------------------------- */}
      {findings.length > 0 && (
        <section className="cma-section">
          <header className="cma-head">
            <span className="cma-step">4</span>
            <div>
              <h2>What the combination means</h2>
              <p>
                Each of these needed more than one dimension to reach — a price difference read against a specification, a
                rating read against its review base. Every one carries the figures it was computed from.
              </p>
            </div>
          </header>

          <div className="cma-findings">
            {findings.map((f) => {
              const meta = DIRECTION_META[f.direction] ?? DIRECTION_META.neutral;
              const DimIcon = DIMENSION_ICON[f.dimension] ?? Info;
              const DirIcon = meta.icon;
              return (
                <article key={f.id} className={`cma-finding tone-${meta.tone}`}>
                  <div className="cma-finding-head">
                    <span className="cma-finding-dim">
                      <DimIcon size={13} strokeWidth={2} />
                      {f.dimension}
                    </span>
                    <span className={`cma-finding-dir ${meta.tone}`}>
                      <DirIcon size={12} strokeWidth={2.25} />
                      {meta.label}
                    </span>
                  </div>
                  <h3>{f.headline}</h3>
                  <p>{f.detail}</p>
                  {f.evidence?.length > 0 && (
                    <ul className="cma-evidence">
                      {f.evidence.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* ----------------------------- 5. HISTORY -------------------------- */}
      {history && (
        <section className="cma-section">
          <header className="cma-head">
            <span className="cma-step">5</span>
            <div>
              <h2>Is today&rsquo;s market normal?</h2>
              <p>
                {history.observationCount} observations from {history.firstDate}. Without this, a promotional dip reads as the
                standing market price.
              </p>
            </div>
          </header>

          <div className="cma-hist">
            <div className="cma-hist-stats">
              <div>
                <span>90-day normal</span>
                <strong className="tabular">{formatMinor(history.normalMinor)}</strong>
              </div>
              <div>
                <span>Observed range</span>
                <strong className="tabular">
                  {formatMinor(history.minMinor)} – {formatMinor(history.maxMinor)}
                </strong>
              </div>
              <div>
                <span>Cheapest today</span>
                <strong className="tabular">{formatMinor(history.currentMinor)}</strong>
              </div>
              <div>
                <span>Volatility</span>
                <strong className="tabular">
                  {history.volatility}% <em>{history.volatilityBand}</em>
                </strong>
              </div>
              <div>
                <span>Trend over window</span>
                <strong className={`tabular ${history.trendPct > 0 ? "up" : "down"}`}>
                  {history.trendPct > 0 ? "+" : ""}
                  {history.trendPct}%
                </strong>
              </div>
              <div>
                <span>Promotional days</span>
                <strong className="tabular">{history.promoDays}</strong>
              </div>
            </div>

            <div className="cma-hist-band">
              <div className="cma-band-track">
                <div
                  className="cma-band-marker"
                  style={{ left: `${Math.min(Math.max(history.percentile, 2), 98)}%` }}
                  title={`${history.percentile}th percentile`}
                />
              </div>
              <div className="cma-band-labels">
                <span>{formatMinor(history.minMinor)}</span>
                <span className="cma-band-caption">
                  Cheapest offer today sits at the <strong>{history.percentile}th percentile</strong> of its own range
                </span>
                <span>{formatMinor(history.maxMinor)}</span>
              </div>
            </div>

            {history.distortion?.note && (
              <p className="cma-note warn">
                <AlertTriangle size={14} strokeWidth={2} />
                {history.distortion.note}
              </p>
            )}
          </div>
        </section>
      )}

      {/* --------------------------- 6. CONCLUSION ------------------------- */}
      {bridge && (
        <section className="cma-section">
          <header className="cma-head">
            <span className="cma-step">6</span>
            <div>
              <h2>Therefore &mdash; the price</h2>
              <p>
                The findings above, sorted by which direction each one argues for, and what the engine did with them.
              </p>
            </div>
          </header>

          <div className="cma-scales">
            <div className="cma-scale up">
              <h4>
                <TrendingUp size={14} strokeWidth={2.25} />
                Supports a higher price ({bridge.forPremium.length})
              </h4>
              {bridge.forPremium.length ? (
                <ul>
                  {bridge.forPremium.map((f) => (
                    <li key={f.id}>{f.headline}</li>
                  ))}
                </ul>
              ) : (
                <p className="cma-scale-empty">Nothing in the evidence argues for a premium.</p>
              )}
            </div>
            <div className="cma-scale down">
              <h4>
                <TrendingDown size={14} strokeWidth={2.25} />
                Argues for a lower price ({bridge.forAggressive.length})
              </h4>
              {bridge.forAggressive.length ? (
                <ul>
                  {bridge.forAggressive.map((f) => (
                    <li key={f.id}>{f.headline}</li>
                  ))}
                </ul>
              ) : (
                <p className="cma-scale-empty">Nothing in the evidence argues for undercutting.</p>
              )}
            </div>
          </div>

          <p className="cma-verdict">{bridge.verdict}</p>

          <div className="cma-strategies">
            {bridge.strategies.map((s) => (
              <div key={s.key} className={`cma-strategy ${s.key}`}>
                <span className="cma-strategy-label">{s.label}</span>
                <strong className="tabular">{formatMinor(s.priceMinor)}</strong>
                <div className="cma-strategy-deltas">
                  {s.vsOwnMarketPct != null && (
                    <span>
                      {s.vsOwnMarketPct > 0 ? "+" : ""}
                      {s.vsOwnMarketPct}% vs own market
                    </span>
                  )}
                  {s.vsCompMedianPct != null && (
                    <span>
                      {s.vsCompMedianPct > 0 ? "+" : ""}
                      {s.vsCompMedianPct}% vs competitors
                    </span>
                  )}
                </div>
                {s.supported === false && <span className="cma-chip warn">Not evidenced</span>}
                {s.boundBy && <span className="cma-chip muted">Held at {s.boundBy}</span>}
              </div>
            ))}
          </div>

          <div className="cma-bounds">
            <span>
              Floor <strong className="tabular">{formatMinor(bridge.floorMinor)}</strong>
            </span>
            <span>
              Ceiling <strong className="tabular">{formatMinor(bridge.ceilingMinor)}</strong> ({bridge.ceilingSource})
            </span>
            <span>
              Evidence <strong>{bridge.confidence}</strong>
            </span>
          </div>

          {bridge.collapsed && (
            <p className="cma-note warn">
              <AlertTriangle size={14} strokeWidth={2} />
              {bridge.collapsed}
            </p>
          )}

          <Link to={`/products/${productId}/recommendation`} className="btn btn-accent cma-cta">
            See the full recommendation <ArrowRight size={14} strokeWidth={2} />
          </Link>
        </section>
      )}
    </div>
  );
}
