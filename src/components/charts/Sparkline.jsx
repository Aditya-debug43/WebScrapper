import { ResponsiveContainer, LineChart, Line } from "recharts";

/** Minimal single-hue trend line for compact contexts (dashboard cards). No axes, no legend needed for one series. */
export default function Sparkline({ data, color = "var(--series-1)", height = 36 }) {
  if (!data || data.length < 2) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data.map((v, i) => ({ i, v }))}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.75} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
