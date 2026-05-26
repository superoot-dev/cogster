// Excel-style aliases for the expression baselib. Lets users coming from
// spreadsheets write `IF(x > 0, x, 0)` or `SUM(a, b, c)` instead of the
// native ternary and camelCase forms. Each alias forwards to an existing
// function (or wraps a small implementation) — no behavior changes for
// callers using the canonical names.

import { SerialValue } from "../CoreTypings";
import { isTruthy } from "../EvalCasting";
import { Method, num, P } from "./FunctionHelpers";
import { mathFunctions } from "./MathFunctions";

function flat(args: unknown[]): number[] {
  const out: number[] = [];
  for (const a of args) {
    if (Array.isArray(a)) {
      for (const x of flat(a)) out.push(x);
    } else if (a !== null && a !== undefined && a !== "") {
      const n = num(a as P);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

function flatTruthy(args: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const a of args) {
    if (Array.isArray(a)) for (const x of flatTruthy(a)) out.push(x);
    else out.push(a);
  }
  return out;
}

const SUM = (...args: unknown[]) => flat(args).reduce((s, x) => s + x, 0);

const PRODUCT = (...args: unknown[]) => {
  const xs = flat(args);
  return xs.reduce((p, x) => p * x, 1);
};

const COUNT = (...args: unknown[]) => flat(args).length;

const COUNTA = (...args: unknown[]) => flatTruthy(args).filter((v) => v !== null && v !== undefined && v !== "").length;

const AVERAGE = (...args: unknown[]) => {
  const xs = flat(args);
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
};

const MEDIAN = (...args: unknown[]) => {
  const xs = flat(args).slice().sort((a, b) => a - b);
  if (xs.length === 0) return 0;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
};

const MIN = (...args: unknown[]) => {
  const xs = flat(args);
  return xs.length === 0 ? 0 : Math.min(...xs);
};

const MAX = (...args: unknown[]) => {
  const xs = flat(args);
  return xs.length === 0 ? 0 : Math.max(...xs);
};

const IF = (cond: unknown, then: SerialValue, otherwise: SerialValue = null) =>
  isTruthy(cond) ? then : otherwise;

// Multi-branch IF: IFS(cond1, val1, cond2, val2, ..., [default])
const IFS = (...args: unknown[]): SerialValue => {
  for (let i = 0; i + 1 < args.length; i += 2) {
    if (isTruthy(args[i])) return args[i + 1] as SerialValue;
  }
  if (args.length % 2 === 1) return args[args.length - 1] as SerialValue;
  return null;
};

const AND = (...args: unknown[]) => flatTruthy(args).every((v) => isTruthy(v));
const OR = (...args: unknown[]) => flatTruthy(args).some((v) => isTruthy(v));
const NOT = (v: unknown) => !isTruthy(v);
const XOR = (...args: unknown[]) => flatTruthy(args).filter((v) => isTruthy(v)).length % 2 === 1;

// IFERROR / IFNA: if value is non-finite or null, return fallback.
const IFERROR = (value: unknown, fallback: SerialValue) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number" && !Number.isFinite(value)) return fallback;
  return value as SerialValue;
};
const IFNA = IFERROR;

// Rounding. Excel CEILING/FLOOR take an optional `significance` arg
// (round to multiple of). Default 1.
const CEILING = (v: unknown, significance: unknown = 1) => {
  const sig = num(significance as P) || 1;
  return Math.ceil(num(v as P) / sig) * sig;
};
const FLOOR = (v: unknown, significance: unknown = 1) => {
  const sig = num(significance as P) || 1;
  return Math.floor(num(v as P) / sig) * sig;
};
const ROUND = (v: unknown, digits: unknown = 0) => {
  const d = Math.trunc(num(digits as P));
  const f = Math.pow(10, d);
  return Math.round(num(v as P) * f) / f;
};
const ROUNDUP = (v: unknown, digits: unknown = 0) => {
  const d = Math.trunc(num(digits as P));
  const f = Math.pow(10, d);
  const x = num(v as P);
  return (x >= 0 ? Math.ceil(x * f) : Math.floor(x * f)) / f;
};
const ROUNDDOWN = (v: unknown, digits: unknown = 0) => {
  const d = Math.trunc(num(digits as P));
  const f = Math.pow(10, d);
  const x = num(v as P);
  return (x >= 0 ? Math.floor(x * f) : Math.ceil(x * f)) / f;
};
const INT = (v: unknown) => Math.floor(num(v as P));
const TRUNC = (v: unknown, digits: unknown = 0) => {
  const d = Math.trunc(num(digits as P));
  const f = Math.pow(10, d);
  return Math.trunc(num(v as P) * f) / f;
};
const MOD = (a: unknown, b: unknown) => {
  const nb = num(b as P);
  if (nb === 0) return 0;
  return num(a as P) - nb * Math.floor(num(a as P) / nb);
};
const POWER = (base: unknown, exp: unknown) => Math.pow(num(base as P), num(exp as P));
const SQRT = (v: unknown) => Math.sqrt(num(v as P));
const EXP = (v: unknown) => Math.exp(num(v as P));
const LN = (v: unknown) => Math.log(num(v as P));
const LOG10 = (v: unknown) => Math.log10(num(v as P));
const LOG = (v: unknown, base: unknown = 10) => Math.log(num(v as P)) / Math.log(num(base as P));
const ABS = (v: unknown) => Math.abs(num(v as P));
const SIGN = (v: unknown) => Math.sign(num(v as P));
const PI = () => Math.PI;

// Math/stats forwards (use canonical implementations).
const STDEV = mathFunctions.getStdDev;
const VAR = mathFunctions.getVariance;
const CLAMP = mathFunctions.clamp;

export const excelAliases: Record<string, Method> = {
  IF,
  IFS,
  AND,
  OR,
  NOT,
  XOR,
  IFERROR,
  IFNA,
  SUM,
  PRODUCT,
  COUNT,
  COUNTA,
  AVERAGE,
  AVG: AVERAGE,
  MEDIAN,
  MIN,
  MAX,
  ABS,
  ROUND,
  ROUNDUP,
  ROUNDDOWN,
  INT,
  TRUNC,
  CEILING,
  FLOOR,
  MOD,
  POWER,
  SQRT,
  EXP,
  LN,
  LOG,
  LOG10,
  SIGN,
  PI,
  STDEV,
  VAR,
  CLAMP,
};
