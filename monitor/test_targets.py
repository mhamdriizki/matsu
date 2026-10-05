"""Check: each watch has its own band and alert state; alerts name the currency.
Run: docker compose run --rm -v ./monitor:/app monitor python test_targets.py"""
import sqlite3
import monitor as m

db = sqlite3.connect(":memory:")
db.row_factory = sqlite3.Row
db.executescript(m.SCHEMA)
sent = []
m.telegram = sent.append
m.seed_watches(db, [("JPY", 110, 113), ("SGD", 13720, 13900)])


def watch(code):
    return db.execute("SELECT * FROM watches WHERE currency=?", (code,)).fetchone()


def d(jual):
    return {"erate_jual": jual, "erate_beli": jual - 3, "source_updated_at": None}


m.evaluate_alerts(db, watch("JPY"), d(112.0))
assert len(sent) == 1 and sent[0].startswith("JPY IN TARGET BAND (110 to 113)")
assert watch("JPY")["in_band"] == 1 and watch("SGD")["in_band"] == 0       # SGD untouched

m.evaluate_alerts(db, watch("JPY"), d(112.0))
assert len(sent) == 1                                                       # silent while sitting

m.evaluate_alerts(db, watch("SGD"), d(14087.51))                            # above SGD band: no alert
assert len(sent) == 1
m.evaluate_alerts(db, watch("SGD"), d(13800.0))
assert len(sent) == 2 and sent[1].startswith("SGD IN TARGET BAND (13720 to 13900)")
m.evaluate_alerts(db, watch("SGD"), d(13750.0))
assert "NEW LOW" in sent[2] and watch("SGD")["band_low"] == 13750.0
m.evaluate_alerts(db, watch("JPY"), d(114.0))
assert "left target band" in sent[3] and watch("JPY")["band_low"] is None   # JPY left; SGD still in
assert watch("SGD")["in_band"] == 1

db.execute("UPDATE watches SET target_max=111, in_band=0, band_low=NULL WHERE currency='JPY'")  # dashboard edit
m.evaluate_alerts(db, watch("JPY"), d(110.5))
assert len(sent) == 5 and "(110 to 111)" in sent[4]                         # re-alerts against new band
print("ok")
