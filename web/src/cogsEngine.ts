import { parseProgram } from "../../lib/CogsParser";
import { evalProgram, renderCharts, RenderedChart } from "../../lib/CogsEvaluator";
import { Binding, Cell, CogValue, Program, Qty, scalarQty } from "../../lib/CogsTypes";
import { fmtUnit } from "../../lib/CogsUnits";

export type ScalarRow = {
  name: string;
  lineIndex: number;
  baseValue: number;
  value: number;
  unit: string;
  display: string;
  computed: boolean;
  rhs: string;
  section: string | null;
  axes: string[];
  cells: { at: Record<string, string>; label: string; value: number; unit: string; currency: boolean }[];
};

export type EngineState = {
  source: string;
  program: Program;
  values: Map<string, CogValue>;
  rows: ScalarRow[];
  charts: RenderedChart[];
  error: string | null;
};

const LITERAL_LINE = /^(\s*)([A-Za-z_][A-Za-z0-9_\- ]*?)\s*=\s*(\$?)(-?(?:\d+(?:\.\d*)?|\.\d+))(.*)$/;

function extractRhs(line: string): string {
  const eq = line.indexOf("=");
  if (eq < 0) return "";
  return line.slice(eq + 1).trim();
}

const SECTION_RE = /^\s*\/\/\s*-{2,}\s*(.+?)\s*-*\s*$/;

function buildSectionMap(lines: string[]): (string | null)[] {
  const out: (string | null)[] = new Array(lines.length).fill(null);
  let current: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(SECTION_RE);
    if (m) {
      const label = m[1].replace(/-+$/, "").trim();
      current = label || null;
    }
    out[i] = current;
  }
  return out;
}

function findLineIndex(lines: string[], name: string): number {
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^\s*([A-Za-z_][A-Za-z0-9_\- ]*?)\s*=/);
    if (m && m[1].trim().replace(/\s+/g, " ") === name) return i;
  }
  return -1;
}

const BINDING_LINE = /^\s*([A-Za-z_][A-Za-z0-9_\- ]*?)\s*=\s*(.+?)\s*$/;

function fallbackRows(source: string): ScalarRow[] {
  const lines = source.split("\n");
  const sections = buildSectionMap(lines);
  const rows: ScalarRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("//") || line.trim().startsWith("#") || line.trim().startsWith("axis ") || line.trim().startsWith(":") || line.trim().startsWith("|")) continue;
    const m = line.match(BINDING_LINE);
    if (!m) continue;
    const name = m[1].trim().replace(/\s+/g, " ");
    if (seen.has(name)) continue;
    seen.add(name);
    rows.push({ name, lineIndex: i, baseValue: 0, value: NaN, unit: "", display: "?", computed: true, rhs: m[2], section: sections[i], axes: [], cells: [] });
  }
  return rows;
}

export function buildState(source: string): EngineState {
  const parsed = parseProgram(source);
  if (!parsed.ok) {
    return { source, program: { axes: [], bindings: [], charts: [], chartConfigs: [] }, values: new Map(), rows: fallbackRows(source), charts: [], error: parsed.error };
  }
  const program = parsed.value;
  const evald = evalProgram(program);
  if (!evald.ok) {
    return { source, program, values: new Map(), rows: fallbackRows(source), charts: [], error: evald.error };
  }
  const values = evald.value;
  const charts = renderCharts(program, values);
  const lines = source.split("\n");
  const sections = buildSectionMap(lines);
  const rows: ScalarRow[] = [];
  for (const b of program.bindings) {
    const v = values.get(b.name);
    if (!v) continue;
    const lineIndex = findLineIndex(lines, b.name);
    const isLiteral = b.expr.kind === "qty";
    const rhs = lineIndex >= 0 ? extractRhs(lines[lineIndex]) : "";
    const section = lineIndex >= 0 ? sections[lineIndex] : null;
    const q = scalarQty(v);
    if (q !== null) {
      const baseValue = isLiteral && b.expr.kind === "qty" ? b.expr.qty.value : q.value;
      rows.push({
        name: b.name,
        lineIndex,
        baseValue,
        value: q.value,
        unit: fmtUnit(q.unit),
        display: q.value.toString(),
        computed: !isLiteral,
        rhs,
        section,
        axes: [],
        cells: [],
      });
      continue;
    }
    const repUnit = v.cells[0]?.qty.unit ?? { num: [], den: [] };
    const cellRows = v.cells.map((c: Cell) => ({
      at: c.at,
      label: v.axes.map((a) => c.at[a]).join(" / "),
      value: c.qty.value,
      unit: fmtUnit(c.qty.unit),
      currency: c.qty.unit.num.includes("usd"),
    }));
    rows.push({
      name: b.name,
      lineIndex,
      baseValue: NaN,
      value: NaN,
      unit: fmtUnit(repUnit),
      display: "",
      computed: true,
      rhs,
      section,
      axes: v.axes,
      cells: cellRows,
    });
  }
  return {
    source,
    program,
    values,
    rows,
    charts: charts.ok ? charts.value : [],
    error: null,
  };
}

