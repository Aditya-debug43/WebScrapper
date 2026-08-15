import { useState } from "react";
import {
  Eye, Calculator, TrendingUp, TrendingDown, Users, History, Wallet, Target,
  ShieldQuestion, Lock, Ban, CheckCircle2, XCircle, Layers, Info,
  Store, FlaskConical, AlertTriangle, BarChart3,
} from "lucide-react";
import { formatMinor, formatPct, formatDate } from "../../utils/money";
import StatusBadge from "../common/StatusBadge";
import DataTable from "../common/DataTable";
import StrategyCard from "./StrategyCard";
import "./RecommendationPanel.css";

const CONFIDENCE_STATUS = { high: "good", "medium-high": "good", medium: "warning", low: "serious" };

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function Tag({ kind }) {
  return (
    <span className={`prov-tag prov-${kind}`}>
      {kind === "observed" ? <Eye size={10} strokeWidth={2.5} /> : <Calculator size={10} strokeWidth={2.5} />}
      {kind}
    </span>
  );
}

function Evidence({ icon: Icon, title, tag, children }) {
  return (
    <section className="evidence-card card">
      <header className="evidence-head">
        <span className="evidence-icon">
          <Icon size={14} strokeWidth={2} />
        </span>
        <h3>{title}</h3>
        {tag && <Tag kind={tag} />}
      </header>
      <div className="evidence-body">{children}</div>
    </section>
  );
}

