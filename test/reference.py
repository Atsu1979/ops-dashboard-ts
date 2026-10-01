# -*- coding: utf-8 -*-
"""Reference implementation copied from ops_dash.py (to_jst / norm / key / grouping / open_items).
Reads JSON {"rows": [...], "state": {...}} on stdin, prints the open items. Used by test/parity.test.ts."""
import datetime, hashlib, json, re, sys

JST = datetime.timezone(datetime.timedelta(hours=9))


def to_jst(s):
    s = (s or "").replace("Z", "+00:00")
    try:
        t = datetime.datetime.fromisoformat(s.replace(" ", "T"))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=datetime.timezone.utc)
    return t.astimezone(JST)


def norm(summary):
    s = re.sub(r"[0-9a-f]{8,}", "#", summary or "")
    s = re.sub(r"\d+", "#", s)
    return s[:48]


def items(rows):
    g = {}
    for rid, at, actor, et, scope, summ in rows:
        kind = "警報" if (et.startswith("gate:") or "[sentinel]" in (summ or "")) else "本人待ち"
        key = hashlib.sha1((et + "|" + norm(summ)).encode("utf-8")).hexdigest()[:8]
        t = to_jst(at)
        x = g.setdefault(key, {"key": key, "kind": kind, "event_type": et, "scope": scope, "actor": actor,
                               "count": 0, "first": t, "last": t, "last_id": rid, "summary": summ})
        x["count"] += 1
        if t and (x["last"] is None or t >= x["last"]):
            x["last"], x["last_id"], x["summary"] = t, rid, summ
        if t and (x["first"] is None or t < x["first"]):
            x["first"] = t
    return list(g.values())


def open_items(st, g):
    res = []
    for x in g:
        ack = st.get("ack", {}).get(x["key"])
        if ack and x["last"] and x["last"].isoformat() <= ack:
            continue
        res.append(x)
    res.sort(key=lambda x: (x["kind"] != "本人待ち", -(x["last"].timestamp() if x["last"] else 0)))
    return res


inp = json.load(sys.stdin)
rows = [(r["id"], r["occurred_at"], r["actor"], r["event_type"], r["scope"], r["summary"]) for r in inp["rows"]]
out = open_items(inp.get("state", {}), items(rows))
for x in out:
    for f in ("first", "last"):
        x[f] = x[f].isoformat() if x[f] else None
print(json.dumps({"items": out, "norm": [norm(s) for s in inp.get("norm", [])],
                  "jst": [(to_jst(s).isoformat() if to_jst(s) else None) for s in inp.get("jst", [])]}, ensure_ascii=False))
