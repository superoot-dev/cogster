import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseProgram } from "../lib/CogsParser";
import { evalProgram, renderCharts } from "../lib/CogsEvaluator";
import { fmtQty } from "../lib/CogsUnits";
import { CogValue, scalarQty } from "../lib/CogsTypes";

function run(name: string, fn: () => void) {
  fn();
  console.log(`  ok ${name}`);
}

function parseOk(src: string) {
  const r = parseProgram(src);
  assert.equal(r.ok, true, !r.ok ? r.error : "");
  return r.ok ? r.value : null!;
}

function evalOk(src: string): Map<string, CogValue> {
  const p = parseOk(src);
  const r = evalProgram(p);
  assert.equal(r.ok, true, !r.ok ? r.error : "");
  return r.ok ? r.value : null!;
}

function val(r: Map<string, CogValue>, name: string): number {
  const v = r.get(name);
  assert.ok(v, `missing binding '${name}'`);
  const q = scalarQty(v);
  assert.ok(q, `expected scalar for '${name}', got tagged (axes: ${v.axes.join(",")})`);
  return q.value;
}

function cell(r: Map<string, CogValue>, name: string, at: Record<string, string>): number {
  const v = r.get(name);
  assert.ok(v, `missing binding '${name}'`);
  for (const c of v.cells) {
    let match = true;
    for (const k in at) if (c.at[k] !== at[k]) { match = false; break; }
    if (match) return c.qty.value;
  }
  throw new Error(`no cell at ${JSON.stringify(at)} in '${name}'`);
}

function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
}

run("parses scalar binding", () => {
  const p = parseOk("packs per case = 6");
  assert.equal(p.bindings.length, 1);
  assert.equal(p.bindings[0].name, "packs per case");
});

run("parses quantity with unit", () => {
  const p = parseOk("ginger per serving = 1000 mg");
  const e = p.bindings[0].expr;
  assert.equal(e.kind, "qty");
});

run("parses currency rate", () => {
  const p = parseOk("ginger price = $100 / kg");
  const e = p.bindings[0].expr;
  if (e.kind !== "qty") throw new Error("expected qty");
  assert.deepEqual(e.qty.unit, { num: ["usd"], den: ["kg"] });
});

run("parses 'per' unit denominator", () => {
  const p = parseOk("bob salary = $10000 per month");
  const e = p.bindings[0].expr;
  if (e.kind !== "qty") throw new Error("expected qty");
  assert.deepEqual(e.qty.unit, { num: ["usd"], den: ["month"] });
});

run("parses tier expression", () => {
  const p = parseOk("price = $100 / kg @ 10 kg, $80 / kg @ 20 kg");
  const e = p.bindings[0].expr;
  assert.equal(e.kind, "tiers");
});

run("evaluates arithmetic", () => {
  const r = evalOk("packs per case = 6\nunits per pack = 16\nunits per case = packs per case * units per pack");
  assert.equal(val(r, "units per case"), 96);
});

run("evaluates add same dim", () => {
  const r = evalOk("a = 100 mg\nb = 1 g\nc = a + b");
  assert.equal(val(r, "c"), 1100);
});

run("evaluates dim cancellation in mul", () => {
  const r = evalOk("ginger per serving = 1000 mg\nginger price = $100 / kg\ncost = ginger per serving * ginger price");
  assert.ok(approx(val(r, "cost"), 0.1));
});

run("evaluates 'per month' rate", () => {
  const r = evalOk("bob salary = $10000 per month\njim salary = $2222 per month\ntotal = bob salary + jim salary");
  assert.equal(val(r, "total"), 12222);
});

run("tiers default to lowest", () => {
  const r = evalOk("price = $100 / kg @ 10 kg, $80 / kg @ 20 kg");
  assert.equal(val(r, "price"), 100);
});

run("detects cycles", () => {
  const p = parseOk("a = b\nb = a");
  const r = evalProgram(p);
  assert.equal(r.ok, false);
});

run("calls min/max from STDLIB", () => {
  const r = evalOk("a = 10\nb = 4\nc = min(a, b)\nd = max(a, b)");
  assert.equal(val(r, "c"), 4);
  assert.equal(val(r, "d"), 10);
});

run("calls variadic calcMax", () => {
  const r = evalOk("a = 1\nb = 5\nc = 3\nm = calcMax(a, b, c)");
  assert.equal(val(r, "m"), 5);
});

