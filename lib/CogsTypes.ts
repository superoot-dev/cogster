import { z } from "zod";

export const UnitSchema = z.object({
  num: z.array(z.string()),
  den: z.array(z.string()),
});
export type Unit = z.infer<typeof UnitSchema>;

export const DIMENSIONLESS: Unit = { num: [], den: [] };

export const QtySchema = z.object({
  value: z.number(),
  unit: UnitSchema,
});
export type Qty = z.infer<typeof QtySchema>;

export const AggOpSchema = z.enum(["sum", "avg", "min", "max"]);
export type AggOp = z.infer<typeof AggOpSchema>;

export type Expr =
  | { kind: "qty"; qty: Qty }
  | { kind: "ref"; name: string }
  | { kind: "neg"; expr: Expr }
  | { kind: "op"; op: "+" | "-" | "*" | "/"; left: Expr; right: Expr }
  | { kind: "call"; name: string; args: Expr[] }
  | { kind: "tiers"; tiers: { at: Qty; expr: Expr }[] }
  | { kind: "branches"; cases: BranchCase[] }
  | { kind: "select"; expr: Expr; filter: TagSet }
  | { kind: "aggregate"; op: AggOp; expr: Expr; axes: string[] };

export type TagSet = Record<string, string[]>;

export type BranchCase = {
  tags: TagSet;
  expr: Expr;
};

const TagSetSchema: z.ZodType<TagSet> = z.record(z.string(), z.array(z.string()));

const BranchCaseSchema: z.ZodType<BranchCase> = z.lazy(() =>
  z.object({ tags: TagSetSchema, expr: ExprSchema }),
);

export const ExprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("qty"), qty: QtySchema }),
    z.object({ kind: z.literal("ref"), name: z.string() }),
    z.object({ kind: z.literal("neg"), expr: ExprSchema }),
    z.object({
      kind: z.literal("op"),
      op: z.enum(["+", "-", "*", "/"]),
      left: ExprSchema,
      right: ExprSchema,
    }),
    z.object({ kind: z.literal("call"), name: z.string(), args: z.array(ExprSchema) }),
    z.object({
      kind: z.literal("tiers"),
      tiers: z.array(z.object({ at: QtySchema, expr: ExprSchema })),
    }),
    z.object({ kind: z.literal("branches"), cases: z.array(BranchCaseSchema) }),
    z.object({ kind: z.literal("select"), expr: ExprSchema, filter: TagSetSchema }),
    z.object({
      kind: z.literal("aggregate"),
      op: AggOpSchema,
      expr: ExprSchema,
      axes: z.array(z.string()),
    }),
  ]),
);

export const AxisGroupSchema = z.object({
  name: z.string(),
  values: z.array(z.string()),
});
export type AxisGroup = z.infer<typeof AxisGroupSchema>;

export const AxisSchema = z.object({
  name: z.string(),
  values: z.array(z.string()),
  groups: z.array(AxisGroupSchema).default([]),
});
export type Axis = z.infer<typeof AxisSchema>;

export const BindingSchema = z.object({
  name: z.string(),
  expr: ExprSchema,
});
export type Binding = z.infer<typeof BindingSchema>;

export const ChartEntrySchema = z.object({
  color: z.string(),
  chart: z.string(),
  ref: z.string(),
});
export type ChartEntry = z.infer<typeof ChartEntrySchema>;

export const ChartKindSchema = z.enum(["bar", "pie"]);
export type ChartKind = z.infer<typeof ChartKindSchema>;

export const ChartConfigSchema = z.object({
  name: z.string(),
  kind: ChartKindSchema,
});
export type ChartConfig = z.infer<typeof ChartConfigSchema>;

export const ProgramSchema = z.object({
  axes: z.array(AxisSchema),
  bindings: z.array(BindingSchema),
  charts: z.array(ChartEntrySchema),
  chartConfigs: z.array(ChartConfigSchema),
});
export type Program = z.infer<typeof ProgramSchema>;

export type Assignment = Record<string, string>;

export type Cell = { at: Assignment; qty: Qty };

export type CogValue = {
  axes: string[];
  cells: Cell[];
};

export function scalarValue(q: Qty): CogValue {
  return { axes: [], cells: [{ at: {}, qty: q }] };
}

export function isScalar(v: CogValue): boolean {
  return v.axes.length === 0;
}

export function scalarQty(v: CogValue): Qty | null {
  if (v.axes.length === 0 && v.cells.length === 1) return v.cells[0].qty;
  return null;
}
