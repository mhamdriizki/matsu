# CLAUDE.md — Matsu (待つ)

Matsu watches BCA's **e-Rate Jual** (https://www.bca.co.id/id/informasi/kurs), keeps history in
SQLite, sends Telegram alerts when the rate is inside a target band, and shows a Next.js dashboard.
The repo folder is still named `kurs-watch`, and some identifiers use the old name too (dashboard title, package name, docs file names).
The current branch `feat/multi-currency` moves it from one currency (env `CURRENCY`, default JPY) to a watchlist. See `PRD.md`.

## Architecture
```
BCA page --> monitor (Python, monitor/monitor.py) --> SQLite ./data/kurs.db <-- dashboard (Next.js 16)
                 |--> Telegram sendMessage                                     (reads; writes only the target)
                 '--> optional HEALTHCHECK_URL ping
```
- Both services mount the same `./data` volume at `/data` (`DB_PATH=/data/kurs.db`), see `docker-compose.yml`.
- **The monitor owns the DB.** It creates the schema (`SCHEMA` in monitor.py), writes `rates` and `state`.
- **The dashboard** opens short-lived read-only connections (`withDb` in `dashboard/lib/db.ts`). Its only
  write is `setTarget` (a read-write connection in one transaction).
- Tables: `rates(id, fetched_at, source_updated_at, currency, erate_*/tt_*/notes_* beli+jual)`,
  `state(key, value)` with keys `target_min`, `target_max`, `in_band`, `band_low`,
  `consecutive_failures`, `last_ok`, `last_error`.
- Dashboard binds to `127.0.0.1:3000` and has no auth.

## Commands
```bash
docker compose up -d --build                                   # run both services
docker compose build                                           # build only
docker compose run --rm monitor python monitor.py --dry        # fetch+parse once, print, touch nothing
docker compose run --rm monitor python monitor.py --once       # one full cycle (store + alerts)
docker compose run --rm monitor python monitor.py --test-telegram
docker compose run --rm -v ./monitor:/app monitor python test_targets.py   # tests (plain asserts, print "ok")
docker compose run --rm -v ./monitor:/app monitor python test_prune.py
cd dashboard && npm install && DB_PATH=../data/kurs.db npm run dev         # dashboard dev
cd dashboard && npx tsc --noEmit                                           # typecheck
DB_PATH=./data/kurs.db python3 scripts/seed_sample.py          # ~60 days of fake JPY rows; delete the DB afterwards
```
The `-v ./monitor:/app` mount is needed because the image only copies `monitor.py`, not the tests.
`scripts/seed_sample.py` has its own copy of the schema. Keep it in sync with `monitor.py`.

## Conventions and gotchas (verified in code)
- **Target lives in the DB**, in `state` keys `target_min` and `target_max`. The monitor reads it on every
  poll (`get_targets`). The env vars `TARGET_MIN`/`TARGET_MAX` are only defaults until the first save.
  `min` 0 means no floor.
- Saving a target resets `in_band=0` and `band_low=inf` (`setTarget`), so the next poll alerts again if the rate is in the new band.
- Alerts (`evaluate_alerts`): one alert on entering the band, one on each new low while inside, one on
  leaving. After `FAIL_ALERT_AFTER` (3) failed polls in a row it sends a failure alert, and a recovery alert once polling works again.
- Dedupe (`store_if_new`): insert only if BCA's stamp changed. With no stamp, insert only if the value changed.
- **`source_updated_at` is currently always None**: the "Terakhir diperbarui pada" regex in
  `parse_updated` does not match the live page, so dedupe compares values instead.
- `prune_old` deletes rows older than `RETENTION_DAYS` (10) but always keeps the newest row per
  currency (`MAX(id) GROUP BY currency`). The dashboard's `RANGES` in `lib/db.ts` must not go above the retention period.
- On a ParseError the raw page is written to `/data/last_page.html` for debugging.
- **The dashboard container runs as root on purpose**: it must write into the SQLite file that the root
  monitor created. Do not "fix" this by adding `USER node`.
- **shadcn `add`**: the generated components may get a bogus `cn` import. Replace it with
  `import { cn } from "@/lib/utils"`. `-o` (overwrite) still prompts, so answer it or pipe `yes`.
  The style is `base-nova` (Base UI, `render=` prop, not `asChild`).
- Needs Node >= 22 (better-sqlite3 13). `next.config.js` marks it as a `serverExternalPackages` entry and uses standalone output.
- `next/font/google` (Zen Kaku Gothic New) downloads fonts at build time, so the Docker build needs network access.
- **Rate scale differs per currency**: JPY is about 113 (2 decimals matter), SGD about 14 000, USD about 18 000.
  The chart (`lo/hi` ±0.5, `toFixed(0)` ticks) and the meter (±0.5 padding) currently assume the JPY scale.
- Indonesian number format on the page: `to_num("17.845,00") -> 17845.0`.
- Times are stored in UTC and shown in WIB (`lib/format.ts`).
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
- `docs/kurs-watch.architecture.json` and the generated `docs/kurs-watch-architecture.html`. The README
  links to `docs/matsu-architecture.html`, but that file does not exist.
- `.env.example` when adding env vars.