run("call: getRoundTo", () => {
  const r = evalOk("x = getRoundTo(3.14159, 2)");
  assert.equal(val(r, "x"), 3.14);
});

run("axis declaration", () => {
  const p = parseOk("axis sku = :widget :energy");
  assert.equal(p.axes.length, 1);
  assert.deepEqual(p.axes[0], { name: "sku", values: ["widget", "energy"], groups: [] });
});

run("tagged binding via branches", () => {
  const src = `
axis sku = :widget :energy
cogs per bar =
  :widget  $0.64
  :energy  $0.55`;
  const r = evalOk(src);
  assert.equal(cell(r, "cogs per bar", { sku: "widget" }), 0.64);
  assert.equal(cell(r, "cogs per bar", { sku: "energy" }), 0.55);
});

run("broadcast: scalar * tagged", () => {
  const src = `
axis sku = :a :b
price =
  :a  $10
  :b  $20
doubled = price * 2`;
  const r = evalOk(src);
  assert.equal(cell(r, "doubled", { sku: "a" }), 20);
  assert.equal(cell(r, "doubled", { sku: "b" }), 40);
});

run("broadcast: tagged * tagged same axis (zip)", () => {
  const src = `
axis sku = :a :b
price =
  :a  $10
  :b  $20
units =
  :a  100
  :b  50
revenue = price * units`;
  const r = evalOk(src);
  assert.equal(cell(r, "revenue", { sku: "a" }), 1000);
  assert.equal(cell(r, "revenue", { sku: "b" }), 1000);
});

run("broadcast: tagged different axes (cartesian)", () => {
  const src = `
axis sku = :a :b
axis chan = :x :y
price =
  :a  $10
  :b  $20
mult =
  :x  2
  :y  3
out = price * mult`;
  const r = evalOk(src);
  assert.equal(cell(r, "out", { sku: "a", chan: "x" }), 20);
  assert.equal(cell(r, "out", { sku: "a", chan: "y" }), 30);
  assert.equal(cell(r, "out", { sku: "b", chan: "x" }), 40);
  assert.equal(cell(r, "out", { sku: "b", chan: "y" }), 60);
});

run("two-axis branches: cartesian leaf", () => {
  const src = `
axis sku = :a :b
axis chan = :x :y
bars =
  :a :x  100
  :a :y  200
  :b :x  300
  :b :y  400`;
  const r = evalOk(src);
  assert.equal(cell(r, "bars", { sku: "a", chan: "x" }), 100);
  assert.equal(cell(r, "bars", { sku: "b", chan: "y" }), 400);
});

run("aggregation: sum over axis", () => {
  const src = `
axis sku = :a :b
units =
  :a  100
  :b  200
total = sum units over :sku`;
  const r = evalOk(src);
  assert.equal(val(r, "total"), 300);
});

run("aggregation: sum keeps other axes", () => {
  const src = `
axis sku = :a :b
axis chan = :x :y
sales =
  :a :x  10
  :a :y  20
  :b :x  30
  :b :y  40
by chan = sum sales over :sku`;
  const r = evalOk(src);
  assert.equal(cell(r, "by chan", { chan: "x" }), 40);
  assert.equal(cell(r, "by chan", { chan: "y" }), 60);
});

run("selector picks cell", () => {
  const src = `
axis sku = :a :b
price =
  :a  $10
  :b  $20
a price = price :a`;
  const r = evalOk(src);
  assert.equal(val(r, "a price"), 10);
});

run("wildcard branch is default", () => {
  const src = `
axis tier = :gold :silver :bronze
rate =
  :gold    0.05
  :*       0.10`;
  const r = evalOk(src);
  assert.equal(cell(r, "rate", { tier: "gold" }), 0.05);
  assert.equal(cell(r, "rate", { tier: "silver" }), 0.10);
  assert.equal(cell(r, "rate", { tier: "bronze" }), 0.10);
});

run("broadcast errors on missing cell", () => {
  const src = `
axis sku = :a :b
price =
  :a  $10
units =
  :a  100
  :b  200
revenue = price * units`;
  const r = parseProgram(src);
  assert.ok(r.ok);
  const e = evalProgram(r.value);
  assert.equal(e.ok, false);
});

