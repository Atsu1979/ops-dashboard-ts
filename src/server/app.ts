import { Hono } from "hono";
import { groupBlocked, openItems, type Group } from "./items.ts";
import { jstMinuteString, nowJst, toJst, utcSqlString } from "./time.ts";
import {
  loadState,
  readBlocked,
  readChanges,
  readJson,
  readTasks,
  runUsageCommand,
  saveState,
  totals,
  type Usage,
} from "./data.ts";

export interface Config {
  ledgerDb: string;
  changesDb: string;
  statePath: string;
  usageMacPath: string;
  /** command that prints this machine's usage JSON; empty to skip */
  usageCmd: string[];
  days: number;
  usageCacheMs: number;
  now?: () => number;
}

export interface ItemView {
  key: string;
  kind: string;
  event_type: string;
  scope: string;
  actor: string;
  count: number;
  first: string | null;
  last: string | null;
  last_id: number;
  summary: string | null;
}

const view = (g: Group): ItemView => ({ ...g, first: g.first?.iso ?? null, last: g.last?.iso ?? null });

export function createApp(cfg: Config) {
  const app = new Hono();
  const now = cfg.now ?? (() => Date.now());
  let usageCache: { at: number; server: Usage | null } | null = null;

  function groups(): Group[] {
    const since = utcSqlString((now() - cfg.days * 86400_000) * 1000);
    return groupBlocked(readBlocked(cfg.ledgerDb, since));
  }

  app.get("/api/health", (c) => c.json({ ok: true, at: nowJst(now()).iso }));

  app.get("/api/items", (c) => {
    const all = groups();
    const open = openItems(loadState(cfg.statePath), all);
    return c.json({
      generated: nowJst(now()).iso,
      days: cfg.days,
      total_groups: all.length,
      items: open.map(view),
    });
  });

  app.get("/api/tasks", (c) =>
    c.json({ tasks: readTasks(cfg.ledgerDb).map((t) => ({ ...t, at_jst: toJst(t.at)?.iso ?? t.at })) }),
  );

  app.get("/api/changes", (c) => {
    const days = Math.min(Math.max(Number(c.req.query("days") ?? cfg.days) || cfg.days, 1), 90);
    const since = jstMinuteString((now() - days * 86400_000) * 1000);
    return c.json({ days, changes: readChanges(cfg.changesDb, since) });
  });

  app.get("/api/usage", async (c) => {
    if (!usageCache || now() - usageCache.at > cfg.usageCacheMs) {
      usageCache = { at: now(), server: cfg.usageCmd.length ? await runUsageCommand(cfg.usageCmd) : null };
    }
    const mac = readJson<Usage>(cfg.usageMacPath);
    const hosts = { mac, server: usageCache.server };
    const out = Object.fromEntries(
      Object.entries(hosts).map(([h, u]) => [
        h,
        u
          ? {
              generated: u.generated ?? null,
              today: totals(u, 1),
              week: totals(u, 7),
              sessions: (u.sessions ?? []).slice(0, 8),
            }
          : null,
      ]),
    );
    return c.json(out);
  });

  /**
   * Mark incidents as seen, like `python3 ops_dash.py ack <prefix>`.
   * Requires a custom header so a page on another origin cannot trigger it through the browser
   * (a cross-origin request with a custom header needs a CORS preflight, which this server never grants).
   */
  app.post("/api/ack", async (c) => {
    if (c.req.header("x-ops-ack") !== "1") return c.json({ error: "missing x-ops-ack header" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { key?: unknown };
    const prefix = typeof body.key === "string" ? body.key.trim() : "";
    if (!/^[0-9a-f]{4,8}$/.test(prefix)) return c.json({ error: "key must be 4-8 hex chars" }, 400);
    const hit = groups().filter((g) => g.key.startsWith(prefix));
    if (!hit.length) return c.json({ acked: [] });
    const state = loadState(cfg.statePath);
    const stamp = nowJst(now()).iso;
    state.ack = state.ack ?? {};
    for (const g of hit) state.ack[g.key] = stamp;
    saveState(cfg.statePath, state);
    return c.json({ acked: hit.map((g) => g.key), at: stamp });
  });

  return app;
}
