# PROJECT_STATUS — honest status ledger

Last updated: Stage 9 (2026-10-18). **All nine stages are complete.**

Legend:
- **implemented** — code exists
- **tested (fixtures)** — covered by Vitest tests against fixtures/mocks only
- **verified (real API)** — confirmed against the real external system
- **not done** — planned for a later stage

## External API facts

| Fact | Status |
|---|---|
| Mudrex base URL `https://trade.mudrex.com/fapi/v1` | **verified (docs.trade.mudrex.com, 2026-10-04)** |
| Auth header `X-Authentication: <secret>` | **verified (docs)** |
| `GET /futures` response shape (`{success, data:[{id,name,symbol,min_contract,...,price}]}`, numerics as strings) | **verified (docs example)** — but NOT yet against a live authenticated call (needs your API secret) |
| `GET /price/kline` params (`assets`, `aggregation`, `start_time`/`end_time` epoch seconds) and response `{data:{asset_ticks:{"btc/usdt":[[ts,o,h,l,c,v]]}}}` | **verified (docs example)** — not yet against a live call |
| Allowed `aggregation` values `1m,3t,5t,10t,15t,30t,1h,4h,6h,12h,1d,1w,1mth` | **verified (docs)** |
| Mapping bot timeframes → aggregation: 5m→`5t`, 15m→`15t` ("t" = minutes) | **ASSUMED** — docs list the values but don't spell out that "t" means minutes. Your live-API test will confirm. |
| Unrecognized kline pairs are silently dropped | **verified (docs)** — handled: treated as UNAVAILABLE, never fabricated |
| No REST ticker endpoint (WebSocket only) | **verified (docs)** — synthetic ticker from latest 1m close, always labeled `synthetic: true` |
| Whether XAU/USDT and HYPE/USDT are actually listed on Mudrex futures | **UNKNOWN until your live test** — discovery marks missing ones UNAVAILABLE and reports them |
| Mudrex taker fee rate (using 0.05%) and slippage (using 0.03%) | **ASSUMED** — conservative placeholders in `lib/config/risk.ts`; docs mention a fees endpoint, not verified values |
| Anthropic model ids `claude-sonnet-5-5` / `claude-opus-5-5` | **verified (anthropic.com / platform.claude.com, 2026-10-04)** |
| Anthropic Messages API request/response shape used by the review agent (`x-api-key`, `anthropic-version: 2023-06-01`, forced `tool_choice`) | **tested against mocks only** — NOT yet verified against a live Anthropic call (needs your key); review agent fails closed to FLAG_FOR_HUMAN_REVIEW on any mismatch |
| Test fixtures (`tests/fixtures/mudrex/*.json`) | Built from the verified doc examples; **fixtures are only as accurate as the docs** — real verification happens only when you run against the live API |

## Modules

