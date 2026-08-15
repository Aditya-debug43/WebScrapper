import { Check, AlertTriangle, Zap, Scale, Crown, Lock } from "lucide-react";
import { formatMinor, formatPct } from "../../utils/money";
import "./StrategyCard.css";

const ICONS = { fast_sale: Zap, balanced: Scale, premium: Crown };

export default function StrategyCard({ strategy, selected, onSelect, currentPriceMinor }) {
  const Icon = ICONS[strategy.key] ?? Scale;
  const vsCurrent =
    currentPriceMinor && currentPriceMinor > 0 ? (strategy.priceMinor - currentPriceMinor) / currentPriceMinor : null;

  // Margin is quoted on the best marketplace available for this strategy —
  // the seller's realistic best case, with the marketplace named so it is not
  // a floating number.
  const best = strategy.margins
    .filter((m) => m.marginMinor != null)
    .sort((a, b) => b.marginMinor - a.marginMinor)[0];

  return (
    <button
      type="button"
      className={`strategy-card${selected ? " selected" : ""}${strategy.recommended ? " recommended" : ""}`}
      onClick={() => onSelect(strategy.key)}
      aria-pressed={selected}
    >
      <div className="strategy-card-head">
        <span className="strategy-card-icon">
          <Icon size={14} strokeWidth={2} />
        </span>
        <div className="strategy-card-titles">
          <span className="strategy-card-label">{strategy.label}</span>
          <span className="strategy-card-tagline">{strategy.tagline}</span>
        </div>
        {strategy.recommended && <span className="strategy-card-flag">Recommended</span>}
        {strategy.supported === false && <span className="strategy-card-flag unsupported">Not evidenced</span>}
      </div>

      <div className="strategy-card-price tabular">{formatMinor(strategy.priceMinor)}</div>

      {strategy.bindingConstraint && (
        <span className="strategy-card-bound">
          <Lock size={11} strokeWidth={2.25} />
          Held at the {strategy.bindingConstraint.label}
        </span>
      )}

      <div className="strategy-card-deltas">
        {vsCurrent != null && (
          <span className={`strategy-delta ${vsCurrent >= 0 ? "up" : "down"}`}>
            {formatPct(vsCurrent, { signed: true })} vs current
          </span>
        )}
        <span className="strategy-delta neutral">
          undercuts {strategy.position.undercuts} of {strategy.position.total}
        </span>
      </div>

      {best && (
        <div className="strategy-card-margin">
          <span>Best margin — {best.marketplace.name}</span>
          <strong className={best.marginMinor >= 0 ? "" : "negative"}>
            {formatMinor(best.marginMinor)} ({formatPct(best.marginPct)})
          </strong>
        </div>
      )}

      <ul className="strategy-card-when">
        {strategy.bestWhen.map((w) => (
          <li key={w}>
            <Check size={12} strokeWidth={2.5} />
            {w}
          </li>
        ))}
      </ul>

      {strategy.warning && (
        <p className="strategy-card-warning">
          <AlertTriangle size={12} strokeWidth={2} />
          {strategy.warning}
        </p>
      )}
    </button>
  );
}
