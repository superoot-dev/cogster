import React from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RenderedChart, RenderedSeries } from "../../lib/CogsEvaluator";

type Props = { charts: RenderedChart[] };

export function ChartsPane({ charts }: Props) {
  return (
    <div className="pane">
      {charts.length === 0 && <div className="empty">No charts defined. Add a <code>chart name</code> block or <code>#color.chart ref</code> lines.</div>}
      <div className="charts">
        {charts.map((c) => (
          <ChartCard key={c.chart} chart={c} />
        ))}
      </div>
    </div>
  );
}

function formatValue(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return n.toString();
  return Number(n.toPrecision(6)).toString();
}

function ChartCard({ chart }: { chart: RenderedChart }) {
  const unit = chart.series[0]?.unit ?? "";
  const data = chart.series.map((s) => ({ name: s.label, value: s.value, color: s.color, unit: s.unit }));
  return (
    <div className="chart-card">
      <h3>{chart.chart} {unit && <span style={{ color: "var(--muted)", fontWeight: 400 }}>({unit})</span>}</h3>
      <ResponsiveContainer width="100%" height={chart.kind === "pie" ? 200 : Math.max(120, 24 + 28 * chart.series.length)}>
        {chart.kind === "pie" ? (
          <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <Pie data={data} dataKey="value" nameKey="name" outerRadius={80} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip formatter={(v, _n, p) => [`${formatValue(Number(v))} ${(p as { payload: { unit: string } }).payload.unit}`, (p as { payload: { name: string } }).payload.name]} />
          </PieChart>
        ) : (
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v, _n, p) => [`${formatValue(Number(v))} ${(p as { payload: { unit: string } }).payload.unit}`, (p as { payload: { name: string } }).payload.name]} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
      <SeriesTable series={chart.series} showShare={chart.kind === "pie"} />
    </div>
  );
}

function SeriesTable({ series, showShare }: { series: RenderedSeries[]; showShare: boolean }) {
  const total = showShare ? series.reduce((a, s) => a + (Number.isFinite(s.value) ? s.value : 0), 0) : 0;
  return (
    <table className="series-table">
      <tbody>
        {series.map((s, i) => (
          <tr key={i}>
            <td className="swatch-cell"><span className="swatch" style={{ background: s.color }} /></td>
            <td className="label-cell" title={s.label}>{s.label}</td>
            <td className="val-cell">{formatValue(s.value)}</td>
            <td className="unit-cell">{s.unit}</td>
            {showShare && (
              <td className="share-cell">{total > 0 ? `${((s.value / total) * 100).toFixed(1)}%` : ""}</td>
            )}
          </tr>
        ))}
        {showShare && series.length > 1 && (
          <tr className="total-row">
            <td className="swatch-cell" />
            <td className="label-cell">total</td>
            <td className="val-cell">{formatValue(total)}</td>
            <td className="unit-cell">{series[0]?.unit ?? ""}</td>
            <td className="share-cell">100%</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
