import { createHash } from "node:crypto";
import { cmpParts, fromParts, parseParts, type Instant, type Parts } from "./time.ts";

/** A row of agent_events with status='blocked'. */
export interface BlockedRow {
  id: number;
  occurred_at: string;
  actor: string;
  event_type: string;
  scope: string;
  summary: string | null;
}

export type Kind = "本人待ち" | "警報";

export interface Group {
  key: string;
  kind: Kind;
  event_type: string;
  scope: string;
  actor: string;
  count: number;
  first: Instant | null;
  last: Instant | null;
  last_id: number;
  summary: string | null;
}

/**
 * Same shape as ops_dash.py norm(): hex runs (8+) become "#", digit runs become "#",
 * then the first 48 characters. Python's \d matches any Unicode decimal digit, so \p{Nd} here,
 * and slicing counts code points, not UTF-16 units.
 */
export function norm(summary: string | null): string {
  const s = (summary ?? "").replace(/[0-9a-f]{8,}/g, "#").replace(/\p{Nd}+/gu, "#");
  return Array.from(s).slice(0, 48).join("");
}

export function keyOf(eventType: string, summary: string | null): string {
  return sha8(`${eventType}|${norm(summary)}`);
}

const sha8 = (text: string): string => createHash("sha1").update(text, "utf8").digest("hex").slice(0, 8);

export function kindOf(eventType: string, summary: string | null): Kind {
  return eventType.startsWith("gate:") || (summary ?? "").includes("[sentinel]") ? "警報" : "本人待ち";
}

/**
 * Group blocked rows by kind of incident, in the order the rows arrive (ordered by id).
 * Rows run into the tens of thousands but groups are few, so per row only the timestamp is parsed
 * (to two integers) and the hash is looked up by normalised text; ISO strings are built once per group.
 */
export function groupBlocked(rows: readonly BlockedRow[]): Group[] {
  interface Acc {
    g: Omit<Group, "first" | "last">;
    first: Parts | null;
    last: Parts | null;
  }
  const byKey = new Map<string, Acc>();
  const keyCache = new Map<string, string>();
  for (const r of rows) {
    const text = `${r.event_type}|${norm(r.summary)}`;
    let key = keyCache.get(text);
    if (key === undefined) keyCache.set(text, (key = sha8(text)));
    const t = parseParts(r.occurred_at);
    let x = byKey.get(key);
    if (!x) {
      x = {
        g: {
          key,
          kind: kindOf(r.event_type, r.summary),
          event_type: r.event_type,
          scope: r.scope,
          actor: r.actor,
          count: 0,
          last_id: r.id,
          summary: r.summary,
        },
        first: t,
        last: t,
      };
      byKey.set(key, x);
    }
    x.g.count += 1;
    if (t !== null && (x.last === null || cmpParts(t, x.last) >= 0)) {
      x.last = t;
      x.g.last_id = r.id;
      x.g.summary = r.summary;
    }
    if (t !== null && (x.first === null || cmpParts(t, x.first) < 0)) x.first = t;
  }
  const at = (p: Parts | null): Instant | null => (p === null ? null : fromParts(p));
  return [...byKey.values()].map(({ g, first, last }) => ({ ...g, first: at(first), last: at(last) }));
}

export interface State {
  seen?: Record<string, string>;
  ack?: Record<string, string>;
  [k: string]: unknown;
}

/** Hide groups acknowledged after their last occurrence; 本人待ち first, then newest first. */
export function openItems(state: State, groups: readonly Group[]): Group[] {
  const acks = state.ack ?? {};
  return groups
    .filter((x) => {
      const ack = acks[x.key];
      return !(ack && x.last && x.last.iso <= ack);
    })
    .sort((a, b) => {
      const ka = a.kind !== "本人待ち" ? 1 : 0;
      const kb = b.kind !== "本人待ち" ? 1 : 0;
      if (ka !== kb) return ka - kb;
      return (b.last?.micros ?? 0) - (a.last?.micros ?? 0);
    });
}
