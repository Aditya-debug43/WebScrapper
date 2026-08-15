import { useState } from "react";
import { ChevronDown } from "lucide-react";
import "./FacetGroup.css";

/**
 * One collapsible filter group. Options carry live counts computed with this
 * group's own selection excluded, so selecting one option never zeroes out its
 * siblings — standard faceted-search behaviour.
 */
export default function FacetGroup({ title, options, selected = [], onToggle, singleSelect = false, initiallyOpen = true, maxVisible = 6 }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [showAll, setShowAll] = useState(false);

  if (!options || options.length === 0) return null;
  const visible = showAll ? options : options.slice(0, maxVisible);

  return (
    <div className="facet-group">
      <button type="button" className="facet-group-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>{title}</span>
        <ChevronDown size={14} strokeWidth={2} className={`facet-chevron${open ? " open" : ""}`} />
      </button>

      {open && (
        <div className="facet-group-body">
          {visible.map((opt) => {
            const isSelected = selected.includes(opt.id);
            return (
              <label key={opt.id} className={`facet-option${isSelected ? " selected" : ""}`}>
                <input
                  type={singleSelect ? "radio" : "checkbox"}
                  checked={isSelected}
                  onChange={() => onToggle(opt.id)}
                />
                <span className="facet-option-label">{opt.label}</span>
                <span className="facet-option-count">{opt.count}</span>
              </label>
            );
          })}
          {options.length > maxVisible && (
            <button type="button" className="facet-more" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show less" : `+${options.length - maxVisible} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
