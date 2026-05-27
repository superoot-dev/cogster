import { z } from "zod";

export const TimeUnitSchema = z.enum(["hour", "day", "week", "month", "year"]);
export type TimeUnit = z.infer<typeof TimeUnitSchema>;

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

export type Expr =
  | { kind: "qty"; qty: Qty }
  | { kind: "ref"; name: string }
  | { kind: "neg"; expr: Expr }
  | { kind: "op"; op: "+" | "-" | "*" | "/"; left: Expr; right: Expr }
  | { kind: "tiers"; tiers: { at: Qty; expr: Expr }[] };

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
    z.object({
      kind: z.literal("tiers"),
      tiers: z.array(z.object({ at: QtySchema, expr: ExprSchema })),
    }),
  ]),
);

export const RangeSchema = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
  per: TimeUnitSchema.nullable(),
});
export type Range = z.infer<typeof RangeSchema>;

export const BindingSchema = z.object({
  name: z.string(),
  expr: ExprSchema,
});
export type Binding = z.infer<typeof BindingSchema>;

export const ChartKindSchema = z.enum(["pie", "line", "bar"]);
export type ChartKind = z.infer<typeof ChartKindSchema>;

export const ChartSchema = z.object({
  refs: z.array(z.string()),
  range: RangeSchema,
  as: ChartKindSchema.nullable(),
});
export type Chart = z.infer<typeof ChartSchema>;

export const ProgramSchema = z.object({
  bindings: z.array(BindingSchema),
  charts: z.array(ChartSchema),
});
export type Program = z.infer<typeof ProgramSchema>;
