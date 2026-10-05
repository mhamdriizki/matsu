# kurs-watch

Watches BCA's **e-Rate Jual** for one currency (default JPY), keeps history in SQLite,
alerts via Telegram, and shows a Next.js dashboard.

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

## Alert rules
- Alert once when the rate enters `TARGET_MIN..TARGET_MAX`, again on each new low while inside,
  and once when it leaves. No repeated pings while it sits still.
- 3 failed polls in a row triggers a "scraper failing" message; recovery triggers another.
- Optional `HEALTHCHECK_URL` is pinged after each good poll, so you also hear about a dead container.

## Tests
Parser and alert logic were exercised offline against synthetic HTML. The live BCA HTML has not been
tested from your VPS; step 3 is that test.
