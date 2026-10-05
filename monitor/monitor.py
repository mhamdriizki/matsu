"""BCA kurs watcher: scrape the e-Rate row, store history, alert via Telegram.

Usage:
  python monitor.py                 run forever (poll every POLL_MINUTES)
  python monitor.py --dry           fetch + parse once, print result, touch nothing
  python monitor.py --once          one full cycle (store + alert logic), then exit
  python monitor.py --test-telegram send a test message
"""
import datetime as dt
import logging
import os
import re
import sqlite3
import sys
import time

import httpx
from selectolax.lexbor import LexborHTMLParser as HTMLParser

URL = os.getenv("KURS_URL", "https://www.bca.co.id/id/informasi/kurs")
CURRENCY = os.getenv("CURRENCY", "JPY").upper()
DB_PATH = os.getenv("DB_PATH", "/data/kurs.db")
RAW_DUMP = os.getenv("RAW_DUMP", "/data/last_page.html")
POLL_SECONDS = int(float(os.getenv("POLL_MINUTES", "60")) * 60)
# Defaults only: the dashboard stores the live target in the `state` table (see get_targets).
TARGET_MIN = float(os.getenv("TARGET_MIN", "0"))      # 0 = no floor (cheaper is always better)
TARGET_MAX = float(os.getenv("TARGET_MAX", "113"))
TG_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TG_CHAT = os.getenv("TELEGRAM_CHAT_ID", "")
HEALTHCHECK_URL = os.getenv("HEALTHCHECK_URL", "")
RETENTION_DAYS = int(os.getenv("RETENTION_DAYS", "10"))   # older rate rows are deleted
FAIL_ALERT_AFTER = int(os.getenv("FAIL_ALERT_AFTER", "3"))
USER_AGENT = os.getenv(
    "USER_AGENT",
    "Mozilla/5.0 (compatible; matsu/1.0; personal use, hourly)",
)

WIB = dt.timezone(dt.timedelta(hours=7))
MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "mei": 5, "may": 5, "jun": 6,
          "jul": 7, "agu": 8, "aug": 8, "sep": 9, "okt": 10, "oct": 10,
          "nov": 11, "des": 12, "dec": 12}

log = logging.getLogger("kurs")


class ParseError(Exception):
    pass


# ---------- scraping ----------

def to_num(s):
    """Parse an Indonesian-format number ("17.845,00" -> 17845.0); None for an empty cell."""
    s = s.strip().replace("\xa0", "")
    if not s:
        return None
    return float(s.replace(".", "").replace(",", "."))  # "17.845,00" -> 17845.0


def fetch_html():
    """GET the BCA kurs page and return its HTML. Raises on HTTP errors."""
    r = httpx.get(
        URL,
        headers={"User-Agent": USER_AGENT, "Accept-Language": "id,en;q=0.8"},
        timeout=30,
        follow_redirects=True,
    )
    r.raise_for_status()
    return r.text


def parse_updated(html):
    """Return BCA's "Terakhir diperbarui pada ..." stamp as a WIB ISO string, or None if absent."""
    m = re.search(
        r"Terakhir diperbarui pada\s+(\d{1,2})\s+(\w+)\s+(\d{4})\s+(\d{1,2})[.:](\d{2})\s*WIB",
        html,
    )
    if not m:
        return None
    day, mon, year, hh, mm = m.groups()
    month = MONTHS.get(mon[:3].lower())
    if not month:
        return None
    return dt.datetime(int(year), month, int(day), int(hh), int(mm), tzinfo=WIB).isoformat()


