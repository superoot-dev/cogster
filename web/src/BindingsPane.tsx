import React, { useEffect, useRef, useState } from "react";
import { EngineState, ScalarRow } from "./cogsEngine";

type Props = {
  state: EngineState;
  error: string | null;
  bases: Record<string, number>;
  scenarios: string[];
  scenario: string | null;
  onScenario: (scenario: string | null) => void;
  onValueChange: (lineIndex: number, value: number) => void;
  onRhsChange: (lineIndex: number, rhs: string) => void;
  onNameChange: (oldName: string, newName: string) => void;
  onUnitChange: (lineIndex: number, unit: string) => void;
  onCommentChange: (lineIndex: number, comment: string) => void;
  onCellValueChange: (lineIndex: number, assignment: Record<string, string>, value: number, currency: boolean) => void;
  onColorChange: (ref: string, chart: string, color: string) => void;
  onChartChange: (ref: string, chartKey: string, color: string) => void;
  onReorder: (from: number, to: number) => void;
  onDelete: (lineIndex: number) => void;
  onAdd: () => void;
  onDownload: () => void;
};

const DEFAULT_CHART_COLOR = "#ffffff";

// Hide inputs from password managers / autofill extensions, which otherwise
// tag fields and clobber attributes like `placeholder` (e.g. setting it to "null").
const NO_AUTOFILL = {
  autoComplete: "off",
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-bwignore": true,
  "data-form-type": "other",
} as const;

// Some autofill extensions ignore the hints above and still rewrite the
// `placeholder` attribute (e.g. to "null") on every input. Each input mirrors
// its legit placeholder in `data-ph`; this observer reverts any other write.
function useGuardPlaceholders(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    function fix(el: HTMLInputElement) {
      const want = el.dataset.ph ?? "";
      if ((el.getAttribute("placeholder") ?? "") === want) return;
      if (want) el.setAttribute("placeholder", want);
      else el.removeAttribute("placeholder");
    }
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.target instanceof HTMLInputElement) fix(m.target);
      }
    });
    obs.observe(root, { subtree: true, attributes: true, attributeFilter: ["placeholder"] });
    root.querySelectorAll("input").forEach(fix);
    return () => obs.disconnect();
  }, [ref]);
}

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

