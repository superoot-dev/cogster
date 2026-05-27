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

run("parses charts", () => {
  const src = "a = 1\nb = 2\n[a, b] as pie";
  const p = parseOk(src);
  assert.equal(p.charts.length, 1);
  assert.deepEqual(p.charts[0].refs, ["a", "b"]);
  assert.equal(p.charts[0].as, "pie");
});

run("parses chart time range", () => {
  const src = "a = 1\n[a] from 2026-01-01 to 2026-12-31 per month as line";
  const p = parseOk(src);
  const c = p.charts[0];
  assert.equal(c.range.from, "2026-01-01");
  assert.equal(c.range.to, "2026-12-31");
  assert.equal(c.range.per, "month");
  assert.equal(c.as, "line");
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
