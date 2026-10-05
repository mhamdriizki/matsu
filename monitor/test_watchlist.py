"""Check: WATCHLIST parsing/seeding, page parsing, store guard, and the cycle's missing-currency handling.
Run: docker compose run --rm -v ./monitor:/app monitor python test_watchlist.py"""
import sqlite3
import monitor as m

# --- parse_watchlist: bad items skipped, good ones kept
assert m.parse_watchlist("JPY:110:113,bad,SGD:1:0,USD:0:18000, ") == [("JPY", 110.0, 113.0), ("USD", 0.0, 18000.0)]

db = sqlite3.connect(":memory:")
db.row_factory = sqlite3.Row
db.executescript(m.SCHEMA)

# --- seeding happens once; a currency removed later is not re-seeded
assert m.seed_watches(db, [("JPY", 110, 113), ("SGD", 13720, 13900)]) == 2
assert m.seed_watches(db, [("JPY", 1, 2)]) == 0
db.execute("DELETE FROM watches WHERE currency='SGD'")
assert m.seed_watches(db, [("SGD", 1, 2)]) == 0
assert [w["currency"] for w in m.get_watches(db)] == ["JPY"]

# --- parse_rows on synthetic HTML (Indonesian number format, bad row skipped, non-currency rows ignored)
HTML = """<p>Terakhir diperbarui pada 5 Okt 2026 10.31 WIB</p><table>
<tr><th>Mata Uang</th><th>a</th><th>b</th><th>c</th><th>d</th><th>e</th><th>f</th></tr>
<tr><td>JPY</td><td>113,27</td><td>113,64</td><td>111,62</td><td>114,58</td><td>111,22</td><td>114,99</td></tr>
<tr><td>SGD</td><td>13.883,92</td><td>14.087,51</td><td>13.815,69</td><td>14.085,61</td><td>13.809,00</td><td>14.157,00</td></tr>
<tr><td>BAD</td><td>10,00</td><td>5,00</td><td>1</td><td>1</td><td>1</td><td>1</td></tr></table>"""
rows = m.parse_rows(HTML)
assert set(rows) == {"JPY", "SGD"} and rows["SGD"]["erate_jual"] == 14087.51
assert rows["JPY"]["source_updated_at"].startswith("2026-10-05T10:31")
try:
    m.parse_rows("<html></html>"); assert False
except m.ParseError:
    pass

# --- store_if_new refuses an unwatched currency, dedupes a watched one
assert m.store_if_new(db, "SGD", rows["SGD"]) is False
assert m.store_if_new(db, "JPY", rows["JPY"]) is True
assert m.store_if_new(db, "JPY", rows["JPY"]) is False

# --- cycle: a missing watched currency only warns; none found counts as a failure
m.telegram = lambda t: None
m.RAW_DUMP = "/tmp/matsu_test_page.html"
db.execute("INSERT INTO watches(currency,target_min,target_max) VALUES('USD',0,18000)")
m.fetch_html = lambda: HTML
m.cycle(db)
assert m.get_state(db, "consecutive_failures") == "0"                       # USD missing: warning only
assert db.execute("SELECT COUNT(*) FROM currencies").fetchone()[0] == 2     # catalogue filled
db.execute("DELETE FROM watches WHERE currency IN ('JPY','USD')")
db.execute("INSERT INTO watches(currency,target_min,target_max) VALUES('EUR',0,20000)")
m.cycle(db)
assert m.get_state(db, "consecutive_failures") == "1"                       # none watched on the page
print("ok")
