"""Check: a target saved in `state` (what the dashboard writes) overrides the env defaults and drives alerts.
Run: docker compose run --rm -v ./monitor:/app monitor python test_targets.py"""
import sqlite3
import monitor as m

db = sqlite3.connect(":memory:")
db.executescript(m.SCHEMA)
sent = []
m.telegram = sent.append

assert m.get_targets(db) == (m.TARGET_MIN, m.TARGET_MAX)           # no saved value -> env default
m.set_state(db, "target_min", 110); m.set_state(db, "target_max", 113)
assert m.get_targets(db) == (110.0, 113.0)                          # saved value wins

d = {"erate_jual": 112.0, "erate_beli": 109.0, "source_updated_at": None}
m.evaluate_alerts(db, d); assert len(sent) == 1 and "110 to 113" in sent[0]   # enters band
m.evaluate_alerts(db, d); assert len(sent) == 1                                # silent while sitting
m.set_state(db, "target_max", 111)                                             # dashboard narrows band
m.evaluate_alerts(db, d); assert len(sent) == 2 and "Left" in sent[1]          # 112 now outside
print("ok")
