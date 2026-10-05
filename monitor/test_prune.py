"""Check: rows older than RETENTION_DAYS are deleted, but the newest row per currency always survives.
Run: docker compose run --rm -v ./monitor:/app monitor python test_prune.py"""
import datetime as dt
import sqlite3
import monitor as m

db = sqlite3.connect(":memory:")
db.executescript(m.SCHEMA)
now = dt.datetime.now(dt.timezone.utc)
ins = lambda days: db.execute("INSERT INTO rates(fetched_at,currency,erate_jual) VALUES(?,?,?)",
                              ((now - dt.timedelta(days=days)).isoformat(), "JPY", 110.0))
for d in (30, 11, 9, 1):
    ins(d)
assert m.prune_old(db) == 2                                         # 30d and 11d rows gone
assert db.execute("SELECT COUNT(*) FROM rates").fetchone()[0] == 2
db.execute("DELETE FROM rates WHERE id IN (3,4)"); ins(20)          # only a stale row left
assert m.prune_old(db) == 0 and db.execute("SELECT COUNT(*) FROM rates").fetchone()[0] == 1  # newest kept
print("ok")
