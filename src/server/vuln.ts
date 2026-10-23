import { fromMicros } from "./time.ts";

/**
 * Running-image vulnerability scan, read from vuln_status.json (written by the scanner on the server).
 * The file's exact shape is not pinned down, so every key is optional: missing or odd values become 0 / [] / null.
 */
export interface VulnTotals {
  P1: number;
  P2: number;
  P3: number;
  H: number;
}
export interface VulnStatus {
  ts: string | null;
  images: number;
  totals: VulnTotals;
  new_hot: string[];
  errors: string[];
  warns: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** Epoch seconds or milliseconds become a JST ISO string; strings pass through. */
function stamp(v: unknown): string | null {
  if (typeof v === "string") return v || null;
  if (typeof v === "number" && Number.isFinite(v)) return fromMicros((v < 1e12 ? v * 1000 : v) * 1000).iso;
  return null;
}

/** One line per entry: strings as-is, objects as "id image pkg sev" from whichever keys exist. */
function line(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (isObj(v)) {
    const parts = ["id", "cve", "image", "pkg", "package", "severity", "sev", "msg", "message"]
      .map((k) => v[k])
      .filter((x): x is string | number => typeof x === "string" || typeof x === "number")
      .map(String);
    return parts.length ? parts.join(" ") : JSON.stringify(v);
  }
  return JSON.stringify(v) ?? "";
}

const lines = (v: unknown): string[] => (Array.isArray(v) ? v.map(line).filter(Boolean) : []);

function count(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (isObj(v)) return Object.keys(v).length;
  return num(v);
}

export function normalizeVuln(raw: unknown): VulnStatus {
  const r = isObj(raw) ? raw : {};
  const t = isObj(r.totals) ? r.totals : {};
  return {
    ts: stamp(r.ts),
    images: count(r.images),
    totals: { P1: num(t.P1), P2: num(t.P2), P3: num(t.P3), H: num(t.H ?? t.HIGH) },
    new_hot: lines(r.new_hot),
    errors: lines(r.errors),
    warns: lines(r.warns),
  };
}
