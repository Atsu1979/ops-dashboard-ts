import { homedir } from "node:os";
import type { Config } from "./app.ts";

export interface ServerConfig {
  app: Config;
  port: number;
  hostname: string;
}

function intIn(raw: string | undefined, name: string, def: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
  }
  return n;
}

/**
 * OPS_USAGE_CMD: either a JSON array (`["python3","/path with space/cc_usage.py"]`) or a
 * space-separated command. Empty string disables the server-side usage collection.
 */
export function parseCommand(raw: string): string[] {
  const s = raw.trim();
  if (s.startsWith("[")) {
    const v: unknown = JSON.parse(s);
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
      throw new Error("OPS_USAGE_CMD as JSON must be an array of strings");
    }
    return v;
  }
  return s.split(/\s+/).filter(Boolean);
}

/** Build the server configuration from environment variables; throws on invalid values. */
export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const home = env.HOME ?? homedir();
  const hostname = env.HOST ?? "127.0.0.1"; // localhost only: reach it through an SSH tunnel
  const extra = (env.OPS_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return {
    port: intIn(env.PORT, "PORT", 8787, 1, 65535),
    hostname,
    app: {
      ledgerDb: env.OPS_LEDGER_DB ?? `${home}/agent_ledger.db`,
      changesDb: env.OPS_CHANGES_DB ?? `${home}/ops/changes.db`,
      statePath: env.OPS_STATE ?? `${home}/ops/ops_dash_state.json`,
      usageMacPath: env.OPS_USAGE_MAC ?? `${home}/ops/usage_mac.json`,
      usageCmd: parseCommand(
        env.OPS_USAGE_CMD ?? `python3 ${home}/cc_usage.py --dir ${home}/.claude/projects --host server`,
      ),
      days: intIn(env.OPS_DAYS, "OPS_DAYS", 7, 1, 90),
      usageCacheMs: 5 * 60_000,
      allowedHosts: ["localhost", "127.0.0.1", "[::1]", ...extra],
    },
  };
}
