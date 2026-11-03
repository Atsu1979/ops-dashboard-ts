import { Hono } from "hono";
import { groupBlocked, openItems, type Group } from "./items.ts";
import { jstMinuteString, nowJst, toJst, utcSqlString } from "./time.ts";
import {
  loadState,
  readBlocked,
  readChanges,
  readJson,
  readTasks,
  MissingDatabaseError,
  CorruptStateError,
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
  /**
   * Host names (without port) the server answers to. Guards against DNS rebinding: a page on
   * evil.example that re-points its name to 127.0.0.1 is "same origin" to the browser, but still
   * sends `Host: evil.example`. Undefined disables the check (tests only).
   */
  allowedHosts?: readonly string[];
  now?: () => number;
}

/** Host header -> lower-case host name without port ("[::1]:8787" -> "[::1]"). */
export function hostName(header: string | undefined): string {
  const h = (header ?? "").trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0] ?? "";
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
  const allowed = cfg.allowedHosts ? new Set(cfg.allowedHosts.map((h) => h.toLowerCase())) : null;

  app.use("*", async (c, next) => {
    if (allowed && !allowed.has(hostName(c.req.header("host")))) {
      return c.json({ error: "host not allowed" }, 421);
    }
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("x-frame-options", "DENY"); // the ack button must not be clickable from a framing page
    c.header("referrer-policy", "no-referrer");
    c.header(
      "content-security-policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    if (c.req.path.startsWith("/api/")) c.header("cache-control", "no-store");
  });

  app.onError((err, c) => {
    if (err instanceof MissingDatabaseError) return c.json({ error: err.message }, 503);
    if (err instanceof CorruptStateError) return c.json({ error: err.message }, 409);
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

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
              generated: u.generated ? (toJst(u.generated)?.iso ?? u.generated) : null,
              today: totals(u, 1),
              week: totals(u, 7),
              // shown as JST like every other time on the page (the aggregator may write UTC "Z" strings)
              sessions: (u.sessions ?? []).slice(0, 8).map((s) => (s.last ? { ...s, last: toJst(s.last)?.iso ?? s.last } : s)),
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
    const state = loadState(cfg.statePath, { strict: true });
    const stamp = nowJst(now()).iso;
    if (!state.ack || typeof state.ack !== "object") state.ack = {};
    for (const g of hit) state.ack[g.key] = stamp;
    saveState(cfg.statePath, state);
    return c.json({ acked: hit.map((g) => g.key), at: stamp });
  });

  // Unknown API paths are 404 here, not the SPA fallback that main.ts adds after this.
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  return app;
}