function Row({ label, value, strong }) {
  return (
    <div className={`ev-row${strong ? " strong" : ""}`}>
      <span>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}

/** Shown when the engine deliberately declines to produce a price. */
function NoRecommendation({ rec }) {
  const conflict = rec.constraintConflict;
  return (
    <div className="rec-root">
      <section className="card rec-refusal">
        <header>
          <span className={`rec-refusal-icon${conflict ? " conflict" : ""}`}>
            <Ban size={18} strokeWidth={2} />
          </span>
          <div>
            <h2>{conflict ? "No valid price exists" : "Not enough comparable evidence"}</h2>
            <p>{rec.reason}</p>
          </div>
        </header>

        {rec.whatWouldHelp?.length > 0 && (
          <div className="rec-refusal-help">
            <span className="eyebrow">What would change this</span>
            <ul>
              {rec.whatWouldHelp.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <p className="rec-refusal-note">
          A confident number here would be worse than none: it would look authoritative while resting on evidence the
          system does not actually have.
        </p>
      </section>

      {rec.excludedComps?.length > 0 && <ExcludedTable excluded={rec.excludedComps} />}
    </div>
  );
}

function ExcludedTable({ excluded }) {
  return (
    <section>
      <div className="rec-section-head">
        <div>
          <h2 className="section-title">Screened out of the comparable set</h2>
          <p className="rec-section-sub">
            Same product type, but rejected as a benchmark. Each exclusion carries its reason — a comparable set is only
            as good as what it refuses to include.
          </p>
        </div>
      </div>
      <DataTable
        columns={[
          { key: "name", header: "Product", render: (c) => c.product.canonicalName },
          { key: "price", header: "Price", align: "right", render: (c) => formatMinor(c.currentPriceMinor) },
          { key: "sim", header: "Similarity", align: "right", render: (c) => `${Math.round(c.similarity * 100)}%` },
          { key: "why", header: "Why excluded", render: (c) => <span className="rec-excl-reason">{c.reason}</span> },
        ]}
        rows={excluded}
        rowKey={(c) => c.product.id}
      />
    </section>
  );
}

export default function RecommendationPanel({ rec }) {
  const [selectedKey, setSelectedKey] = useState("balanced");

  if (rec.insufficientData) return <NoRecommendation rec={rec} />;

  const {
    stats, strength, history, competition, commercial, strategies, bounds, confidence,
    comps, compMethod, excludedComps, constraints, mrp, evidence, currentPriceLayers, collapsed,
    anchor, ownMarket, normalMinor, distortion, wtp, zones, viability, sanityChecks,
  } = rec;
  const selected = strategies.find((s) => s.key === selectedKey) ?? strategies[1];
  const failedChecks = (sanityChecks ?? []).filter((c) => !c.passed);

  return (
    <div className="rec-root">
      {/* ---- banners that change how the whole page should be read ---- */}
      {viability?.conflict && (
        <div className="rec-banner critical">
          <AlertTriangle size={16} strokeWidth={2} />
          <div>
            <strong>Market price and your economics are in conflict.</strong>
            <p>{viability.note}</p>
          </div>
        </div>
      )}
      {distortion?.state !== "normal" && distortion?.note && (
        <div className="rec-banner warning">
          <Info size={16} strokeWidth={2} />
          <div>
            <strong>The current market looks {distortion.state}.</strong>
            <p>{distortion.note}</p>
          </div>
        </div>
      )}

      {/* ------------------------- strategies ------------------------- */}
      <section>
        <div className="rec-section-head">
          <div>
            <h2 className="section-title">Pricing strategies</h2>
            <p className="rec-section-sub">
              Three prices derived from different evidence and bounded by the same hard constraints. All are derived
              figures, never observed marketplace facts.
            </p>
          </div>
          <StatusBadge status={CONFIDENCE_STATUS[confidence.level] ?? "neutral"}>
            Confidence: {confidence.level}
          </StatusBadge>
        </div>

        {collapsed && (
          <p className="rec-collapsed">
            <Info size={13} strokeWidth={2} /> {collapsed}
          </p>
        )}

        <div className="rec-strategies">
          {strategies.map((s) => (
            <StrategyCard
              key={s.key}
              strategy={s}
              selected={s.key === selectedKey}
              onSelect={setSelectedKey}
              currentPriceMinor={rec.currentPriceMinor}
            />
          ))}
        </div>

        <div className="rec-why card">
          <header>
            <Target size={14} strokeWidth={2} />
            <h3>
              Why {formatMinor(selected.priceMinor)} for “{selected.label}”
            </h3>
          </header>
          <p className="rec-why-anchor">
            <strong>Objective:</strong> {selected.objective}
            <br />
            <strong>Anchor:</strong> {selected.anchor}
          </p>
          <ul className="rec-why-list">
            {selected.rationale.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {selected.bindingConstraint && (
            <p className="rec-why-bound">
              <Lock size={13} strokeWidth={2} />
              This price was held at the <strong>{selected.bindingConstraint.label}</strong> (
              {formatMinor(selected.bindingConstraint.boundMinor)}) — the underlying calculation wanted to go further.
            </p>
          )}
          <div className="rec-why-position">
            At this price you would undercut <strong>{selected.position.undercuts}</strong> of{" "}
            {selected.position.total} competing prices, with <strong>{selected.position.sitsAbove}</strong> still
            cheaper than you — the {ordinal(Math.round(selected.position.percentile * 100))} percentile of the
            competitive pool.
          </div>

          <div className="rec-margin-table">
            <span className="eyebrow">Margin at {formatMinor(selected.priceMinor)}, by marketplace</span>
            {selected.margins.map((m) => (
              <div className="rec-margin-row" key={m.marketplace.id}>
                <span className="rec-margin-mp">
                  <span className="marketplace-dot" style={{ background: m.marketplace.brandColor }} />
                  {m.marketplace.name}
                </span>
                <span className="rec-margin-fee">
                  {m.feeRule
                    ? `${m.feeRule.referralPct}% referral${m.feeRule.isCategoryDefault ? " (default rate)" : ""}`
                    : "no fee rule"}
                </span>
                <span className="tabular">
                  {m.breakEvenMinor != null ? `floor ${formatMinor(m.breakEvenMinor)}` : "—"}
                </span>
                <span className={`tabular rec-margin-value${m.marginMinor != null && m.marginMinor < 0 ? " negative" : ""}`}>
                  {m.marginMinor != null ? `${formatMinor(m.marginMinor)} (${formatPct(m.marginPct)})` : "—"}
                </span>
              </div>
            ))}
            {!commercial.cost && (
              <p className="rec-note">No seller cost has been entered for this product, so margin cannot be computed.</p>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------- constraints ------------------------- */}
      <section>
        <div className="rec-section-head">
          <div>
            <h2 className="section-title">Constraints applied</h2>
            <p className="rec-section-sub">
              Hard constraints cannot be violated by any strategy — a price that breaks one is invalid, not bold. Soft
              constraints shape the result without bounding it.
            </p>
          </div>
        </div>

        <div className="rec-constraints">
          {constraints.hard.map((c) => (
            <div className={`rec-constraint card${c.binding ? " binding" : ""}`} key={c.key}>
              <header>
                <Lock size={13} strokeWidth={2} />
                <h3>{c.label}</h3>
                <span className={`rec-constraint-kind ${c.kind}`}>{c.kind}</span>
                {c.binding && <StatusBadge status="warning">Binding</StatusBadge>}
              </header>
              <p className="rec-constraint-value tabular">
                {c.boundMinor != null ? formatMinor(c.boundMinor) : "not available"}
              </p>
              <p className="rec-constraint-why">{c.rationale}</p>
            </div>
          ))}
        </div>

        <div className="rec-soft">
          <span className="eyebrow">Soft constraints</span>
          <ul>
            {constraints.soft.map((s) => (
              <li key={s.key}>
                <strong>{s.label}</strong> — {s.detail}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------- defensibility ------------------------- */}
      <section>
        <div className="rec-section-head">
          <h2 className="section-title">Why not higher or lower?</h2>
        </div>
        <div className="rec-bounds">
          <div className="rec-bound card">
            <header>
              <TrendingDown size={14} strokeWidth={2} />
              <h3>Floor — {formatMinor(bounds.floorMinor)}</h3>
            </header>
            <ul>
              {bounds.lowerReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <div className="rec-bound card">
            <header>
              <TrendingUp size={14} strokeWidth={2} />
              <h3>Ceiling — {formatMinor(bounds.ceilingMinor)}</h3>
              <StatusBadge status={bounds.ceilingSource === "applicable MRP" ? "critical" : "neutral"}>
                set by {bounds.ceilingSource}
              </StatusBadge>
            </header>
            <ul>
              {bounds.upperReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ------------------------- evidence ------------------------- */}
      <section>
        <div className="rec-section-head">
          <h2 className="section-title">Evidence</h2>
          <p className="rec-section-sub">Everything the three prices were computed from.</p>
        </div>

        <div className="rec-evidence-grid">
          {ownMarket && (
            <Evidence icon={Store} title="This product's own market" tag="observed">
              <p className="ev-lead">
                The strongest evidence of what a product commands is what it is <strong>already selling for</strong>.
                This is the primary anchor; comparable products are secondary.
              </p>
              <Row label="In-stock offers" value={`${ownMarket.n}`} />
              <Row label="Range" value={`${formatMinor(ownMarket.min)} – ${formatMinor(ownMarket.max)}`} />
              <Row label="Median now" value={formatMinor(ownMarket.median)} strong />
              <Row label="90-day normal" value={normalMinor != null ? formatMinor(normalMinor) : "—"} />
              <Row label="Anchor used" value={`${formatMinor(anchor.minor)} (${anchor.basis})`} strong />
              <p className="ev-note">{anchor.detail}</p>
            </Evidence>
          )}

          <Evidence icon={FlaskConical} title="Willingness to pay" tag="derived">
            <p className="ev-lead">
              Not “is this product better?” but “does the market <strong>pay more</strong> for the ways it is better?”
              Estimated by regressing price on attributes across the comparable set.
            </p>
            <Row label="Observations" value={`${wtp.n} comparables`} />
            {wtp.adjR2 != null && <Row label="Model fit (adj. R²)" value={wtp.adjR2.toFixed(2)} />}
            <Row
              label="Verdict"
              value={wtp.trusted ? (wtp.supported ? "premium evidenced" : "no premium") : "not trustworthy"}
              strong
            />
            {wtp.supported && <Row label="Evidenced premium" value={formatMinor(wtp.evidencedPremiumMinor)} />}
            {wtp.trusted && wtp.features?.length > 0 && (
              <div className="ev-features">
                {wtp.features.map((f) => (
                  <div className="ev-feature" key={f.key}>
                    <span>{f.label}</span>
                    <span className="tabular">
                      {f.perSdPct >= 0 ? "+" : ""}
                      {(f.perSdPct * 100).toFixed(1)}% <em>per SD</em>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="ev-note">{wtp.verdict}</p>
          </Evidence>

          <Evidence icon={BarChart3} title="Competitive zones" tag="derived">
            <p className="ev-lead">
              The {zones.poolSize} prices a buyer could actually choose between — {zones.ownCount} offers for this
              product and {zones.compCount} close substitutes.
            </p>
            <Row label="Cheapest in pool" value={formatMinor(zones.floorZoneMinor)} />
            <Row label="Competitive band" value={`${formatMinor(zones.competitiveLowMinor)} – ${formatMinor(zones.competitiveHighMinor)}`} strong />
            <Row label="Band midpoint" value={formatMinor(zones.competitiveMidMinor)} />
            <Row label="Dearest in pool" value={formatMinor(zones.outlierAboveMinor)} />
            <Row
              label="Price concentration"
              value={zones.concentration != null ? `${Math.round(zones.concentration * 100)}% of median` : "—"}
            />
            <p className="ev-note">
              A tight band means the market is commoditised and there is little room to deviate; a wide one means
              positioning genuinely varies.
            </p>
          </Evidence>

          {currentPriceLayers && (
            <Evidence icon={Layers} title="Price ladder, cheapest offer" tag="observed">
              <Row label="MRP" value={currentPriceLayers.mrpMinor ? formatMinor(currentPriceLayers.mrpMinor) : "—"} />
              <Row label="Selling price" value={formatMinor(currentPriceLayers.sellingPriceMinor)} />
              <Row
                label="Shipping"
                value={currentPriceLayers.shippingFeeMinor ? formatMinor(currentPriceLayers.shippingFeeMinor) : "Free"}
              />
              <Row label="Landed price" value={formatMinor(currentPriceLayers.landedMinor)} />
              {currentPriceLayers.universalDiscountMinor > 0 && (
                <Row label="Instant discount (everyone)" value={`−${formatMinor(currentPriceLayers.universalDiscountMinor)}`} />
              )}
              <Row label="Effective price" value={formatMinor(currentPriceLayers.universalEffectiveMinor)} strong />
              {currentPriceLayers.conditionalDiscountMinor > 0 && (
                <Row
                  label="Best case if eligible"
                  value={formatMinor(currentPriceLayers.conditionalBestMinor)}
                />
              )}
              <p className="ev-note">
                Market comparison uses the <strong>effective price</strong> — what a buyer with no particular card,
                coupon or trade-in pays. Conditional benefits are shown but never benchmarked, because eligibility
                differs between sellers.
              </p>
            </Evidence>
          )}

          <Evidence icon={Target} title="Market position" tag="derived">
            <Row label="Comparable median" value={formatMinor(stats.median)} strong />
            <Row label="Interquartile range" value={`${formatMinor(stats.q1)} – ${formatMinor(stats.q3)}`} />
            <Row label="Full range" value={`${formatMinor(stats.min)} – ${formatMinor(stats.max)}`} />
            <Row
              label="This product now"
              value={rec.currentPriceMinor != null ? formatMinor(rec.currentPriceMinor) : "no active offer"}
            />
            {mrp?.mrpMinor != null && (
              <Row label="Applicable MRP" value={`${formatMinor(mrp.mrpMinor)} (${mrp.reliability})`} />
            )}
            {mrp?.note && <p className="ev-note">{mrp.note}</p>}
          </Evidence>

          <Evidence icon={TrendingUp} title="Product strength" tag="derived">
            <Row
              label="Strength index"
              value={strength.index >= 0 ? `+${strength.index.toFixed(2)}` : strength.index.toFixed(2)}
              strong
            />
            {strength.components.map((c) => (
              <div className="ev-component" key={c.key}>
                <div className="ev-component-head">
                  <span>{c.label}</span>
                  <span className={`ev-score ${c.score > 0.05 ? "pos" : c.score < -0.05 ? "neg" : ""}`}>
                    {c.score >= 0 ? "+" : ""}
                    {c.score.toFixed(2)}
                    <em> ×{c.weight}</em>
                  </span>
                </div>
                <p>{c.detail}</p>
              </div>
            ))}
            {strength.specAdvantages.length > 0 && (
              <p className="ev-specs">
                <strong>Ahead on:</strong>{" "}
                {strength.specAdvantages.map((s) => `${s.label} (${s.mine}${s.unit ? ` ${s.unit}` : ""} vs ${s.compMedian})`).join(", ")}
              </p>
            )}
            {strength.specDisadvantages.length > 0 && (
              <p className="ev-specs behind">
                <strong>Behind on:</strong>{" "}
                {strength.specDisadvantages.map((s) => `${s.label} (${s.mine}${s.unit ? ` ${s.unit}` : ""} vs ${s.compMedian})`).join(", ")}
              </p>
            )}
          </Evidence>

          <Evidence icon={Users} title="Competition" tag="observed">
            <Row label="Listings across marketplaces" value={`${competition.listingCount} on ${competition.marketplaceCount}`} />
            <Row label="Offers (in stock)" value={`${competition.inStockOfferCount} of ${competition.offerCount}`} strong />
            <Row label="Cheapest offer" value={competition.cheapestMinor != null ? formatMinor(competition.cheapestMinor) : "—"} />
            <Row label="Median offer" value={competition.medianMinor != null ? formatMinor(competition.medianMinor) : "—"} />
            <Row label="Spread across sellers" value={competition.spreadMinor != null ? formatMinor(competition.spreadMinor) : "—"} />
            {competition.reviewVelocity != null && (
              <Row label="Review velocity (demand proxy)" value={`~${Math.round(competition.reviewVelocity)}/day`} />
            )}
          </Evidence>

          {history && (
            <Evidence icon={History} title="Price history" tag="observed">
              <Row label="Observations" value={`${history.observationCount} days from ${formatDate(history.firstDate, { withYear: false })}`} />
              <Row label="30-day median" value={history.median30 != null ? formatMinor(history.median30) : "—"} strong />
              <Row label="60-day median" value={history.median60 != null ? formatMinor(history.median60) : "—"} />
              <Row label="90-day median" value={history.median90 != null ? formatMinor(history.median90) : "—"} />
              <Row label="Historic low / high" value={`${formatMinor(history.minMinor)} / ${formatMinor(history.maxMinor)}`} />
              <Row label="Trend over window" value={formatPct(history.trendPct, { signed: true })} />
              {history.promoDays > 0 && (
                <p className="ev-note">
                  {history.promoDays} promotional days observed ({history.promoLabels.join(", ")}) — the historic low is
                  a sale price, not a standing one.
                </p>
              )}
            </Evidence>
          )}

          <Evidence icon={Wallet} title="Commercial viability" tag="derived">
            <Row
              label="Seller cost (entered)"
              value={commercial.cost ? formatMinor(commercial.cost.costPriceMinor) : "not entered"}
              strong
            />
            {commercial.perMarketplace.map((m) => (
              <Row
                key={m.marketplace.id}
                label={`${m.marketplace.name} break-even`}
                value={m.breakEvenMinor != null ? formatMinor(m.breakEvenMinor) : "—"}
              />
            ))}
            {commercial.usesDefaultFeeRule && (
              <p className="ev-note">
                One or more marketplaces have no captured fee rule for this category, so a marketplace default rate is
                used. Margins here are indicative rather than confirmed.
              </p>
            )}
          </Evidence>

          {sanityChecks?.length > 0 && (
            <Evidence icon={CheckCircle2} title="Sanity checks" tag="derived">
              <p className="ev-lead">
                Run before anything is displayed. A failed check does not hide the number — it tells you which part of
                the reasoning to distrust.
              </p>
              <ul className="ev-checks">
                {sanityChecks.map((c) => (
                  <li key={c.key} className={c.passed ? "ok" : "not-ok"}>
                    {c.passed ? <CheckCircle2 size={12} strokeWidth={2.5} /> : <XCircle size={12} strokeWidth={2.5} />}
                    <span>
                      <strong>{c.label}</strong> — {c.detail}
                    </span>
                  </li>
                ))}
              </ul>
              {failedChecks.length === 0 && <p className="ev-note">All checks passed.</p>}
            </Evidence>
          )}

          <Evidence icon={ShieldQuestion} title="Evidence quality" tag="derived">
            <Row label="Overall" value={`${evidence.level} (${Math.round(evidence.score * 100)}%)`} strong />
            <ul className="ev-checks">
              {evidence.checks.map((c) => (
                <li key={c.key} className={c.ok ? "ok" : "not-ok"}>
                  {c.ok ? <CheckCircle2 size={12} strokeWidth={2.5} /> : <XCircle size={12} strokeWidth={2.5} />}
                  <span>
                    <strong>{c.label}</strong> — {c.detail}
                  </span>
                </li>
              ))}
            </ul>
            <p className="ev-note">
              Evidence quality does not just label the result — it limits it. Weaker evidence narrows how far the
              Balanced and Premium prices may travel from the market median.
            </p>
          </Evidence>
        </div>
      </section>

      {/* ------------------------- comparable set ------------------------- */}
      <section>
        <div className="rec-section-head">
          <div>
            <h2 className="section-title">Comparable set</h2>
            <p className="rec-section-sub">
              {compMethod
                ? `${compMethod.selected} of ${compMethod.candidatePool} ${compMethod.productTypeName.toLowerCase()} kept, ${compMethod.excludedCount} screened out. Scored on specifications (${compMethod.weights.specifications * 100}%), price segment (${compMethod.weights.priceSegment * 100}%) and brand tier (${compMethod.weights.brandTier * 100}%), then filtered for price coherence. Compared on ${compMethod.comparisonBasis}.`
                : null}
            </p>
          </div>
        </div>
        <DataTable
          columns={[
            { key: "name", header: "Product", render: (c) => c.product.canonicalName },
            { key: "brand", header: "Brand", render: (c) => `${c.brand?.name ?? "—"} · ${c.brand?.tier ?? "—"}` },
            { key: "price", header: "Effective price", align: "right", render: (c) => formatMinor(c.currentPriceMinor) },
            { key: "rating", header: "Rating", align: "right", render: (c) => (c.rating != null ? `${c.rating.toFixed(1)}★` : "—") },
            { key: "sim", header: "Similarity", align: "right", render: (c) => `${Math.round(c.similarity * 100)}%` },
          ]}
          rows={comps}
          rowKey={(c) => c.product.id}
        />
      </section>

      {excludedComps?.length > 0 && <ExcludedTable excluded={excludedComps} />}
    </div>
  );
}
