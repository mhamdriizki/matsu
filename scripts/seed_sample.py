"""Fill a SQLite DB with ~60 days of fake hourly JPY rates, for testing the dashboard.

Usage:  DB_PATH=./data/kurs.db python scripts/seed_sample.py
Delete the DB afterwards so real monitoring starts clean.
"""
import datetime as dt
import math
import os
import random
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS rates(
  id INTEGER PRIMARY KEY, fetched_at TEXT NOT NULL, source_updated_at TEXT,
  currency TEXT NOT NULL, erate_beli REAL, erate_jual REAL NOT NULL,
  tt_beli REAL, tt_jual REAL, notes_beli REAL, notes_jual REAL);
CREATE INDEX IF NOT EXISTS idx_rates_cur_time ON rates(currency, fetched_at);
CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY, value TEXT);
"""  # keep in sync with monitor/monitor.py

db_path = os.getenv("DB_PATH", "./data/kurs.db")
os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
db = sqlite3.connect(db_path)
db.executescript(SCHEMA)
random.seed(7)
now = dt.datetime.now(dt.timezone.utc)
wib = dt.timezone(dt.timedelta(hours=7))
rows = 0
for h in range(60 * 24, -1, -1):
    t = now - dt.timedelta(hours=h)
    if t.astimezone(wib).weekday() >= 5 or not 8 <= t.astimezone(wib).hour < 17:
        continue  # BCA only updates on weekdays, office hours
    jual = round(112 + 3 * math.sin(h / 70) + random.uniform(-0.6, 0.6), 2)
    db.execute(
        "INSERT INTO rates(fetched_at,source_updated_at,currency,erate_beli,erate_jual,tt_beli,tt_jual,notes_beli,notes_jual)"
        " VALUES(?,?,?,?,?,?,?,?,?)",
        (t.isoformat(), t.astimezone(wib).isoformat(), "JPY", round(jual * 0.975, 2), jual,
         round(jual * 0.977, 2), round(jual * 1.004, 2), round(jual * 0.96, 2), round(jual * 1.02, 2)),
    )
    rows += 1
for k, v in {"last_ok": now.isoformat(), "consecutive_failures": "0"}.items():
    db.execute("INSERT OR REPLACE INTO state VALUES(?,?)", (k, v))
db.commit()
print(f"seeded {rows} rows into {db_path}")
