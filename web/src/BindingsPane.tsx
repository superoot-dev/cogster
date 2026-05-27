import React, { useState } from "react";
import { EngineState, ScalarRow } from "./cogsEngine";

type Props = {
  state: EngineState;
  error: string | null;
  bases: Record<string, number>;
  onValueChange: (lineIndex: number, value: number) => void;
  onRhsChange: (lineIndex: number, rhs: string) => void;
  onColorChange: (ref: string, chart: string, color: string) => void;
  onChartChange: (ref: string, chartKey: string, color: string) => void;
  onReorder: (from: number, to: number) => void;
  onDelete: (lineIndex: number) => void;
  onAdd: () => void;
  onDownload: () => void;
};

const DEFAULT_CHART_COLOR = "#ffffff";

function chartForRef(state: EngineState, ref: string): { chart: string; color: string } | null {
  const c = state.program.charts.find((e) => e.ref === ref);
  return c ? { chart: c.chart, color: c.color } : null;
}

function groupRows(rows: ScalarRow[]): { section: string | null; rows: ScalarRow[] }[] {
  const groups: { section: string | null; rows: ScalarRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (!last || last.section !== row.section) groups.push({ section: row.section, rows: [row] });
    else last.rows.push(row);
  }
  return groups;
}

export function BindingsPane({ state, error, bases, onValueChange, onRhsChange, onColorChange, onChartChange, onReorder, onDelete, onAdd, onDownload }: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropOn, setDropOn] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  return (
    <div className="pane">
      <div className="pane-header">
        <div className="brand">
          <span className="brand-icon" aria-hidden>⚙️</span>
          <span className="brand-name">cogster</span>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={onAdd}>+ Add row</button>
          <button className="btn" onClick={onDownload}>Download</button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="rows">
        {groupRows(state.rows).map((g) => {
          const key = g.section ?? "__none__";
          const isCollapsed = collapsed.has(key);
          return (
            <div key={key} className="section">
              {g.section && (
                <button
                  className="section-header"
                  onClick={() => setCollapsed((s) => {
                    const n = new Set(s);
                    if (n.has(key)) n.delete(key); else n.add(key);
                    return n;
                  })}
                >
                  <span className="section-caret">{isCollapsed ? "▸" : "▾"}</span>
                  <span className="section-label">{g.section}</span>
                  <span className="section-count">{g.rows.length}</span>
                </button>
              )}
              {!isCollapsed && g.rows.map((row) => (
                <Row
                  key={`${row.lineIndex}-${row.name}`}
                  row={row}
                  base={bases[row.name] ?? row.baseValue}
                  chart={chartForRef(state, row.name)}
                  isDragging={dragFrom === row.lineIndex}
                  isDropTarget={dropOn === row.lineIndex && dragFrom !== row.lineIndex}
                  onDragStart={() => setDragFrom(row.lineIndex)}
                  onDragEnd={() => {
                    if (dragFrom !== null && dropOn !== null && dragFrom !== dropOn) {
                      onReorder(dragFrom, dropOn);
                    }
                    setDragFrom(null);
                    setDropOn(null);
                  }}
                  onDragOver={() => setDropOn(row.lineIndex)}
                  onValueChange={(v) => onValueChange(row.lineIndex, v)}
                  onRhsChange={(s) => onRhsChange(row.lineIndex, s)}
                  onColorChange={(c) => {
                    const ch = chartForRef(state, row.name);
                    if (ch) onColorChange(row.name, ch.chart, c);
                  }}
                  onChartChange={(key2) => {
                    const ch = chartForRef(state, row.name);
                    onChartChange(row.name, key2, ch?.color ?? DEFAULT_CHART_COLOR);
                  }}
                  onDelete={() => onDelete(row.lineIndex)}
                />
              ))}
            </div>
          );
        })}
        {state.rows.length === 0 && !state.error && <div className="empty">No scalar bindings.</div>}
      </div>
    </div>
  );
}

type RowProps = {
  row: ScalarRow;
  base: number;
  chart: { chart: string; color: string } | null;
  isDragging: boolean;
  isDropTarget: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onValueChange: (v: number) => void;
  onRhsChange: (s: string) => void;
  onColorChange: (c: string) => void;
  onChartChange: (key: string) => void;
  onDelete: () => void;
};

