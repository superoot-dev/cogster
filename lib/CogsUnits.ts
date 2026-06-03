import { Result, err, ok } from "./CoreTypings";
import { Qty, Unit, DIMENSIONLESS } from "./CogsTypes";
import { UnitDimension, lookupUnit, normalizeUnit } from "./UnitHelpers";

export type Dims = Partial<Record<UnitDimension, number>>;

export function parseUnit(src: string): Unit {
  const s = src.trim();
  if (!s) return DIMENSIONLESS;
  const parts = s.split(/\s*(?:\/|\bper\b)\s*/i).filter(Boolean);
  const [head, ...rest] = parts;
  const num = splitTerms(head);
  const den = rest.flatMap(splitTerms);
  return { num: num.map(normalizeUnit), den: den.map(normalizeUnit) };
}

function splitTerms(seg: string): string[] {
  return seg
    .split(/[\s*·]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function unitDims(u: Unit): { dims: Dims; factor: number } {
  const dims: Dims = {};
  let factor = 1;
  for (const sym of u.num) {
    const def = lookupUnit(sym);
    if (!def) continue;
    dims[def.dim] = (dims[def.dim] ?? 0) + 1;
    factor *= def.toBase;
  }
  for (const sym of u.den) {
    const def = lookupUnit(sym);
    if (!def) continue;
    dims[def.dim] = (dims[def.dim] ?? 0) - 1;
    factor /= def.toBase;
  }
  return { dims: cleanDims(dims), factor };
}

function cleanDims(d: Dims): Dims {
  const out: Dims = {};
  for (const k of Object.keys(d) as UnitDimension[]) {
    if (d[k]) out[k] = d[k];
  }
  return out;
}

export function dimsEqual(a: Dims, b: Dims): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if ((a[k as UnitDimension] ?? 0) !== (b[k as UnitDimension] ?? 0)) return false;
  }
  return true;
}

export function mulQty(a: Qty, b: Qty): Result<Qty, string> {
  const unit: Unit = { num: [...a.unit.num, ...b.unit.num], den: [...a.unit.den, ...b.unit.den] };
  return ok(cancel({ value: a.value * b.value, unit }));
}

export function divQty(a: Qty, b: Qty): Result<Qty, string> {
  if (b.value === 0) return err("division by zero");
  const unit: Unit = { num: [...a.unit.num, ...b.unit.den], den: [...a.unit.den, ...b.unit.num] };
  return ok(cancel({ value: a.value / b.value, unit }));
}

export function cancel(q: Qty): Qty {
  const num = [...q.unit.num];
  const den = [...q.unit.den];
  let value = q.value;
  for (let i = num.length - 1; i >= 0; i -= 1) {
    const ndef = lookupUnit(num[i]);
    if (!ndef) continue;
    for (let j = den.length - 1; j >= 0; j -= 1) {
      const ddef = lookupUnit(den[j]);
      if (!ddef) continue;
      if (ndef.dim !== ddef.dim) continue;
      value *= ndef.toBase / ddef.toBase;
      num.splice(i, 1);
      den.splice(j, 1);
      break;
    }
  }
  return { value, unit: { num, den } };
}

export function addQty(a: Qty, b: Qty): Result<Qty, string> {
  const da = unitDims(a.unit);
  const db = unitDims(b.unit);
  if (!dimsEqual(da.dims, db.dims)) {
    return err(`cannot add ${fmtUnit(a.unit) || "1"} + ${fmtUnit(b.unit) || "1"}: dimension mismatch`);
  }
  const bInA = (b.value * db.factor) / da.factor;
  return ok({ value: a.value + bInA, unit: a.unit });
}

export function subQty(a: Qty, b: Qty): Result<Qty, string> {
  return addQty(a, { value: -b.value, unit: b.unit });
}

export function negQty(a: Qty): Qty {
  return { value: -a.value, unit: a.unit };
}

const UNIT_SYMBOL: Record<string, string> = { usd: "$" };
const sym = (t: string) => UNIT_SYMBOL[t] ?? t;

export function fmtUnit(u: Unit): string {
  if (u.num.length === 0 && u.den.length === 0) return "";
  const n = u.num.length ? u.num.map(sym).join("·") : "1";
  if (u.den.length === 0) return n;
  return `${n}/${u.den.map(sym).join("·")}`;
}

export function fmtQty(q: Qty): string {
  const u = fmtUnit(q.unit);
  return u ? `${q.value} ${u}` : `${q.value}`;
}
