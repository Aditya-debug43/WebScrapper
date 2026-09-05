import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import "./MetricCard.css";

/**
 * A stat, not a card.
 *
 * These used to be four rounded white boxes in a row. They are now columns
 * hung beneath a single heavy rule: the label small and tracked, the figure
 * large and monospaced, everything else quiet underneath. Grouped in a grid
 * the rules line up and read as one ruled band, which is both calmer and far
 * more legible than four competing containers.
 *
 * `trend` controls delta colour semantics ("up-is-good" | "up-is-bad" | null).
 */
export default function MetricCard({ label, value, delta, trend = null, sublabel, icon: Icon, children }) {
  const deltaPositive = typeof delta === "string" ? delta.trim().startsWith("+") : delta > 0;
  const goodUp = trend === "up-is-good";
  const badUp = trend === "up-is-bad";
  let deltaClass = "neutral";
  if (trend && delta != null && delta !== "") {
    if (deltaPositive) deltaClass = goodUp ? "positive" : badUp ? "negative" : "neutral";
    else deltaClass = goodUp ? "negative" : badUp ? "positive" : "neutral";
  }

  return (
    <div className="metric">
      <div className="metric-label">
        {Icon && <Icon size={12} strokeWidth={2} aria-hidden="true" />}
        <span>{label}</span>
      </div>
      <div className="metric-value tabular">{value}</div>
      {(delta || sublabel) && (
        <div className="metric-foot">
          {delta != null && delta !== "" && (
            <span className={`metric-delta ${deltaClass}`}>
              {deltaPositive ? <ArrowUpRight size={12} strokeWidth={2.5} /> : <ArrowDownRight size={12} strokeWidth={2.5} />}
              {delta}
            </span>
          )}
          {sublabel && <span className="metric-sub">{sublabel}</span>}
        </div>
      )}
      {children}
    </div>
  );
}
