# matsu 待つ

Watches BCA's **e-Rate Jual** for the currencies you choose (JPY, SGD, USD, ...), keeps 10 days of
history in SQLite, alerts via Telegram when a rate enters its target band, and shows a Next.js
dashboard with one tab per currency.

```
BCA page --> monitor (Python) --> SQLite /data/kurs.db <-- dashboard (Next.js 16)
                  |--> Telegram alerts                    (reads; writes the watchlist)
                  '--> optional healthcheck ping
```
Interactive diagram: `docs/matsu-architecture.html`.

## Setup (VPS)

1. Telegram: message @BotFather, `/newbot`, copy the token. Send any message to your bot, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id`.
2. `cp .env.example .env` and fill in `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. Set `WATCHLIST`
   (see below) for the currencies and bands you start with.
3. **Check the scraper works from this VPS before anything else:**
   `docker compose run --rm monitor python monitor.py --dry`
   It prints every currency BCA lists (`--dry SGD` for one). If it errors, BCA may block your VPS IP or the
   page layout differs from what the parser expects (the raw page is saved to `data/last_page.html`).
4. `docker compose run --rm monitor python monitor.py --test-telegram`
5. `docker compose up -d --build`
6. Dashboard binds to `127.0.0.1:3000`. Use `ssh -L 3000:localhost:3000 you@vps` or put it behind
   your reverse proxy with auth. It has no login of its own.

**Upgrading from the single-currency version:** the schema changed and there is no migration. Stop the stack,
move or delete the old `data/kurs.db`, drop `CURRENCY` / `TARGET_MIN` / `TARGET_MAX` from `.env`, add
`WATCHLIST`, then start again.

## Watchlist
Each watched currency has its own target band (`min <= e-Rate Jual <= max`, min 0 = no floor), stored in the
DB. Manage it from the dashboard:
- **+ tab**: pick any currency BCA lists, set min and max, start watching.
- **Edit target**: change a currency's band. The monitor reads it on every poll (up to `POLL_MINUTES`),
  and saving resets that currency's alert state so the next poll re-alerts if the rate is inside the new band.
- **Stop watching**: removes the currency **and deletes all of its stored readings**.

`WATCHLIST=JPY:110:113,SGD:13720:13900` in `.env` only **seeds** the list, once, the first time the monitor
runs on an empty database. After that the dashboard owns the list, so a currency you removed is not re-added
on restart and changing `WATCHLIST` has no effect. Rates differ a lot in scale (JPY about 113, SGD about
14,000), so set each band in that currency's own units.

## Dashboard
Next.js 16 + React 19, Tailwind v4, shadcn/ui, Recharts. Needs Node >= 22 (better-sqlite3 13).

- Tabs: one per watched currency showing its code, current rate and a status dot (green in target, orange
  above, blue below the floor). `?c=SGD` opens a tab directly.
- Per tab: hero rate with verdict and change since last reading, target meter, history chart with the target
  band shaded, range switch `?range=24h|3d|7d|10d` (default 10d), stats, last 20 readings.
- Monitor health (last OK, failed polls, last error), light/dark mode.
- Reads the DB read-only, except for add / edit / stop watching. Shows "Waiting for the monitor" until the
  monitor has created the database.
- The container runs as root so it can write to the file the monitor created. Anyone who can reach the
  dashboard can change your targets; keep it on localhost or behind auth.
- The Docker build downloads Google Fonts, so it needs network access.

Local dev (no Docker): `cd dashboard && npm install && DB_PATH=../data/kurs.db npm run dev`

### Sample data
To see the charts before real history exists:
`DB_PATH=./data/kurs.db python3 scripts/seed_sample.py` (about 60 days of fake JPY, SGD and USD rates).
**Delete `data/kurs.db` afterwards** so real monitoring starts clean.

## Alert rules
Evaluated per currency, with its own state; every message starts with the currency code.
- Alert once when the rate enters the band, again on each new low while inside, and once when it leaves.
  No repeated pings while it sits still.
- 3 failed polls in a row triggers a "scraper failing" message; recovery triggers another. A watched currency
  missing from the page is only a warning, unless none of the watched currencies are found.
- Optional `HEALTHCHECK_URL` is pinged after each good poll, so you also hear about a dead container.

## Data retention
The monitor keeps **10 days** of readings per currency (`RETENTION_DAYS`, default 10). After each successful
poll it deletes older rows, but always keeps the newest row of each watched currency so the dashboard still
has a current reading. Rows of currencies that are no longer watched are deleted. Deleted rows are gone for
good. The dashboard's longest range is 10d; if you raise `RETENTION_DAYS`, also raise the ranges in
`dashboard/lib/db.ts`.

## Tests
Plain-assert scripts, each prints `ok`:
`docker compose run --rm -v ./monitor:/app monitor python test_targets.py` (also `test_prune.py`,
`test_watchlist.py`). They cover per-currency alerts, retention, WATCHLIST seeding and page parsing.
Known quirk: `source_updated_at` is `None` against the live page (the "Terakhir diperbarui" regex does not
match), so de-duplication compares the rate value instead.
