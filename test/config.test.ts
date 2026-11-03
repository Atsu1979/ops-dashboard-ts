import { loadConfig, parseCommand } from "../src/server/config.ts";

describe("loadConfig", () => {
  test("defaults: localhost only, port 8787, 7 days", () => {
    const c = loadConfig({ HOME: "/home/u" });
    expect(c.hostname).toBe("127.0.0.1");
    expect(c.port).toBe(8787);
    expect(c.app.days).toBe(7);
    expect(c.app.ledgerDb).toBe("/home/u/agent_ledger.db");
    expect(c.app.allowedHosts).toEqual(["localhost", "127.0.0.1", "[::1]"]);
  });

  test("OPS_ALLOWED_HOSTS adds host names", () => {
    expect(loadConfig({ HOME: "/h", OPS_ALLOWED_HOSTS: "ops.lan, box " }).app.allowedHosts).toEqual([
      "localhost", "127.0.0.1", "[::1]", "ops.lan", "box",
    ]);
  });

  test.each([
    ["PORT", "abc"], ["PORT", "0"], ["PORT", "70000"], ["PORT", "80.5"],
    ["OPS_DAYS", "seven"], ["OPS_DAYS", "0"], ["OPS_DAYS", "91"],
  ])("%s=%j is rejected instead of becoming NaN", (k, v) => {
    expect(() => loadConfig({ HOME: "/h", [k]: v })).toThrow(k);
  });

  test("OPS_USAGE_CMD empty disables the command", () => {
    expect(loadConfig({ HOME: "/h", OPS_USAGE_CMD: "" }).app.usageCmd).toEqual([]);
  });
});

describe("parseCommand", () => {
  test("space separated", () => expect(parseCommand(" python3  a.py --x 1 ")).toEqual(["python3", "a.py", "--x", "1"]));
  test("JSON array keeps spaces in paths", () =>
    expect(parseCommand('["python3", "/my dir/cc_usage.py"]')).toEqual(["python3", "/my dir/cc_usage.py"]));
  test("JSON that is not a string array is an error", () => expect(() => parseCommand("[1, 2]")).toThrow());
});
