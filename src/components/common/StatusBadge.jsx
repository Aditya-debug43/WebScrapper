import { CheckCircle2, AlertTriangle, AlertOctagon, Info } from "lucide-react";
import "./StatusBadge.css";

// Status is a fixed, reserved scale — never repurposed as a categorical
// series color — and always paired with an icon + label, never color alone.
const STATUS_MAP = {
  good: { icon: CheckCircle2, className: "status-good" },
  warning: { icon: AlertTriangle, className: "status-warning" },
  serious: { icon: AlertTriangle, className: "status-serious" },
  critical: { icon: AlertOctagon, className: "status-critical" },
  neutral: { icon: Info, className: "status-neutral" },
};

export default function StatusBadge({ status = "neutral", children, icon: overrideIcon }) {
  const config = STATUS_MAP[status] ?? STATUS_MAP.neutral;
  const Icon = overrideIcon ?? config.icon;
  return (
    <span className={`status-badge ${config.className}`}>
      <Icon size={12.5} strokeWidth={2.25} />
      {children}
    </span>
  );
}