run("selectCells errors on non-existent axis", () => {
  const src = `
axis sku = :a :b
price =
  :a  $10
  :b  $20
total = sum price over :sku
bad = total :a`;
  const r = parseProgram(src);
  assert.ok(r.ok);
  const e = evalProgram(r.value);
  assert.equal(e.ok, false);
});

run("specificity tie: last branch wins", () => {
  const src = `
axis sku = :a :b
price =
  :a  $10
  :a  $99`;
  const r = evalOk(src);
  assert.equal(cell(r, "price", { sku: "a" }), 99);
});

run("min/max are unit-aware", () => {
  const r = evalOk("axis x = :a :b\nw =\n  :a  1 kg\n  :b  500 g\nm = min w over :x");
  assert.equal(val(r, "m"), 500);
});

run("unrecognized line errors", () => {
  const r = parseProgram("cogs per bar  $0.64");
  assert.equal(r.ok, false);
});

run("axis line missing leading colon errors", () => {
  const r = parseProgram("axis sku = junk text :widget :energy");
  assert.equal(r.ok, false);
});

run("branch with axis name as tag errors", () => {
  const src = `
axis sku = :a :b
price =
  :sku  $10`;
  const r = parseProgram(src);
  assert.equal(r.ok, false);
});

run("unknown ref errors", () => {
  const r = parseProgram("a = unknown ref");
  assert.equal(r.ok, false);
});

run("unknown function errors", () => {
  const p = parseOk("a = nope(1)");
  const r = evalProgram(p);
  assert.equal(r.ok, false);
});

run("strips comments", () => {
  const p = parseOk("// just a comment\na = 1 // trailing\nb = 2");
  assert.equal(p.bindings.length, 2);
});

run("dim mismatch error", () => {
  const p = parseOk("a = 1 kg\nb = 1 ml\nc = a + b");
  const r = evalProgram(p);
  assert.equal(r.ok, false);
});

run("inline tagged literal: comma-separated on one line", () => {
  const src = `
axis tier = :gold :silver :bronze
rate = :gold 0.05, :silver 0.08, :bronze 0.10`;
  const r = evalOk(src);
  assert.equal(cell(r, "rate", { tier: "gold" }), 0.05);
  assert.equal(cell(r, "rate", { tier: "silver" }), 0.08);
  assert.equal(cell(r, "rate", { tier: "bronze" }), 0.10);
});

run("default via RHS: scalar on '=' line plus branch overrides", () => {
  const src = `
axis tier = :gold :silver :bronze
rate = 0.07
  :gold     0.05
  :silver   0.06`;
  const r = evalOk(src);
  assert.equal(cell(r, "rate", { tier: "gold" }), 0.05);
  assert.equal(cell(r, "rate", { tier: "silver" }), 0.06);
  assert.equal(cell(r, "rate", { tier: "bronze" }), 0.07);
});

run("relaxed tag chars: digits and hyphens", () => {
  const src = `
axis seg = :b2b :tier-1 :q4-2026
rate =
  :b2b      0.05
  :tier-1   0.10
  :q4-2026  0.15`;
  const r = evalOk(src);
  assert.equal(cell(r, "rate", { seg: "b2b" }), 0.05);
  assert.equal(cell(r, "rate", { seg: "tier-1" }), 0.10);
  assert.equal(cell(r, "rate", { seg: "q4-2026" }), 0.15);
});

run("line continuation: binary op at end of line", () => {
  const src = `
a = 1 +
    2 +
    3
b = (10 +
     20) * 2`;
  const r = evalOk(src);
  assert.equal(val(r, "a"), 6);
  assert.equal(val(r, "b"), 60);
});

run("matrix form: 2D cartesian via markdown table", () => {
  const src = `
axis sku = :widget :energy
axis chan = :fakemart :indie

bars =
  |          | :fakemart | :indie
  | :widget  | 3494400   | 1996800
  | :energy  |  748800   |  686400`;
  const r = evalOk(src);
  assert.equal(cell(r, "bars", { sku: "widget", chan: "fakemart" }), 3494400);
  assert.equal(cell(r, "bars", { sku: "widget", chan: "indie" }), 1996800);
  assert.equal(cell(r, "bars", { sku: "energy", chan: "fakemart" }), 748800);
  assert.equal(cell(r, "bars", { sku: "energy", chan: "indie" }), 686400);
});

