import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

let cfg;
try {
  cfg = loadConfig(process.env);
} catch (e) {
  console.error(`config error: ${(e as Error).message}`);
  process.exit(2);
}

const app = createApp(cfg.app);

// Built UI (vite build -> dist/web). serveStatic resolves paths relative to cwd.
const webDir = relative(process.cwd(), join(dirname(fileURLToPath(import.meta.url)), "..", "web"));
app.use("/*", serveStatic({ root: webDir }));
app.get("*", serveStatic({ path: join(webDir, "index.html") }));

const { port, hostname } = cfg;
serve({ fetch: app.fetch, port, hostname }, (i) => console.log(`ops-dashboard on http://${hostname}:${i.port}`));
