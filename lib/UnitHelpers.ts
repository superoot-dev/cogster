export type UnitDimension = "weight" | "volume" | "count" | "currency" | "time";

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

  usd: { dim: "currency", toBase: 1 },

  second: { dim: "time", toBase: 1 },
  hour: { dim: "time", toBase: 3600 },
  day: { dim: "time", toBase: 86400 },
  week: { dim: "time", toBase: 604800 },
  month: { dim: "time", toBase: 2629800 },
  year: { dim: "time", toBase: 31557600 },
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
  units: "unit",
  servings: "unit",
  serving: "unit",
  ea: "each",

  $: "usd",
  dollar: "usd",
  dollars: "usd",

  s: "second",
  sec: "second",
  secs: "second",
  seconds: "second",
  hr: "hour",
  hrs: "hour",
  hours: "hour",
  d: "day",
  days: "day",
  wk: "week",
  wks: "week",
  weeks: "week",
  mo: "month",
  mos: "month",
  months: "month",
  monthly: "month",
  yr: "year",
  yrs: "year",
  years: "year",
  yearly: "year",
  annual: "year",
  annually: "year",
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
  if (dim === "currency") return "usd";
  if (dim === "time") return "second";
  return "each";
}
