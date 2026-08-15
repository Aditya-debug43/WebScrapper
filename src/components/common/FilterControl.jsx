import "./FilterControl.css";

/** A segmented pill control — used for chart range presets and similar small option sets. */
export default function FilterControl({ options, value, onChange, ariaLabel }) {
  return (
    <div className="filter-control" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`filter-control-option${value === opt.value ? " active" : ""}`}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
