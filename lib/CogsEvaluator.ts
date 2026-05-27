import { Result, err, ok } from "./CoreTypings";
import {
  AggOp,
  Assignment,
  Binding,
  BranchCase,
  Cell,
  ChartKind,
  CogValue,
  DIMENSIONLESS,
  Expr,
  Program,
  Qty,
  TagSet,
  scalarQty,
  scalarValue,
} from "./CogsTypes";
import { addQty, divQty, fmtUnit, mulQty, negQty, subQty } from "./CogsUnits";
import { STDLIB, buildEvalFunctions, ExprEvalFunc } from "./ScriptEvaluator";

const FNS: Record<string, ExprEvalFunc> = { ...buildEvalFunctions(), ...STDLIB };

export type Env = {
  bindings: Map<string, Binding>;
  cache: Map<string, CogValue>;
  stack: Set<string>;
  axes: Map<string, string[]>;
};

export function makeEnv(prog: Program): Env {
  const bindings = new Map<string, Binding>();
  for (const b of prog.bindings) bindings.set(b.name, b);
  const axes = new Map<string, string[]>();
  for (const a of prog.axes) axes.set(a.name, a.values);
  return { bindings, cache: new Map(), stack: new Set(), axes };
}

function cartesian<T>(arrs: T[][]): T[][] {
  let out: T[][] = [[]];
  for (const arr of arrs) {
    const next: T[][] = [];
    for (const row of out) for (const v of arr) next.push([...row, v]);
    out = next;
  }
  return out;
}

function asKey(at: Assignment, axes: string[]): string {
  return JSON.stringify(axes.map((a) => at[a]));
}

function unionAxes(vals: { axes: string[] }[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of vals) for (const a of v.axes) if (!seen.has(a)) { seen.add(a); out.push(a); }
  return out;
}

function broadcast(
  vals: CogValue[],
  fn: (qtys: Qty[]) => Result<Qty, string>,
): Result<CogValue, string> {
  if (vals.length === 0) return err("empty broadcast");
  const allAxes = unionAxes(vals);
  if (allAxes.length === 0) {
    const r = fn(vals.map((v) => v.cells[0].qty));
    if (!r.ok) return r;
    return ok(scalarValue(r.value));
  }
  const indices: Map<string, Qty>[] = [];
  const axisDomain = new Map<string, Set<string>>();
  for (const a of allAxes) axisDomain.set(a, new Set());
  for (const v of vals) {
    const m = new Map<string, Qty>();
    for (const cell of v.cells) {
      m.set(asKey(cell.at, v.axes), cell.qty);
      for (const a of v.axes) axisDomain.get(a)!.add(cell.at[a]);
    }
    indices.push(m);
  }
  const perAxis = allAxes.map((a) => [...axisDomain.get(a)!]);
  const out: Cell[] = [];
  for (const combo of cartesian(perAxis)) {
    const at: Assignment = {};
    for (let i = 0; i < allAxes.length; i += 1) at[allAxes[i]] = combo[i];
    const qtys: Qty[] = [];
    for (let i = 0; i < vals.length; i += 1) {
      const q = indices[i].get(asKey(at, vals[i].axes));
      if (q === undefined) {
        return err(`missing cell for assignment ${JSON.stringify(at)} in operand ${i}`);
      }
      qtys.push(q);
    }
    const r = fn(qtys);
    if (!r.ok) return r;
    out.push({ at, qty: r.value });
  }
  return ok({ axes: allAxes, cells: out });
}

function expandBranches(cases: BranchCase[], env: Env): Result<CogValue, string> {
  const universe = unionAxes(cases.map((c) => ({ axes: Object.keys(c.tags) })));
  type Entry = { at: Assignment; qty: Qty; specificity: number };
  const cellMap = new Map<string, Entry>();
  for (const c of cases) {
    const e = evalExpr(c.expr, env);
    if (!e.ok) return e;
    const sq = scalarQty(e.value);
    if (sq === null) return err("branch expression must evaluate to a scalar (v1 limit)");
    const specificity = Object.keys(c.tags).length;
    const perAxis: string[][] = [];
    for (const ax of universe) {
      const tagged = c.tags[ax];
      if (tagged && tagged.length > 0) {
        perAxis.push(tagged);
        continue;
      }
      const declared = env.axes.get(ax);
      if (!declared) return err(`axis '${ax}' is not declared`);
      if (declared.length === 0) return err(`axis '${ax}' has no values`);
      perAxis.push(declared);
    }
    for (const combo of cartesian(perAxis)) {
      const at: Assignment = {};
      for (let i = 0; i < universe.length; i += 1) at[universe[i]] = combo[i];
      const key = asKey(at, universe);
      const prev = cellMap.get(key);
      if (!prev || prev.specificity <= specificity) {
        cellMap.set(key, { at, qty: sq, specificity });
      }
    }
  }
  const cells: Cell[] = [...cellMap.values()].map((e) => ({ at: e.at, qty: e.qty }));
  return ok({ axes: universe, cells });
}

