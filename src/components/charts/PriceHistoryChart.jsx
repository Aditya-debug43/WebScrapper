import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { TableProperties, LineChart as LineChartIcon } from "lucide-react";
import FilterControl from "../common/FilterControl";
import DataTable from "../common/DataTable";
import { formatMinor, formatCompactMinor, formatDate } from "../../utils/money";
import "./PriceHistoryChart.css";

const SERIES_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];

const RANGE_OPTIONS = [
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
  { value: 0, label: "All" },
];

function mergeSeries(series) {
  const dateSet = new Set();
  series.forEach((s) => s.observations.forEach((o) => dateSet.add(o.observedAt)));
  const dates = [...dateSet].sort();
  return dates.map((date) => {
    const row = { date };
    series.forEach((s, i) => {
      const obs = s.observations.find((o) => o.observedAt === date);
      // Plotted on the engine's comparison basis (see PRICE_BASIS), never the
      // raw selling price — the chart and the recommendation must be reading
      // the same number.
      row[`s${i}`] = obs && obs.isInStock ? (obs.effectiveMinor ?? obs.sellingPriceMinor + obs.shippingFeeMinor) / 100 : null;
      if (obs?.saleLabel) row.saleLabel = obs.saleLabel;
      if (obs?.mrpMinor) row.mrp = obs.mrpMinor / 100;
    });
    return row;
  });
}

function findSaleWindows(mergedData) {
  const windows = [];
  let open = null;
  mergedData.forEach((row, i) => {
    if (row.saleLabel && !open) open = { label: row.saleLabel, start: row.date };
    if (!row.saleLabel && open) {
      windows.push({ ...open, end: mergedData[i - 1].date });
      open = null;
    }
  });
  if (open) windows.push({ ...open, end: mergedData[mergedData.length - 1].date });
  return windows;
}

function CustomTooltip({ active, payload, label, series }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-date">{formatDate(label)}</p>
      {payload.map((p, i) => {
        if (p.value == null) return null;
        const seller = series[Number(p.dataKey.replace("s", ""))]?.seller;
        return (
          <div className="chart-tooltip-row" key={p.dataKey}>
            <span className="chart-tooltip-dot" style={{ background: SERIES_COLORS[i] }} />
            <span className="chart-tooltip-label">{seller?.name}</span>
            <span className="chart-tooltip-value tabular">₹{p.value.toLocaleString("en-IN")}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function PriceHistoryChart({ series, priceBasis }) {
  const [rangeDays, setRangeDays] = useState(90);
  const [showTable, setShowTable] = useState(false);
  const [showMrp, setShowMrp] = useState(false);

  const merged = useMemo(() => mergeSeries(series), [series]);
  const visible = useMemo(() => {
    if (!rangeDays) return merged;
    return merged.slice(-rangeDays);
  }, [merged, rangeDays]);
  const saleWindows = useMemo(() => findSaleWindows(visible), [visible]);
  const mrp = visible.find((r) => r.mrp)?.mrp;
  const yDomain = showMrp && mrp ? [0, Math.ceil((mrp * 1.05) / 500) * 500] : ["auto", "auto"];

  return (
    <div className="price-history-chart card">
      <div className="phc-toolbar">
        <FilterControl options={RANGE_OPTIONS} value={rangeDays} onChange={setRangeDays} ariaLabel="Date range" />
        <div className="phc-toolbar-actions">
          {mrp != null && !showTable && (
            <button
              type="button"
              className={`btn btn-sm ${showMrp ? "btn-secondary" : "btn-ghost"}`}
              onClick={() => setShowMrp((v) => !v)}
            >
              {showMrp ? "Hide MRP" : "Show vs MRP"}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowTable((v) => !v)}>
            {showTable ? <LineChartIcon size={14} strokeWidth={2} /> : <TableProperties size={14} strokeWidth={2} />}
            {showTable ? "View as chart" : "View as table"}
          </button>
        </div>
      </div>

      <div className="phc-legend">
        {series.map((s, i) => (
          <span className="phc-legend-item" key={s.offer.id}>
            <span className="phc-legend-dot" style={{ background: SERIES_COLORS[i] }} />
            {s.seller.name}
          </span>
        ))}
        {mrp != null && showMrp && (
          <span className="phc-legend-item muted">
            <span className="phc-legend-dot dashed" />
            MRP ({formatMinor(mrp * 100)})
          </span>
        )}
      </div>

      {showTable ? (
        <DataTable
          columns={[
            { key: "date", header: "Date", render: (r) => formatDate(r.date) },
            ...series.map((s, i) => ({
              key: `s${i}`,
              header: s.seller.name,
              align: "right",
              render: (r) => (r[`s${i}`] != null ? formatMinor(r[`s${i}`] * 100) : "—"),
            })),
          ]}
          rows={[...visible].reverse()}
          rowKey={(r) => r.date}
        />
      ) : (
        <div className="phc-plot">
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={visible} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => formatDate(d, { withYear: false })}
                tick={{ fontSize: 11, fill: "var(--ink-400)" }}
                axisLine={{ stroke: "var(--border-strong)" }}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                tickFormatter={(v) => formatCompactMinor(v * 100)}
                tick={{ fontSize: 11, fill: "var(--ink-400)" }}
                axisLine={false}
                tickLine={false}
                width={54}
                domain={yDomain}
              />
              <Tooltip content={<CustomTooltip series={series} />} />
              {saleWindows.map((w) => (
                <ReferenceArea
                  key={w.start}
                  x1={w.start}
                  x2={w.end}
                  fill="var(--accent)"
                  fillOpacity={0.07}
                  stroke="none"
                />
              ))}
              {mrp != null && showMrp && (
                <ReferenceLine y={mrp} stroke="var(--series-reference)" strokeDasharray="4 4" strokeWidth={1.5} />
              )}
              {series.map((s, i) => (
                <Line
                  key={s.offer.id}
                  type="monotone"
                  dataKey={`s${i}`}
                  stroke={SERIES_COLORS[i]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="phc-footnote">
        Plotted on the {priceBasis?.label?.toLowerCase() ?? "effective price"} —{" "}
        {priceBasis?.description ?? "selling price + shipping − instant discounts available to every buyer"} — the same
        basis the recommendation engine compares on.
        {saleWindows.length > 0 && !showTable
          ? ` Shaded bands mark promotional windows: ${saleWindows.map((w) => w.label).join(", ")}.`
          : ""}
      </p>
    </div>
  );
}
