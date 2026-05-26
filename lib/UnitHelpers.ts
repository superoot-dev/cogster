export type UnitDimension = "weight" | "volume" | "count";

type UnitDef = {
  dim: UnitDimension;
  toBase: number;
};

const UNITS: Record<string, UnitDef> = {
  mg: { dim: "weight", toBase: 0.001 },
  g: { dim: "weight", toBase: 1 },
  kg: { dim: "weight", toBase: 1000 },
  oz: { dim: "weight", toBase: 28.349523125 },
  lb: { dim: "weight", toBase: 453.59237 },

  ml: { dim: "volume", toBase: 1 },
  l: { dim: "volume", toBase: 1000 },
  gal: { dim: "volume", toBase: 3785.411784 },
  fl_oz: { dim: "volume", toBase: 29.5735295625 },

  each: { dim: "count", toBase: 1 },
  unit: { dim: "count", toBase: 1 },
  pc: { dim: "count", toBase: 1 },
  pcs: { dim: "count", toBase: 1 },
  dozen: { dim: "count", toBase: 12 },
};

const ALIAS: Record<string, string> = {
  grams: "g",
  gram: "g",
  kilograms: "kg",
  kilogram: "kg",
  milligrams: "mg",
  milligram: "mg",
  ounces: "oz",
  ounce: "oz",
  pounds: "lb",
  pound: "lb",
  lbs: "lb",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  milliliter: "ml",
  milliliters: "ml",
  gallon: "gal",
  gallons: "gal",
  "fluid_ounce": "fl_oz",
  "fluid_ounces": "fl_oz",
  fluid_oz: "fl_oz",
};

export function normalizeUnit(unit: string): string {
  const k = unit.trim().toLowerCase();
  return ALIAS[k] ?? k;
}

export function lookupUnit(unit: string): UnitDef | null {
  return UNITS[normalizeUnit(unit)] ?? null;
}

export type ConvertResult =
  | { ok: true; value: number }
  | { ok: false; reason: string };

export function convertAmount(amount: number, from: string, to: string): ConvertResult {
  const f = lookupUnit(from);
  const t = lookupUnit(to);
  if (!f) return { ok: false, reason: `Unknown unit '${from}'` };
  if (!t) return { ok: false, reason: `Unknown unit '${to}'` };
  if (f.dim !== t.dim) return { ok: false, reason: `Cannot convert ${from} (${f.dim}) to ${to} (${t.dim})` };
  return { ok: true, value: (amount * f.toBase) / t.toBase };
}

export function baseUnitFor(dim: UnitDimension): string {
  if (dim === "weight") return "g";
  if (dim === "volume") return "ml";
  return "each";
}
