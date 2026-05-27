import { Result, err, ok } from "./CoreTypings";
import { AggOp, Axis, BranchCase, Binding, Expr, Program, Qty, TagSet, Unit } from "./CogsTypes";
import { parseUnit } from "./CogsUnits";

type OpCh = "+" | "-" | "*" | "/" | "(" | ")" | "@" | "," | "$" | ":";
type Tok =
  | { kind: "num"; value: number; pos: number }
  | { kind: "word"; value: string; pos: number }
  | { kind: "op"; value: OpCh; pos: number };

const OPS: Set<OpCh> = new Set(["+", "-", "*", "/", "(", ")", "@", ",", "$", ":"]);
const AGG_OPS: Record<string, AggOp> = { sum: "sum", avg: "avg", min: "min", max: "max" };
const RESERVED_WORDS = new Set(["axis", "over", "sum", "avg", "min", "max"]);

function lex(src: string): Result<Tok[], string> {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = src.slice(i).match(/^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?|^\.[0-9]+([eE][+-]?[0-9]+)?/);
      if (!m) return err(`bad number at ${i}`);
      out.push({ kind: "num", value: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (isOpCh(c)) {
      out.push({ kind: "op", value: c, pos: i });
      i += 1;
      continue;
    }
    if (c === "_" || /[A-Za-z]/.test(c)) {
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

function isWord(t: Tok | null, v: string): boolean {
  return !!t && t.kind === "word" && t.value === v;
}

type Ctx = {
  names: Set<string>;
  axes: Map<string, Set<string>>;
  tagToAxis: Map<string, string>;
};

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
      if (nx?.kind === "word" && !RESERVED_WORDS.has(nx.value)) {
        unitTokens.push("/");
        take(c);
        lastWasDiv = true;
        continue;
      }
      break;
    }
    if (p.kind === "word") {
      if (RESERVED_WORDS.has(p.value)) break;
      if (p.value === "per") {
        const nx = peek(c, 1);
        if (nx?.kind === "word" && !RESERVED_WORDS.has(nx.value)) {
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

function parseCallArgs(c: Cursor, ctx: Ctx): Result<Expr[], string> {
  const open = take(c);
  if (!isOp(open, "(")) return err(`expected '(' at ${open?.pos ?? "EOF"}`);
  const args: Expr[] = [];
  if (isOp(peek(c), ")")) {
    take(c);
    return ok(args);
  }
  while (true) {
    const a = parseAddSub(c, ctx);
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

function collectWords(c: Cursor, stopAt: (t: Tok) => boolean): string[] {
  const words: string[] = [];
  while (true) {
    const t = peek(c);
    if (!t) break;
    if (t.kind !== "word") break;
    if (RESERVED_WORDS.has(t.value)) break;
    if (stopAt(t)) break;
    words.push(t.value);
    take(c);
  }
  return words;
}

function parseRefName(c: Cursor, ctx: Ctx): { name: string } | null {
  const startI = c.i;
  const words = collectWords(c, () => false);
  for (let n = words.length; n > 0; n -= 1) {
    const candidate = words.slice(0, n).join(" ");
    if (ctx.names.has(candidate)) {
      c.i = startI + n;
      return { name: candidate };
    }
  }
  c.i = startI;
  return null;
}

type TagParse = { kind: "wildcard" } | { kind: "tag"; axis: string; value: string } | { kind: "axis"; name: string };

function parseTagAfterColon(c: Cursor, ctx: Ctx): Result<TagParse, string> {
  const colon = take(c);
  if (!colon || !isOp(colon, ":")) return err(`expected ':' at ${colon?.pos ?? "EOF"}`);
  const next = peek(c);
  if (next && next.pos !== colon.pos + 1) {
    return err(`no space allowed after ':' at ${colon.pos}`);
  }
  if (isOp(next, "*")) {
    take(c);
    return ok({ kind: "wildcard" });
  }
  const startI = c.i;
  const words = collectWords(c, () => false);
  if (words.length === 0) return err(`expected tag after ':' at ${peek(c)?.pos ?? "EOF"}`);
  for (let n = words.length; n > 0; n -= 1) {
    const candidate = words.slice(0, n).join(" ");
    const ax = ctx.tagToAxis.get(candidate);
    if (ax) {
      c.i = startI + n;
      return ok({ kind: "tag", axis: ax, value: candidate });
    }
    if (ctx.axes.has(candidate)) {
      c.i = startI + n;
      return ok({ kind: "axis", name: candidate });
    }
  }
  return err(`unknown tag or axis '${words.join(" ")}'`);
}

function parseSelectorTags(c: Cursor, ctx: Ctx): Result<TagSet, string> {
  const filter: TagSet = {};
  while (isOp(peek(c), ":")) {
    const t = parseTagAfterColon(c, ctx);
    if (!t.ok) return t;
    if (t.value.kind !== "tag") return err(`selector expects tag values, got ${t.value.kind}`);
    if (!filter[t.value.axis]) filter[t.value.axis] = [];
    filter[t.value.axis].push(t.value.value);
  }
  return ok(filter);
}

function parseAxisList(c: Cursor, ctx: Ctx): Result<string[], string> {
  const axes: string[] = [];
  while (isOp(peek(c), ":")) {
    const t = parseTagAfterColon(c, ctx);
    if (!t.ok) return t;
    if (t.value.kind !== "axis") return err(`aggregation expects axis names, got ${t.value.kind === "tag" ? `tag '${t.value.value}'` : "wildcard"}`);
    axes.push(t.value.name);
  }
  if (axes.length === 0) return err("expected at least one ':axis' after 'over'");
  return ok(axes);
}

function parseAggregation(c: Cursor, ctx: Ctx, op: AggOp): Result<Expr, string> {
  const inner = parseFactor(c, ctx);
  if (!inner.ok) return inner;
  const overTok = peek(c);
  if (!isWord(overTok, "over")) return err(`expected 'over' after aggregated expression at ${overTok?.pos ?? "EOF"}`);
  take(c);
  const axes = parseAxisList(c, ctx);
  if (!axes.ok) return axes;
  return ok({ kind: "aggregate", op, expr: inner.value, axes: axes.value });
}

function parseFactor(c: Cursor, ctx: Ctx): Result<Expr, string> {
  const t = peek(c);
  if (!t) return err("unexpected end of expression");
  if (isOp(t, "-")) {
    take(c);
    const r = parseFactor(c, ctx);
    if (!r.ok) return r;
    return ok({ kind: "neg", expr: r.value });
  }
  if (isOp(t, "(")) {
    take(c);
    const inner = parseAddSub(c, ctx);
    if (!inner.ok) return inner;
    const close = take(c);
    if (!isOp(close, ")")) return err(`expected ')' at ${close?.pos ?? "EOF"}`);
    return wrapWithSelector(c, ctx, inner.value);
  }
  if (t.kind === "num" || isOp(t, "$")) {
    const q = parseQty(c);
    if (!q.ok) return q;
    return ok({ kind: "qty", qty: q.value });
  }
  if (t.kind === "word") {
    const next = peek(c, 1);
    if (next?.kind === "op" && next.value === "(") {
      take(c);
      const args = parseCallArgs(c, ctx);
      if (!args.ok) return args;
      return wrapWithSelector(c, ctx, { kind: "call", name: t.value, args: args.value });
    }
    if (t.value in AGG_OPS) {
      take(c);
      return parseAggregation(c, ctx, AGG_OPS[t.value]);
    }
    const ref = parseRefName(c, ctx);
    if (!ref) {
      const probe = collectWords({ toks: c.toks, i: c.i }, () => false);
      return err(`unknown identifier '${probe.join(" ")}' at ${t.pos}`);
    }
    return wrapWithSelector(c, ctx, { kind: "ref", name: ref.name });
  }
  return err(`unexpected token at ${t.pos}`);
}

function wrapWithSelector(c: Cursor, ctx: Ctx, expr: Expr): Result<Expr, string> {
  if (!isOp(peek(c), ":")) return ok(expr);
  const f = parseSelectorTags(c, ctx);
  if (!f.ok) return f;
  if (Object.keys(f.value).length === 0) return ok(expr);
  return ok({ kind: "select", expr, filter: f.value });
}

function parseMulDiv(c: Cursor, ctx: Ctx): Result<Expr, string> {
  const first = parseFactor(c, ctx);
  if (!first.ok) return first;
  let left: Expr = first.value;
  while (true) {
    const t = peek(c);
    if (!isOp(t, "*") && !isOp(t, "/")) break;
    const op = (take(c) as Tok).value as "*" | "/";
    const right = parseFactor(c, ctx);
    if (!right.ok) return right;
    left = { kind: "op", op, left, right: right.value };
  }
  return ok(left);
}

function parseAddSub(c: Cursor, ctx: Ctx): Result<Expr, string> {
  const first = parseMulDiv(c, ctx);
  if (!first.ok) return first;
  let left: Expr = first.value;
  while (true) {
    const t = peek(c);
    if (!isOp(t, "+") && !isOp(t, "-")) break;
    const op = (take(c) as Tok).value as "+" | "-";
    const right = parseMulDiv(c, ctx);
    if (!right.ok) return right;
    left = { kind: "op", op, left, right: right.value };
  }
  return ok(left);
}

function parseTierBody(c: Cursor, ctx: Ctx): Result<Expr, string> {
  const segments: { at: Qty; expr: Expr }[] = [];
  const first = parseAddSub(c, ctx);
  if (!first.ok) return first;
  if (!isOp(peek(c), "@")) return first;
  take(c);
  const firstAt = parseQty(c);
  if (!firstAt.ok) return firstAt;
  segments.push({ at: firstAt.value, expr: first.value });
  while (isOp(peek(c), ",")) {
    take(c);
    const expr = parseAddSub(c, ctx);
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

function parseExprFrom(src: string, ctx: Ctx): Result<Expr, string> {
  const lex0 = lex(src);
  if (!lex0.ok) return lex0;
  const c: Cursor = { toks: lex0.value, i: 0 };
  const e = parseTierBody(c, ctx);
  if (!e.ok) return e;
  if (c.i < c.toks.length) {
    return err(`unexpected token at ${c.toks[c.i].pos}`);
  }
  return e;
}

function parseBranchTags(src: string, ctx: Ctx): Result<{ tags: TagSet; rest: string }, string> {
  const lex0 = lex(src);
  if (!lex0.ok) return lex0;
  const c: Cursor = { toks: lex0.value, i: 0 };
  const tags: TagSet = {};
  while (isOp(peek(c), ":")) {
    const t = parseTagAfterColon(c, ctx);
    if (!t.ok) return t;
    if (t.value.kind === "axis") {
      return err(`branch tag expects a value, got axis name '${t.value.name}'`);
    }
    if (t.value.kind === "tag") {
      if (!tags[t.value.axis]) tags[t.value.axis] = [];
      tags[t.value.axis].push(t.value.value);
    }
  }
  const remaining = src.slice(c.toks[c.i]?.pos ?? src.length);
  return ok({ tags, rest: remaining });
}

type RawAxis = { name: string; values: string[] };
type RawBinding = { name: string; rhs: string; branches: string[] };

function isBranchLine(line: string): boolean {
  return line.trimStart().startsWith(":");
}

function parseAxisLine(line: string): Result<RawAxis, string> {
  const m = line.match(/^axis\s+(.+?)\s*=\s*(.+)$/);
  if (!m) return err(`bad axis declaration: '${line}'`);
  const name = collapseSpaces(m[1]);
  const valsStr = m[2].trim();
  if (!valsStr.startsWith(":")) return err(`axis '${name}' values must start with ':', got '${valsStr}'`);
  const raw = valsStr.split(":").slice(1);
  const parts: string[] = [];
  for (const p of raw) {
    if (/^\s/.test(p)) return err(`axis '${name}': no space allowed after ':'`);
    const v = collapseSpaces(p);
    if (v) parts.push(v);
  }
  if (parts.length === 0) return err(`axis '${name}' has no values`);
  return ok({ name, values: parts });
}

type ScanResult = { axes: RawAxis[]; bindings: RawBinding[] };

function scanLines(src: string): Result<ScanResult, string> {
  const clean = stripComments(src);
  const lines = clean.split("\n");
  const axes: RawAxis[] = [];
  const bindings: RawBinding[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }
    if (trimmed.startsWith("axis ")) {
      const ax = parseAxisLine(trimmed);
      if (!ax.ok) return ax;
      axes.push(ax.value);
      i += 1;
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      return err(`unrecognized line (expected 'name = expr' or 'axis name = :tag :tag'): '${trimmed}'`);
    }
    const name = collapseSpaces(trimmed.slice(0, eq));
    const rhs = trimmed.slice(eq + 1).trim();
    const branches: string[] = [];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      if (!next.trim()) {
        i += 1;
        continue;
      }
      if (!isBranchLine(next)) break;
      branches.push(next.trim());
      i += 1;
    }
    if (!name || (!rhs && branches.length === 0)) {
      return err(`bad binding at '${name || trimmed}'`);
    }
    bindings.push({ name, rhs, branches });
  }
  return ok({ axes, bindings });
}

function buildCtx(scan: ScanResult): Result<Ctx, string> {
  const axes = new Map<string, Set<string>>();
  const tagToAxis = new Map<string, string>();
  for (const ax of scan.axes) {
    if (axes.has(ax.name)) return err(`duplicate axis '${ax.name}'`);
    axes.set(ax.name, new Set(ax.values));
    for (const v of ax.values) {
      if (tagToAxis.has(v)) return err(`tag '${v}' belongs to multiple axes`);
      tagToAxis.set(v, ax.name);
    }
  }
  const names = new Set<string>();
  for (const b of scan.bindings) {
    if (names.has(b.name)) return err(`duplicate binding '${b.name}'`);
    names.add(b.name);
  }
  return ok({ names, axes, tagToAxis });
}

export function parseProgram(src: string): Result<Program, string> {
  const scan = scanLines(src);
  if (!scan.ok) return scan;
  const ctxR = buildCtx(scan.value);
  if (!ctxR.ok) return ctxR;
  const ctx = ctxR.value;
  const axes: Axis[] = scan.value.axes.map((a) => ({ name: a.name, values: a.values }));
  const bindings: Binding[] = [];
  for (const b of scan.value.bindings) {
    if (b.branches.length === 0) {
      const expr = parseExprFrom(b.rhs, ctx);
      if (!expr.ok) return err(`in binding '${b.name}': ${expr.error}`);
      bindings.push({ name: b.name, expr: expr.value });
      continue;
    }
    const cases: BranchCase[] = [];
    if (b.rhs) {
      const expr = parseExprFrom(b.rhs, ctx);
      if (!expr.ok) return err(`in binding '${b.name}': ${expr.error}`);
      cases.push({ tags: {}, expr: expr.value });
    }
    for (const br of b.branches) {
      const tagP = parseBranchTags(br, ctx);
      if (!tagP.ok) return err(`in branch of '${b.name}': ${tagP.error}`);
      if (!tagP.value.rest.trim()) {
        return err(`in branch of '${b.name}': empty value`);
      }
      const expr = parseExprFrom(tagP.value.rest, ctx);
      if (!expr.ok) return err(`in branch of '${b.name}': ${expr.error}`);
      cases.push({ tags: tagP.value.tags, expr: expr.value });
    }
    bindings.push({ name: b.name, expr: { kind: "branches", cases } });
  }
  return ok({ axes, bindings });
}