type BranchParts = { indent: string; rawTags: string[]; value: string; valueStart: number };

function parseBranchLine(line: string): BranchParts | null {
  const indent = (line.match(/^\s*/) ?? [""])[0];
  const trimmed = line.slice(indent.length);
  if (!trimmed.startsWith(":")) return null;
  let pos = 0;
  const rawTags: string[] = [];
  while (pos < trimmed.length && trimmed[pos] === ":") {
    let end = pos + 1;
    while (end < trimmed.length && !/\s/.test(trimmed[end])) end += 1;
    rawTags.push(trimmed.slice(pos + 1, end));
    pos = end;
    while (pos < trimmed.length && /\s/.test(trimmed[pos])) pos += 1;
  }
  const value = trimmed.slice(pos).trim();
  return { indent, rawTags, value, valueStart: indent.length + pos };
}

function bindingBlockRange(lines: string[], startLine: number): { firstBranch: number; lastBranch: number } {
  let firstBranch = -1;
  let lastBranch = startLine;
  let prevContinues = false;
  for (let i = startLine + 1; i < lines.length; i += 1) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) continue;
    const isBranch = t.startsWith(":") || t.startsWith("|");
    const isIndented = /^\s/.test(raw);
    if (isBranch) {
      if (firstBranch < 0) firstBranch = i;
      lastBranch = i;
      prevContinues = t.endsWith(",");
      continue;
    }
    if (prevContinues && isIndented) {
      lastBranch = i;
      prevContinues = t.endsWith(",");
      continue;
    }
    break;
  }
  return { firstBranch, lastBranch };
}

function formatCellNumber(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return (Math.round(n * 10000) / 10000).toString();
}

export function setCellValue(
  source: string,
  program: Program,
  bindingLine: number,
  assignment: Record<string, string>,
  newValue: number,
  currency: boolean,
): string {
  const tagToAxis = new Map<string, string>();
  const groupNames = new Set<string>();
  for (const ax of program.axes) {
    for (const v of ax.values) tagToAxis.set(v, ax.name);
    for (const g of ax.groups) groupNames.add(g.name);
  }
  const lines = source.split("\n");
  const { lastBranch } = bindingBlockRange(lines, bindingLine);
  const axesNeeded = Object.keys(assignment);

  function tagsMatchExactly(rawTags: string[]): boolean {
    if (rawTags.length !== axesNeeded.length) return false;
    const seen = new Map<string, string>();
    for (const t of rawTags) {
      if (t === "*") return false;
      if (groupNames.has(t)) return false;
      const ax = tagToAxis.get(t);
      if (!ax) return false;
      if (seen.has(ax)) return false;
      seen.set(ax, t);
    }
    if (seen.size !== axesNeeded.length) return false;
    for (const ax of axesNeeded) {
      if (seen.get(ax) !== assignment[ax]) return false;
    }
    return true;
  }

  for (let i = bindingLine + 1; i <= lastBranch && i < lines.length; i += 1) {
    const parts = parseBranchLine(lines[i]);
    if (!parts) continue;
    if (!tagsMatchExactly(parts.rawTags)) continue;
    const useCurrency = parts.value.trim().startsWith("$") || currency;
    const formatted = `${useCurrency ? "$" : ""}${formatCellNumber(newValue)}`;
    let endLine = i;
    while (endLine + 1 < lines.length && lines[endLine].trimEnd().endsWith(",")) {
      const nextTrim = lines[endLine + 1].trim();
      if (!nextTrim || nextTrim.startsWith(":") || nextTrim.startsWith("|")) break;
      if (!/^\s/.test(lines[endLine + 1])) break;
      endLine += 1;
    }
    const replacement = `${lines[i].slice(0, parts.valueStart)}${formatted}`;
    lines.splice(i, endLine - i + 1, replacement);
    return lines.join("\n");
  }

  const sortedAxes = program.axes
    .filter((a) => assignment[a.name] !== undefined)
    .map((a) => a.name);
  const orderedTags = sortedAxes.map((a) => `:${assignment[a]}`).join(" ");
  const formatted = `${currency ? "$" : ""}${formatCellNumber(newValue)}`;
  const indent = "  ";
  const newLine = `${indent}${orderedTags}  ${formatted}`;
  lines.splice(lastBranch + 1, 0, newLine);
  return lines.join("\n");
}

