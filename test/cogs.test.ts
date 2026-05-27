import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseProgram } from "../lib/CogsParser";
import { evalProgram } from "../lib/CogsEvaluator";
import { fmtQty } from "../lib/CogsUnits";
import { Qty } from "../lib/CogsTypes";

function run(name: string, fn: () => void) {
  fn();
  console.log(`  ok ${name}`);
}

function parseOk(src: string) {
  const r = parseProgram(src);
  assert.equal(r.ok, true, !r.ok ? r.error : "");
  return r.ok ? r.value : null!;
}

function evalOk(src: string): Map<string, Qty> {
  const p = parseOk(src);
  const r = evalProgram(p);
  assert.equal(r.ok, true, !r.ok ? r.error : "");
  return r.ok ? r.value : null!;
}

function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
}

run("parses scalar binding", () => {
  const p = parseOk("packs per case = 6");
  assert.equal(p.bindings.length, 1);
  assert.equal(p.bindings[0].name, "packs per case");
  assert.equal(p.bindings[0].expr.kind, "qty");
});

run("parses quantity with unit", () => {
  const p = parseOk("ginger per serving = 1000 mg");
  const e = p.bindings[0].expr;
  assert.equal(e.kind, "qty");
  if (e.kind !== "qty") return;
  assert.equal(e.qty.value, 1000);
  assert.deepEqual(e.qty.unit, { num: ["mg"], den: [] });
});

run("parses currency rate", () => {
  const p = parseOk("ginger price = $100 / kg");
  const e = p.bindings[0].expr;
  if (e.kind !== "qty") throw new Error("expected qty");
  assert.deepEqual(e.qty.unit, { num: ["usd"], den: ["kg"] });
  assert.equal(e.qty.value, 100);
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
  if (e.kind !== "tiers") return;
  assert.equal(e.tiers.length, 2);
  assert.equal(e.tiers[0].at.value, 10);
  assert.equal(e.tiers[1].at.value, 20);
});

run("parses multi-word refs", () => {
  const src = "packs per case = 6\nunits per pack = 16\nunits per case = packs per case * units per pack";
  const p = parseOk(src);
  const last = p.bindings[2].expr;
  assert.equal(last.kind, "op");
});

run("evaluates arithmetic", () => {
  const r = evalOk("packs per case = 6\nunits per pack = 16\nunits per case = packs per case * units per pack");
  assert.equal(r.get("units per case")?.value, 96);
});

run("evaluates add same dim", () => {
  const r = evalOk("a = 100 mg\nb = 1 g\nc = a + b");
  assert.equal(r.get("c")?.value, 1100);
});

run("evaluates dim cancellation in mul", () => {
  const r = evalOk("ginger per serving = 1000 mg\nginger price = $100 / kg\ncost = ginger per serving * ginger price");
  const cost = r.get("cost");
  assert.ok(cost);
  assert.ok(approx(cost.value, 0.1), `expected 0.1 got ${cost.value}`);
  assert.deepEqual(cost.unit, { num: ["usd"], den: [] });
});

run("evaluates 'per month' rate", () => {
  const r = evalOk("bob salary = $10000 per month\njim salary = $2222 per month\ntotal = bob salary + jim salary");
  const total = r.get("total");
  assert.ok(total);
  assert.equal(total.value, 12222);
  assert.deepEqual(total.unit, { num: ["usd"], den: ["month"] });
});

run("tiers default to lowest", () => {
  const r = evalOk("price = $100 / kg @ 10 kg, $80 / kg @ 20 kg");
  const v = r.get("price");
  assert.equal(v?.value, 100);
});

run("detects cycles", () => {
  const p = parseOk("a = b\nb = a");
  const r = evalProgram(p);
  assert.equal(r.ok, false);
});

run("rejects unknown ref", () => {
  const r = parseProgram("x = unknown thing");
  assert.equal(r.ok, false);
});

run("dim mismatch error", () => {
  const p = parseOk("a = 1 kg\nb = 1 ml\nc = a + b");
  const r = evalProgram(p);
  assert.equal(r.ok, false);
});

run("calls min/max from STDLIB", () => {
  const r = evalOk("a = 10\nb = 4\nc = min(a, b)\nd = max(a, b)");
  assert.equal(r.get("c")?.value, 4);
  assert.equal(r.get("d")?.value, 10);
});

run("calls variadic calcMax from mathFunctions", () => {
  const r = evalOk("a = 1\nb = 5\nc = 3\nd = 2\nm = calcMax(a, b, c, d)");
  assert.equal(r.get("m")?.value, 5);
});

run("call preserves first-arg unit", () => {
  const r = evalOk("a = $10\nb = $4\nc = min(a, b)");
  const c = r.get("c");
  assert.equal(c?.value, 4);
  assert.deepEqual(c?.unit, { num: ["usd"], den: [] });
});

run("call: clamp from mathFunctions", () => {
  const r = evalOk("x = clamp(15, 0, 10)");
  assert.equal(r.get("x")?.value, 10);
});

run("call: getRoundTo", () => {
  const r = evalOk("x = getRoundTo(3.14159, 2)");
  assert.equal(r.get("x")?.value, 3.14);
});

run("sku block: prefixes names, local refs resolve in scope", () => {
  const src = `
sku widget bar {
  cogs per bar = $0.64
  price per bar = $1.55
  units = 1000
  revenue = price per bar * units
}`;
  const p = parseOk(src);
  const namesSet = new Set(p.bindings.map((b) => b.name));
  assert.ok(namesSet.has("widget bar.cogs per bar"));
  assert.ok(namesSet.has("widget bar.revenue"));
  const r = evalOk(src);
  assert.equal(r.get("widget bar.revenue")?.value, 1550);
});

run("sku block: globals visible from inside", () => {
  const src = `
trade pct = 0.1
sku widget bar {
  gross = $1000
  trade dollars = gross * trade pct
}`;
  const r = evalOk(src);
  assert.equal(r.get("widget bar.trade dollars")?.value, 100);
});

run("sku block: dotted refs across SKUs", () => {
  const src = `
sku widget bar {
  revenue = $1000
}
sku energy bar {
  revenue = $500
}
total = widget bar.revenue + energy bar.revenue`;
  const r = evalOk(src);
  assert.equal(r.get("total")?.value, 1500);
});

run("sku block: local shadows global", () => {
  const src = `
price = $1
sku premium {
  price = $5
  doubled = price + price
}`;
  const r = evalOk(src);
  assert.equal(r.get("premium.doubled")?.value, 10);
});

run("unclosed sku block errors", () => {
  const r = parseProgram("sku foo {\nbar = 1\n");
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

run("formats qty", () => {
  assert.equal(fmtQty({ value: 100, unit: { num: ["usd"], den: ["kg"] } }), "100 usd/kg");
  assert.equal(fmtQty({ value: 5, unit: { num: [], den: [] } }), "5");
});

run("parses sample file", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "examples", "sample.cogs"), "utf8");
  const r = evalOk(src);
  assert.equal(r.get("units per case")?.value, 96);
  assert.equal(r.get("labor total")?.value, 12222);
  assert.equal(r.get("fakemart units sold per week")?.value, 1600);
});

console.log("all tests passed");
