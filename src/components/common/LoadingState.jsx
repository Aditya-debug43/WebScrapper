import "./LoadingState.css";

/**
 * No spinner. A hairline sweeping across the width of the content is quieter,
 * matches the rule-based language of the rest of the interface, and — because
 * it occupies the full measure — reserves roughly the space the content will
 * take, so the page does not lurch when it arrives.
 */
export default function LoadingState({ label = "Loading…" }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading-rule" aria-hidden="true">
        <span />
      </div>
      <p className="loading-label">{label}</p>
    </div>
  );
}