run("matrix form: cells can contain expressions", () => {
  const src = `
axis sku = :a :b
axis chan = :x :y

base = $1.50
mult = 1.10

price =
  |       | :x        | :y
  | :a    | base      | base * mult
  | :b    | base / 2  | base / 2 * mult`;
  const r = evalOk(src);
  assert.equal(cell(r, "price", { sku: "a", chan: "x" }), 1.5);
  assert.ok(Math.abs(cell(r, "price", { sku: "a", chan: "y" }) - 1.65) < 1e-9);
  assert.equal(cell(r, "price", { sku: "b", chan: "x" }), 0.75);
});

run("formats qty", () => {
  assert.equal(fmtQty({ value: 100, unit: { num: ["usd"], den: ["kg"] } }), "100 usd/kg");
});

run("rejects space after : in axis decl", () => {
  const r = parseProgram("axis sku = : widget :energy");
  assert.equal(r.ok, false);
});

run("rejects space after : in branch tag", () => {
  const src = `
axis sku = :a :b
price =
  : a  $10
  :b  $20`;
  const r = parseProgram(src);
  assert.equal(r.ok, false);
});

run("rejects space after : in selector", () => {
  const src = `
axis sku = :a :b
price =
  :a  $10
  :b  $20
v = price : a`;
  const r = parseProgram(src);
  assert.equal(r.ok, false);
});

run("rejects space after : in aggregation axis", () => {
  const src = `
axis sku = :a :b
units =
  :a  100
  :b  200
total = sum units over : sku`;
  const r = parseProgram(src);
  assert.equal(r.ok, false);
});

run("rejects space in : * wildcard", () => {
  const src = `
axis tier = :gold :silver
rate =
  :gold  0.05
  : *    0.10`;
  const r = parseProgram(src);
  assert.equal(r.ok, false);
});

run("parses sample file", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "examples", "sample.cogs"), "utf8");
  const r = evalOk(src);
  assert.equal(val(r, "units per case"), 96);
});

run("parses chart entries: hex and named colors", () => {
  const src = `
a = 10
b = 20
#f6f6f6.foo a
#red.foo b
#1f8.bar a
`;
  const prog = parseOk(src);
  assert.equal(prog.charts.length, 3);
  assert.equal(prog.charts[0].color, "#f6f6f6");
  assert.equal(prog.charts[0].chart, "foo");
  assert.equal(prog.charts[0].ref, "a");
  assert.equal(prog.charts[1].color, "#ef4444");
  assert.equal(prog.charts[2].color, "#11ff88");
});

run("chart entry with multi-word ref", () => {
  const src = `
fakemart total stores = 100
#red.foo fakemart total stores
`;
  const prog = parseOk(src);
  assert.equal(prog.charts[0].ref, "fakemart total stores");
});

run("unknown color rejected", () => {
  const r = parseProgram(`a = 10\n#chartreuse.foo a\n`);
  assert.equal(r.ok, false);
});

run("unknown chart ref rejected", () => {
  const r = parseProgram(`a = 10\n#red.foo b\n`);
  assert.equal(r.ok, false);
});

run("renderCharts groups by chart key", () => {
  const src = `
a = 10
b = 20 mg
#red.foo a
#blue.foo b
#green.bar a
`;
  const prog = parseOk(src);
  const evald = evalProgram(prog);
  assert.equal(evald.ok, true);
  if (!evald.ok) return;
  const r = renderCharts(prog, evald.value);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.length, 2);
  const foo = r.value.find((c) => c.chart === "foo")!;
  assert.equal(foo.series.length, 2);
  assert.equal(foo.series[0].label, "a");
  assert.equal(foo.series[0].value, 10);
  assert.equal(foo.series[1].value, 20);
  assert.equal(foo.series[1].unit, "mg");
});

run("auto color + tagged ref expands into per-cell series", () => {
  const src = `
axis sku = :widget bar :energy bar
units sold =
  :widget bar  100
  :energy bar  200
#auto.foo units sold
`;
  const prog = parseOk(src);
  const evald = evalProgram(prog);
  assert.equal(evald.ok, true);
  if (!evald.ok) return;
  const r = renderCharts(prog, evald.value);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const foo = r.value.find((c) => c.chart === "foo")!;
  assert.equal(foo.series.length, 2);
  assert.equal(foo.series[0].label, "widget bar");
  assert.equal(foo.series[0].value, 100);
  assert.equal(foo.series[1].label, "energy bar");
  assert.equal(foo.series[1].value, 200);
  assert.notEqual(foo.series[0].color, foo.series[1].color);
});

