import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, hostName, type Config } from "../src/server/app.ts";

function cfg(over: Partial<Config> = {}): Config {
  const dir = mkdtempSync(join(tmpdir(), "opsdash-sec-"));
  const db = new DatabaseSync(join(dir, "ledger.db"));
  db.exec(`create table agent_events(id integer primary key, occurred_at text, actor text, event_type text, scope text,
    status text, summary text); create table tasks(id integer primary key, at text, what text, status text);`);
  db.prepare("insert into agent_events(occurred_at, actor, event_type, scope, status, summary) values (?,?,?,?,?,?)")
    .run("2026-09-30 01:00:00", "a", "approval", "s", "blocked", "承認待ち");
  db.close();
  return {
    ledgerDb: join(dir, "ledger.db"),
    changesDb: join(dir, "changes.db"),
    statePath: join(dir, "state.json"),
    usageMacPath: join(dir, "usage_mac.json"),
    usageCmd: [],
    days: 7,
    usageCacheMs: 0,
    allowedHosts: ["localhost", "127.0.0.1", "[::1]"],
    now: () => Date.UTC(2026, 9, 1, 3, 0, 0),
    ...over,
  };
}

const ACK = { "x-ops-ack": "1", "content-type": "application/json" };

describe("host check (DNS rebinding)", () => {
  test.each([
    ["localhost:8787", 200],
    ["127.0.0.1:9000", 200], // a different local port through an SSH tunnel is fine
    ["[::1]:8787", 200],
    ["LOCALHOST", 200],
    ["evil.example:8787", 421],
    ["127.0.0.1.evil.example", 421],
    ["", 421],
  ])("Host %j -> %i", async (host, status) => {
    const app = createApp(cfg());
    const r = await app.request("http://x/api/health", { headers: host ? { host } : {} });
    expect(r.status).toBe(status);
  });

  test("a rebinding page cannot ack even with the custom header", async () => {
    const c = cfg();
    const app = createApp(c);
    const r = await app.request("http://x/api/ack", {
      method: "POST",
      headers: { ...ACK, host: "evil.example" },
      body: JSON.stringify({ key: "abcd" }),
    });
    expect(r.status).toBe(421);
    expect(() => readFileSync(c.statePath)).toThrow();
  });

  test("hostName strips the port and lower-cases", () => {
    expect(hostName("Example.COM:80")).toBe("example.com");
    expect(hostName("[::1]:8787")).toBe("[::1]");
    expect(hostName(undefined)).toBe("");
  });
});

describe("responses", () => {
  const local = { headers: { host: "localhost" } };

  test("security headers on every response, no-store on the API", async () => {
    const r = await createApp(cfg()).request("http://x/api/items", local);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  test("missing ledger database is a 503 JSON error without the full path", async () => {
    const app = createApp(cfg({ ledgerDb: "/nonexistent/secret-dir/agent_ledger.db" }));
    for (const p of ["/api/items", "/api/tasks"]) {
      const r = await app.request(`http://x${p}`, local);
      expect(r.status).toBe(503);
      const body = (await r.json()) as { error: string };
      expect(body.error).toBe("database not found: agent_ledger.db");
      expect(body.error).not.toContain("secret-dir");
      expect(r.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  test("unknown API paths are JSON 404, not the SPA page", async () => {
    const r = await createApp(cfg()).request("http://x/api/nope", local);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not found" });
  });

  test("ack refuses to overwrite a state file it cannot parse", async () => {
    const c = cfg();
    writeFileSync(c.statePath, "{ broken json");
    const app = createApp(c);
    const key = ((await (await app.request("http://x/api/items", local)).json()) as { items: { key: string }[] }).items[0]!.key;
    const r = await app.request("http://x/api/ack", {
      method: "POST",
      headers: { ...ACK, host: "localhost" },
      body: JSON.stringify({ key }),
    });
    expect(r.status).toBe(409);
    expect(readFileSync(c.statePath, "utf8")).toBe("{ broken json");
  });

  test.each([
    ["no body", undefined],
    ["not JSON", "key=abcd"],
    ["number key", JSON.stringify({ key: 1234 })],
    ["upper-case hex", JSON.stringify({ key: "ABCD" })],
    ["too short", JSON.stringify({ key: "abc" })],
    ["too long", JSON.stringify({ key: "abcdef012" })],
  ])("ack rejects %s with 400", async (_name, body) => {
    const r = await createApp(cfg()).request("http://x/api/ack", {
      method: "POST",
      headers: { ...ACK, host: "localhost" },
      ...(body === undefined ? {} : { body }),
    });
    expect(r.status).toBe(400);
  });

  test("ack with an unknown prefix changes nothing", async () => {
    const c = cfg();
    const r = await createApp(c).request("http://x/api/ack", {
      method: "POST",
      headers: { ...ACK, host: "localhost" },
      body: JSON.stringify({ key: "0000" }),
    });
    expect(await r.json()).toEqual({ acked: [] });
    expect(() => readFileSync(c.statePath)).toThrow();
  });
});
