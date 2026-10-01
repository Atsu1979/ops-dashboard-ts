import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { groupBlocked, norm, openItems, type BlockedRow, type State } from "../src/server/items.ts";
import { toJst } from "../src/server/time.ts";

/** Runs the Python reference (copied from ops_dash.py) on the same input and compares results. */
function python(input: unknown): {
  items: Record<string, unknown>[];
  norm: string[];
  jst: (string | null)[];
} {
  const script = fileURLToPath(new URL("./reference.py", import.meta.url));
  return JSON.parse(execFileSync("python3", [script], { input: JSON.stringify(input), encoding: "utf8" }));
}

const rows: BlockedRow[] = [
  { id: 1, occurred_at: "2026-09-30 01:02:03", actor: "claude", event_type: "gate:content", scope: "tabi", summary: "記事 12 本を止めた deadbeef12" },
  { id: 2, occurred_at: "2026-09-30T05:00:00.500", actor: "claude", event_type: "gate:content", scope: "tabi", summary: "記事 3 本を止めた cafebabe99" },
  { id: 3, occurred_at: "2026-09-29T23:59:59.123456", actor: "hermes", event_type: "approval", scope: "shuzen", summary: "承認待ち：ビルド ２ 件" },
  { id: 4, occurred_at: "2026-09-30T10:00:00Z", actor: "codex", event_type: "deploy", scope: "infra", summary: "[sentinel] 再起動の嵐 7 回" },
  { id: 5, occurred_at: "not a date", actor: "shared", event_type: "approval", scope: "x", summary: null },
  { id: 6, occurred_at: "2026-09-30T00:00:00+09:00", actor: "human", event_type: "approval", scope: "shuzen", summary: "承認待ち：ビルド ３ 件" },
  { id: 7, occurred_at: "2026-09-28", actor: "claude", event_type: "gate:links", scope: "tabi", summary: "🙂 絵文字 と 長い説明".repeat(5) },
];

describe("parity with ops_dash.py", () => {
  test("norm() matches Python, including full-width digits and code-point slicing", () => {
    const samples = ["abc 123 def", "ＩＤ ０１２３ と 45", "hash 0123abcd9 end", "🙂".repeat(60), "", "deadbeefXYZ 1a2b3c4d"];
    expect(samples.map(norm)).toEqual(python({ rows: [], norm: samples }).norm);
  });

  test("toJst() matches Python fromisoformat().astimezone(JST).isoformat()", () => {
    const samples = ["2026-09-30 01:02:03", "2026-09-30T05:00:00.500", "2026-09-30T10:00:00Z", "2026-09-30T00:00:00+09:00",
      "2026-09-28", "2026-01-01T00:00:00.000000", "2026-12-31T23:30:00-05:00", "garbage", ""];
    expect(samples.map((s) => toJst(s)?.iso ?? null)).toEqual(python({ rows: [], jst: samples }).jst);
  });

  test("grouping, keys, counts and ordering match Python, with and without acks", () => {
    const states: State[] = [{}, { ack: {} }];
    const first = openItems({}, groupBlocked(rows));
    // ack one group exactly at its last time (hidden) and another one second before (still shown)
    const [a, b] = first;
    if (a?.last && b?.last) {
      states.push({ ack: { [a.key]: a.last.iso, [b.key]: "2000-01-01T00:00:00+09:00" } });
    }
    for (const state of states) {
      const ts = openItems(state, groupBlocked(rows)).map((x) => ({
        ...x, first: x.first?.iso ?? null, last: x.last?.iso ?? null,
      }));
      expect(ts).toEqual(python({ rows, state }).items);
    }
  });
});
