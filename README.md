# watchlist-news-bot

A safety-first, **paper-only** intraday crypto-futures bot for a fixed watchlist
on Mudrex: **BTC/USDT, XAU/USDT, XRP/USDT, ETH/USDT, SOL/USDT, HYPE/USDT,
BNB/USDT**. No other symbol can ever be traded, even if the exchange lists more.

> **Live trading is intentionally impossible in this build.** Three independent
> gates guard exchange writes, the code-level master switch is `false`, and live
> order routing is not implemented. Every fill, fee, and PnL figure is simulated.

## What it does

- Pulls candles/news, builds multi-timeframe market snapshots, and validates data
  strictly (missing/malformed/stale data ⇒ no trade).
- Runs four rule-based initiating analysts plus a news-sentiment analyst, then a
  majority consensus gate (news can never initiate; it can veto or lower
  confidence).
- Applies a frozen, independently tested risk engine: risk per trade, leverage,
  concurrent positions, daily loss, total drawdown, per-symbol exposure, mandatory
  stop-loss, and minimum reward:risk. Breaches block entries and can halt trading.
- Sends surviving candidates to an independent Anthropic review agent; any review
  failure fails closed to `FLAG_FOR_HUMAN_REVIEW`.
- Simulates fills in a paper OMS with fees and slippage, including conservative
  gap-through-stop and stop-first-when-both-touched behavior.
- Persists paper state to PostgreSQL, exposes read-only JSON APIs, and renders a
  dashboard with an equity curve, positions, cycles, risk events, and journal.
- Includes a backtester that reuses the live decision pipeline, applies the same
  exit model, and splits results into in-sample/out-of-sample segments.

## Quick start

```bash
npm install
# Fill in DATABASE_URL, MUDREX_API_SECRET, ANTHROPIC_API_KEY in .env
npm run setup:db
npm run paper:once
npm run dev            # dashboard at http://localhost:3000
```

Secrets are read only from `.env`, which is git-ignored. Never commit it or paste
its contents anywhere.

### Commands

| Command | Purpose |
|---|---|
| `npm run setup:db` | Create the `watchlist_bot` database and apply migrations. |
| `npm run test` | Run all Vitest suites (347 tests). |
| `npm run typecheck` | TypeScript, no emit. |
| `npm run lint` | ESLint. |
| `npm run build` | Production Next.js build. |
| `npm run paper:once` | Run one full paper cycle. |
| `npm run paper:autopilot` | Run paper cycles every 5 minutes (Ctrl+C to stop). |
| `npm run backtest:run` | Walk-forward backtest on synthetic data. |
| `npm run dev` | Dashboard + API routes. |

Flags for the paper CLIs: `--no-db`, `--no-news`, `--provider=paper|deterministic|trending|mudrex`,
`--interval=<seconds>`, `--cycles=<count>`.

## Data sources

- With no `MUDREX_API_SECRET`, runs use a **deterministic synthetic provider** and
  are labeled as such. Results validate plumbing, never edge.
- With a Mudrex secret, public klines are read directly. There is no REST ticker,
  so the price line is synthesized from the latest 1m close and labeled accordingly.
- News defaults to configurable public RSS feeds. Feed failures degrade to “news
  unavailable” and reduce consensus confidence; they never trigger a trade.

## Documentation

- [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) — honest verified/unverified status.
- [`docs/MY_STEPS.md`](docs/MY_STEPS.md) — plain-English setup checklist for the operator.
- [`docs/RISK_SETTINGS.md`](docs/RISK_SETTINGS.md) — approved risk limits and assumptions.

## Disclaimer

This software is for research and paper trading. Backtests on synthetic data say
nothing about live performance. Fees and slippage are modeled assumptions, not
verified exchange values. Nothing here is financial advice. Do not enable live
trading without an independent security and strategy review.
