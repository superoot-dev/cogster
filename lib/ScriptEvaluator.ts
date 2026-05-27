import { SerialValue } from "./CoreTypings";
import { castToNumber, isTruthy } from "./EvalCasting";
import { arrayFunctions } from "./functions/ArrayFunctions";
import { dateFunctions } from "./functions/DateFunctions";
import { excelAliases } from "./functions/ExcelAliases";
import { mathFunctions } from "./functions/MathFunctions";
import { stringFunctions } from "./functions/StringFunctions";
import { unifiedFunctions } from "./functions/UnifiedFunctions";

export type ExprEvalFunc = (...args: SerialValue[]) => SerialValue;

const BASELIB: Record<string, ExprEvalFunc> = {};
for (const key in arrayFunctions) BASELIB[key] = arrayFunctions[key];
for (const key in stringFunctions) BASELIB[key] = stringFunctions[key];
for (const key in unifiedFunctions) BASELIB[key] = unifiedFunctions[key];
for (const key in mathFunctions) BASELIB[key] = mathFunctions[key];
for (const key in dateFunctions) BASELIB[key] = dateFunctions[key];
for (const key in excelAliases) BASELIB[key] = excelAliases[key];

export function buildEvalFunctions(extras: Record<string, ExprEvalFunc> = {}) {
  return { ...BASELIB, ...extras };
}

const n = castToNumber;

export const STDLIB: Record<string, ExprEvalFunc> = {
  add: (a, b) => n(a) + n(b),
  sub: (a, b) => n(a) - n(b),
  mul: (a, b) => n(a) * n(b),
  div: (a, b) => n(a) / n(b),
  mod: (a, b) => n(a) % n(b),
  pow: (a, b) => n(a) ** n(b),
  sqrt: (a) => Math.sqrt(n(a)),
  log: (a) => Math.log(n(a)),
  exp: (a) => Math.exp(n(a)),
  min: (a, b) => Math.min(n(a), n(b)),
  max: (a, b) => Math.max(n(a), n(b)),
  abs: (a) => Math.abs(n(a)),
  floor: (a) => Math.floor(n(a)),
  ceil: (a) => Math.ceil(n(a)),
  round: (a) => Math.round(n(a)),
  negate: (a) => -n(a),
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
  lt: (a, b) => n(a) < n(b),
  gt: (a, b) => n(a) > n(b),
  lte: (a, b) => n(a) <= n(b),
  gte: (a, b) => n(a) >= n(b),
  not: (a) => !isTruthy(a),
};
