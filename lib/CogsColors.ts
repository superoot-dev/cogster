const NAMED: Record<string, string> = {
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  yellow: "#eab308",
  lime: "#84cc16",
  green: "#22c55e",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  blue: "#3b82f6",
  indigo: "#6366f1",
  purple: "#a855f7",
  pink: "#ec4899",
  magenta: "#d946ef",
  rose: "#f43f5e",
  black: "#000000",
  white: "#ffffff",
  gray: "#9ca3af",
  grey: "#9ca3af",
  slate: "#64748b",
};

const HEX3 = /^[0-9a-fA-F]{3}$/;
const HEX6 = /^[0-9a-fA-F]{6}$/;

export function resolveColor(raw: string): string | null {
  const v = raw.trim();
  if (v.toLowerCase() === "auto") return "#auto";
  if (HEX3.test(v)) return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`.toLowerCase();
  if (HEX6.test(v)) return `#${v.toLowerCase()}`;
  const named = NAMED[v.toLowerCase()];
  return named ?? null;
}
