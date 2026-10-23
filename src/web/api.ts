export interface Item {
  key: string;
  kind: "本人待ち" | "警報";
  event_type: string;
  scope: string;
  actor: string;
  count: number;
  first: string | null;
  last: string | null;
  summary: string | null;
}
export interface ItemsRes {
  generated: string;
  days: number;
  total_groups: number;
  items: Item[];
}
export interface Task {
  id: number;
  at_jst: string;
  what: string;
}
export interface Change {
  id: number;
  detected_at: string;
  kind: string;
  added: number;
  removed: number;
  who: string | null;
  guarded: string | null;
}
export interface Tot {
  weighted: number;
  calls: number;
  out: number;
}
export interface Session {
  project?: string;
  last?: string;
  weighted?: number;
  calls?: number;
}
export interface HostUsage {
  generated: string | null;
  today: Tot | null;
  week: Tot | null;
  sessions: Session[];
}
export type UsageRes = Record<"mac" | "server", HostUsage | null>;
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
/** `{}` when the scanner has not written vuln_status.json (or it cannot be read). */
export type VulnRes = VulnStatus | Record<string, never>;
export type VulnLevel = "red" | "yellow" | "green" | "none";

/** red: P1 > 0 or scan errors; yellow: P2 > 0; green: otherwise; none: no scan result yet. */
export function vulnLevel(v: VulnRes | null): VulnLevel {
  if (!v || !("totals" in v)) return "none";
  if (v.totals.P1 > 0 || v.errors.length > 0) return "red";
  if (v.totals.P2 > 0) return "yellow";
  return "green";
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return (await r.json()) as T;
}

export const api = {
  items: () => get<ItemsRes>("/api/items"),
  tasks: () => get<{ tasks: Task[] }>("/api/tasks"),
  changes: (days: number) => get<{ days: number; changes: Change[] }>(`/api/changes?days=${days}`),
  usage: () => get<UsageRes>("/api/usage"),
  vuln: () => get<VulnRes>("/api/vuln"),
  ack: async (key: string): Promise<string[]> => {
    const r = await fetch("/api/ack", {
      method: "POST",
      headers: { "content-type": "application/json", "x-ops-ack": "1" },
      body: JSON.stringify({ key }),
    });
    if (!r.ok) throw new Error(`ack: ${r.status}`);
    return ((await r.json()) as { acked: string[] }).acked;
  },
};

export function fmt(n: number | null | undefined): string {
  const v = n ?? 0;
  return v >= 1e4 ? `${(v / 1e4).toFixed(1)}万` : Math.round(v).toLocaleString("ja-JP");
}