def parse_page(html):
    """Return dict with e-Rate / TT Counter / Bank Notes buy+sell for CURRENCY."""
    tree = HTMLParser(html)
    for tr in tree.css("tr"):
        cells = [c.text(strip=True) for c in tr.css("td,th")]
        if len(cells) < 7 or cells[0].upper() != CURRENCY:
            continue
        try:
            vals = [to_num(c) for c in cells[1:7]]
        except ValueError:
            continue
        keys = ["erate_beli", "erate_jual", "tt_beli", "tt_jual", "notes_beli", "notes_jual"]
        d = dict(zip(keys, vals))
        if not d["erate_jual"] or not d["erate_beli"] or d["erate_jual"] < d["erate_beli"]:
            raise ParseError(f"implausible values: {d}")
        d["source_updated_at"] = parse_updated(html)
        return d
    raise ParseError(f"no {CURRENCY} row found (page layout changed or blocked?)")


# ---------- storage ----------

SCHEMA = """
CREATE TABLE IF NOT EXISTS rates(
  id INTEGER PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  source_updated_at TEXT,
  currency TEXT NOT NULL,
  erate_beli REAL, erate_jual REAL NOT NULL,
  tt_beli REAL, tt_jual REAL,
  notes_beli REAL, notes_jual REAL
);
CREATE INDEX IF NOT EXISTS idx_rates_cur_time ON rates(currency, fetched_at);
CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY, value TEXT);
"""


def open_db():
    """Open (creating if needed) the SQLite DB at DB_PATH and ensure the schema exists."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.executescript(SCHEMA)
    return db


def get_state(db, key, default=None):
    """Read a value from the key/value `state` table."""
    row = db.execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
    return row[0] if row else default


def set_state(db, key, value):
    """Upsert a value into the `state` table (stored as text)."""
    db.execute("INSERT INTO state(key,value) VALUES(?,?) "
               "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, str(value)))
    db.commit()


def store_if_new(db, d):
    """Insert only when BCA's own 'last updated' stamp (or the value) changed."""
    last = db.execute(
        "SELECT source_updated_at, erate_jual FROM rates WHERE currency=? ORDER BY id DESC LIMIT 1",
        (CURRENCY,),
    ).fetchone()
    if last:
        same_stamp = d["source_updated_at"] and last[0] == d["source_updated_at"]
        same_value = not d["source_updated_at"] and last[1] == d["erate_jual"]
        if same_stamp or same_value:
            return False
    db.execute(
        "INSERT INTO rates(fetched_at,source_updated_at,currency,erate_beli,erate_jual,"
        "tt_beli,tt_jual,notes_beli,notes_jual) VALUES(?,?,?,?,?,?,?,?,?)",
        (dt.datetime.now(dt.timezone.utc).isoformat(), d["source_updated_at"], CURRENCY,
         d["erate_beli"], d["erate_jual"], d["tt_beli"], d["tt_jual"],
         d["notes_beli"], d["notes_jual"]),
    )
    db.commit()
    return True


def prune_old(db):
    """Delete rate rows older than RETENTION_DAYS (by fetched_at). The newest row per currency is always
    kept, so the dashboard still has a current reading if BCA has not changed for a long time."""
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=RETENTION_DAYS)).isoformat()
    n = db.execute(
        "DELETE FROM rates WHERE fetched_at < ? AND id NOT IN (SELECT MAX(id) FROM rates GROUP BY currency)",
        (cutoff,),
    ).rowcount
    db.commit()
    return n


# ---------- alerts ----------

def telegram(text):
    """Send `text` to the configured chat. Returns True on success; logs instead if unconfigured."""
    if not (TG_TOKEN and TG_CHAT):
        log.warning("Telegram not configured; would send: %s", text)
        return False
    try:
        r = httpx.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            json={"chat_id": TG_CHAT, "text": text, "disable_web_page_preview": True},
            timeout=15,
        )
        r.raise_for_status()
        return True
    except httpx.HTTPStatusError as e:  # don't log the URL: it contains the bot token
        log.error("Telegram HTTP %s", e.response.status_code)
    except Exception as e:
        log.error("Telegram error: %s", type(e).__name__)
    return False


def get_targets(db):
    """Return (min, max). A value saved from the dashboard wins over the TARGET_MIN/TARGET_MAX env defaults."""
    return (float(get_state(db, "target_min", TARGET_MIN)),
            float(get_state(db, "target_max", TARGET_MAX)))


