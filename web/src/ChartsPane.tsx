import React from "react";
import { Bar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RenderedChart } from "../../lib/CogsEvaluator";

type Props = { charts: RenderedChart[] };

export function ChartsPane({ charts }: Props) {
  return (
    <div className="pane">
      {charts.length === 0 && <div className="empty">No charts defined. Add <code>#color.chart binding</code> lines.</div>}
      <div className="charts">
        {charts.map((c) => (
          <ChartCard key={c.chart} chart={c} />
        ))}
      </div>
    </div>
  );
}

function ChartCard({ chart }: { chart: RenderedChart }) {
  const unit = chart.series[0]?.unit ?? "";
  const data = chart.series.map((s) => ({ name: s.label, value: s.value, color: s.color, unit: s.unit }));
  return (
    <div className="chart-card">
      <h3>{chart.chart} {unit && <span style={{ color: "var(--muted)", fontWeight: 400 }}>({unit})</span>}</h3>
      <ResponsiveContainer width="100%" height={chart.kind === "pie" ? 240 : Math.max(120, 40 + 32 * chart.series.length)}>
        {chart.kind === "pie" ? (
          <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <Pie data={data} dataKey="value" nameKey="name" outerRadius={90} isAnimationActive={false} label={(e) => String((e as { name?: string }).name ?? "")}>
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip formatter={(v, _n, p) => [`${v} ${(p as { payload: { unit: string } }).payload.unit}`, (p as { payload: { name: string } }).payload.name]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        ) : (
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v, _n, p) => [`${v} ${(p as { payload: { unit: string } }).payload.unit}`, (p as { payload: { name: string } }).payload.name]} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
