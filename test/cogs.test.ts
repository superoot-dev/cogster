import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseProgram } from "../lib/CogsParser";
import { evalProgram } from "../lib/CogsEvaluator";
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
  assert.deepEqual(p.axes[0], { name: "sku", values: ["widget", "energy"] });
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

run("formats qty", () => {
  assert.equal(fmtQty({ value: 100, unit: { num: ["usd"], den: ["kg"] } }), "100 usd/kg");
});

run("parses sample file", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "examples", "sample.cogs"), "utf8");
  const r = evalOk(src);
  assert.equal(val(r, "units per case"), 96);
});

console.log("all tests passed");
