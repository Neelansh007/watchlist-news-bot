# RISK_SETTINGS — approved defaults (2026-10-04)

> **STATUS: APPROVED.** On 2026-10-04 the user said "Proceed with default
> settings", approving every value below as-is. The paper autopilot is
> authorized to use these. Live trading remains OFF regardless (3-gate guard +
> master switch in `lib/safety/live-guard.ts`).

Every number below lives in **one file**: `lib/config/risk.ts`.
Nothing can loosen these at runtime.

| Setting | Proposed value | One-line explanation |
|---|---|---|
| `riskPerTradePct` | **0.5%** | If a trade hits its stop-loss, you lose at most 0.5% of equity (~$50 on a $10k account). |
| `maxLeverage` | **3x** | Hard cap on leverage; higher leverage = faster liquidation. 3x is mild for intraday. |
| `maxConcurrentPositions` | **3** | At most 3 open positions at once (out of 7 watchlist symbols), limiting correlated risk. |
| `maxDailyLossPct` | **2%** | If the day's realized+unrealized loss reaches 2% of start-of-day equity, no new entries until the next UTC day. |
| `maxTotalDrawdownPct` | **10%** | If equity falls 10% below its all-time peak, ALL trading halts until a human explicitly resets it. |
| `maxExposurePerSymbolPct` | **20%** | One symbol's position notional can never exceed 20% of equity. |
| `minRewardRisk` | **1.5** | A setup must target at least 1.5x more profit than risk (TP distance ÷ SL distance) or it's rejected. |
| `requireStopLoss` | **true (permanent)** | Every position must have a stop-loss. Not configurable. |
| `maxHoldMinutes` | **240 (4h)** | Intraday focus: positions are force-flattened before 4 hours. |
| `takerFeeRate` | **0.05% per side** | ASSUMPTION — Mudrex fee tier not verified; applied on entry and exit in paper/backtest. |
| `slippageRate` | **0.03% per fill** | ASSUMPTION — no depth data via REST; fills modeled at a worse price on both sides. |
| `startingEquityUsdt` | **10,000** | Paper-trading starting balance. |
| `atrStopMultiplier` | **1.5** | Strategy param: stop-loss distance = 1.5 × ATR(14, 15m). Wider = fewer noise stop-outs but smaller size (risk per trade is fixed). |
| `targetRewardRisk` | **2.0** | Strategy param: take-profit is placed to make 2 units per 1 unit risked. Must stay ≥ `minRewardRisk` (locked by a test). |

> **How sizing works:** risk per trade is fixed at `riskPerTradePct`, so the
> position size shrinks automatically when the ATR stop is wide. Quantity is the
> SMALLEST of (risk budget ÷ stop distance), (per-symbol exposure cap), and
> (available margin × leverage), then rounded DOWN to the exchange step. If the
> result can't meet the exchange's min contract / min notional, the trade is
> skipped — we never oversize to reach a minimum.

## Status and changes

These values are **approved and active** (2026-10-04) and are enforced by the risk
engine and its tests. They live in one file (`lib/config/risk.ts`) and are frozen
at runtime — no CLI flag, env var, or API call can loosen them.

Changing a value later requires a deliberate code edit, re-running the full test
suite, and re-approving the new numbers. Live trading remains OFF regardless of
these settings.
