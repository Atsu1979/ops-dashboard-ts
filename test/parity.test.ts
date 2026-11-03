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
  return JSON.parse(execFileSync(process.env.PYTHON ?? "python3", [script], { input: JSON.stringify(input), encoding: "utf8" }));
}

const rows: BlockedRow[] = [
  { id: 1, occurred_at: "2026-09-30 01:02:03", actor: "claude", event_type: "gate:content", scope: "site-a", summary: "記事 12 本を止めた deadbeef12" },
  { id: 2, occurred_at: "2026-09-30T05:00:00.500", actor: "claude", event_type: "gate:content", scope: "site-a", summary: "記事 3 本を止めた cafebabe99" },
  { id: 3, occurred_at: "2026-09-29T23:59:59.123456", actor: "agent-b", event_type: "approval", scope: "site-b", summary: "承認待ち：ビルド ２ 件" },
  { id: 4, occurred_at: "2026-09-30T10:00:00Z", actor: "codex", event_type: "deploy", scope: "infra", summary: "[sentinel] 再起動の嵐 7 回" },
  { id: 5, occurred_at: "not a date", actor: "shared", event_type: "approval", scope: "x", summary: null },
  { id: 6, occurred_at: "2026-09-30T00:00:00+09:00", actor: "human", event_type: "approval", scope: "site-b", summary: "承認待ち：ビルド ３ 件" },
  { id: 7, occurred_at: "2026-09-28", actor: "claude", event_type: "gate:links", scope: "site-a", summary: "🙂 絵文字 と 長い説明".repeat(5) },
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

  test("toJst() rejects out-of-range fields like Python (no silent roll-over)", () => {
    const samples = ["2026-02-30 00:00:00", "2025-02-29", "2024-02-29", "2026-13-01", "2026-00-10", "2026-09-30T24:00:00",
      "2026-09-30T23:60:00", "2026-09-30T23:59:60", "2026-09-30T01:02:03+24:00", "0000-01-01",
      "0001-01-01T00:00:00", "0099-03-04T05:06:07", "2026-04-31"];
    expect(samples.map((s) => toJst(s)?.iso ?? null)).toEqual(python({ rows: [], jst: samples }).jst);
  });

  test("toJst() follows Python 3.10 (production) for formats only 3.11+ accepts", () => {
    // fromisoformat() in 3.11+ also takes these; 3.10, which runs ops_dash.py, raises ValueError.
    expect(["2026-09-30T01", "2026-09-30T01:02:03.1", "20260930", "2026-09-30t01:02:03"].map((s) => toJst(s))).toEqual([
      null, null, null, null,
    ]);
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

describe("parity on generated input (fixed seed)", () => {
  // small deterministic PRNG (mulberry32) so a failure is reproducible
  function rng(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const r = rng(20261103);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const two = (n: number) => String(n).padStart(2, "0");

  function timestamp(): string {
    const y = pick(["2026", "2024", "2025", "0001", "1999", "0000"]);
    const date = `${y}-${two(1 + Math.floor(r() * 13))}-${two(1 + Math.floor(r() * 31))}`; // month 13 / day 31 sometimes invalid
    const time = `${two(Math.floor(r() * 25))}:${two(Math.floor(r() * 61))}:${two(Math.floor(r() * 61))}`; // 24 / 60 sometimes
    const frac = pick(["", "", ".123", ".000000", ".500000", ".999999"]);
    const tz = pick(["", "", "Z", "+09:00", "-05:30", "+00:00", "+23:59", "+24:00"]);
    return pick([`${date} ${time}${frac}`, `${date}T${time}${frac}${tz}`, date, "garbage"]);
  }

  test("3000 random timestamps", () => {
    const samples = Array.from({ length: 3000 }, timestamp);
    expect(samples.map((s) => toJst(s)?.iso ?? null)).toEqual(python({ rows: [], jst: samples }).jst);
  });

  test("2000 random rows: groups, keys, counts, first/last and ordering", () => {
    const summaries = ["承認待ち: ビルド ", "記事 本を止めた run ", "[sentinel] 再起動 ", "ＩＤ ０１ ", "🙂 ", null];
    const rows: BlockedRow[] = Array.from({ length: 2000 }, (_, i) => {
      const base = pick(summaries);
      return {
        id: i + 1,
        occurred_at: pick([timestamp(), `2026-09-${two(1 + Math.floor(r() * 28))} ${two(Math.floor(r() * 24))}:00:00`]),
        actor: pick(["a", "b"]),
        event_type: pick(["approval", "gate:content", "deploy"]),
        scope: pick(["s1", "s2"]),
        summary: base === null ? null : base + Math.floor(r() * 1e6).toString(pick([10, 16])),
      };
    });
    const ts = openItems({}, groupBlocked(rows)).map((x) => ({ ...x, first: x.first?.iso ?? null, last: x.last?.iso ?? null }));
    expect(ts.length).toBeGreaterThan(5);
    expect(ts).toEqual(python({ rows, state: {} }).items);
  });
});
