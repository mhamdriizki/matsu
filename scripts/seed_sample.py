"""Fill a SQLite DB with ~60 days of fake hourly rates for JPY, SGD and USD, for testing the dashboard.

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
CREATE TABLE IF NOT EXISTS watches(
  currency TEXT PRIMARY KEY,
  target_min REAL NOT NULL DEFAULT 0 CHECK(target_min >= 0),
  target_max REAL NOT NULL CHECK(target_max > 0 AND target_max >= target_min),
  in_band INTEGER NOT NULL DEFAULT 0, band_low REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS currencies(code TEXT PRIMARY KEY, name TEXT NOT NULL, flag TEXT);
"""  # keep in sync with monitor/monitor.py

# code: (name, base rate, swing, noise, target_min, target_max)
CURRENCIES = {
    "JPY": ("Japanese Yen", 112, 3, 0.6, 110, 113),
    "SGD": ("Singapore Dollar", 13800, 150, 40, 13720, 13900),
    "USD": ("US Dollar", 16300, 200, 60, 0, 16200),
}

db_path = os.getenv("DB_PATH", "./data/kurs.db")
os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
db = sqlite3.connect(db_path)
db.executescript(SCHEMA)
random.seed(7)
now = dt.datetime.now(dt.timezone.utc)
wib = dt.timezone(dt.timedelta(hours=7))
rows = 0
for code, (name, base, swing, noise, lo, hi) in CURRENCIES.items():
    db.execute("INSERT OR REPLACE INTO currencies VALUES(?,?)", (code, name))
    db.execute("INSERT OR REPLACE INTO watches(currency,target_min,target_max) VALUES(?,?,?)", (code, lo, hi))
    dp = 2 if base < 1000 else 0
    for h in range(60 * 24, -1, -1):
        t = now - dt.timedelta(hours=h)
        if t.astimezone(wib).weekday() >= 5 or not 8 <= t.astimezone(wib).hour < 17:
            continue  # BCA only updates on weekdays, office hours
        jual = round(base + swing * math.sin(h / 70) + random.uniform(-noise, noise), dp)
        db.execute(
            "INSERT INTO rates(fetched_at,source_updated_at,currency,erate_beli,erate_jual,tt_beli,tt_jual,notes_beli,notes_jual)"
            " VALUES(?,?,?,?,?,?,?,?,?)",
            (t.isoformat(), t.astimezone(wib).isoformat(), code, round(jual * 0.975, dp), jual,
             round(jual * 0.977, dp), round(jual * 1.004, dp), round(jual * 0.96, dp), round(jual * 1.02, dp)),
        )
        rows += 1
for k, v in {"last_ok": now.isoformat(), "consecutive_failures": "0", "watchlist_seeded": "1"}.items():
    db.execute("INSERT OR REPLACE INTO state VALUES(?,?)", (k, v))
db.commit()
print(f"seeded {rows} rows for {', '.join(CURRENCIES)} into {db_path}")
