/**
 * Start the built server (dist/) on demo data and check the page and the API answer.
 * Run after `npm run build`:  node --experimental-strip-types scripts/smoke.ts
 */
import { spawn } from "node:child_process";
import { request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedDemo } from "./seed-demo.ts";

const dir = mkdtempSync(join(tmpdir(), "opsdash-smoke-"));
seedDemo(dir, 200, Date.now());
const port = 18000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, ["--no-warnings=ExperimentalWarning", "dist/server/main.js"], {
  env: {
    ...process.env,
    PORT: String(port),
    OPS_LEDGER_DB: join(dir, "agent_ledger.db"),
    OPS_CHANGES_DB: join(dir, "changes.db"),
    OPS_STATE: join(dir, "state.json"),
    OPS_USAGE_MAC: join(dir, "usage_mac.json"),
    OPS_USAGE_CMD: "",
  },
  stdio: ["ignore", "pipe", "inherit"],
});

const base = `http://127.0.0.1:${port}`;
const fail = (msg: string): never => {
  srv.kill();
  rmSync(dir, { recursive: true, force: true });
  console.error(`smoke: FAIL ${msg}`);
  process.exit(1);
};

async function waitUp(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  fail("server did not start");
}

await waitUp();
const page = await fetch(`${base}/`);
const html = await page.text();
if (!page.ok || !html.includes('<div id="root">')) fail("index.html not served");
const js = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1] ?? fail("no script tag in index.html");
if (!(await fetch(base + js)).ok) fail(`asset ${js} not served`);
const items = (await (await fetch(`${base}/api/items`)).json()) as { items: { key: string }[] };
if (!items.items.length) fail("no items from demo data");
const ack = await fetch(`${base}/api/ack`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-ops-ack": "1" },
  body: JSON.stringify({ key: items.items[0]!.key }),
});
if (!ack.ok) fail(`ack returned ${ack.status}`);
// fetch() does not let us set Host, so use node:http for the DNS-rebinding check
const rebind = await new Promise<number>((resolve, reject) => {
  request(`${base}/api/health`, { headers: { host: "evil.example" } }, (r) => {
    r.resume();
    resolve(r.statusCode ?? 0);
  })
    .on("error", reject)
    .end();
});
if (rebind !== 421) fail(`host check off (${rebind})`);
if ((await fetch(`${base}/api/nope`)).status !== 404) fail("unknown API path not 404");

srv.kill();
rmSync(dir, { recursive: true, force: true });
console.log(`smoke: OK (page, ${js}, /api/items ${items.items.length} items, ack, host check, 404)`);
