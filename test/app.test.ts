import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type Config } from "../src/server/app.ts";

const NOW = Date.UTC(2026, 9, 1, 3, 0, 0); // 2026-10-01 12:00 JST

function fixture(): Config {
  const dir = mkdtempSync(join(tmpdir(), "opsdash-"));
  const ledger = new DatabaseSync(join(dir, "ledger.db"));
  ledger.exec(`create table agent_events(id integer primary key autoincrement, occurred_at text, actor text,
      event_type text, scope text, status text, summary text);
    create table tasks(id integer primary key autoincrement, at text, actor text, what text, status text, why text default '', closed_at text);`);
  const ins = ledger.prepare("insert into agent_events(occurred_at, actor, event_type, scope, status, summary) values (?,?,?,?,?,?)");
  ins.run("2026-09-30 01:00:00", "claude", "gate:content", "tabi", "blocked", "記事 3 本を止めた");
  ins.run("2026-09-30 02:00:00", "claude", "gate:content", "tabi", "blocked", "記事 5 本を止めた");
  ins.run("2026-09-30 03:00:00", "hermes", "approval", "shuzen", "blocked", "承認待ち: ビルド");
  ins.run("2026-09-30 04:00:00", "hermes", "approval", "shuzen", "done", "終わった件は出ない");
  ins.run("2026-09-01 04:00:00", "hermes", "approval", "old", "blocked", "8日以上前は出ない");
  ledger.prepare("insert into tasks(at, actor, what, status) values (?,?,?,?)").run("2026-09-29T10:00:00", "human", "請求書を送る", "未着手");
  ledger.prepare("insert into tasks(at, actor, what, status) values (?,?,?,?)").run("2026-09-29T10:00:00", "human", "済み", "完了");
  ledger.close();
  const ch = new DatabaseSync(join(dir, "changes.db"));
  ch.exec("create table changes(id integer primary key autoincrement, detected_at text, kind text, added int, removed int, who text, guarded text)");
  ch.prepare("insert into changes(detected_at, kind, added, removed, who, guarded) values (?,?,?,?,?,?)").run("2026-09-30 10:00", "crontab", 2, 1, "claude", null);
  ch.close();
  writeFileSync(join(dir, "usage_mac.json"), JSON.stringify({ generated: "x", days: { "2026-09-30": { weighted: 100, calls: 2, out: 5 }, "2026-10-01": { weighted: 50, calls: 1, out: 1 } }, sessions: [] }));
  return {
    ledgerDb: join(dir, "ledger.db"),
    changesDb: join(dir, "changes.db"),
    statePath: join(dir, "state.json"),
    usageMacPath: join(dir, "usage_mac.json"),
    vulnPath: join(dir, "vuln_status.json"),
    usageCmd: [],
    days: 7,
    usageCacheMs: 0,
    now: () => NOW,
  };
}

describe("API", () => {
  test("items: groups blocked events of the last 7 days, 本人待ち first", async () => {
    const app = createApp(fixture());
    const r = await (await app.request("/api/items")).json();
    expect(r.items.map((x: { kind: string; count: number }) => [x.kind, x.count])).toEqual([["本人待ち", 1], ["警報", 2]]);
    expect(r.items[1].summary).toBe("記事 5 本を止めた"); // latest summary wins
    expect(r.items[1].last).toBe("2026-09-30T11:00:00+09:00");
  });

  test("ack needs the custom header, validates the key, and hides the item", async () => {
    const cfg = fixture();
    const app = createApp(cfg);
    const key = (await (await app.request("/api/items")).json()).items[0].key as string;
    const post = (headers: Record<string, string>, body: unknown) =>
      app.request("/api/ack", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

    expect((await post({}, { key })).status).toBe(403);
    expect((await post({ "x-ops-ack": "1" }, { key: "zz; rm -rf" })).status).toBe(400);
    const ok = await (await post({ "x-ops-ack": "1" }, { key: key.slice(0, 5) })).json();
    expect(ok.acked).toEqual([key]);
    expect(JSON.parse(readFileSync(cfg.statePath, "utf8")).ack[key]).toBe("2026-10-01T12:00:00+09:00");
    const after = await (await app.request("/api/items")).json();
    expect(after.items.map((x: { key: string }) => x.key)).not.toContain(key);
  });

  test("ack keeps other fields of the state file (written by ops_dash.py too)", async () => {
    const cfg = fixture();
    writeFileSync(cfg.statePath, JSON.stringify({ seen: { abc12345: "t" }, ack: {}, extra: 1 }));
    const app = createApp(cfg);
    const key = (await (await app.request("/api/items")).json()).items[0].key as string;
    await app.request("/api/ack", { method: "POST", headers: { "x-ops-ack": "1" }, body: JSON.stringify({ key }) });
    const st = JSON.parse(readFileSync(cfg.statePath, "utf8"));
    expect(st.seen).toEqual({ abc12345: "t" });
    expect(st.extra).toBe(1);
  });

  test("tasks, changes and usage", async () => {
    const app = createApp(fixture());
    const t = await (await app.request("/api/tasks")).json();
    expect(t.tasks.map((x: { what: string }) => x.what)).toEqual(["請求書を送る"]);
    expect(t.tasks[0].at_jst).toBe("2026-09-29T19:00:00+09:00");
    const c = await (await app.request("/api/changes?days=7")).json();
    expect(c.changes).toHaveLength(1);
    const u = await (await app.request("/api/usage")).json();
    expect(u.mac.today.weighted).toBe(50);
    expect(u.mac.week.weighted).toBe(150);
    expect(u.server).toBeNull();
  });

  test("vuln: missing or broken file gives {} with 200", async () => {
    const cfg = fixture();
    const app = createApp(cfg);
    const missing = await app.request("/api/vuln");
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({});
    writeFileSync(cfg.vulnPath, "{not json");
    const broken = await app.request("/api/vuln");
    expect(broken.status).toBe(200);
    expect(await broken.json()).toEqual({});
  });

  test("vuln: returns the scan with defaults for missing keys", async () => {
    const cfg = fixture();
    writeFileSync(cfg.vulnPath, JSON.stringify({ ts: "2026-10-01T06:00:00+09:00", images: 12, totals: { P1: 1, H: 4 }, new_hot: ["CVE-2026-0001 nginx"] }));
    const r = await (await createApp(cfg).request("/api/vuln")).json();
    expect(r).toEqual({
      ts: "2026-10-01T06:00:00+09:00",
      images: 12,
      totals: { P1: 1, P2: 0, P3: 0, H: 4 },
      new_hot: ["CVE-2026-0001 nginx"],
      errors: [],
      warns: [],
    });
  });
});
