import "./DataTable.css";

/**
 * columns: [{ key, header, align?, width?, render(row) }]
 * rows: array of any shape; `rowKey(row)` must return a stable id.
 *
 * Right-aligned columns are treated as numeric and set in the mono figure
 * face, so decimal points line up down the column without every call site
 * having to remember to say so.
 */
export default function DataTable({ columns, rows, rowKey, onRowClick, emptyMessage = "Nothing to show yet." }) {
  if (!rows || rows.length === 0) {
    return <div className="data-table-empty">{emptyMessage}</div>;
  }

  return (
    <div className="data-table-wrap scroll-x">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={col.align === "right" ? "num" : undefined}
                style={{ width: col.width }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? "clickable" : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} className={col.align === "right" ? "num tabular" : undefined}>
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