| Module | Status | Notes |
|---|---|---|
| Config (env, risk limits, watchlist) | implemented, **tested** | 24 tests (Stage 1) |
| Safety core (SafetyError, 3-gate live guard) | implemented, **tested** | master switch OFF; locked by tests |
| DB schema + migrations + `setup:db` | implemented, **verified against a real PostgreSQL 18** | `setup:db` created the database and applied migrations `0000` + `0001` cleanly on a temporary local cluster (2026-10-18). **Your `.env` `DATABASE_URL` still contains the literal placeholders `<USER>`/`<PASSWORD>` (auth error `28P01`, re-confirmed Stage 9)** — replace them with your real local credentials, then run `npm run setup:db` once. |
| Mudrex REST client (reads) | implemented, **tested (fixtures/mocked fetch)** | strict parsers, fail-closed, no secret leakage (tested) |
| Mudrex writes (createOrder/cancelOrder/setLeverage) | implemented as **hard-guarded stubs**, tested | always throw SafetyError in this build; live routing intentionally not implemented |
| Instrument discovery + watchlist guard | implemented, **tested** | non-watchlist symbols refused everywhere |
| Candle validation (OHLC/dup/gap/stale/alignment) | implemented, **tested** | zero-tolerance gaps by default |
| Providers: mock, deterministic, paper | implemented, **tested** | deterministic = seeded, reproducible |
| Synthetic ticker | implemented, **tested** | interface ready for a real WebSocket ticker later |
| News providers (RSS + fixtures + optional API-key) | implemented, **tested** | fail-soft per feed; API-key provider disabled unless `NEWS_API_URL`+`NEWS_API_KEY` set; NewsAPI-style shape assumed for that provider |
| News sanitization / prompt-injection defenses | implemented, **tested** | no newlines/tags/control chars can survive; fenced data blocks; injection tests included |
| News relevance tagging + dedupe + lookback | implemented, **tested** | word-boundary keyword matching; macro headlines tagged MARKET_WIDE |
| Indicators (SMA/EMA/RSI/ATR/MACD/Bollinger) | implemented, **tested** | null = insufficient data → callers must fail closed |
| Market snapshot builder | implemented, **tested** | strict per-timeframe validation; fails closed listing exactly what is missing |
| Analyst agents (trend, momentum, volatility, risk-of-ruin, news-sentiment) | implemented, **tested (fixtures)** | rule-based, deterministic; news agent is NEVER initiating and can veto |
| Consensus engine | implemented, **tested** | majority among initiating votes + min confidence; sentiment nudge; veto + news-unavailable penalty block |
| Independent review agent (Anthropic) | implemented, **tested (mocked fetch)** | forced tool-use output; every failure path → FLAG_FOR_HUMAN_REVIEW; never throws; **NOT yet verified against a real Anthropic call** (needs your key) |
| Risk engine | implemented, **tested** | every limit a separate pure function, each independently tested; reads frozen `RISK_LIMITS` with **no override path** (epsilon-over-limit is blocked, tested); fails closed on invalid equity/anchors |
| Trade setup (entry/SL/TP, min R:R) | implemented, **tested** | ATR-buffered stop, RR-based target; fails closed if stop/target crosses zero; independent re-validation |
| Position sizing | implemented, **tested** | sized to smallest of risk / exposure / margin caps, rounded down to step; never oversizes to reach exchange minimums |
| Realistic exit-fill model | implemented, **tested** | gap-through-stop fills at the worse OPEN; conservative TP (never assumes a favorable gap); SL-first when one candle touches both; max-hold flatten at close; LONG & SHORT |
| Paper OMS (executor) | implemented, **tested** | runs the risk engine internally on every open (**no bypass path**); applies fees+slippage; continuous equity = cash + margin + uPnL; journal + equity curve; daily-loss/drawdown halts with UTC rollover |
| Portfolio accounting & realized PnL | implemented, **tested** | realized PnL incl. both fees; equity == starting + realized once flat (asserted) |
| Reconciliation | implemented, **tested** | 8 invariant checks; fed corrupted states in tests to prove it catches each bug |
| No-lookahead provider (backtest guard) | implemented, **tested** | wraps any provider; drops the bar still forming at `end` (startTime+step>end); writes delegated (still safety-guarded) |
| Backtest ticker | implemented, **tested** | "last price" = decision-bar close, labeled synthetic (`source: backtest-decision-close`) |
| Trending synthetic fixture provider | implemented, **tested** | coherent drifted series (1m base aggregated to 5m/15m/1h) so the frozen analysts can legitimately reach consensus; **clearly synthetic, plumbing-validation only, never live**; writes throw SafetyError |
| Backtest engine (`runBacktest`) | implemented, **tested** | reuses the LIVE decision pipeline (snapshot→analysts→consensus→setup→sizing→risk→OMS) + the tested exit model; no lookahead; walk-forward segments; metrics + per-symbol breakdown + disclaimer |
| Backtest metrics (win rate, PF, expectancy, net PnL, max DD) | implemented, **tested** | pure functions; drawdown from the marked equity curve; PF=∞ when no losers |
| Walk-forward split (in/out-of-sample) | implemented, **tested** | bar-aligned split; **robustness check, NOT an overfitting guard** (params are frozen) — stated honestly |
| `backtest:run` CLI | implemented, **verified running** | `tsx scripts/backtest-run.ts`; `--data=trend` (default, 144 trades over 14d) exercises the full lifecycle; `--data=walk` shows edgeless noise → **0 trades (fail-closed confirmed)** |
| Postgres persistence (Drizzle) | implemented, **tested (mappers) + verified against temp PostgreSQL** | positions, journal, cycles, votes, consensus, reviews, risk events, news, portfolio snapshots, settings; numerics as decimal strings; corrupt numerics are a hard error; cash is re-derived on restore, never trusted |
| Orchestrator (`runCycle`) | implemented, **tested** | exits before entries; exits run on closed 1m candles with a capped catch-up replay; failed exit data → no new entries and the cursor is NOT advanced; per-symbol isolation; review gate can only reduce trades; OMS re-runs the risk engine at execution; DB ids adopted into memory |
| `paper:once` / `paper:autopilot` CLIs | implemented, **verified running** | in-memory and persisted runs both verified; autopilot stops gracefully on Ctrl+C; DB failure falls back to in-memory with loud warnings; no secrets printed; live orders impossible |
| Read-only API routes | implemented, **verified in browser** | `/api/status`, `/api/positions`, `/api/journal`, `/api/equity`, `/api/cycles`, `/api/risk-events`; dynamic + `no-store`; DB failure → 503 `{ok:false,error:"database unavailable"}` with no internals leaked |
| Dashboard (`/`) | implemented, **verified in browser (both states)** | PAPER banner, halt banner (daily-loss/drawdown), portfolio cards, SVG equity curve, open/closed positions, recent cycles, risk events, journal, fixed watchlist; when the DB is unavailable it shows setup steps and **renders no invented numbers** |

