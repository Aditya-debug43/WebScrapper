import "./SpecList.css";

/** Renders a product's flexible spec document against its attribute registry definitions. */
export default function SpecList({ specifications, attributeDefs }) {
  if (!specifications || attributeDefs.length === 0) {
    return <p className="spec-list-empty">No structured specifications captured for this product yet.</p>;
  }

  return (
    <dl className="spec-list">
      {attributeDefs.map((def) => {
        const raw = specifications[def.attributeKey];
        if (raw === undefined) return null;
        let display = raw;
        if (def.dataType === "boolean") display = raw ? "Yes" : "No";
        else if (def.unit) display = `${raw} ${def.unit}`;
        return (
          <div className="spec-list-row" key={def.id}>
            <dt>{def.displayName}</dt>
            <dd>{display}</dd>
          </div>
        );
      })}
    </dl>
  );
}
