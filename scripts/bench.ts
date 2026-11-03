/**
 * Measure /api/items on synthetic data (seed-demo.ts), in process (no network).
 *   node --experimental-strip-types --no-warnings=ExperimentalWarning scripts/bench.ts [rows...]
 * Prints a Markdown table: rows, groups, median and p95 latency of GET /api/items.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createApp } from "../src/server/app.ts";
import { seedDemo } from "./seed-demo.ts";

const sizes = process.argv.slice(2).map(Number).filter((n) => n > 0);
const ROWS = sizes.length ? sizes : [1_000, 10_000, 100_000];
const RUNS = 30;
const NOW = Date.UTC(2026, 9, 1, 3, 0, 0);

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!;
};

console.log(`node ${process.version} / ${cpus()[0]?.model ?? "?"} x${cpus().length} / ${RUNS} runs each (after 3 warm-up)\n`);
console.log("| blocked rows | groups | median ms | p95 ms |");
console.log("|---:|---:|---:|---:|");
for (const rows of ROWS) {
  const dir = mkdtempSync(join(tmpdir(), "opsdash-bench-"));
  seedDemo(dir, rows, NOW);
  const app = createApp({
    ledgerDb: join(dir, "agent_ledger.db"),
    changesDb: join(dir, "changes.db"),
    statePath: join(dir, "state.json"),
    usageMacPath: join(dir, "usage_mac.json"),
    usageCmd: [],
    days: 7,
    usageCacheMs: 0,
    now: () => NOW,
  });
  const times: number[] = [];
  let body: { total_groups: number } = { total_groups: 0 };
  for (let i = 0; i < RUNS + 3; i++) {
    const t0 = performance.now();
    const r = await app.request("/api/items");
    body = (await r.json()) as { total_groups: number };
    if (i >= 3) times.push(performance.now() - t0);
  }
  const blocked = rows - Math.floor(rows / 10); // every 10th demo row is "done"
  console.log(`| ${blocked.toLocaleString("en")} | ${body.total_groups} | ${q(times, 0.5).toFixed(1)} | ${q(times, 0.95).toFixed(1)} |`);
  rmSync(dir, { recursive: true, force: true });
}
