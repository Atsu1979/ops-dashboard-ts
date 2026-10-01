# ops-dashboard-ts

A watch board for a one-person AI automation stack: blocked agent events (alerts and items
waiting for a human), open tasks, production config changes, and Claude Code token usage, on one page.

It is the TypeScript rewrite of a Python script (`ops_dash.py`) that rendered a static HTML page every
10 minutes. The rewrite adds a live API, filtering, and an **ack button** in place of a CLI command, while
keeping the same data files so both versions run side by side.

- **API**: [Hono](https://hono.dev) on Node 22, reading SQLite through the built-in `node:sqlite` (no native modules)
- **UI**: React 19 + Vite, TypeScript `strict` (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- **Tests**: Vitest. A parity suite runs the original Python logic on the same input and requires identical
  output (grouping keys, counts, timestamps, ordering, ack filtering)
- **CI**: GitHub Actions (typecheck, tests, build)

## Why the parity tests

Incidents are grouped by `sha1(event_type + "|" + norm(summary))[:8]`, and acks are stored as ISO strings and
compared as strings. Small differences between Python and JavaScript would silently split groups or
re-show acknowledged items, so the tests pin them down:

| Python behaviour | What the TS code does |
|---|---|
| `\d` matches any Unicode digit (e.g. full-width `０１２`) | `\p{Nd}` with the `u` flag |
| `s[:48]` counts code points | `Array.from(s).slice(0, 48)` |
| `datetime.isoformat()` prints 6-digit microseconds, omitted when zero | timestamps carried as integer microseconds, formatted the same way |
| naive ledger timestamps are UTC | same, then shown in JST (+09:00) |

## API

| Method | Path | |
|---|---|---|
| GET | `/api/items` | open incidents of the last N days (本人待ち first, newest first) |
| GET | `/api/tasks` | tasks not started |
| GET | `/api/changes?days=7` | detected config changes and whether they went through a snapshot |
| GET | `/api/usage` | token usage per machine (today / 7 days, heaviest sessions) |
| POST | `/api/ack` | `{ "key": "<4-8 hex>" }` marks matching incidents as seen |

`POST /api/ack` requires an `x-ops-ack: 1` header. A page on another origin cannot send a custom header
without a CORS preflight, which this server never answers, so a browser cannot be tricked into acking.
The server binds to `127.0.0.1` and is reached through an SSH tunnel.

## Run

```sh
npm ci
npm test
npm run build
OPS_LEDGER_DB=~/agent_ledger.db OPS_CHANGES_DB=~/ops/changes.db OPS_STATE=~/ops/ops_dash_state.json \
OPS_USAGE_MAC=~/ops/usage_mac.json PORT=8787 npm start
# from a laptop: ssh -L 8787:127.0.0.1:8787 server, then open http://localhost:8787
```

Requires Node ≥ 22.13 (`node:sqlite`) and, for the parity tests, Python 3.11+.

## License

MIT
