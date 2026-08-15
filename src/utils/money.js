// Money is stored as integer minor units (paise) everywhere in the mock
// entities, mirroring the database design (`selling_price_minor`, `mrp_minor`)
// so cross-marketplace arithmetic never touches floating point. Formatting
// happens only here, at the boundary to the UI.

export function toMinor(rupees) {
  return Math.round(rupees * 100);
}

export function toMajor(minor) {
  return minor / 100;
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrFormatterDecimal = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export function formatMinor(minor, { decimals = false } = {}) {
  if (minor === null || minor === undefined) return "—";
  const major = toMajor(minor);
  return decimals ? inrFormatterDecimal.format(major) : inrFormatter.format(major);
}

export function formatCompactMinor(minor) {
  if (minor === null || minor === undefined) return "—";
  const major = toMajor(minor);
  if (major >= 100000) return `₹${(major / 100000).toFixed(2)}L`;
  if (major >= 1000) return `₹${(major / 1000).toFixed(1)}k`;
  return `₹${major.toFixed(0)}`;
}

export function formatPct(fraction, { signed = false, decimals = 1 } = {}) {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return "—";
  const pct = fraction * 100;
  const sign = signed && pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(decimals)}%`;
}

export function formatDate(iso, { withYear = true } = {}) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: withYear ? "numeric" : undefined,
  });
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTime(iso) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