run("chart block form: indented entries with optional color", () => {
  const src = `
a = 10
b = 20
c = 30
chart foo = pie
  #red    a
  #1f8    b
          c
`;
  const prog = parseOk(src);
  assert.equal(prog.charts.length, 3);
  assert.equal(prog.charts[0].color, "#ef4444");
  assert.equal(prog.charts[0].chart, "foo");
  assert.equal(prog.charts[0].ref, "a");
  assert.equal(prog.charts[1].color, "#11ff88");
  assert.equal(prog.charts[1].ref, "b");
  assert.equal(prog.charts[2].color, "#auto");
  assert.equal(prog.charts[2].ref, "c");
});

run("chart block ends at unindented line", () => {
  const src = `
a = 10
b = 20
chart foo = bar
  #red a
b doubled = b * 2
#blue.bar a
`;
  const prog = parseOk(src);
  assert.equal(prog.charts.length, 2);
  assert.equal(prog.charts[0].chart, "foo");
  assert.equal(prog.charts[1].chart, "bar");
  assert.ok(prog.bindings.find((b) => b.name === "b doubled"));
});

run("chart block: multi-word ref", () => {
  const src = `
total revenue = 1000
chart kpis = bar
  #green total revenue
`;
  const prog = parseOk(src);
  assert.equal(prog.charts[0].ref, "total revenue");
});

run("chart decl without kind defaults to bar", () => {
  const src = `
a = 10
b = 20
chart kpis
  a
  b
`;
  const prog = parseOk(src);
  assert.equal(prog.chartConfigs[0].name, "kpis");
  assert.equal(prog.chartConfigs[0].kind, "bar");
  assert.equal(prog.charts.length, 2);
});

run("chart block: unknown color rejected", () => {
  const src = `
a = 10
chart foo = pie
  #fuchsia a
`;
  const r = parseProgram(src);
  assert.equal(r.ok, false);
});

run("axis groups: declared via indented 'group :name = :tags'", () => {
  const src = `
axis sku = :my16 :st16 :or16 :pe16 :my30 :st30 :or30 :pe30
  group :sticks  = :my16 :st16 :or16 :pe16
  group :pouches = :my30 :st30 :or30 :pe30
`;
  const prog = parseOk(src);
  assert.equal(prog.axes[0].groups.length, 2);
  assert.equal(prog.axes[0].groups[0].name, "sticks");
  assert.deepEqual(prog.axes[0].groups[0].values, ["my16", "st16", "or16", "pe16"]);
});

run("axis groups: expand in branches", () => {
  const src = `
axis sku = :a :b :c :d
  group :first half = :a :b

per sku =
  :first half  100
  :c           50
  :d           25
`;
  const r = evalOk(src);
  assert.equal(cell(r, "per sku", { sku: "a" }), 100);
  assert.equal(cell(r, "per sku", { sku: "b" }), 100);
  assert.equal(cell(r, "per sku", { sku: "c" }), 50);
  assert.equal(cell(r, "per sku", { sku: "d" }), 25);
});

run("axis groups: expand in selectors and aggregation", () => {
  const src = `
axis sku = :a :b :c :d
  group :sticks = :a :b

units =
  :a 10
  :b 20
  :c 30
  :d 40

stick total = sum units :sticks over :sku
`;
  const r = evalOk(src);
  assert.equal(val(r, "stick total"), 30);
});

run("axis groups: member must belong to axis", () => {
  const src = `
axis sku = :a :b
axis channel = :x :y
  group :bad = :a
`;
  const r = parseProgram(src);
  assert.equal(r.ok, false);
});

run("axis groups: name collision with tag rejected", () => {
  const src = `
axis sku = :a :b
  group :a = :a :b
`;
  const r = parseProgram(src);
  assert.equal(r.ok, false);
});

run("matrix :* row default", () => {
  const src = `
axis sku = :a :b :c
axis channel = :x :y

price =
  |     | :x   | :y
  | :a  | $1   | $2
  | :*  | $10  | $20
`;
  const r = evalOk(src);
  assert.equal(cell(r, "price", { sku: "a", channel: "x" }), 1);
  assert.equal(cell(r, "price", { sku: "b", channel: "x" }), 10);
  assert.equal(cell(r, "price", { sku: "c", channel: "y" }), 20);
});