export function setRhs(source: string, lineIndex: number, newRhs: string): string {
  const lines = source.split("\n");
  const line = lines[lineIndex];
  const eq = line.indexOf("=");
  if (eq < 0) return source;
  lines[lineIndex] = `${line.slice(0, eq + 1)} ${newRhs}`;
  return lines.join("\n");
}

export function setLiteralValue(source: string, lineIndex: number, newValue: number): string {
  const lines = source.split("\n");
  const line = lines[lineIndex];
  const m = line.match(LITERAL_LINE);
  if (!m) return source;
  const formatted = formatNumber(newValue);
  lines[lineIndex] = `${m[1]}${m[2]} = ${m[3]}${formatted}${m[5]}`;
  return lines.join("\n");
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  const rounded = Math.round(n * 10000) / 10000;
  return rounded.toString();
}

export function moveLine(source: string, from: number, to: number): string {
  const lines = source.split("\n");
  if (from < 0 || from >= lines.length || to < 0 || to >= lines.length) return source;
  const [moved] = lines.splice(from, 1);
  lines.splice(to, 0, moved);
  return lines.join("\n");
}

export function deleteLine(source: string, lineIndex: number): string {
  const lines = source.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return source;
  lines.splice(lineIndex, 1);
  return lines.join("\n");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function renameBinding(source: string, oldName: string, newName: string): string {
  const trimmedNew = newName.trim().replace(/\s+/g, " ");
  if (!trimmedNew || trimmedNew === oldName) return source;
  if (!/^[A-Za-z_][A-Za-z0-9_\- ]*$/.test(trimmedNew)) return source;
  const escaped = escapeRegex(oldName);
  // Match the name only where it's not preceded or followed by an identifier
  // character. Multi-word names (containing spaces) are matched as a whole
  // phrase. A trailing word character means the ref continues into a longer
  // binding name — leave those alone.
  const re = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "g");
  return source.replace(re, trimmedNew);
}

const LITERAL_UNIT_LINE = /^(\s*[A-Za-z_][A-Za-z0-9_\- ]*?\s*=\s*\$?-?\d+(?:\.\d+)?)(\s*[^,@\n]*)$/;

export function setUnit(source: string, lineIndex: number, newUnit: string): string {
  const lines = source.split("\n");
  const line = lines[lineIndex];
  const m = line.match(LITERAL_UNIT_LINE);
  if (!m) return source;
  const trimmedUnit = newUnit.trim();
  lines[lineIndex] = trimmedUnit ? `${m[1]} ${trimmedUnit}` : m[1];
  return lines.join("\n");
}

export function appendBinding(source: string, name: string, value: number): string {
  const trimmed = source.endsWith("\n") ? source : `${source}\n`;
  return `${trimmed}${name} = ${formatNumber(value)}\n`;
}

export function nextNewName(state: EngineState): string {
  const taken = new Set(state.program.bindings.map((b) => b.name));
  let i = 1;
  while (taken.has(`new value ${i}`)) i += 1;
  return `new value ${i}`;
}

const CHART_LINE_RE = /^(\s*)#([A-Za-z0-9]+)\.([A-Za-z_][A-Za-z0-9_-]*)\s+(.+?)\s*$/;

function findChartLineForRef(lines: string[], ref: string): number {
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(CHART_LINE_RE);
    if (!m) continue;
    if (m[4].trim().replace(/\s+/g, " ") === ref) return i;
  }
  return -1;
}

export function setChartColor(source: string, ref: string, chart: string, newColor: string): string {
  const lines = source.split("\n");
  const i = findChartLineForRef(lines, ref);
  if (i < 0) return source;
  const m = lines[i].match(CHART_LINE_RE);
  if (!m || m[3] !== chart) return source;
  const stripped = newColor.startsWith("#") ? newColor.slice(1) : newColor;
  lines[i] = `${m[1]}#${stripped}.${m[3]} ${m[4]}`;
  return lines.join("\n");
}

export function setRowChart(source: string, ref: string, chartKey: string, color: string): string {
  const lines = source.split("\n");
  const i = findChartLineForRef(lines, ref);
  const stripped = color.startsWith("#") ? color.slice(1) : color;
  const trimmedKey = chartKey.trim();
  if (!trimmedKey) {
    if (i >= 0) lines.splice(i, 1);
    return lines.join("\n");
  }
  const newLine = `#${stripped}.${trimmedKey} ${ref}`;
  if (i >= 0) {
    const m = lines[i].match(CHART_LINE_RE);
    const indent = m ? m[1] : "";
    lines[i] = `${indent}${newLine}`;
  } else {
    if (lines[lines.length - 1] === "") lines.splice(lines.length - 1, 0, newLine);
    else lines.push(newLine);
  }
  return lines.join("\n");
}
