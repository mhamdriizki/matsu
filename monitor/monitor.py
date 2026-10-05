"""BCA kurs watcher: scrape e-Rates for every watched currency, store history, alert via Telegram.

The watchlist (currency + target band) lives in the `watches` table and is edited from the dashboard.
The WATCHLIST env var only seeds it once.

Usage:
  python monitor.py                 run forever (poll every POLL_MINUTES)
  python monitor.py --dry [CODE]    fetch + parse once, print every currency (or just CODE), touch nothing
  python monitor.py --once          one full cycle (store + alert logic), then exit
  python monitor.py --test-telegram send a test message
"""
import base64
import datetime as dt
import logging
import os
import re
import sqlite3
import sys
import time
from urllib.parse import urljoin, urlparse

import httpx
from selectolax.lexbor import LexborHTMLParser as HTMLParser

URL = os.getenv("KURS_URL", "https://www.bca.co.id/id/informasi/kurs")
DB_PATH = os.getenv("DB_PATH", "/data/kurs.db")
RAW_DUMP = os.getenv("RAW_DUMP", "/data/last_page.html")
POLL_SECONDS = int(float(os.getenv("POLL_MINUTES", "60")) * 60)
# One-time seed, "CODE:min:max,...". Only used while the DB has never been seeded (see seed_watches).
WATCHLIST = os.getenv("WATCHLIST", "")
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
# Display names for the dashboard's "Add currency" list; unknown codes fall back to the code itself.
NAMES = {"AUD": "Australian Dollar", "CAD": "Canadian Dollar", "CHF": "Swiss Franc", "CNY": "Chinese Yuan",
         "DKK": "Danish Krone", "EUR": "Euro", "GBP": "British Pound", "HKD": "Hong Kong Dollar",
         "JPY": "Japanese Yen", "MYR": "Malaysian Ringgit", "NOK": "Norwegian Krone",
         "NZD": "New Zealand Dollar", "SAR": "Saudi Riyal", "SEK": "Swedish Krona",
         "SGD": "Singapore Dollar", "THB": "Thai Baht", "USD": "US Dollar"}
RATE_KEYS = ["erate_beli", "erate_jual", "tt_beli", "tt_jual", "notes_beli", "notes_jual"]

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


