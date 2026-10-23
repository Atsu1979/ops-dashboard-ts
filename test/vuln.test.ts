import { normalizeVuln } from "../src/server/vuln.ts";
import { vulnLevel, type VulnRes } from "../src/web/api.ts";

describe("normalizeVuln", () => {
  test("empty or non-object input becomes zeros and empty lists", () => {
    const empty = { ts: null, images: 0, totals: { P1: 0, P2: 0, P3: 0, H: 0 }, new_hot: [], errors: [], warns: [] };
    expect(normalizeVuln({})).toEqual(empty);
    expect(normalizeVuln(null)).toEqual(empty);
    expect(normalizeVuln([1, 2])).toEqual(empty);
    expect(normalizeVuln({ totals: "x", new_hot: "x", errors: 3 })).toEqual(empty);
  });

  test("tolerates other shapes of the same keys", () => {
    const v = normalizeVuln({
      ts: 1759266000, // epoch seconds
      images: ["web", "db", "worker"],
      totals: { P1: "2", P2: null, P3: 7, HIGH: 5 },
      new_hot: [{ id: "CVE-2026-1234", image: "web", pkg: "openssl", severity: "CRITICAL" }, { other: 1 }, "CVE-2026-9"],
      errors: [{ message: "trivy timeout" }],
      warns: ["db: stale"],
    });
    expect(v.ts).toBe("2025-10-01T06:00:00+09:00");
    expect(v.images).toBe(3);
    expect(v.totals).toEqual({ P1: 2, P2: 0, P3: 7, H: 5 });
    expect(v.new_hot).toEqual(["CVE-2026-1234 web openssl CRITICAL", '{"other":1}', "CVE-2026-9"]);
    expect(v.errors).toEqual(["trivy timeout"]);
    expect(v.warns).toEqual(["db: stale"]);
  });

  test("epoch milliseconds and H wins over HIGH", () => {
    const v = normalizeVuln({ ts: 1759266000000, totals: { H: 1, HIGH: 9 } });
    expect(v.ts).toBe("2025-10-01T06:00:00+09:00");
    expect(v.totals.H).toBe(1);
  });
});

describe("vulnLevel", () => {
  const base = normalizeVuln({});
  const with_ = (p: Partial<typeof base>): VulnRes => ({ ...base, ...p });
  test("red when P1 > 0 or there are errors, yellow when P2 > 0, else green", () => {
    expect(vulnLevel(with_({ totals: { P1: 1, P2: 0, P3: 0, H: 0 } }))).toBe("red");
    expect(vulnLevel(with_({ errors: ["scan failed"] }))).toBe("red");
    expect(vulnLevel(with_({ totals: { P1: 0, P2: 3, P3: 9, H: 9 } }))).toBe("yellow");
    expect(vulnLevel(with_({ totals: { P1: 0, P2: 0, P3: 9, H: 9 }, warns: ["x"] }))).toBe("green");
  });
  test("none when there is no scan result", () => {
    expect(vulnLevel({})).toBe("none");
    expect(vulnLevel(null)).toBe("none");
  });
});
