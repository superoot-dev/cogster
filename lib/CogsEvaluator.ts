import { Result, err, ok } from "./CoreTypings";
import { Binding, Expr, Program, Qty } from "./CogsTypes";
import { addQty, divQty, mulQty, negQty, subQty } from "./CogsUnits";

export type Env = {
  bindings: Map<string, Binding>;
  cache: Map<string, Qty>;
  stack: Set<string>;
};

export function makeEnv(prog: Program): Env {
  const bindings = new Map<string, Binding>();
  for (const b of prog.bindings) bindings.set(b.name, b);
  return { bindings, cache: new Map(), stack: new Set() };
}

export function evalExpr(expr: Expr, env: Env): Result<Qty, string> {
  if (expr.kind === "qty") return ok(expr.qty);
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
    return ok(negQty(r.value));
  }
  if (expr.kind === "op") {
    const l = evalExpr(expr.left, env);
    if (!l.ok) return l;
    const r = evalExpr(expr.right, env);
    if (!r.ok) return r;
    if (expr.op === "+") return addQty(l.value, r.value);
    if (expr.op === "-") return subQty(l.value, r.value);
    if (expr.op === "*") return mulQty(l.value, r.value);
    return divQty(l.value, r.value);
  }
  if (expr.tiers.length === 0) return err("empty tier expression");
  return evalExpr(expr.tiers[0].expr, env);
}

export function evalProgram(prog: Program): Result<Map<string, Qty>, string> {
  const env = makeEnv(prog);
  for (const b of prog.bindings) {
    const r = evalExpr({ kind: "ref", name: b.name }, env);
    if (!r.ok) return err(`in '${b.name}': ${r.error}`);
  }
  return ok(env.cache);
}
