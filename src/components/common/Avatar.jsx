import "./Avatar.css";

/**
 * Seller initials.
 *
 * These used to be six hard-coded hues assigned by hashing the name — six
 * colours that meant nothing, in a system where colour is reserved for
 * meaning. They are now monochrome tiles. Identity still comes from the
 * initials; the hue is not doing any work, so it is gone.
 */
function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Avatar({ name, size = 32 }) {
  return (
    <span
      className="avatar tabular"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
