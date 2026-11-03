import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CorruptStateError, loadState, runUsageCommand, saveState, totals } from "../src/server/data.ts";
import { fmt } from "../src/web/api.ts";

const dir = () => mkdtempSync(join(tmpdir(), "opsdash-data-"));

describe("state file", () => {
  test("missing file is an empty state", () => {
    expect(loadState(join(dir(), "none.json"), { strict: true })).toEqual({ seen: {}, ack: {} });
  });

  test("broken or non-object JSON: empty for display, error before writing", () => {
    for (const text of ["{ nope", "null", "[1]", '"str"']) {
      const p = join(dir(), "s.json");
      writeFileSync(p, text);
      expect(loadState(p)).toEqual({ seen: {}, ack: {} });
      expect(() => loadState(p, { strict: true })).toThrow(CorruptStateError);
    }
  });

  test("save then load round-trips and keeps unknown fields", () => {
    const p = join(dir(), "s.json");
    saveState(p, { seen: { a: "1" }, ack: { b: "2" }, other: [1, 2] });
    expect(loadState(p, { strict: true })).toEqual({ seen: { a: "1" }, ack: { b: "2" }, other: [1, 2] });
  });
});

describe("usage", () => {
  const u = { days: { "2026-09-29": { weighted: 1, calls: 1 }, "2026-09-30": { weighted: 10 }, "2026-10-01": { weighted: 100, out: 3 } } };

  test("totals sums the latest N days (by date key, not insertion order)", () => {
    expect(totals(u, 1)).toEqual({ weighted: 100, calls: 0, out: 3 });
    expect(totals(u, 2)).toEqual({ weighted: 110, calls: 0, out: 3 });
    expect(totals(u, 30)).toEqual({ weighted: 111, calls: 1, out: 3 });
    expect(totals(null, 7)).toBeNull();
    expect(totals({}, 7)).toBeNull();
  });

  test("runUsageCommand returns parsed JSON, or null on failure / bad output", async () => {
    expect(await runUsageCommand([process.execPath, "-e", 'console.log(JSON.stringify({host:"s"}))'])).toEqual({ host: "s" });
    expect(await runUsageCommand([process.execPath, "-e", "console.log('not json')"])).toBeNull();
    expect(await runUsageCommand([process.execPath, "-e", "process.exit(3)"])).toBeNull();
    expect(await runUsageCommand(["/nonexistent/binary"])).toBeNull();
    expect(await runUsageCommand([])).toBeNull();
  });
});

describe("fmt (UI number format)", () => {
  test.each([
    [null, "0"], [undefined, "0"], [0, "0"], [1234.4, "1,234"], [9999, "9,999"], [10000, "1.0万"], [123456, "12.3万"],
  ])("%j -> %s", (n, s) => expect(fmt(n)).toBe(s));
});
