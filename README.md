# kurs-watch

Watches BCA's **e-Rate Jual** for one currency (default JPY), keeps history in SQLite,
alerts via Telegram, and shows a Next.js dashboard.

```
BCA page --> monitor (Python) --> SQLite /data/kurs.db <-- dashboard (Next.js 16, read-only)
                  |--> Telegram alerts
                  '--> optional healthcheck ping
```
Interactive diagram: `docs/kurs-watch-architecture.html`.

## Setup (VPS)

1. Telegram: message @BotFather, `/newbot`, copy the token. Send any message to your bot, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id`.
2. `cp .env.example .env` and fill in `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
3. **Check the scraper works from this VPS before anything else:**
   `docker compose run --rm monitor python monitor.py --dry`
   It should print the JPY numbers. If it errors, BCA may block your VPS IP or the page layout
   differs from what the parser expects (the raw page is saved to `data/last_page.html`).
4. `docker compose run --rm monitor python monitor.py --test-telegram`
5. `docker compose up -d --build`
6. Dashboard binds to `127.0.0.1:3000`. Use `ssh -L 3000:localhost:3000 you@vps` or put it behind
   your reverse proxy with auth. It has no login of its own.

## Dashboard
Next.js 16 + React 19, Tailwind v4, shadcn/ui, Recharts. Needs Node >= 22 (better-sqlite3 13).

- Hero rate with verdict, change since last reading, and a target meter (current vs period low/high vs target).
- Rate history chart with the target band shaded; range switch via `?range=24h|7d|30d|all` (default 30d).
- Stats, monitor health (last OK, failed polls, last error), last 20 readings, light/dark mode.
- Opens the DB read-only; shows an empty state until the monitor has stored a reading.
- The Docker build downloads Google Fonts, so it needs network access.

Local dev (no Docker): `cd dashboard && npm install && DB_PATH=../data/kurs.db npm run dev`

### Sample data
To see the charts before real history exists:
`DB_PATH=./data/kurs.db python3 scripts/seed_sample.py` (about 60 days of fake rates).
**Delete `data/kurs.db` afterwards** so real monitoring starts clean.

## Alert rules
- Alert once when the rate enters `TARGET_MIN..TARGET_MAX`, again on each new low while inside,
  and once when it leaves. No repeated pings while it sits still.
- 3 failed polls in a row triggers a "scraper failing" message; recovery triggers another.
- Optional `HEALTHCHECK_URL` is pinged after each good poll, so you also hear about a dead container.

## Data retention
Nothing is deleted. A row is stored only when BCA's own "last updated" value changes, so at most
about 24 rows a day (about 1.3 MB a year). No pruning is needed. If the dashboard's "all" range ever
gets heavy, downsample it to daily points in `getRates`.

## Tests
Parser and alert logic were exercised offline against synthetic HTML. The live BCA page was fetched
successfully from a local machine (JPY row parsed); run step 3 on your VPS to check it from there.
Known quirk: `source_updated_at` is currently `None` against the live page (the "Terakhir diperbarui"
regex does not match), so de-duplication falls back to comparing the rate value.
