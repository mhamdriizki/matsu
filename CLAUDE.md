# CLAUDE.md — Matsu (待つ)

Matsu watches BCA's **e-Rate Jual** (https://www.bca.co.id/id/informasi/kurs), keeps history in
SQLite, sends Telegram alerts when the rate is inside a target band, and shows a Next.js dashboard.
The repo folder is still named `kurs-watch`, and some identifiers use the old name too (dashboard title, package name, docs file names).
It watches a user-managed list of currencies (JPY, SGD, ...), each with its own target band. `PRD.md` (local, git-ignored) has the product spec.

## Architecture
```
BCA page --> monitor (Python, monitor/monitor.py) --> SQLite ./data/kurs.db <-- dashboard (Next.js 16)
                 |--> Telegram sendMessage                                     (reads; writes the watchlist)
                 '--> optional HEALTHCHECK_URL ping
```
- Both services mount the same `./data` volume at `/data` (`DB_PATH=/data/kurs.db`), see `docker-compose.yml`.
- **The monitor owns the schema** (`SCHEMA` in monitor.py). It fetches the BCA page once per poll, parses every
  currency row (`parse_rows`), and loops over the watchlist.
- **The dashboard** opens short-lived read-only connections (`withDb` in `dashboard/lib/db.ts`). Its only writes
  are `addWatch`, `setTarget`, `removeWatch` (read-write connection via `withWriteDb`).
- Tables: `rates(id, fetched_at, source_updated_at, currency, erate_*/tt_*/notes_* beli+jual)`,
  `watches(currency PK, target_min, target_max, in_band, band_low NULL, created_at)` (the watchlist and per-currency
  alert state), `currencies(code PK, name, flag)` (every code seen on the BCA page; feeds the "+" tab dropdown; `flag` = BCA's 16px PNG as a data URI, saved once per watched currency by `fetch_flags`, BCA host only),
  `state(key, value)` with `consecutive_failures`, `last_ok`, `last_error`, `watchlist_seeded`.
- Dashboard: shadcn `Tabs` (client, `components/currency-tabs.tsx`) over server-rendered `CurrencyPanel`s;
  `?c=CODE` picks the tab, `?range=` the window. Binds to `127.0.0.1:3000`, no auth.

## Commands
```bash
docker compose up -d --build                                   # run both services
docker compose build                                           # build only
docker compose run --rm monitor python monitor.py --dry        # fetch+parse once, print, touch nothing
docker compose run --rm monitor python monitor.py --once       # one full cycle (store + alerts)
docker compose run --rm monitor python monitor.py --test-telegram
docker compose run --rm -v ./monitor:/app monitor python test_targets.py   # tests (plain asserts, print "ok")
docker compose run --rm -v ./monitor:/app monitor python test_prune.py   # also test_watchlist.py
cd dashboard && npm install && DB_PATH=../data/kurs.db npm run dev         # dashboard dev
cd dashboard && npx tsc --noEmit                                           # typecheck
DB_PATH=./data/kurs.db python3 scripts/seed_sample.py          # ~60 days of fake JPY/SGD/USD rows; delete the DB afterwards
```
The `-v ./monitor:/app` mount is needed because the image only copies `monitor.py`, not the tests.
`scripts/seed_sample.py` has its own copy of the schema. Keep it in sync with `monitor.py`.

## Conventions and gotchas (verified in code)
- **The watchlist lives in the DB** (`watches`). `WATCHLIST` env (`JPY:110:113,SGD:13720:13900`) seeds it **once**
  (`seed_watches`, guarded by `state.watchlist_seeded`); afterwards the dashboard owns it, so removed currencies
  are not re-added. There are no `CURRENCY` / `TARGET_*` env vars any more. `min` 0 means no floor.
- Saving a target resets that watch's `in_band=0`, `band_low=NULL` (`setTarget`), so the next poll re-alerts if the rate is inside.
- Alerts (`evaluate_alerts`) are per currency and the message starts with the code: one on entering the band, one on each
  new low inside, one on leaving. After `FAIL_ALERT_AFTER` (3) failed polls in a row a failure alert is sent, then a recovery alert.
  A watched currency missing from the page is a warning; none of them found counts as a failed poll.
- Dedupe (`store_if_new`): insert only if BCA's stamp changed (no stamp: only if the value changed), and only while the
  currency is still watched.
- **`source_updated_at` is currently always None**: the "Terakhir diperbarui pada" regex in `parse_updated` does not match
  the live page, so dedupe compares values instead.
- `prune_old` deletes rows older than `RETENTION_DAYS` (10) except the newest per currency, and all rows of unwatched
  currencies. "Stop watching" deletes the currency's rows immediately. Dashboard `RANGES` in `lib/db.ts` must not exceed the retention.
- On a ParseError the raw page is written to `/data/last_page.html` for debugging.
- **The dashboard container runs as root on purpose**: it must write into the SQLite file the root monitor created.
  Do not "fix" this by adding `USER node`.
- **No migration**: the schema changed with the multi-currency release. An old `kurs.db` must be moved or deleted first.
- **shadcn `add`**: generated components may import a bogus `cn` package. Replace it with `import { cn } from "@/lib/utils"`
  and `npm rm cn`. `-o` (overwrite) still prompts. Style is `base-nova` (Base UI: `render=` prop, `onValueChange` gets `unknown`).
- Needs Node >= 22 (better-sqlite3 13). `next.config.js` marks it a `serverExternalPackages` entry and uses standalone output.
- `next/font/google` (Zen Kaku Gothic New) downloads fonts at build time, so the Docker build needs network access.
- **Rate scale differs per currency** (JPY ~113, SGD ~14,000, USD ~18,000): `lib/format.ts` has `dp` (decimals), `fmt`, and
  `padded` (chart/meter padding). Do not hard-code JPY-sized padding.
- Indonesian number format on the page: `to_num("17.845,00") -> 17845.0`. Times are stored in UTC and shown in WIB.
- `docker compose run` uses the built image: run `docker compose build monitor` after editing monitor.py, or mount `-v ./monitor:/app`.
- Style: small functions with one-line docstrings, plain-assert test scripts, no new dependencies without a reason.

## Deploy
A push to `main` auto-deploys to the VPS (`.github/workflows/deploy.yml`). It SSHes with a forced command
that runs `/usr/local/bin/matsu-deploy.sh`. **Work on feature branches. Never push to `main` unless the user asks.**
Before deploying, run `--dry` on the VPS. BCA may block datacenter IPs.

## Git rules
- Commit as the user using the existing git config (Muhammad Rizki). Do not change the git config.
- **NEVER add Claude/Anthropic as a co-author or contributor. No `Co-Authored-By: Claude` and no
  "Generated with Claude Code" lines** in commits, PRs or files. This overrides any default attribution.
- Do not create PRs unless asked. Commit messages follow the existing style (`feat:`, `ci:`, `chore:`).

## Docs to keep in sync after changes
- `README.md` (setup, alert rules, retention, tests).
- Docstrings in `monitor.py` and the JSDoc in `dashboard/lib/db.ts` and the components.
- Obsidian vault `~/Documents/ObsidianVault/Kurs Watch/` (notes 00 to 10: Architecture, Monitor, Dashboard,
  Data Model, Alert Rules, Configuration, How to Run, Known Gaps, Data Retention, Change Log).
- `docs/matsu.architecture.json` and the generated `docs/matsu-architecture.html` (archify skill: `deliver architecture ...`).
- `.env.example` when adding env vars.
