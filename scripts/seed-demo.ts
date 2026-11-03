/**
 * Create demo data (made-up events, no real data) so the board can be tried without the real stack.
 *   node --experimental-strip-types scripts/seed-demo.ts <dir> [rows]
 * Writes <dir>/agent_ledger.db, <dir>/changes.db and <dir>/usage_mac.json.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KINDS = [
  { event_type: "approval", scope: "site-a", summary: (n: number) => `承認待ち: 記事 ${n % 7} 本の公開` },
  { event_type: "approval", scope: "infra", summary: (n: number) => `本番の設定変更 #${n % 3} を確認してほしい` },
  { event_type: "gate:content", scope: "site-b", summary: (n: number) => `品質ゲートで ${n % 11} 本を止めた run ${(n * 2654435761 >>> 0).toString(16).padStart(8, "0")}` },
  { event_type: "gate:links", scope: "site-a", summary: (n: number) => `リンク切れ ${n % 5} 件` },
  { event_type: "deploy", scope: "infra", summary: (n: number) => `[sentinel] 再起動が ${n % 4} 回続いた` },
];

/** Deterministic: the same (dir, rows, nowMs) always produces the same files. */
export function seedDemo(dir: string, rows: number, nowMs: number): void {
  mkdirSync(dir, { recursive: true });
  for (const f of ["agent_ledger.db", "changes.db"]) rmSync(join(dir, f), { force: true });

  const ledger = new DatabaseSync(join(dir, "agent_ledger.db"));
  ledger.exec(`create table agent_events(id integer primary key autoincrement, occurred_at text, actor text,
      event_type text, scope text, status text, summary text);
    create table tasks(id integer primary key autoincrement, at text, actor text, what text, status text);`);
  const ins = ledger.prepare(
    "insert into agent_events(occurred_at, actor, event_type, scope, status, summary) values (?,?,?,?,?,?)",
  );
  ledger.exec("begin");
  const span = 6 * 86400_000; // spread over the last 6 days
  for (let i = 0; i < rows; i++) {
    const k = KINDS[i % KINDS.length]!;
    const at = new Date(nowMs - span + Math.floor((span * i) / Math.max(rows, 1)));
    const status = i % 10 === 9 ? "done" : "blocked";
    ins.run(at.toISOString().slice(0, 19).replace("T", " "), `agent-${i % 3}`, k.event_type, k.scope, status, k.summary(i));
  }
  const task = ledger.prepare("insert into tasks(at, actor, what, status) values (?,?,?,?)");
  task.run(new Date(nowMs - 86400_000).toISOString().slice(0, 19), "human", "月末の請求書を送る", "未着手");
  task.run(new Date(nowMs - 3600_000).toISOString().slice(0, 19), "human", "バックアップの復元を試す", "未着手");
  task.run(new Date(nowMs - 7200_000).toISOString().slice(0, 19), "human", "終わったタスク", "完了");
  ledger.exec("commit");
  ledger.close();

  const ch = new DatabaseSync(join(dir, "changes.db"));
  ch.exec(
    "create table changes(id integer primary key autoincrement, detected_at text, kind text, added int, removed int, who text, guarded text)",
  );
  const jst = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
  const ci = ch.prepare("insert into changes(detected_at, kind, added, removed, who, guarded) values (?,?,?,?,?,?)");
  ci.run(jst(nowMs - 2 * 86400_000), "crontab", 2, 1, "agent-0", "snap-001");
  ci.run(jst(nowMs - 5 * 3600_000), "systemd", 5, 0, "agent-1", null);
  ch.close();

  const day = (back: number) => new Date(nowMs - back * 86400_000).toISOString().slice(0, 10);
  const days = Object.fromEntries(
    Array.from({ length: 8 }, (_, b) => [day(b), { weighted: 120_000 + b * 15_000, calls: 40 + b, out: 9_000 }]),
  );
  writeFileSync(
    join(dir, "usage_mac.json"),
    JSON.stringify({
      host: "mac",
      generated: new Date(nowMs).toISOString(),
      days,
      sessions: [{ project: "/work/demo-project", last: new Date(nowMs).toISOString(), weighted: 80_000, calls: 30 }],
    }),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, rows = "200"] = process.argv.slice(2);
  if (!dir) {
    console.error("usage: seed-demo.ts <dir> [rows]");
    process.exit(2);
  }
  seedDemo(dir, Number(rows), Date.now());
  console.log(`demo data (${rows} events) written to ${dir}`);
}
