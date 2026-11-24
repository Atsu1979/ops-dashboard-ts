import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { homedir } from "node:os";
import { createApp } from "./app.ts";

const env = process.env;
const home = env.HOME ?? homedir();

const app = createApp({
  eventsDb: env.OPS_EVENTS_DB ?? `${home}/agent_events.db`,
  changesDb: env.OPS_CHANGES_DB ?? `${home}/data/changes.db`,
  statePath: env.OPS_STATE ?? `${home}/data/dash_state.json`,
  usageMacPath: env.OPS_USAGE_MAC ?? `${home}/data/usage_mac.json`,
  usageCmd: (env.OPS_USAGE_CMD ?? `python3 ${home}/usage.py --dir ${home}/.claude/projects --host server`)
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
