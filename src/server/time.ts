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

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeap(year) ? 29 : (MONTH_DAYS[month - 1] ?? 0);
}

/** Days since 1970-01-01 for a proleptic Gregorian date (H. Hinnant's days_from_civil), no Date allocation. */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** A parsed time: whole seconds since the epoch and 0..999999 microseconds, both exact. */
export interface Parts {
  sec: number;
  us: number;
}

/** Order of two parsed times (negative, zero, positive). */
export const cmpParts = (a: Parts, b: Parts): number => a.sec - b.sec || a.us - b.us;

/**
 * Format as JST. Seconds and microseconds are kept apart because a single microsecond count passes
 * 2^53 (the exact range of a JS number) about 285 years from 1970, and Python accepts years 1-9999.
 */
export function fromParts({ sec, us }: Parts): Instant {
  const d = new Date((sec + JST_OFFSET_SEC) * 1000);
  const base =
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return { micros: sec * 1e6 + us, iso: base + (us ? "." + pad(us, 6) : "") + "+09:00" };
}

export function fromMicros(micros: number): Instant {
  const sec = Math.floor(micros / 1e6);
  return fromParts({ sec, us: micros - sec * 1e6 });
}

/**
 * Parse a ledger timestamp. Returns null where Python's to_jst() returns None.
 * Runs once per row, so it builds no Date.
 */
export function parseParts(raw: string | null | undefined): Parts | null {
  const s = (raw ?? "").replaceAll("Z", "+00:00").replaceAll(" ", "T");
  const m = RE.exec(s);
  if (!m) return null;
  const Y = Number(m[1]), M = Number(m[2]), D = Number(m[3]);
  const H = Number(m[4] ?? 0), Mi = Number(m[5] ?? 0), S = Number(m[6] ?? 0);
  const OH = Number(m[9] ?? 0), OM = Number(m[10] ?? 0);
  // Python rejects out-of-range fields (Feb 30, month 13, 24:00, :60, year 0, offsets of 24h or more);
  // Date.UTC would silently roll them over instead.
  if (Y < 1 || M < 1 || M > 12 || D < 1 || D > daysInMonth(Y, M) || H > 23 || Mi > 59 || S > 59 || OH > 23) {
    return null;
  }
  const offset = m[8] ? (m[8] === "-" ? -1 : 1) * (OH * 3600 + OM * 60) : 0;
  return {
    sec: daysFromCivil(Y, M, D) * 86400 + H * 3600 + Mi * 60 + S - offset,
    us: Number((m[7] ?? "").padEnd(6, "0")),
  };
}

/** Parse a ledger timestamp. Returns null where Python's to_jst() returns None. */
export function toJst(raw: string | null | undefined): Instant | null {
  const p = parseParts(raw);
  return p === null ? null : fromParts(p);
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
