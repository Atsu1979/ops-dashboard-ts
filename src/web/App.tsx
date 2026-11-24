import { useCallback, useEffect, useMemo, useState } from "react";
import { api, fmt, type Change, type ItemsRes, type Task, type UsageRes } from "./api.ts";

type Filter = "all" | "本人待ち" | "警報";
const REFRESH_MS = 60_000;
const short = (iso: string | null) => (iso ? iso.slice(5, 16).replace("T", " ") : "—");

export function App() {
  const [items, setItems] = useState<ItemsRes | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [usage, setUsage] = useState<UsageRes | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [i, t, c] = await Promise.all([api.items(), api.tasks(), api.changes(7)]);
      setItems(i);
      setTasks(t.tasks);
      setChanges(c.changes);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
    api.usage().then(setUsage).catch(() => setUsage(null));
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (items?.items ?? []).filter(
      (x) =>
        (filter === "all" || x.kind === filter) &&
        (!needle || `${x.event_type} ${x.scope} ${x.summary ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [items, filter, q]);

  const waiting = items?.items.filter((x) => x.kind === "本人待ち").length ?? 0;
  const alerts = items?.items.filter((x) => x.kind === "警報").length ?? 0;
  const unguarded = changes.filter((c) => !c.guarded).length;

  async function ack(key: string) {
    setBusy(key);
    try {
      await api.ack(key);
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main>
      <header>
        <h1>運用の見張り板</h1>
        <span className="muted">{items ? `${short(items.generated)} 更新・直近${items.days}日` : "読み込み中…"}</span>
      </header>
      {err && <p className="error">{err}</p>}

      <section className="cards">
        <Card label="本人待ち" value={waiting} alert={waiting > 0} />
        <Card label="警報" value={alerts} alert={alerts > 0} />
        <Card label="未着手タスク" value={tasks.length} />
        <Card label="snapshot なしの変更" value={unguarded} alert={unguarded > 0} />
        {(["mac", "server"] as const).map((h) => (
          <Card
            key={h}
            label={`トークン ${h}（今日／7日）`}
            value={usage?.[h] ? `${fmt(usage[h]?.today?.weighted)}／${fmt(usage[h]?.week?.weighted)}` : "—"}
          />
        ))}
      </section>

      <section>
        <div className="bar">
          <h2>本人待ち・警報</h2>
          <div className="seg" role="tablist">
            {(["all", "本人待ち", "警報"] as const).map((f) => (
              <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "すべて" : f}
              </button>
            ))}
          </div>
          <input placeholder="絞り込み（種類・内容）" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="wrap">
          <table>
            <thead>
              <tr><th>種類</th><th>記録</th><th>回</th><th>最後</th><th>内容</th><th /></tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={6} className="muted">なし</td></tr>}
              {shown.map((x) => (
                <tr key={x.key}>
                  <td><span className={x.kind === "警報" ? "tag red" : "tag"}>{x.kind}</span></td>
                  <td><code>{x.event_type}</code><div className="muted">{x.key}・{x.scope}</div></td>
                  <td className="num">{x.count}</td>
                  <td className="nowrap">{short(x.last)}</td>
                  <td>{x.summary}</td>
                  <td>
                    <button disabled={busy === x.key} onClick={() => void ack(x.key)}>
                      {busy === x.key ? "…" : "見た"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>未着手のタスク</h2>
        <div className="wrap">
          <table>
            <tbody>
              {tasks.length === 0 && <tr><td className="muted">なし</td></tr>}
              {tasks.map((t) => (
                <tr key={t.id}><td className="num">{t.id}</td><td className="nowrap">{short(t.at_jst)}</td><td>{t.what}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>設定の変更（直近7日）</h2>
        <div className="wrap">
          <table>
            <thead><tr><th>時刻</th><th>対象</th><th>行</th><th>誰</th><th>snapshot</th></tr></thead>
            <tbody>
              {changes.length === 0 && <tr><td colSpan={5} className="muted">なし</td></tr>}
              {changes.map((c) => (
                <tr key={c.id}>
                  <td className="nowrap">{c.detected_at.slice(5)}</td>
                  <td>{c.kind}</td>
                  <td className="nowrap">+{c.added}/-{c.removed}</td>
                  <td>{c.who}</td>
                  <td>{c.guarded ? "あり" : <b className="red">なし</b>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>重い会話（入力換算の順）</h2>
        <div className="wrap">
          <table>
            <thead><tr><th>機械</th><th>場所</th><th>最後</th><th>入力換算</th><th>回</th></tr></thead>
            <tbody>
              {(["mac", "server"] as const).flatMap((h) =>
                (usage?.[h]?.sessions ?? []).slice(0, 5).map((s, i) => (
                  <tr key={`${h}${i}`}>
                    <td>{h}</td>
                    <td className="ellipsis">{(s.project ?? "").slice(-40)}</td>
                    <td className="nowrap">{short(s.last ?? null)}</td>
                    <td className="num">{fmt(s.weighted)}</td>
                    <td className="num">{s.calls ?? 0}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
        <p className="muted small">入力換算 = 入力 + キャッシュ作成×1.25 + キャッシュ読み×0.1 + 出力×5（料金の比率で、金額ではない）。</p>
      </section>
    </main>
  );
}

function Card({ label, value, alert = false }: { label: string; value: number | string; alert?: boolean }) {
  return (
    <div className="card">
      <div className="muted small">{label}</div>
      <div className={`big${alert ? " red" : ""}${typeof value === "string" ? " mid" : ""}`}>{value}</div>
    </div>
  );
}
