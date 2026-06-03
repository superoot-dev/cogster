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

type TipItem = { name?: string; value?: number; color?: string };

// Custom bar tooltip: lists each stacked segment with its share of the full bar,
// then (when a `margin` segment is present) a COGS / Margin / Price footer — the
// full bar length is the SRP, so this reads off the unit economics on hover.
function BarTooltip({ active, payload, unit }: { active?: boolean; payload?: TipItem[]; unit?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload.filter((p) => Number.isFinite(p.value));
  if (rows.length === 0) return null;
  const total = rows.reduce((a, p) => a + (p.value as number), 0);
  const marginRow = rows.find((p) => /margin/i.test(p.name ?? ""));
  const margin = marginRow ? (marginRow.value as number) : 0;
  const cogs = total - margin;
  const pct = (v: number) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "");
  const segs = rows.filter((p) => p !== marginRow);
  const foot = (label: string, v: number, bold: boolean) => (
    <div style={{ display: "flex", gap: 8, fontWeight: bold ? 600 : 400 }}>
      <span style={{ flex: 1 }}>{label}</span>
      <span>{formatValue(v)}</span>
      <span style={{ width: 46, textAlign: "right", color: "var(--muted)" }}>{pct(v)}</span>
    </div>
  );
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6, padding: "8px 10px", fontSize: 11, boxShadow: "0 2px 8px rgba(0,0,0,.08)", minWidth: 210 }}>
      {segs.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", lineHeight: 1.7 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: p.color, flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{p.name}</span>
          <span>{formatValue(p.value as number)}</span>
          <span style={{ width: 46, textAlign: "right", color: "var(--muted)" }}>{pct(p.value as number)}</span>
        </div>
      ))}
      {marginRow && (
        <div style={{ borderTop: "1px solid #e5e7eb", marginTop: 6, paddingTop: 6, display: "grid", gap: 2 }}>
          {foot("COGS", cogs, true)}
          {foot("Margin", margin, false)}
          {foot(`Price ${unit ?? ""}`.trim(), total, true)}
        </div>
      )}
    </div>
  );
}

function ChartCard({ chart }: { chart: RenderedChart }) {
  const unit = chart.series[0]?.unit ?? "";
  const data = chart.series.map((s) => ({ name: s.label, value: s.value, color: s.color, unit: s.unit }));
  // Bar charts stack series sharing a `group` into one bar; ungrouped series
  // each form their own (singleton) group. One row per group, one Bar per
  // series (its value lives only in its group's row), all sharing a stackId.
  const groups: string[] = [];
  for (const s of chart.series) if (!groups.includes(s.group)) groups.push(s.group);
  const stackRows = groups.map((g) => {
    const row: Record<string, number | string> = { name: g, unit };
    chart.series.forEach((s, i) => { if (s.group === g) row[`v${i}`] = s.value; });
    return row;
  });
  const grouped = groups.length < chart.series.length;
  return (
    <div className="chart-card">
      <h3>{chart.chart} {unit && <span style={{ color: "var(--muted)", fontWeight: 400 }}>({unit})</span>}</h3>
      <ResponsiveContainer width="100%" height={chart.kind === "pie" ? 200 : Math.max(120, 24 + 28 * groups.length)}>
        {chart.kind === "pie" ? (
          <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <Pie data={data} dataKey="value" nameKey="name" outerRadius={80} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip formatter={(v, _n, p) => [`${formatValue(Number(v))} ${(p as { payload: { unit: string } }).payload.unit}`, (p as { payload: { name: string } }).payload.name]} />
          </PieChart>
        ) : (
          <BarChart data={stackRows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
            <Tooltip content={<BarTooltip unit={unit} />} cursor={{ fill: "rgba(0,0,0,.04)" }} />
            {chart.series.map((s, i) => (
              <Bar key={i} dataKey={`v${i}`} name={s.label} stackId="a" fill={s.color}
                radius={grouped ? undefined : [0, 4, 4, 0]} isAnimationActive={false} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
      <SeriesTable series={chart.series} showShare={chart.kind === "pie"} />
    </div>
  );
}

function SeriesTable({ series, showShare }: { series: RenderedSeries[]; showShare: boolean }) {
  const total = showShare ? series.reduce((a, s) => a + (Number.isFinite(s.value) ? s.value : 0), 0) : 0;
  const sharePct = (v: number) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "");

  // Cluster pie rows by group; render a subtotal header per multi-member group
  // with its members indented beneath. Single-member groups stay flat.
  const order: string[] = [];
  const byGroup = new Map<string, RenderedSeries[]>();
  for (const s of series) {
    if (!byGroup.has(s.group)) { byGroup.set(s.group, []); order.push(s.group); }
    byGroup.get(s.group)!.push(s);
  }
  const grouped = showShare && order.some((g) => byGroup.get(g)!.length > 1);

  return (
    <table className="series-table">
      <tbody>
        {!grouped && series.map((s, i) => (
          <tr key={i}>
            <td className="swatch-cell"><span className="swatch" style={{ background: s.color }} /></td>
            <td className="label-cell" title={s.label}>{s.label}</td>
            <td className="val-cell">{formatValue(s.value)}</td>
            <td className="unit-cell">{s.unit}</td>
            {showShare && (
              <td className="share-cell">{sharePct(s.value)}</td>
            )}
          </tr>
        ))}
        {grouped && order.flatMap((g) => {
          const members = byGroup.get(g)!;
          const sub = members.reduce((a, s) => a + (Number.isFinite(s.value) ? s.value : 0), 0);
          if (members.length === 1) {
            const s = members[0];
            return [(
              <tr key={g}>
                <td className="swatch-cell"><span className="swatch" style={{ background: s.color }} /></td>
                <td className="label-cell" title={s.label}>{s.label}</td>
                <td className="val-cell">{formatValue(s.value)}</td>
                <td className="unit-cell">{s.unit}</td>
                <td className="share-cell">{sharePct(s.value)}</td>
              </tr>
            )];
          }
          const header = (
            <tr key={g} className="group-row">
              <td className="swatch-cell" />
              <td className="label-cell" style={{ fontWeight: 600 }}>{g}</td>
              <td className="val-cell" style={{ fontWeight: 600 }}>{formatValue(sub)}</td>
              <td className="unit-cell">{members[0].unit}</td>
              <td className="share-cell" style={{ fontWeight: 600 }}>{sharePct(sub)}</td>
            </tr>
          );
          const rows = members.map((s, i) => (
            <tr key={`${g}-${i}`}>
              <td className="swatch-cell"><span className="swatch" style={{ background: s.color }} /></td>
              <td className="label-cell" title={s.label} style={{ paddingLeft: 16 }}>{s.label}</td>
              <td className="val-cell">{formatValue(s.value)}</td>
              <td className="unit-cell">{s.unit}</td>
              <td className="share-cell">{sharePct(s.value)}</td>
            </tr>
          ));
          return [header, ...rows];
        })}
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