## Test totals (real output)

- Stage 1: 3 files, **24 passed**, 0 failed (`npx vitest run`)
- Stage 2: 9 files, **77 passed**, 0 failed (`npx vitest run`)
- Stage 3: 13 files, **119 passed**, 0 failed (`npx vitest run`)
- Stage 4: 17 files, **164 passed**, 0 failed (`npx vitest run`)
- Stage 5: 20 files, **220 passed**, 0 failed (`npx vitest run`)
- Stage 6: 23 files, **269 passed**, 0 failed (`npx vitest run`)
- Stage 7: 28 files, **323 passed**, 0 failed (`npx vitest run`)
- Stage 8: 31 files, **347 passed**, 0 failed (`npx vitest run`)
- `npm run typecheck`, `npm run lint`, `npm run build`: all pass (Stage 8; build compiles 6 dynamic API routes + dynamic dashboard, 0 lint warnings)
- `npm run backtest:run`: **verified running** (Stage 7) — trend mode 144 trades / 99 wins / PF 3.12 / max DD 0.56% over 14 days on synthetic data; walk mode 0 trades (fail-closed).
- `npm run paper:once` / `npm run paper:autopilot`: **verified running** (Stage 8), both `--no-db` (in-memory) and persisted against a temporary PostgreSQL 18.
- Persisted restart was exercised for real: a second `paper:once` process restored the open position from Postgres, processed its 1m exits, applied gap-through-stop accounting, then correctly set daily-loss and drawdown halts.
- Browser verification (Stage 8): with the DB unreachable, `/` renders setup guidance and all six API routes return 503; with a seeded temporary DB, `/` renders cards, equity curve, positions, cycles, risk events, journal, and the halt banner.

### Stage 9 final verification (all required npm scripts re-run 2026-10-18)

- `npm run test` → **31 files, 347 passed, 0 failed**
- `npm run typecheck` → pass
- `npm run lint` → pass, 0 errors, 0 warnings
- `npm run build` → pass; dashboard + 6 API routes built as dynamic
- `npm run paper:once -- --no-db --no-news` → cycle OK; all 7 symbols NO_TRADE (fail-closed); 0 positions; no live orders
- `npm run paper:autopilot -- --no-db --no-news --cycles=1 --interval=10` → 1 cycle OK; clean stop; no live orders
- `npm run backtest:run` → 144 trades, 99 wins, PF 3.12, max DD 0.56% on **synthetic** data (plumbing only)
- `npm run setup:db` → verified in Stage 8 against a temporary PostgreSQL 18 (both migrations applied). **Against your actual `.env` it fails with `28P01` because `DATABASE_URL` still literally contains `<USER>`/`<PASSWORD>`** (re-confirmed Stage 9).

## What is proven vs not proven

