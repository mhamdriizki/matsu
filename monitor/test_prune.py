"""Check: rows older than RETENTION_DAYS are deleted per currency (newest row survives), and rows of
currencies that are no longer watched are removed.
Run: docker compose run --rm -v ./monitor:/app monitor python test_prune.py"""
import datetime as dt
import sqlite3
import monitor as m

db = sqlite3.connect(":memory:")
db.executescript(m.SCHEMA)
m.seed_watches(db, [("JPY", 110, 113), ("SGD", 13720, 13900)])
now = dt.datetime.now(dt.timezone.utc)


def ins(code, days):
    db.execute("INSERT INTO rates(fetched_at,currency,erate_jual) VALUES(?,?,?)",
               ((now - dt.timedelta(days=days)).isoformat(), code, 1.0))


def count(code):
    return db.execute("SELECT COUNT(*) FROM rates WHERE currency=?", (code,)).fetchone()[0]


for days in (30, 11, 9, 1):
    ins("JPY", days)
ins("SGD", 20)                                   # only a stale row: newest, so it stays
ins("USD", 1)                                    # not watched: removed even though fresh
assert m.prune_old(db) == 3                      # JPY 30d + 11d, USD
assert count("JPY") == 2 and count("SGD") == 1 and count("USD") == 0
print("ok")
