import { Result, err, ok } from "./CoreTypings";
import { Binding, Expr, Program, Qty, Unit } from "./CogsTypes";
import { parseUnit } from "./CogsUnits";
import { normalizeUnit } from "./UnitHelpers";

type OpCh = "+" | "-" | "*" | "/" | "(" | ")" | "@" | "," | "$";
type Tok =
  | { kind: "num"; value: number; pos: number }
  | { kind: "word"; value: string; pos: number }
  | { kind: "op"; value: OpCh; pos: number };

const OPS: Set<OpCh> = new Set(["+", "-", "*", "/", "(", ")", "@", ",", "$"]);

function lex(src: string): Result<Tok[], string> {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (isOpCh(c)) {
      out.push({ kind: "op", value: c, pos: i });
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = src.slice(i).match(/^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?|^\.[0-9]+([eE][+-]?[0-9]+)?/);
      if (!m) return err(`bad number at ${i}`);
      out.push({ kind: "num", value: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (!m) return err(`bad word at ${i}`);
      out.push({ kind: "word", value: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    return err(`unexpected '${c}' at ${i}`);
  }
  return ok(out);
}

function isOpCh(c: string): c is OpCh {
  return (OPS as Set<string>).has(c);
}

function stripComments(src: string): string {
  return src
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

function collapseSpaces(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

type Cursor = { toks: Tok[]; i: number };

function peek(c: Cursor, n = 0): Tok | null {
  return c.toks[c.i + n] ?? null;
}

function take(c: Cursor): Tok | null {
  const t = c.toks[c.i] ?? null;
  if (t) c.i += 1;
  return t;
}

function isOp(t: Tok | null, v: string): boolean {
  return !!t && t.kind === "op" && t.value === v;
}

function parseQty(c: Cursor): Result<Qty, string> {
  let currency = false;
  const t = peek(c);
  if (isOp(t, "$")) {
    currency = true;
    take(c);
  }
  const n = peek(c);
  if (!n || n.kind !== "num") return err(`expected number at ${n?.pos ?? "EOF"}`);
  take(c);
  const unitTokens: string[] = currency ? ["$"] : [];
  let lastWasDiv = false;
  while (true) {
    const p = peek(c);
    if (!p) break;
    if (p.kind === "op" && p.value === "/") {
      const nx = peek(c, 1);
      if (nx?.kind === "word") {
        unitTokens.push("/");
        take(c);
        lastWasDiv = true;
        continue;
      }
      break;
    }
    if (p.kind === "word") {
      if (p.value === "per") {
        const nx = peek(c, 1);
        if (nx?.kind === "word") {
          unitTokens.push("per");
          take(c);
          lastWasDiv = true;
          continue;
        }
        break;
      }
      if (lastWasDiv || unitTokens.length === 0 || unitTokens[unitTokens.length - 1] !== p.value) {
        unitTokens.push(p.value);
        take(c);
        lastWasDiv = false;
        continue;
      }
    }
    break;
  }
  const unit: Unit = parseUnit(unitTokens.join(" "));
  return ok({ value: n.value, unit });
}

function parseCallArgs(c: Cursor, names: Set<string>): Result<Expr[], string> {
  const open = take(c);
  if (!isOp(open, "(")) return err(`expected '(' at ${open?.pos ?? "EOF"}`);
  const args: Expr[] = [];
  if (isOp(peek(c), ")")) {
    take(c);
    return ok(args);
  }
  while (true) {
    const a = parseAddSub(c, names);
    if (!a.ok) return a;
    args.push(a.value);
    const nxt = peek(c);
    if (isOp(nxt, ",")) {
      take(c);
      continue;
    }
    if (isOp(nxt, ")")) {
      take(c);
      return ok(args);
    }
    return err(`expected ',' or ')' at ${nxt?.pos ?? "EOF"}`);
  }
}

function parseWordHead(c: Cursor, names: Set<string>): Result<Expr, string> {
  const first = peek(c);
  if (!first || first.kind !== "word") return err(`expected identifier at ${first?.pos ?? "EOF"}`);
  if (peek(c, 1)?.kind === "op" && (peek(c, 1) as Tok & { value: OpCh }).value === "(") {
    take(c);
    const args = parseCallArgs(c, names);
    if (!args.ok) return args;
    return ok({ kind: "call", name: first.value, args: args.value });
  }
  const startI = c.i;
  const words: string[] = [];
  while (peek(c)?.kind === "word") {
    words.push((take(c) as Tok & { kind: "word" }).value);
  }
  for (let n = words.length; n > 0; n -= 1) {
    const candidate = words.slice(0, n).join(" ");
    if (names.has(candidate)) {
      c.i = startI + n;
      return ok({ kind: "ref", name: candidate });
    }
  }
  return err(`unknown identifier '${words.join(" ")}'`);
}

function parseFactor(c: Cursor, names: Set<string>): Result<Expr, string> {
  const t = peek(c);
  if (!t) return err("unexpected end of expression");
  if (isOp(t, "-")) {
    take(c);
    const r = parseFactor(c, names);
    if (!r.ok) return r;
    return ok({ kind: "neg", expr: r.value });
  }
  if (isOp(t, "(")) {
    take(c);
    const inner = parseAddSub(c, names);
    if (!inner.ok) return inner;
    const close = take(c);
    if (!isOp(close, ")")) return err(`expected ')' at ${close?.pos ?? "EOF"}`);
    return inner;
  }
  if (t.kind === "num" || isOp(t, "$")) {
    const q = parseQty(c);
    if (!q.ok) return q;
    return ok({ kind: "qty", qty: q.value });
  }
  return parseWordHead(c, names);
}

function parseMulDiv(c: Cursor, names: Set<string>): Result<Expr, string> {
  const first = parseFactor(c, names);
  if (!first.ok) return first;
  let left: Expr = first.value;
  while (true) {
    const t = peek(c);
    if (!isOp(t, "*") && !isOp(t, "/")) break;
    const op = (take(c) as Tok).value as "*" | "/";
    const right = parseFactor(c, names);
    if (!right.ok) return right;
    left = { kind: "op", op, left, right: right.value };
  }
  return ok(left);
}

function parseAddSub(c: Cursor, names: Set<string>): Result<Expr, string> {
  const first = parseMulDiv(c, names);
  if (!first.ok) return first;
  let left: Expr = first.value;
  while (true) {
    const t = peek(c);
    if (!isOp(t, "+") && !isOp(t, "-")) break;
    const op = (take(c) as Tok).value as "+" | "-";
    const right = parseMulDiv(c, names);
    if (!right.ok) return right;
    left = { kind: "op", op, left, right: right.value };
  }
  return ok(left);
}

function parseTierBody(c: Cursor, names: Set<string>): Result<Expr, string> {
  const segments: { at: Qty; expr: Expr }[] = [];
  const first = parseAddSub(c, names);
  if (!first.ok) return first;
  if (!isOp(peek(c), "@")) return first;
  take(c);
  const firstAt = parseQty(c);
  if (!firstAt.ok) return firstAt;
  segments.push({ at: firstAt.value, expr: first.value });
  while (isOp(peek(c), ",")) {
    take(c);
    const expr = parseAddSub(c, names);
    if (!expr.ok) return expr;
    if (!isOp(peek(c), "@")) return err(`expected '@' after tier expression at ${peek(c)?.pos ?? "EOF"}`);
    take(c);
    const at = parseQty(c);
    if (!at.ok) return at;
    segments.push({ at: at.value, expr: expr.value });
  }
  segments.sort((a, b) => a.at.value - b.at.value);
  return ok({ kind: "tiers", tiers: segments });
}

function parseExprFrom(src: string, names: Set<string>): Result<Expr, string> {
  const lex0 = lex(src);
  if (!lex0.ok) return lex0;
  const c: Cursor = { toks: lex0.value, i: 0 };
  const e = parseTierBody(c, names);
  if (!e.ok) return e;
  if (c.i < c.toks.length) {
    return err(`unexpected token at ${c.toks[c.i].pos}`);
  }
  return e;
}

type RawLine = { name: string; rhs: string };

function classify(line: string): RawLine | null {
  const t = collapseSpaces(line);
  if (!t) return null;
  const eq = t.indexOf("=");
  if (eq < 0) return null;
  const name = collapseSpaces(t.slice(0, eq));
  const rhs = t.slice(eq + 1).trim();
  if (!name || !rhs) return null;
  return { name, rhs };
}

export function parseProgram(src: string): Result<Program, string> {
  const clean = stripComments(src);
  const lines = clean.split(/\n/).map(classify).filter(Boolean) as RawLine[];
  const names = new Set<string>();
  for (const ln of lines) {
    if (names.has(ln.name)) return err(`duplicate binding '${ln.name}'`);
    names.add(ln.name);
  }
  const bindings: Binding[] = [];
  for (const ln of lines) {
    const expr = parseExprFrom(ln.rhs, names);
    if (!expr.ok) return err(`in binding '${ln.name}': ${expr.error}`);
    bindings.push({ name: ln.name, expr: expr.value });
  }
  return ok({ bindings });
}

export { normalizeUnit };
