/**
 * Timestamps, matched to Python's datetime behaviour in ops_dash.py so that ack
 * strings written by either side compare the same way (they are compared as strings).
 *
 * Python: datetime.fromisoformat(s.replace(" ", "T")); naive => UTC; .astimezone(JST).isoformat()
 * isoformat() prints microseconds as 6 digits, and omits them when they are zero.
 * Fractions must be 3 or 6 digits: production runs Python 3.10, whose fromisoformat() rejects others.
 */

export interface Instant {
  /** microseconds since the Unix epoch */
  micros: number;
  /** ISO string in JST (+09:00), formatted like Python's isoformat() */
  iso: string;
}

const JST_OFFSET_SEC = 9 * 3600;
const RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{3}|\d{6}))?)?)?(?:([+-])(\d{2}):?(\d{2}))?$/;

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

export function fromMicros(micros: number): Instant {
  const secs = Math.floor(micros / 1e6);
  const frac = micros - secs * 1e6;
  const d = new Date((secs + JST_OFFSET_SEC) * 1000);
  const base =
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return { micros, iso: base + (frac ? "." + pad(frac, 6) : "") + "+09:00" };
}

/** Parse a ledger timestamp. Returns null where Python's to_jst() returns None. */
export function toJst(raw: string | null | undefined): Instant | null {
  const s = (raw ?? "").replaceAll("Z", "+00:00").replaceAll(" ", "T");
  const m = RE.exec(s);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", se = "0", fr = "", sign, oh = "0", om = "0"] = m;
  const utcSec =
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se)) / 1000;
  const offset = sign ? (sign === "-" ? -1 : 1) * (Number(oh) * 3600 + Number(om) * 60) : 0;
  const micros = (utcSec - offset) * 1e6 + Number(fr.padEnd(6, "0") || "0");
  return fromMicros(micros);
}

export function nowJst(nowMs: number = Date.now()): Instant {
  return fromMicros(nowMs * 1000);
}

/** "YYYY-MM-DD HH:MM:SS" in UTC, as the ledger's datetime('now') writes it. */
export function utcSqlString(micros: number): string {
  const d = new Date(Math.floor(micros / 1000));
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/** "YYYY-MM-DD HH:MM" in JST, the format changes.db uses for detected_at. */
export function jstMinuteString(micros: number): string {
  return fromMicros(micros).iso.slice(0, 16).replace("T", " ");
}