**Proven (code + automated tests + local runs):**
- Live trading cannot happen: three-gate guard is tested, the code master switch is
  `LIVE_TRADING_MASTER_SWITCH = false`, and no live order-routing code exists.
- Every risk limit is a separate pure check with its own tests; no override path.
- Missing/stale/invalid data, component failures, and reviewer failures all lead to
  NO_TRADE or FLAG, never a guess.
- The full paper lifecycle (entry → SL/TP/max-hold/manual exit → fees/slippage →
  realized PnL → metrics), persistence, restart/restore, halts, API, and dashboard.
- `.env` is git-ignored and untracked; logs contain no secrets; tests use only dummy keys.

**Not proven (requires your keys or real-world validation):**
- Live Mudrex authenticated calls (`GET /futures`), real listings for XAU/HYPE, and
  the assumption that `5t`/`15t` mean 5/15 minutes.
- A live Anthropic review call and the exact review model behavior.
- Exchange fee tier and real slippage (both are modeled assumptions).
- Any real trading edge or profitability. All backtests use synthetic data.
- Persistence on **your** PostgreSQL instance (login currently fails).

## Remaining risks and uncertainties

1. **No live-API verification yet.** Mudrex request/response shapes come from its
   docs and fixtures, not from an authenticated call with your secret.
2. **Aggregation-unit assumption.** Docs list `1m,3t,5t,...,1h,...` but do not
   explicitly state that `t` = minutes. A wrong mapping would produce wrong
   timeframes; strict validation and fail-closed behavior limit damage but do not
   fix the mapping.
3. **Costs are assumptions.** 0.05% taker fee and 0.03% slippage are conservative
   placeholders, not verified Mudrex values. Real fees/fills will differ.
4. **Backtests are not evidence of edge.** Synthetic data was generated to exercise
   the pipeline. The in/out-of-sample split is a consistency check, not an
   overfitting guard (parameters are frozen). No real-market backtest has been run.
5. **Paper fills are simplified.** No order book, partial fills, funding, latency,
   liquidation engine, or exchange outages are modeled. Gap-through-stop is handled
   conservatively, but real execution can be worse.
6. **Review agent is untested live.** With an empty `ANTHROPIC_API_KEY` every
   candidate is flagged and no position opens — safe, but the reviewer’s real
   approval behavior is unverified.
7. **News is best-effort.** Public RSS feeds can be unavailable, delayed, or changed;
   sentiment is rule-based. Prompt-injection defenses are tested but cannot be
   formally proven complete.
8. **Clock and UTC rollover.** Daily-loss reset uses UTC day boundaries; a host clock
   that is wrong or changes timezone can shift the reset moment.
9. **Not financial advice.** This is research/paper-trading software.

## Pre-live checks (informational only — live is NOT authorized in this build)

Do not enable live trading. Setting environment variables is insufficient: the code
master switch is `false` and live order routing is not implemented. If live trading
were ever considered as a separate project, it would require, at minimum:

- Fixing and verifying the database, then running paper mode with real keys for an
  extended period and reconciling every fill against exchange data.
- Verifying symbol listings and aggregation mappings against the live Mudrex API.
- Adding a real order router with exchange-side stop protection, idempotency,
  partial-fill handling, rate-limit handling, and a tested kill switch.
- Independent security and strategy review, monitoring/alerting, and a written
  incident plan.
- Starting with minimal size and explicit human sign-off; plus legal/tax review.

None of those steps are part of this paper-first build.

> Note: the Stage 6 OMS state is now persisted by Stage 8 (positions, journal,
> portfolio snapshots, settings) and restored on the next process. Cash is
> re-derived from persisted positions rather than stored, so a corrupted cash
> value cannot be silently trusted. The temporary PostgreSQL cluster and its
> seeded demo rows were deleted after verification; your own database has not
> been touched.

> Stage 7 backtest results are on **SYNTHETIC** data and validate plumbing only —
> they say NOTHING about real strategy edge. See `BACKTEST_DISCLAIMER`
> (`lib/backtest/metrics.ts`), printed at the end of every `backtest:run`.
> The live Anthropic review gate is intentionally EXCLUDED from the backtest
> (cost + non-determinism); since it can only REJECT/FLAG, live trading is
> strictly more conservative than the backtest.
