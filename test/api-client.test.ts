import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type Config } from "../src/server/app.ts";
import { api } from "../src/web/api.ts";

/** The browser client (src/web/api.ts) talking to the real server app: fetch is routed into Hono. */
function wire(over: Partial<Config> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "opsdash-client-"));
  const db = new DatabaseSync(join(dir, "ledger.db"));
  db.exec(`create table agent_events(id integer primary key, occurred_at text, actor text, event_type text, scope text,
    status text, summary text); create table tasks(id integer primary key, at text, what text, status text);`);
  db.prepare("insert into agent_events(occurred_at, actor, event_type, scope, status, summary) values (?,?,?,?,?,?)")
    .run("2026-09-30 01:00:00", "a", "approval", "s", "blocked", "承認待ち");
  db.close();
  const app = createApp({
    ledgerDb: join(dir, "ledger.db"),
    changesDb: join(dir, "changes.db"),
    statePath: join(dir, "state.json"),
    usageMacPath: join(dir, "usage_mac.json"),
    usageCmd: [],
    days: 7,
    usageCacheMs: 0,
    allowedHosts: ["localhost"],
    now: () => Date.UTC(2026, 9, 1, 3, 0, 0),
    ...over,
  });
  // app.request() does not add a Host header the way a browser does, so add it here
  vi.stubGlobal("fetch", (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("host", "localhost");
    return app.request(`http://localhost${path}`, { ...init, headers });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("web client against the server", () => {
  test("items, tasks, changes, usage, then ack hides the item", async () => {
    wire();
    const items = await api.items();
    expect(items.items).toHaveLength(1);
    expect((await api.tasks()).tasks).toEqual([]);
    expect((await api.changes(7)).changes).toEqual([]);
    expect(await api.usage()).toEqual({ mac: null, server: null });
    const key = items.items[0]!.key;
    expect(await api.ack(key)).toEqual([key]); // the client sends the x-ops-ack header the server requires
    expect((await api.items()).items).toEqual([]);
  });

  test("server error messages reach the UI text", async () => {
    wire({ ledgerDb: "/nonexistent/agent_ledger.db" });
    await expect(api.items()).rejects.toThrow("/api/items: 503 database not found: agent_ledger.db");
    await expect(api.ack("abcd")).rejects.toThrow("ack: 503 database not found: agent_ledger.db");
  });

  test("a response without a JSON body still gives the status", async () => {
    vi.stubGlobal("fetch", async () => new Response("oops", { status: 502 }));
    await expect(api.tasks()).rejects.toThrow(/^\/api\/tasks: 502$/);
  });
});
