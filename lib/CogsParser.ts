import { Result, err, ok } from "./CoreTypings";
import { Binding, Chart, ChartKind, Expr, Program, Qty, Range, TimeUnitSchema, Unit } from "./CogsTypes";
import { parseUnit } from "./CogsUnits";
import { normalizeUnit } from "./UnitHelpers";

type OpCh = "+" | "-" | "*" | "/" | "(" | ")" | "@" | "," | "[" | "]" | "$";
type Tok =
  | { kind: "num"; value: number; pos: number }
  | { kind: "word"; value: string; pos: number }
  | { kind: "op"; value: OpCh; pos: number };

const OPS: Set<OpCh> = new Set(["+", "-", "*", "/", "(", ")", "@", ",", "[", "]", "$"]);

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

const RATE_TIME_WORDS = new Set(["hour", "day", "week", "month", "year"]);

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

function parseRef(c: Cursor, names: Set<string>): Result<Expr, string> {
  const startI = c.i;
  const words: string[] = [];
  while (peek(c)?.kind === "word") {
    words.push((take(c) as Tok & { kind: "word" }).value);
  }
  if (words.length === 0) return err(`expected identifier at ${peek(c)?.pos ?? "EOF"}`);
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
  return parseRef(c, names);
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
    return err(`unexpected '${c.toks[c.i].kind === "op" ? (c.toks[c.i] as { value: string }).value : c.toks[c.i].kind}' at ${c.toks[c.i].pos}`);
  }
  return e;
}

function parseChart(line: string, names: Set<string>): Result<Chart, string> {
  const close = findTopClose(line);
  if (close < 0) return err("unterminated '['");
  const inside = line.slice(1, close);
  const tail = line.slice(close + 1);
  const refs = inside
    .split(",")
    .map(collapseSpaces)
    .filter(Boolean);
  for (const r of refs) {
    if (!names.has(r)) return err(`unknown reference '${r}' in chart`);
  }
  const range = parseRangeTail(tail);
  if (!range.ok) return range;
  return ok({ refs, range: range.value.range, as: range.value.as });
}

function findTopClose(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "[") depth += 1;
    else if (s[i] === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseRangeTail(tail: string): Result<{ range: Range; as: ChartKind | null }, string> {
  const range: Range = { from: null, to: null, per: null };
  let as: ChartKind | null = null;
  const t = collapseSpaces(tail);
  if (!t) return ok({ range, as });
  const words = t.split(" ");
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (w === "from" && i + 1 < words.length) {
      range.from = words[i + 1];
      i += 2;
      continue;
    }
    if (w === "to" && i + 1 < words.length) {
      range.to = words[i + 1];
      i += 2;
      continue;
    }
    if (w === "per" && i + 1 < words.length) {
      const parsed = TimeUnitSchema.safeParse(normalizeUnit(words[i + 1]));
      if (!parsed.success) return err(`bad 'per' time unit '${words[i + 1]}'`);
      range.per = parsed.data;
      i += 2;
      continue;
    }
    if (w === "as" && i + 1 < words.length) {
      const kind = words[i + 1];
      if (kind !== "pie" && kind !== "line" && kind !== "bar") return err(`bad chart kind '${kind}'`);
      as = kind;
      i += 2;
      continue;
    }
    return err(`unexpected '${w}' in chart tail`);
  }
  return ok({ range, as });
}

type RawLine = { kind: "binding"; name: string; rhs: string } | { kind: "chart"; src: string };

function classify(line: string): RawLine | null {
  const t = collapseSpaces(line);
  if (!t) return null;
  if (t.startsWith("[")) return { kind: "chart", src: t };
  const eq = t.indexOf("=");
  if (eq < 0) return null;
  const name = collapseSpaces(t.slice(0, eq));
  const rhs = t.slice(eq + 1).trim();
  if (!name || !rhs) return null;
  return { kind: "binding", name, rhs };
}

export function parseProgram(src: string): Result<Program, string> {
  const clean = stripComments(src);
  const lines = clean.split(/\n/).map(classify).filter(Boolean) as RawLine[];
  const names = new Set<string>();
  for (const ln of lines) {
    if (ln.kind === "binding") {
      if (names.has(ln.name)) return err(`duplicate binding '${ln.name}'`);
      names.add(ln.name);
    }
  }
  const bindings: Binding[] = [];
  const charts: Chart[] = [];
  for (const ln of lines) {
    if (ln.kind === "binding") {
      const expr = parseExprFrom(ln.rhs, names);
      if (!expr.ok) return err(`in binding '${ln.name}': ${expr.error}`);
      bindings.push({ name: ln.name, expr: expr.value });
    } else {
      const ch = parseChart(ln.src, names);
      if (!ch.ok) return ch;
      charts.push(ch.value);
    }
  }
  return ok({ bindings, charts });
}