run("matrix :* col default", () => {
  const src = `
axis sku = :a :b
axis channel = :x :y :z

price =
  |     | :x   | :*
  | :a  | $1   | $99
  | :b  | $2   | $88
`;
  const r = evalOk(src);
  assert.equal(cell(r, "price", { sku: "a", channel: "x" }), 1);
  assert.equal(cell(r, "price", { sku: "a", channel: "y" }), 99);
  assert.equal(cell(r, "price", { sku: "b", channel: "z" }), 88);
});

run("sum (...) over :axis parses as aggregation when followed by over", () => {
  const src = `
axis b = :x :y :z
units =
  :x 10
  :y 20
  :z 30
mix =
  :x 0.5
  :y 0.3
  :z 0.2
weighted avg = sum (units * mix) over :b
`;
  const r = evalOk(src);
  assert.ok(approx(val(r, "weighted avg"), 10 * 0.5 + 20 * 0.3 + 30 * 0.2));
});

run("min(a, b) still parses as function call (no 'over' after)", () => {
  const src = `
cap = 100
spend = 75
clamped = min(cap, spend)
`;
  const r = evalOk(src);
  assert.equal(val(r, "clamped"), 75);
});

run("min (x) over :ax parses as aggregation", () => {
  const src = `
axis ax = :a :b :c
v =
  :a 10
  :b 5
  :c 20
lowest = min (v) over :ax
`;
  const r = evalOk(src);
  assert.equal(val(r, "lowest"), 5);
});

run("parses negative number literal as qty (not neg expr)", () => {
  const cases = [
    { src: "x = -1", val: -1 },
    { src: "x = -1.5", val: -1.5 },
    { src: "x = -.5", val: -0.5 },
    { src: "x = -0", val: -0 },
    { src: "x = -$3.50", val: -3.5 },
  ];
  for (const c of cases) {
    const p = parseOk(c.src);
    assert.equal(p.bindings[0].expr.kind, "qty", `expected qty for '${c.src}', got ${p.bindings[0].expr.kind}`);
    if (p.bindings[0].expr.kind === "qty") {
      assert.equal(p.bindings[0].expr.qty.value, c.val, `${c.src}`);
    }
  }
});

run("negative literals still evaluate correctly in expressions", () => {
  const r = evalOk("a = -2\nb = 3\nc = a + b");
  assert.equal(val(r, "c"), 1);
});

run("unary minus on identifier still parses as neg expr", () => {
  const p = parseOk("a = 5\nb = -a");
  assert.equal(p.bindings[1].expr.kind, "neg");
});

run("parseQty yields to ref names after '/' (no parens needed)", () => {
  const src = `
sticks per caddy = 16
caddy cost per unit = $1.00 / sticks per caddy
`;
  const r = evalOk(src);
  assert.ok(approx(val(r, "caddy cost per unit"), 1 / 16));
});

run("parseQty: nested ref divisors", () => {
  const src = `
inner = 8
units per case = 96
units per master case = inner * units per case
case cost per unit = $0.50 / units per case
master cost per unit = $1.00 / units per master case
`;
  const r = evalOk(src);
  assert.ok(approx(val(r, "case cost per unit"), 0.5 / 96));
  assert.ok(approx(val(r, "master cost per unit"), 1 / (8 * 96)));
});

run("parseQty still parses literal units (`$1.00 / kg`)", () => {
  const r = evalOk("price = $1.00 / kg\nfor mass = price * 5 kg");
  assert.ok(approx(val(r, "for mass"), 5));
});

run("matrix :* x :* default cell", () => {
  const src = `
axis sku = :a :b
axis channel = :x :y

price =
  |     | :x   | :*
  | :a  | $1   | $2
  | :*  | $5   | $0
`;
  const r = evalOk(src);
  assert.equal(cell(r, "price", { sku: "a", channel: "x" }), 1);
  assert.equal(cell(r, "price", { sku: "a", channel: "y" }), 2);
  assert.equal(cell(r, "price", { sku: "b", channel: "x" }), 5);
  assert.equal(cell(r, "price", { sku: "b", channel: "y" }), 0);
});

console.log("all tests passed");