def parse_rows(html):
    """Return {CODE: rates dict} for every currency row on the page (e-Rate / TT Counter / Bank Notes
    buy+sell plus source_updated_at and the flag image path `flag_src`). Implausible rows are logged and skipped. Raises ParseError if none parse."""
    tree = HTMLParser(html)
    stamp = parse_updated(html)
    rows = {}
    for tr in tree.css("tr"):
        cells = [c.text(strip=True) for c in tr.css("td,th")]
        if len(cells) < 7 or not re.fullmatch(r"[A-Z]{3}", cells[0]):
            continue
        try:
            d = dict(zip(RATE_KEYS, [to_num(c) for c in cells[1:7]]))
        except ValueError:
            continue
        if not d["erate_jual"] or not d["erate_beli"] or d["erate_jual"] < d["erate_beli"]:
            log.warning("%s: implausible values skipped: %s", cells[0], d)
            continue
        d["source_updated_at"] = stamp
        img = tr.css_first("img")
        d["flag_src"] = img.attributes.get("src") if img else None
        rows[cells[0]] = d
    if not rows:
        raise ParseError("no currency rows found (page layout changed or blocked?)")
    return rows


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
CREATE TABLE IF NOT EXISTS watches(
  currency TEXT PRIMARY KEY,
  target_min REAL NOT NULL DEFAULT 0 CHECK(target_min >= 0),
  target_max REAL NOT NULL CHECK(target_max > 0 AND target_max >= target_min),
  in_band INTEGER NOT NULL DEFAULT 0,
  band_low REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS currencies(code TEXT PRIMARY KEY, name TEXT NOT NULL, flag TEXT);
"""


def open_db():
    """Open (creating if needed) the SQLite DB at DB_PATH and ensure the schema exists."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.executescript(SCHEMA)
    if "flag" not in [r[1] for r in db.execute("PRAGMA table_info(currencies)")]:  # DB from before flags
        db.execute("ALTER TABLE currencies ADD COLUMN flag TEXT")
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


def parse_watchlist(s):
    """Parse "JPY:110:113,SGD:13720:13900" into [(code, min, max)]. Bad items are logged and skipped."""
    items = []
    for raw in filter(None, (p.strip() for p in s.split(","))):
        try:
            code, lo, hi = raw.split(":")
            code, lo, hi = code.strip().upper(), float(lo), float(hi)
            if not re.fullmatch(r"[A-Z]{3}", code):
                raise ValueError("code must be 3 letters")
            if lo < 0 or hi <= 0 or lo > hi:
                raise ValueError("need 0 <= min <= max and max > 0")
        except ValueError as e:
            log.error("WATCHLIST item %r skipped: %s", raw, e)
            continue
        items.append((code, lo, hi))
    return items


def seed_watches(db, items):
    """Insert the WATCHLIST items once per DB. After the first seed (flag `watchlist_seeded`), the dashboard
    owns the list, so a currency removed there is never re-added on restart. Returns rows inserted."""
    if get_state(db, "watchlist_seeded"):
        return 0
    n = 0
    for code, lo, hi in items:
        n += db.execute("INSERT OR IGNORE INTO watches(currency,target_min,target_max) VALUES(?,?,?)",
                        (code, lo, hi)).rowcount
    db.commit()
    set_state(db, "watchlist_seeded", "1")
    return n


def upsert_currencies(db, codes):
    """Record every currency code seen on the BCA page (feeds the dashboard's Add list)."""
    db.executemany("INSERT INTO currencies(code,name) VALUES(?,?) "
                   "ON CONFLICT(code) DO UPDATE SET name=excluded.name",
                   [(c, NAMES.get(c, c)) for c in codes])
    db.commit()


def fetch_flags(db, rows, codes):
    """Save BCA's flag image (a data: URI, so the dashboard needs no file serving) for each of `codes` that has
    none yet. Only images from BCA's own host and under 20 KB are accepted; any failure is a warning, never a failed poll."""
    for code in codes:
        src = (rows.get(code) or {}).get("flag_src")
        if not src or db.execute("SELECT flag FROM currencies WHERE code=?", (code,)).fetchone()[0]:
            continue
        url = urljoin(URL, src)
        try:
            if urlparse(url).netloc != urlparse(URL).netloc:
                raise ValueError("flag is not on BCA's host")
            r = httpx.get(url, headers={"User-Agent": USER_AGENT}, timeout=15)
            r.raise_for_status()
            if r.headers.get("content-type", "").split(";")[0] != "image/png" or len(r.content) > 20_000:
                raise ValueError("not a small PNG")
            db.execute("UPDATE currencies SET flag=? WHERE code=?",
                       ("data:image/png;base64," + base64.b64encode(r.content).decode(), code))
            db.commit()
        except Exception as e:
            log.warning("flag for %s not saved: %s", code, type(e).__name__)


def get_watches(db):
    """All watched currencies in tab order (oldest first)."""
    return db.execute("SELECT * FROM watches ORDER BY created_at, currency").fetchall()


def store_if_new(db, code, d):
    """Insert only when BCA's own 'last updated' stamp (or the value) changed, and only while `code`
    is still watched (the dashboard may have removed it mid-cycle)."""
    last = db.execute(
        "SELECT source_updated_at, erate_jual FROM rates WHERE currency=? ORDER BY id DESC LIMIT 1",
        (code,),
    ).fetchone()
    if last:
        same_stamp = d["source_updated_at"] and last[0] == d["source_updated_at"]
        same_value = not d["source_updated_at"] and last[1] == d["erate_jual"]
        if same_stamp or same_value:
            return False
    n = db.execute(
        "INSERT INTO rates(fetched_at,source_updated_at,currency,erate_beli,erate_jual,"
        "tt_beli,tt_jual,notes_beli,notes_jual) "
        "SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM watches WHERE currency=?)",
        (dt.datetime.now(dt.timezone.utc).isoformat(), d["source_updated_at"], code,
         d["erate_beli"], d["erate_jual"], d["tt_beli"], d["tt_jual"],
         d["notes_beli"], d["notes_jual"], code),
    ).rowcount
    db.commit()
    return n > 0


def prune_old(db):
    """Delete rate rows older than RETENTION_DAYS (by fetched_at), plus all rows of currencies that are no
    longer watched. The newest row per currency is otherwise kept, so the dashboard still has a current
    reading if BCA has not changed for a long time."""
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=RETENTION_DAYS)).isoformat()
    n = db.execute(
        "DELETE FROM rates WHERE (fetched_at < ? AND id NOT IN (SELECT MAX(id) FROM rates GROUP BY currency)) "
        "OR currency NOT IN (SELECT currency FROM watches)",
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


def band_text(lo_v, hi_v):
    """Human-readable target band, e.g. "0 to 113"."""
    lo = f"{lo_v:g}" if lo_v > 0 else "0"
    return f"{lo} to {hi_v:g}"


def evaluate_alerts(db, w, d):
    """For watch row `w`: alert on entering the band, setting a new low inside it, or leaving it; silent
    otherwise. Alert state (in_band, band_low) is stored per currency in `watches`."""
    code, jual = w["currency"], d["erate_jual"]
    band = band_text(w["target_min"], w["target_max"])
    in_band = w["target_min"] <= jual <= w["target_max"]
    was_in = bool(w["in_band"])
    band_low = w["band_low"] if w["band_low"] is not None else float("inf")
    stamp = d["source_updated_at"] or "unknown time"
    detail = (f"{code} e-Rate Jual: {jual:,.2f} (Beli {d['erate_beli']:,.2f})\n"
              f"BCA stamp: {stamp}\n"
              "Rates can move before you confirm; check myBCA before buying.")

    def save(flag, low):
        db.execute("UPDATE watches SET in_band=?, band_low=? WHERE currency=?", (flag, low, code))
        db.commit()

    if in_band and not was_in:
        telegram(f"{code} IN TARGET BAND ({band})\n{detail}")
        save(1, jual)
    elif in_band and was_in and jual < band_low:
        telegram(f"{code} NEW LOW inside band ({band})\n{detail}\nPrevious low: {band_low:,.2f}")
        save(1, jual)
    elif not in_band and was_in:
        telegram(f"{code} left target band ({band})\n{detail}\nLow while in band: {band_low:,.2f}")
        save(0, None)


# ---------- main cycle ----------

def cycle(db):
    """One poll: fetch once, then for every watched currency store and alert; prunes old rows, tracks
    consecutive failures and pings the healthcheck. A watched currency missing from the page is only a
    warning, unless none of them are found (then the scrape counts as failed)."""
    fails = int(get_state(db, "consecutive_failures", "0"))
    watches = get_watches(db)
    try:
        html = fetch_html()
        try:
            rows = parse_rows(html)
            if watches and not any(w["currency"] in rows for w in watches):
                raise ParseError("none of the watched currencies were found on the page")
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
    upsert_currencies(db, rows)
    fetch_flags(db, rows, [w["currency"] for w in watches])
    for w in watches:
        code = w["currency"]
        d = rows.get(code)
        if d is None:
            log.warning("%s is watched but not on the page", code)
            continue
        inserted = store_if_new(db, code, d)
        log.info("%s e-Rate Jual=%s stamp=%s %s", code, d["erate_jual"],
                 d["source_updated_at"], "(new)" if inserted else "(unchanged)")
        evaluate_alerts(db, w, d)
    pruned = prune_old(db)
    if pruned:
        log.info("pruned %d rows (older than %d days or no longer watched)", pruned, RETENTION_DAYS)
    if HEALTHCHECK_URL:
        try:
            httpx.get(HEALTHCHECK_URL, timeout=10)
        except Exception:
            log.warning("healthcheck ping failed")


def main():
    """CLI entry point; see the module docstring for flags."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    argv = sys.argv[1:]
    args = set(argv)
    if "--dry" in args:
        rows = parse_rows(fetch_html())
        i = argv.index("--dry") + 1
        only = argv[i].upper() if i < len(argv) and not argv[i].startswith("--") else None
        for code, d in rows.items():
            if only is None or code == only:
                print(code, d)
        return
    if "--test-telegram" in args:
        print("sent" if telegram("matsu test message") else "FAILED (check token/chat id)")
        return
    db = open_db()
    seeded = seed_watches(db, parse_watchlist(WATCHLIST))
    if seeded:
        log.info("seeded %d watches from WATCHLIST", seeded)
    if "--once" in args:
        cycle(db)
        return
    bands = ", ".join(f"{w['currency']} {band_text(w['target_min'], w['target_max'])}" for w in get_watches(db))
    telegram(f"matsu started. Watching e-Rate Jual: {bands or 'nothing yet'}; every {POLL_SECONDS // 60} min.")
    while True:
        cycle(db)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
