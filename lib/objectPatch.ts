type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

export type PatchOp =
  | { op: "set_path"; path: string; value: Json }
  | { op: "remove_path"; path: string }
  | { op: "add_item"; path: string; value: Json }
  | { op: "move_item"; path: string; from: number; to: number }
  | { op: "set_paths"; entries: Array<{ path: string; value: Json }> }
  | { op: "rename_id"; collection: string; from: string; to: string };

const ID_REF_KEYS = new Set([
  "product",
  "channel",
  "department",
  "trade_plan",
  "output_product",
  "ingredient",
  "recipe",
  "packaging",
  "processing",
]);

export type PatchResult = { ok: true; root: Obj } | { ok: false; error: string };

export function applyPatch(root: Obj, patch: PatchOp): PatchResult {
  if (patch.op === "set_paths") {
    return applyPatches(root, patch.entries.map((e) => ({ op: "set_path" as const, path: e.path, value: e.value })));
  }
  if (patch.op === "rename_id") {
    return applyRenameId(root, patch);
  }
  const segments = parsePath(patch.path);
  if (!segments) return { ok: false, error: `Invalid path: ${patch.path}` };
  const next = clone(root);
  if (patch.op === "set_path") {
    const err = setAt(next, segments, patch.value);
    return err ? { ok: false, error: err } : { ok: true, root: next };
  }
  if (patch.op === "remove_path") {
    const err = removeAt(next, segments);
    return err ? { ok: false, error: err } : { ok: true, root: next };
  }
  if (patch.op === "move_item") {
    const err = moveItemAt(next, segments, patch.from, patch.to);
    return err ? { ok: false, error: err } : { ok: true, root: next };
  }
  const err = addItemAt(next, segments, patch.value);
  return err ? { ok: false, error: err } : { ok: true, root: next };
}

export function getPath(root: Obj, path: string): Json | undefined {
  const segs = parsePath(path);
  if (!segs) return undefined;
  let cur: Json = root;
  for (const seg of segs) {
    const next = getChild(cur, seg);
    if (next === undefined) return undefined;
    cur = next;
  }
  return cur;
}

export function applyPatches(root: Obj, patches: PatchOp[]): PatchResult {
  let cur = root;
  for (const p of patches) {
    const r = applyPatch(cur, p);
    if (!r.ok) return r;
    cur = r.root;
  }
  return { ok: true, root: cur };
}

type Seg = { kind: "key"; key: string } | { kind: "index"; index: number } | { kind: "find"; id: string };

function parsePath(path: string): Seg[] | null {
  if (!path) return null;
  const out: Seg[] = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === "[") {
      const end = path.indexOf("]", i);
      if (end === -1) return null;
      const inner = path.slice(i + 1, end);
      if (inner.startsWith("find:")) out.push({ kind: "find", id: inner.slice(5) });
      else {
        const n = Number(inner);
        if (!Number.isInteger(n) || n < 0) return null;
        out.push({ kind: "index", index: n });
      }
      i = end + 1;
      if (path[i] === ".") i++;
      continue;
    }
    let end = i;
    while (end < path.length && path[end] !== "." && path[end] !== "[") end++;
    const key = path.slice(i, end);
    if (!key) return null;
    out.push({ kind: "key", key });
    i = end;
    if (path[i] === ".") i++;
  }
  return out;
}

function setAt(root: Obj, segs: Seg[], value: Json): string | null {
  if (segs.length === 0) return "Empty path";
  let cur: Json = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    const nextSeg = segs[i + 1];
    const child = getChild(cur, seg);
    if (child === undefined) {
      if (seg.kind !== "key") return `Cannot create array element at ${describeSeg(seg)}`;
      const created: Json = nextSeg.kind === "key" ? {} : [];
      (cur as Obj)[seg.key] = created;
      cur = created;
      continue;
    }
    cur = child;
  }
  const last = segs[segs.length - 1];
  return setChild(cur, last, value);
}

function removeAt(root: Obj, segs: Seg[]): string | null {
  if (segs.length === 0) return "Empty path";
  let cur: Json = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const child = getChild(cur, segs[i]);
    if (child === undefined) return `Path not found at ${describeSeg(segs[i])}`;
    cur = child;
  }
  const last = segs[segs.length - 1];
  if (last.kind === "key") {
    if (!isObj(cur)) return `Cannot remove key from non-object`;
    if (!(last.key in cur)) return `Key '${last.key}' not found`;
    delete cur[last.key];
    return null;
  }
  if (!Array.isArray(cur)) return `Cannot index into non-array`;
  const idx = last.kind === "index" ? last.index : findIndexById(cur, last.id);
  if (idx === -1 || idx >= cur.length) return `Index ${describeSeg(last)} out of range`;
  cur.splice(idx, 1);
  return null;
}

