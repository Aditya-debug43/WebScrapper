import "./LoadingState.css";

export default function LoadingState({ label = "Loading…" }) {
  return (
    <div className="loading-state">
      <span className="loading-spinner" aria-hidden="true" />
      {label}
    </div>
  );
}
