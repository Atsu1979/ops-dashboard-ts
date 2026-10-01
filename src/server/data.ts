import { DatabaseSync } from "node:sqlite";
import { readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BlockedRow, State } from "./items.ts";

const run = promisify(execFile);

function openRo(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true });
}

/** Blocked agent events since a UTC "YYYY-MM-DD HH:MM:SS" string (same filter as ops_dash.py). */
export function readBlocked(dbPath: string, sinceUtc: string): BlockedRow[] {
  const db = openRo(dbPath);
  try {
    return db
      .prepare(
        "select id, occurred_at, actor, event_type, scope, summary from agent_events " +
          "where status='blocked' and replace(occurred_at,'T',' ') >= ? order by id",
      )
      .all(sinceUtc) as unknown as BlockedRow[];
  } finally {
    db.close();
  }
}

export interface TaskRow {
  id: number;
  at: string;
  what: string;
}

export function readTasks(dbPath: string): TaskRow[] {
  const db = openRo(dbPath);
  try {
    return db
      .prepare("select id, at, what from tasks where status='未着手' order by id")
      .all() as unknown as TaskRow[];
  } finally {
    db.close();
  }
}

export interface ChangeRow {
  id: number;
  detected_at: string;
  kind: string;
  added: number;
  removed: number;
  who: string | null;
  guarded: string | null;
}

export function readChanges(dbPath: string, sinceJstMinute: string, limit = 30): ChangeRow[] {
  if (!existsSync(dbPath)) return [];
  const db = openRo(dbPath);
  try {
    return db
      .prepare(
        "select id, detected_at, kind, added, removed, who, guarded from changes " +
          "where detected_at >= ? order by id desc limit ?",
      )
      .all(sinceJstMinute, limit) as unknown as ChangeRow[];
  } finally {
    db.close();
  }
}

export function loadState(path: string): State {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as State;
  } catch {
    return { seen: {}, ack: {} };
  }
}

/** Atomic write (tmp + rename), same as ops_dash.py save(). */
export function saveState(path: string, state: State): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 1), "utf8");
  renameSync(tmp, path);
}

export interface UsageDay {
  weighted?: number;
  calls?: number;
  out?: number;
}
export interface UsageSession {
  project?: string;
  last?: string;
  weighted?: number;
  calls?: number;
  out?: number;
  cr?: number;
  cc?: number;
  input?: number;
}
export interface Usage {
  host?: string;
  generated?: string;
  days?: Record<string, UsageDay>;
  sessions?: UsageSession[];
}

export function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Runs the existing Python aggregator for this machine's Claude Code logs. */
export async function runUsageCommand(cmd: readonly string[]): Promise<Usage | null> {
  const [bin, ...args] = cmd;
  if (!bin) return null;
  try {
    const { stdout } = await run(bin, args, { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(stdout) as Usage;
  } catch {
    return null;
  }
}

export function totals(u: Usage | null, days: number): { weighted: number; calls: number; out: number } | null {
  if (!u?.days) return null;
  const keys = Object.keys(u.days).sort().slice(-days);
  const t = { weighted: 0, calls: 0, out: 0 };
  for (const k of keys) {
    const d = u.days[k] ?? {};
    t.weighted += d.weighted ?? 0;
    t.calls += d.calls ?? 0;
    t.out += d.out ?? 0;
  }
  return t;
}