function startScrub(
  e: React.PointerEvent<HTMLInputElement>,
  startVal: number,
  step: number,
  computed: boolean,
  onValueChange: (v: number) => void,
): void {
  if (computed) return;
  const target = e.currentTarget;
  const startX = e.clientX;
  let scrubbing = false;
  function move(ev: PointerEvent) {
    const dx = ev.clientX - startX;
    if (!scrubbing && Math.abs(dx) >= 3) {
      scrubbing = true;
      target.blur();
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
    }
    if (scrubbing) {
      const next = Math.max(0, startVal + dx * step);
      onValueChange(next);
    }
  }
  function up() {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
}

function formatDisplay(n: number): number | string {
  if (!Number.isFinite(n)) return "";
  if (Number.isInteger(n)) return n;
  return Number(n.toPrecision(6));
}

function Row({ row, base, chart, isDragging, isDropTarget, onDragStart, onDragEnd, onDragOver, onValueChange, onRhsChange, onColorChange, onChartChange, onDelete }: RowProps) {
  const max = Math.max(base * 4, 1);
  const step = max < 10 ? 0.01 : max < 1000 ? 0.5 : max / 1000;
  const [dragArmed, setDragArmed] = useState(false);
  const [rhsDraft, setRhsDraft] = useState<string | null>(null);
  const rhsValue = rhsDraft ?? row.rhs;
  function commitRhs() {
    if (rhsDraft !== null && rhsDraft !== row.rhs) onRhsChange(rhsDraft);
    setRhsDraft(null);
  }
  const [chartDraft, setChartDraft] = useState<string | null>(null);
  const chartValue = chartDraft ?? chart?.chart ?? "";
  function commitChart() {
    const current = chart?.chart ?? "";
    if (chartDraft !== null && chartDraft !== current) onChartChange(chartDraft);
    setChartDraft(null);
  }
  return (
    <div
      className={`row ${row.computed ? "computed" : ""} ${isDragging ? "dragging" : ""} ${isDropTarget ? "drop-target" : ""}`}
      draggable={dragArmed}
      onDragStart={onDragStart}
      onDragEnd={() => { setDragArmed(false); onDragEnd(); }}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
    >
      <span
        className="drag"
        title="drag to reorder"
        onMouseDown={() => setDragArmed(true)}
        onMouseUp={() => setDragArmed(false)}
        onTouchStart={() => setDragArmed(true)}
        onTouchEnd={() => setDragArmed(false)}
      >≡</span>
      <span className="name" title={row.name}>{row.name}</span>
      {row.computed ? (
        <input
          className="expr-input"
          type="text"
          value={rhsValue}
          title={rhsValue}
          onChange={(e) => setRhsDraft(e.target.value)}
          onBlur={commitRhs}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") { setRhsDraft(null); (e.target as HTMLInputElement).blur(); }
          }}
        />
      ) : (
        <input
          className="slider"
          type="range"
          min={0}
          max={max}
          step={step}
          value={Math.min(row.value, max)}
          onChange={(e) => onValueChange(Number(e.target.value))}
        />
      )}
      <input
        className="val"
        type="number"
        value={formatDisplay(row.value)}
        disabled={row.computed}
        onChange={(e) => onValueChange(Number(e.target.value))}
        onPointerDown={(e) => startScrub(e, row.value, step, row.computed, onValueChange)}
      />
      <span className="unit" title={row.unit}>{row.unit}</span>
      <input
        className="chart-key"
        type="text"
        placeholder="-"
        value={chartValue}
        onChange={(e) => setChartDraft(e.target.value)}
        onBlur={commitChart}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setChartDraft(null); (e.target as HTMLInputElement).blur(); }
        }}
        title={chart ? `chart: ${chart.chart}` : "set chart key to add to a chart"}
      />
      <input
        className="color"
        type="color"
        value={chart?.color ?? DEFAULT_CHART_COLOR}
        disabled={!chart}
        onChange={(e) => onColorChange(e.target.value)}
        title={chart ? "color" : "set chart key first"}
      />
      <button className="del" onClick={onDelete} title="delete">×</button>
    </div>
  );
}