function addItemAt(root: Obj, segs: Seg[], value: Json): string | null {
  if (segs.length === 0) return "Empty path";
  let cur: Json = root;
  for (const seg of segs) {
    const child = getChild(cur, seg);
    if (child === undefined) {
      if (seg.kind === "key" && isObj(cur)) {
        const created: Json[] = [];
        cur[seg.key] = created;
        cur = created;
        continue;
      }
      return `Path not found at ${describeSeg(seg)}`;
    }
    cur = child;
  }
  if (!Array.isArray(cur)) return `add_item target is not an array`;
  cur.push(value);
  return null;
}

function getChild(cur: Json, seg: Seg): Json | undefined {
  if (seg.kind === "key") return isObj(cur) ? cur[seg.key] : undefined;
  if (!Array.isArray(cur)) return undefined;
  if (seg.kind === "index") return cur[seg.index];
  const idx = findIndexById(cur, seg.id);
  return idx === -1 ? undefined : cur[idx];
}

function setChild(cur: Json, seg: Seg, value: Json): string | null {
  if (seg.kind === "key") {
    if (!isObj(cur)) return `Cannot set key on non-object`;
    cur[seg.key] = value;
    return null;
  }
  if (!Array.isArray(cur)) return `Cannot set index on non-array`;
  if (seg.kind === "index") {
    if (seg.index > cur.length) return `Index ${seg.index} out of range (len ${cur.length})`;
    cur[seg.index] = value;
    return null;
  }
  const idx = findIndexById(cur, seg.id);
  if (idx === -1) return `find:${seg.id} not found`;
  cur[idx] = value;
  return null;
}

function findIndexById(arr: Json[], id: string): number {
  return arr.findIndex((x) => isObj(x) && x.id === id);
}

function describeSeg(seg: Seg): string {
  if (seg.kind === "key") return seg.key;
  if (seg.kind === "index") return `[${seg.index}]`;
  return `[find:${seg.id}]`;
}

function isObj(value: Json): value is Obj {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value: Obj): Obj {
  return JSON.parse(JSON.stringify(value)) as Obj;
}

function moveItemAt(root: Obj, segs: Seg[], from: number, to: number): string | null {
  if (segs.length === 0) return "Empty path";
  let cur: Json = root;
  for (const seg of segs) {
    const child = getChild(cur, seg);
    if (child === undefined) return `Path not found at ${describeSeg(seg)}`;
    cur = child;
  }
  if (!Array.isArray(cur)) return `move_item target is not an array`;
  if (from < 0 || from >= cur.length) return `from index ${from} out of range (len ${cur.length})`;
  if (to < 0 || to >= cur.length) return `to index ${to} out of range (len ${cur.length})`;
  if (from === to) return null;
  const [item] = cur.splice(from, 1);
  cur.splice(to, 0, item);
  return null;
}

function applyRenameId(root: Obj, patch: { collection: string; from: string; to: string }): PatchResult {
  const { collection, from, to } = patch;
  if (!from || !to) return { ok: false, error: "rename_id requires non-empty from and to" };
  if (from === to) return { ok: true, root };
  const next = clone(root);
  const list = (next as Obj)[collection];
  if (!Array.isArray(list)) return { ok: false, error: `Collection '${collection}' is not an array` };
  const idx = list.findIndex((x) => isObj(x) && x.id === from);
  if (idx === -1) return { ok: false, error: `${collection}.${from} not found` };
  const conflict = list.findIndex((x) => isObj(x) && x.id === to);
  if (conflict !== -1) return { ok: false, error: `${collection}.${to} already exists` };

  (list[idx] as Obj).id = to;
  renameRefs(next, collection, from, to);
  return { ok: true, root: next };
}

function renameRefs(value: Json, collection: string, from: string, to: string): void {
  if (Array.isArray(value)) {
    for (const item of value) renameRefs(item, collection, from, to);
    return;
  }
  if (!isObj(value)) return;
  for (const [k, v] of Object.entries(value)) {
    if (ID_REF_KEYS.has(k) && v === from) {
      value[k] = to;
      continue;
    }
    if (k === "ref" && typeof v === "string") {
      const renamed = renameDottedRef(v, collection, from, to);
      if (renamed !== v) value[k] = renamed;
      continue;
    }
    if (k === "rows" && Array.isArray(v)) {
      // chart panels carry row ids as plain strings; only rename if this is a panel rows array.
      // Heuristic: parent has "name" + "rows" or this is inside chart.panels — we rename matches conservatively.
      for (let i = 0; i < v.length; i++) {
        const entry = v[i];
        if (typeof entry === "string" && entry === from) v[i] = to;
        else renameRefs(entry, collection, from, to);
      }
      continue;
    }
    renameRefs(v, collection, from, to);
  }
}

function renameDottedRef(ref: string, collection: string, from: string, to: string): string {
  const parts = ref.split(".");
  if (parts[0] !== collection) return ref;
  if (parts[1] !== from) return ref;
  parts[1] = to;
  return parts.join(".");
}