def band_text(lo_v, hi_v):
    """Human-readable target band, e.g. "0 to 113"."""
    lo = f"{lo_v:g}" if lo_v > 0 else "0"
    return f"{lo} to {hi_v:g}"


def evaluate_alerts(db, d):
    """Send an alert on entering the band, setting a new low inside it, or leaving it; silent otherwise."""
    jual = d["erate_jual"]
    t_min, t_max = get_targets(db)
    band = band_text(t_min, t_max)
    in_band = t_min <= jual <= t_max
    was_in = get_state(db, "in_band", "0") == "1"
    band_low = float(get_state(db, "band_low", "inf"))
    stamp = d["source_updated_at"] or "unknown time"
    detail = (f"{CURRENCY} e-Rate Jual: {jual:,.2f} (Beli {d['erate_beli']:,.2f})\n"
              f"BCA stamp: {stamp}\n"
              "Rates can move before you confirm; check myBCA before buying.")

    if in_band and not was_in:
        telegram(f"IN TARGET BAND ({band})\n{detail}")
        set_state(db, "in_band", "1")
        set_state(db, "band_low", jual)
    elif in_band and was_in and jual < band_low:
        telegram(f"NEW LOW inside band ({band})\n{detail}\nPrevious low: {band_low:,.2f}")
        set_state(db, "band_low", jual)
    elif not in_band and was_in:
        telegram(f"Left target band ({band})\n{detail}\nLow while in band: {band_low:,.2f}")
        set_state(db, "in_band", "0")
        set_state(db, "band_low", "inf")


# ---------- main cycle ----------

def cycle(db):
    """One poll: fetch, parse, store, alert; tracks consecutive failures and pings the healthcheck."""
    fails = int(get_state(db, "consecutive_failures", "0"))
    try:
        html = fetch_html()
        try:
            d = parse_page(html)
        except ParseError:
            try:
                with open(RAW_DUMP, "w", encoding="utf-8") as f:
                    f.write(html)
            except OSError:
                pass
            raise
    except Exception as e:
        fails += 1
        set_state(db, "consecutive_failures", fails)
        set_state(db, "last_error", f"{dt.datetime.now(dt.timezone.utc).isoformat()} {type(e).__name__}: {e}")
        log.error("cycle failed (%d in a row): %s", fails, e)
        if fails == FAIL_ALERT_AFTER:
            telegram(f"matsu is failing ({fails} polls in a row).\n{type(e).__name__}: {e}\n"
                     "No rate alerts until fixed.")
        return

    if fails >= FAIL_ALERT_AFTER:
        telegram("matsu recovered; polling normally again.")
    set_state(db, "consecutive_failures", 0)
    set_state(db, "last_ok", dt.datetime.now(dt.timezone.utc).isoformat())
    inserted = store_if_new(db, d)
    pruned = prune_old(db)
    if pruned:
        log.info("pruned %d rows older than %d days", pruned, RETENTION_DAYS)
    log.info("%s e-Rate Jual=%s stamp=%s %s", CURRENCY, d["erate_jual"],
             d["source_updated_at"], "(new)" if inserted else "(unchanged)")
    evaluate_alerts(db, d)
    if HEALTHCHECK_URL:
        try:
            httpx.get(HEALTHCHECK_URL, timeout=10)
        except Exception:
            log.warning("healthcheck ping failed")


def main():
    """CLI entry point; see the module docstring for flags."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = set(sys.argv[1:])
    if "--dry" in args:
        print(parse_page(fetch_html()))
        return
    if "--test-telegram" in args:
        print("sent" if telegram("matsu test message") else "FAILED (check token/chat id)")
        return
    db = open_db()
    if "--once" in args:
        cycle(db)
        return
    telegram(f"matsu started. Watching {CURRENCY} e-Rate Jual, band {band_text(*get_targets(db))}, "
             f"every {POLL_SECONDS // 60} min.")
    while True:
        cycle(db)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