function selectCells(v: CogValue, filter: TagSet): Result<CogValue, string> {
  for (const ax of Object.keys(filter)) {
    if (!v.axes.includes(ax)) return err(`selector axis '${ax}' is not on the value (axes: ${v.axes.join(", ") || "scalar"})`);
  }
  const dropAxes = new Set<string>();
  for (const ax of Object.keys(filter)) if (filter[ax].length === 1) dropAxes.add(ax);
  const remain = v.axes.filter((a) => !dropAxes.has(a));
  const out: Cell[] = [];
  for (const cell of v.cells) {
    let keep = true;
    for (const ax of Object.keys(filter)) {
      if (!filter[ax].includes(cell.at[ax])) { keep = false; break; }
    }
    if (!keep) continue;
    const at: Assignment = {};
    for (const a of remain) at[a] = cell.at[a];
    out.push({ at, qty: cell.qty });
  }
  return ok({ axes: remain, cells: out });
}

function reduceQtys(qs: Qty[], op: AggOp): Result<Qty, string> {
  if (qs.length === 0) return err("empty aggregation group");
  if (op === "sum" || op === "avg") {
    let acc = qs[0];
    for (let i = 1; i < qs.length; i += 1) {
      const r = addQty(acc, qs[i]);
      if (!r.ok) return r;
      acc = r.value;
    }
    if (op === "sum") return ok(acc);
    return divQty(acc, { value: qs.length, unit: DIMENSIONLESS });
  }
  let best = qs[0];
  for (let i = 1; i < qs.length; i += 1) {
    const cmp = compareQty(qs[i], best);
    if (!cmp.ok) return cmp;
    if (op === "min" ? cmp.value < 0 : cmp.value > 0) best = qs[i];
  }
  return ok(best);
}

function compareQty(a: Qty, b: Qty): Result<number, string> {
  const diff = addQty(a, { value: -b.value, unit: b.unit });
  if (!diff.ok) return diff;
  return ok(diff.value.value);
}

function aggregate(v: CogValue, op: AggOp, axes: string[]): Result<CogValue, string> {
  for (const a of axes) if (!v.axes.includes(a)) return err(`cannot aggregate over '${a}': value has no such axis`);
  const remain = v.axes.filter((a) => !axes.includes(a));
  const groups = new Map<string, Cell[]>();
  for (const cell of v.cells) {
    const key = asKey(cell.at, remain);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(cell);
  }
  const out: Cell[] = [];
  for (const group of groups.values()) {
    const at: Assignment = {};
    for (const a of remain) at[a] = group[0].at[a];
    const r = reduceQtys(group.map((c) => c.qty), op);
    if (!r.ok) return r;
    out.push({ at, qty: r.value });
  }
  return ok({ axes: remain, cells: out });
}

