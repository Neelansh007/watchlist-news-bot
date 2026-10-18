# MY_STEPS — the only things you do yourself

Plain-English checklist. Everything else — code, tests, docs, every command in
this project — has already been done by the assistant.

Run commands from the project folder in a terminal (Git Bash or PowerShell).

---

## Current state (2026-10-18)

- The bot is **fully built and paper-only**. Live order routing does not exist in
  this build, and the code-level live master switch is permanently `false`.
- **347 automated tests pass** across 31 files; typecheck, lint, and production
  build are clean.
- Your `.env` `DATABASE_URL` still contains the literal placeholders `<USER>` and
  `<PASSWORD>`, so PostgreSQL rejects the login (error `28P01`). Until you replace
  them with your real local credentials, the bot and dashboard run in-memory only
  (with loud warnings) and nothing is saved between runs. This was confirmed by
  running `npm run setup:db` on 2026-10-18.
- `MUDREX_API_SECRET` and `ANTHROPIC_API_KEY` are currently empty. That is safe:
  the bot uses synthetic data and flags every candidate trade for human review.

---

## 1. Install (one time)

```
npm install
```

## 2. Fill in `.env` (one time)

A file called `.env` already exists in the project folder. Open it in any text
editor (e.g. Notepad) and fill in **only** these values:

| Line in `.env` | What to put there | Where to get it |
|---|---|---|
| `DATABASE_URL=postgres://<USER>:<PASSWORD>@localhost:5432/watchlist_bot` | Replace `<USER>` and `<PASSWORD>` with your real local PostgreSQL username and password. Keep the database name `watchlist_bot`. | The credentials you chose when installing PostgreSQL (often user `postgres`). |
| `MUDREX_API_SECRET=` | Your Mudrex API secret, for **read-only** market data. | Mudrex website → API settings. |
| `ANTHROPIC_API_KEY=` | Your Anthropic API key, for the independent trade reviewer. | console.anthropic.com → API keys. |

Safety rules:
- `.env` is git-ignored. It is never committed, printed, or logged.
- **Never paste these values into chat** — not to me, not to anyone.
- If you do not know your PostgreSQL password, reset it through pgAdmin or the
  PostgreSQL installer. Do not send it to me.
- Leaving either API key empty is safe and fully supported.

## 3. Create the database (one time, after step 2)

```
npm run setup:db
```

This creates the database `watchlist_bot` if needed and applies the table
migrations. You should see `Database setup complete.` at the end.

> This step is what is currently blocked by the `28P01` login error. Fix the
> `DATABASE_URL` credentials first, then re-run it.

## 4. Optional: confirm the project is healthy

These are the same checks the assistant runs. They do not place any trades.

```
npm run test        # expect: 31 files, 347 tests passed
npm run typecheck
npm run lint
npm run build
npm run backtest:run
```

`backtest:run` uses **synthetic** data. A positive result there proves the
plumbing works; it says nothing about real-world profit.

## 5. Run paper trading

One full cycle:

```
npm run paper:once
```

Continuous paper autopilot (one cycle every 5 minutes; press `Ctrl+C` to stop):

```
npm run paper:autopilot
```

Useful flags (put them after `--`):

| Flag | Effect |
|---|---|
| `-- --no-db` | Force in-memory mode (nothing is saved). |
| `-- --no-news` | Skip news fetching; consensus is penalized for missing news. |
| `-- --provider=trending` | Synthetic trending data — plumbing validation only, never edge. |
| `-- --cycles=3 --interval=60` | Run 3 cycles, 60 seconds apart. |

What to expect:
- Without `ANTHROPIC_API_KEY`, the reviewer flags every candidate, so **no new
  paper positions** are opened. This is correct fail-closed behavior.
- With `ANTHROPIC_API_KEY`, the reviewer can approve candidates.
- With `MUDREX_API_SECRET`, paper cycles use real public Mudrex candles
  (read-only). **No order can be placed either way.**
- Without the secret, runs are labeled `SYNTHETIC` and validate plumbing only.

## 6. Dashboard

```
npm run dev
```

Open http://localhost:3000 in your browser. The dashboard is read-only and shows
paper equity, positions, cycles, risk events, journal entries, and any trading
halt. If the database is unreachable it shows setup instructions instead of
inventing data.

## 7. Live trading

**Do not enable live trading.** Live order routing is intentionally not
implemented in this build, and the master switch
(`LIVE_TRADING_MASTER_SWITCH` in `lib/safety/live-guard.ts`) is `false`. Setting
environment variables alone can never place a real order.

---

## If something fails

Copy the ENTIRE error output (the red/scary text is fine to paste — just **never
paste the contents of `.env` itself** or any password/API key) and send it back
to the assistant.
