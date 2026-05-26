export function sha1(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] = (words[i >> 2] ?? 0) | (bytes[i] << (24 - (i % 4) * 8));
  }
  words[bytes.length >> 2] = (words[bytes.length >> 2] ?? 0) | (0x80 << (24 - (bytes.length % 4) * 8));
  words[(((bytes.length + 8) >> 6) << 4) + 15] = bytes.length * 8;

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  for (let i = 0; i < words.length; i += 16) {
    const w = words.slice(i, i + 16);
    for (let j = 16; j < 80; j++) {
      w[j] = rol((w[j - 3] ?? 0) ^ (w[j - 8] ?? 0) ^ (w[j - 14] ?? 0) ^ (w[j - 16] ?? 0), 1);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let j = 0; j < 80; j++) {
      const [f, k] = sha1Round(j, b, c, d);
      const temp = (rol(a, 5) + f + e + k + (w[j] ?? 0)) | 0;
      e = d;
      d = c;
      c = rol(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  return [h0, h1, h2, h3, h4].map(hex32).join("");
}

function rol(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

function sha1Round(i: number, b: number, c: number, d: number): [number, number] {
  if (i < 20) return [(b & c) | (~b & d), 0x5a827999];
  if (i < 40) return [b ^ c ^ d, 0x6ed9eba1];
  if (i < 60) return [(b & c) | (b & d) | (c & d), 0x8f1bbcdc];
  return [b ^ c ^ d, 0xca62c1d6];
}

function hex32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}

export function smoosh(s: string): string {
  return s.trim().replaceAll(/\s+/g, " ");
}

const charsToEncode = " ~`!@#$%^&*()+={}|[]\\/:\":'<>?,.、。！？「」『』・«»—¡¿„“‚".split("");

export function slugify(txt: string, ch: string = "_"): string {
  let encoded = txt;
  charsToEncode.forEach((char) => {
    encoded = encoded.split(char).join(ch);
  });
  const re = new RegExp(`${ch}+`, "g");
  return encoded.replaceAll(re, ch);
}

export function parameterize(txt: string, ch: string = "_") {
  return txt
    .normalize("NFKC")
    .replace(/[\p{P}\p{S}\p{C}\p{M}\u200B-\u200D\uFEFF\u2060\u00A0]/gu, ch)
    .replace(/_+/g, ch)
    .trim();
}

export function isBlank(v: any) {
  if (typeof v === "string") {
    return /^\s*$/.test(v);
  }
  if (Array.isArray(v)) {
    return v.length < 1;
  }
  if (v && typeof v === "object") {
    return Object.keys(v).length < 1;
  }
  return !v;
}
export function isPresent<T>(v: T): v is NonNullable<T> {
  return !isBlank(v);
}

export function removeLeading(t: string, c: string): string {
  if (t.startsWith(c)) {
    return removeLeading(t.slice(1), c) as string;
  }
  return t;
}

export function removeTrailing(s: string, t: string) {
  if (s[s.length - 1] === t) {
    return removeTrailing(s.slice(0, -1), t);
  }
  return s;
}

export function cleanSplit(s: string | null | undefined, sep: string = "\n") {
  if (typeof s !== "string") {
    return [];
  }
  return s
    .split(sep)
    .map((s) => s.trim())
    .filter((s) => !!s);
}

export function parseLooseKeyValues(
  input: string,
  delimiters: string[] = ["->", "~>", ":=", "=>", ":", "-", "="]
): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof input !== "string") {
    return out;
  }
  const rows = input
    .split("\n")
    .map((row) => row.trim())
    .filter((row) => !!row);
  for (const row of rows) {
    for (const delim of delimiters) {
      const idx = row.indexOf(delim);
      if (idx < 1) {
        continue;
      }
      const key = row.slice(0, idx).trim();
      const value = row.slice(idx + delim.length).trim();
      if (!key) {
        continue;
      }
      out[key] = value;
      break;
    }
  }
  return out;
}

export function stripOuterQuotes(str: string) {
  if (str.length < 2) {
    return str;
  }
  if (str[0] === '"' && str[str.length - 1] === '"') {
    return stripOuterQuotes(str.slice(1, -1));
  }
  if (str[0] === "'" && str[str.length - 1] === "'") {
    return stripOuterQuotes(str.slice(1, -1));
  }
  return str;
}

const ULID_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(random: () => number, timestamp: number = Date.now()): string {
  let t = timestamp;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = ULID_CHARS[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = "";
  for (let i = 0; i < 16; i++) {
    rand += ULID_CHARS[Math.floor(random() * 32)];
  }
  return time + rand;
}

export function generatePredictableKey(prefix: string, prompt: string, suffix: string): string {
  const slug = slugify(prompt).substring(0, 32);
  const hash = sha1(prompt).substring(0, 8);
  return `${prefix}/${slug}-${hash}.${suffix}`;
}

export const extractNetworkDomainFromSSTString = (s: string): string | null => {
  const clean = s.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
  const m = clean.match(/Network:\s+(https?:\/\/\S+)/i);
  const mm = m ? m[1].trim() : null;
  if (!mm) {
    return null;
  }
  const parts = mm.split("//");
  return parts[1];
};

export function isUrlValue(value: string) {
  return /^https?:\/\//i.test(value);
}

export function parseDurationToMs(input: string): number | null {
  const source = input.trim().toLowerCase();
  if (!source) {
    return null;
  }
  const match = source.match(/^(-?\d+(?:\.\d+)?)\s*([a-z]*)$/);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  if (!isFinite(value)) {
    return null;
  }
  const unit = match[2];
  if (!unit || unit === "ms" || unit === "millis" || unit === "milliseconds") {
    return Math.round(value);
  }
  if (unit === "s" || unit === "sec" || unit === "secs" || unit === "second" || unit === "seconds") {
    return Math.round(value * 1000);
  }
  if (unit === "m" || unit === "min" || unit === "mins" || unit === "minute" || unit === "minutes") {
    return Math.round(value * 60 * 1000);
  }
  if (unit === "h" || unit === "hr" || unit === "hrs" || unit === "hour" || unit === "hours") {
    return Math.round(value * 60 * 60 * 1000);
  }
  if (unit === "d" || unit === "day" || unit === "days") {
    return Math.round(value * 24 * 60 * 60 * 1000);
  }
  return null;
}
