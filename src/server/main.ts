import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { createApp } from "./app.ts";

const env = process.env;
const home = env.HOME ?? "/home/ubuntu";

const app = createApp({
  ledgerDb: env.OPS_LEDGER_DB ?? `${home}/agent_ledger.db`,
  changesDb: env.OPS_CHANGES_DB ?? `${home}/ops/changes.db`,
  statePath: env.OPS_STATE ?? `${home}/ops/ops_dash_state.json`,
  usageMacPath: env.OPS_USAGE_MAC ?? `${home}/ops/usage_mac.json`,
  usageCmd: (env.OPS_USAGE_CMD ?? `python3 ${home}/cc_usage.py --dir ${home}/.claude/projects --host server`)
    .split(" ")
    .filter(Boolean),
  days: Number(env.OPS_DAYS ?? 7),
  usageCacheMs: 5 * 60_000,
});

// Built UI (vite build -> dist/web). serveStatic resolves paths relative to cwd.
const webDir = relative(process.cwd(), join(dirname(fileURLToPath(import.meta.url)), "..", "web"));
app.use("/*", serveStatic({ root: webDir }));
app.get("*", serveStatic({ path: join(webDir, "index.html") }));

const port = Number(env.PORT ?? 8787);
const hostname = env.HOST ?? "127.0.0.1"; // localhost only: reach it through an SSH tunnel
serve({ fetch: app.fetch, port, hostname }, (i) => console.log(`ops-dashboard on http://${hostname}:${i.port}`));
