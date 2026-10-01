import { createHash } from "node:crypto";
import { toJst, type Instant } from "./time.ts";

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
  return createHash("sha1").update(`${eventType}|${norm(summary)}`, "utf8").digest("hex").slice(0, 8);
}

export function kindOf(eventType: string, summary: string | null): Kind {
  return eventType.startsWith("gate:") || (summary ?? "").includes("[sentinel]") ? "警報" : "本人待ち";
}

/** Group blocked rows by kind of incident, in the order the rows arrive (ordered by id). */
export function groupBlocked(rows: readonly BlockedRow[]): Group[] {
  const g = new Map<string, Group>();
  for (const r of rows) {
    const key = keyOf(r.event_type, r.summary);
    const t = toJst(r.occurred_at);
    let x = g.get(key);
    if (!x) {
      x = {
        key,
        kind: kindOf(r.event_type, r.summary),
        event_type: r.event_type,
        scope: r.scope,
        actor: r.actor,
        count: 0,
        first: t,
        last: t,
        last_id: r.id,
        summary: r.summary,
      };
      g.set(key, x);
    }
    x.count += 1;
    if (t && (x.last === null || t.micros >= x.last.micros)) {
      x.last = t;
      x.last_id = r.id;
      x.summary = r.summary;
    }
    if (t && (x.first === null || t.micros < x.first.micros)) x.first = t;
  }
  return [...g.values()];
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