export function evalExpr(expr: Expr, env: Env): Result<CogValue, string> {
  if (expr.kind === "qty") return ok(scalarValue(expr.qty));
  if (expr.kind === "ref") {
    const cached = env.cache.get(expr.name);
    if (cached) return ok(cached);
    if (env.stack.has(expr.name)) return err(`cycle detected at '${expr.name}'`);
    const b = env.bindings.get(expr.name);
    if (!b) return err(`unknown binding '${expr.name}'`);
    env.stack.add(expr.name);
    const r = evalExpr(b.expr, env);
    env.stack.delete(expr.name);
    if (!r.ok) return r;
    env.cache.set(expr.name, r.value);
    return r;
  }
  if (expr.kind === "neg") {
    const r = evalExpr(expr.expr, env);
    if (!r.ok) return r;
    return ok({ axes: r.value.axes, cells: r.value.cells.map((c) => ({ at: c.at, qty: negQty(c.qty) })) });
  }
  if (expr.kind === "op") {
    const l = evalExpr(expr.left, env);
    if (!l.ok) return l;
    const r = evalExpr(expr.right, env);
    if (!r.ok) return r;
    const opfn = expr.op === "+" ? addQty : expr.op === "-" ? subQty : expr.op === "*" ? mulQty : divQty;
    return broadcast([l.value, r.value], (qs) => opfn(qs[0], qs[1]));
  }
  if (expr.kind === "call") {
    const fn = FNS[expr.name];
    if (!fn) return err(`unknown function '${expr.name}'`);
    const argVals: CogValue[] = [];
    for (const a of expr.args) {
      const r = evalExpr(a, env);
      if (!r.ok) return r;
      argVals.push(r.value);
    }
    return broadcast(argVals, (qs) => {
      const out = fn(...qs.map((q) => q.value));
      if (typeof out !== "number") return err(`function '${expr.name}' returned non-number`);
      return ok({ value: out, unit: qs[0]?.unit ?? DIMENSIONLESS });
    });
  }
  if (expr.kind === "tiers") {
    if (expr.tiers.length === 0) return err("empty tier expression");
    return evalExpr(expr.tiers[0].expr, env);
  }
  if (expr.kind === "branches") return expandBranches(expr.cases, env);
  if (expr.kind === "select") {
    const v = evalExpr(expr.expr, env);
    if (!v.ok) return v;
    return selectCells(v.value, expr.filter);
  }
  if (expr.kind === "aggregate") {
    const v = evalExpr(expr.expr, env);
    if (!v.ok) return v;
    return aggregate(v.value, expr.op, expr.axes);
  }
  const _exhaustive: never = expr;
  return err(`unknown expr kind`);
}

export function evalProgram(prog: Program): Result<Map<string, CogValue>, string> {
  const env = makeEnv(prog);
  for (const b of prog.bindings) {
    const r = evalExpr({ kind: "ref", name: b.name }, env);
    if (!r.ok) return err(`in '${b.name}': ${r.error}`);
  }
  return ok(env.cache);
}

export type RenderedSeries = {
  label: string;
  color: string;
  value: number;
  unit: string;
};

export type RenderedChart = {
  chart: string;
  kind: ChartKind;
  series: RenderedSeries[];
};

const AUTO_PALETTE = [
  "#3b82f6", "#22c55e", "#f97316", "#a855f7", "#06b6d4",
  "#eab308", "#ef4444", "#14b8a6", "#ec4899", "#84cc16",
  "#6366f1", "#f59e0b",
];

export function renderCharts(prog: Program, values: Map<string, CogValue>): Result<RenderedChart[], string> {
  const groups = new Map<string, RenderedSeries[]>();
  for (const ch of prog.charts) {
    const v = values.get(ch.ref);
    if (!v) return err(`chart entry references unknown binding '${ch.ref}'`);
    if (!groups.has(ch.chart)) groups.set(ch.chart, []);
    const target = groups.get(ch.chart)!;
    const auto = ch.color === "#auto";
    const sq = scalarQty(v);
    if (sq !== null) {
      const color = auto ? AUTO_PALETTE[target.length % AUTO_PALETTE.length] : ch.color;
      target.push({ label: ch.ref, color, value: sq.value, unit: fmtUnit(sq.unit) });
      continue;
    }
    for (let i = 0; i < v.cells.length; i += 1) {
      const cell = v.cells[i];
      const tagLabel = v.axes.map((a) => cell.at[a]).join(" / ");
      const color = auto ? AUTO_PALETTE[(target.length + i) % AUTO_PALETTE.length] : ch.color;
      target.push({ label: tagLabel, color, value: cell.qty.value, unit: fmtUnit(cell.qty.unit) });
    }
  }
  const kinds = new Map<string, ChartKind>();
  for (const c of prog.chartConfigs) kinds.set(c.name, c.kind);
  const out: RenderedChart[] = [];
  for (const [chart, series] of groups) out.push({ chart, kind: kinds.get(chart) ?? "bar", series });
  return ok(out);
}
