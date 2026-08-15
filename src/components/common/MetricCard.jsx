import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import "./MetricCard.css";

/**
 * A stat tile: label, headline value, and an optional signed delta.
 * `trend` controls delta color semantics ("up-is-good" | "up-is-bad" | null).
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
    <div className="metric-card card">
      <div className="metric-card-top">
        <span className="eyebrow">{label}</span>
        {Icon && (
          <span className="metric-card-icon">
            <Icon size={15} strokeWidth={1.8} />
          </span>
        )}
      </div>
      <div className="metric-card-value tabular">{value}</div>
      <div className="metric-card-bottom">
        {delta != null && delta !== "" && (
          <span className={`metric-card-delta ${deltaClass}`}>
            {deltaPositive ? <ArrowUpRight size={13} strokeWidth={2.25} /> : <ArrowDownRight size={13} strokeWidth={2.25} />}
            {delta}
          </span>
        )}
        {sublabel && <span className="metric-card-sublabel">{sublabel}</span>}
      </div>
      {children}
    </div>
  );
}