export function BindingsPane({ state, error, bases, scenarios, scenario, onScenario, onValueChange, onRhsChange, onNameChange, onUnitChange, onCommentChange, onCellValueChange, onColorChange, onChartChange, onReorder, onDelete, onAdd, onDownload }: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropOn, setDropOn] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const paneRef = useRef<HTMLDivElement>(null);
  useGuardPlaceholders(paneRef);

  return (
    <div className="pane" ref={paneRef}>
      <div className="pane-header">
        <div className="brand">
          <span className="brand-icon" aria-hidden>⚙️</span>
          <span className="brand-name">cogster</span>
        </div>
        <div className="toolbar">
          {scenarios.length > 0 && (
            <select
              className="btn"
              value={scenario ?? ""}
              onChange={(e) => onScenario(e.target.value || null)}
              title="Scenario override"
            >
              <option value="">base</option>
              {scenarios.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
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
                  onNameChange={(s) => onNameChange(row.name, s)}
                  onUnitChange={(s) => onUnitChange(row.lineIndex, s)}
                  onCommentChange={(c) => onCommentChange(row.lineIndex, c)}
                  onCellValueChange={(at, v, c) => onCellValueChange(row.lineIndex, at, v, c)}
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
  onNameChange: (s: string) => void;
  onUnitChange: (s: string) => void;
  onCommentChange: (s: string) => void;
  onCellValueChange: (at: Record<string, string>, value: number, currency: boolean) => void;
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

function formatCellValue(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return n.toString();
  return Number(n.toPrecision(6)).toString();
}

type CellRowProps = {
  axes: string[];
  cell: { at: Record<string, string>; value: number; unit: string; currency: boolean };
  onValueChange: (at: Record<string, string>, value: number, currency: boolean) => void;
};

function CellRow({ axes, cell, onValueChange }: CellRowProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? formatCellValue(cell.value);
  function handleChange(v: string) {
    setDraft(v);
    const n = Number(v);
    if (Number.isFinite(n) && n !== cell.value) onValueChange(cell.at, n, cell.currency);
  }
  return (
    <tr>
      {axes.map((a) => <td key={a}>{cell.at[a]}</td>)}
      <td className="cells-val">
        <input
          className="cell-val-input"
          {...NO_AUTOFILL}
          data-ph=""
          type="number"
          value={display}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") { setDraft(null); (e.target as HTMLInputElement).blur(); }
          }}
        />
      </td>
      <td className="cells-unit">{cell.unit}</td>
    </tr>
  );
}

function Row({ row, base, chart, isDragging, isDropTarget, onDragStart, onDragEnd, onDragOver, onValueChange, onRhsChange, onNameChange, onUnitChange, onCommentChange, onCellValueChange, onColorChange, onChartChange, onDelete }: RowProps) {
  const max = Math.max(base * 4, 1);
  const step = max < 10 ? 0.01 : max < 1000 ? 0.5 : max / 1000;
  const [dragArmed, setDragArmed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const tagged = row.axes.length > 0;
  const [rhsDraft, setRhsDraft] = useState<string | null>(null);
  const rhsValue = rhsDraft ?? row.rhs;
  function commitRhs() {
    if (rhsDraft !== null && rhsDraft !== row.rhs) onRhsChange(rhsDraft);
    setRhsDraft(null);
  }
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const nameValue = nameDraft ?? row.name;
  function commitName() {
    if (nameDraft !== null && nameDraft.trim() && nameDraft !== row.name) onNameChange(nameDraft);
    setNameDraft(null);
  }
  const [unitDraft, setUnitDraft] = useState<string | null>(null);
  const unitValue = unitDraft ?? row.unit;
  function commitUnit() {
    if (unitDraft !== null && unitDraft !== row.unit) onUnitChange(unitDraft);
    setUnitDraft(null);
  }
  const [chartDraft, setChartDraft] = useState<string | null>(null);
  const chartValue = chartDraft ?? chart?.chart ?? "";
  function commitChart() {
    const current = chart?.chart ?? "";
    if (chartDraft !== null && chartDraft !== current) onChartChange(chartDraft);
    setChartDraft(null);
  }
  const [commentDraft, setCommentDraft] = useState<string | null>(null);
  function commitComment() {
    if (commentDraft !== null && commentDraft.trim() !== row.comment) onCommentChange(commentDraft);
    setCommentDraft(null);
  }
  return (
    <>
    {renderRow()}
    {commentDraft !== null && (
      <div className="note-edit">
        <span className="note-edit-icon">❝</span>
        <input
          className="note-input"
          {...NO_AUTOFILL}
          data-ph="note…"
          type="text"
          autoFocus
          placeholder="note…"
          value={commentDraft}
          onChange={(e) => setCommentDraft(e.target.value)}
          onBlur={commitComment}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") { setCommentDraft(null); (e.target as HTMLInputElement).blur(); }
          }}
        />
      </div>
    )}
    {tagged && expanded && (
      <div className="cells-panel">
        <table className="cells-table">
          <thead>
            <tr>{row.axes.map((a) => <th key={a}>{a}</th>)}<th className="cells-val">value</th><th className="cells-unit">unit</th></tr>
          </thead>
          <tbody>
            {row.cells.map((c, i) => (
              <CellRow key={i} axes={row.axes} cell={c} onValueChange={onCellValueChange} />
            ))}
          </tbody>
        </table>
      </div>
    )}
    </>
  );
  function renderRow() {
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
      <input
        className="name"
        {...NO_AUTOFILL}
        data-ph=""
        type="text"
        value={nameValue}
        title={nameValue}
        onChange={(e) => setNameDraft(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setNameDraft(null); (e.target as HTMLInputElement).blur(); }
        }}
      />
      {row.computed && (
        <input
          className="expr-input"
          {...NO_AUTOFILL}
          data-ph=""
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
      )}
      {tagged ? (
        <button
          className="val val-tagged"
          onClick={() => setExpanded((x) => !x)}
          title={`${row.cells.length} cells across ${row.axes.join(" / ")}`}
        >{expanded ? "▾" : "▸"} {row.cells.length}</button>
      ) : (
        <input
          className="val"
          {...NO_AUTOFILL}
          data-ph=""
          type="number"
          value={formatDisplay(row.value)}
          disabled={row.computed}
          onChange={(e) => onValueChange(Number(e.target.value))}
          onPointerDown={(e) => startScrub(e, row.value, step, row.computed, onValueChange)}
        />
      )}
      <input
        className="unit"
        {...NO_AUTOFILL}
        data-ph="-"
        type="text"
        value={unitValue}
        title={row.computed ? `${row.unit} (computed)` : row.unit}
        disabled={row.computed}
        placeholder="-"
        onChange={(e) => setUnitDraft(e.target.value)}
        onBlur={commitUnit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setUnitDraft(null); (e.target as HTMLInputElement).blur(); }
        }}
      />
      <input
        className="chart-key"
        {...NO_AUTOFILL}
        data-ph="-"
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
      <button
        className={`note ${row.comment ? "has-note" : ""}`}
        onMouseDown={(e) => {
          e.preventDefault();
          if (commentDraft !== null) commitComment();
          else setCommentDraft(row.comment);
        }}
        title={row.comment || "add note"}
      >{row.comment ? "❝" : "+"}</button>
      <button className="del" onClick={onDelete} title="delete">×</button>
    </div>
  );
  }
}
