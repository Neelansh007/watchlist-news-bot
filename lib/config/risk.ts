/**
 * ALL risk limits and cost assumptions live in this single file.
 * Values below are CONSERVATIVE PROPOSALS. They require explicit user
 * approval (see docs/RISK_SETTINGS.md) before the paper autopilot is
 * considered authorized to use them. Nothing here may be loosened at
 * runtime — the risk engine reads these as frozen constants.
 *
 * Full human-readable explanation of each value: docs/RISK_SETTINGS.md
 */

export const RISK_LIMITS = {
  /** Max % of current equity risked between entry and stop-loss on one trade. */
  riskPerTradePct: 0.5,

  /** Hard cap on leverage. Anything above is blocked, no override. */
  maxLeverage: 3,

  /** Max number of positions open at the same time. */
  maxConcurrentPositions: 3,

  /** Max loss in a single UTC day (% of equity at day start). Breach halts new entries for the day. */
  maxDailyLossPct: 2.0,

  /** Max peak-to-equity drawdown (%). Breach halts ALL new entries until a human resets it. */
  maxTotalDrawdownPct: 10.0,

  /** Max position notional per symbol, as % of equity. */
  maxExposurePerSymbolPct: 20.0,

  /** Minimum reward:risk (TP distance / SL distance) for a setup to be accepted. */
  minRewardRisk: 1.5,

  /** Stop-loss is mandatory on every position. NOT configurable, ever. */
  requireStopLoss: true,

  /** Max minutes a position may stay open. Positions are flattened before this limit. */
  maxHoldMinutes: 240,
} as const;

export const COST_ASSUMPTIONS = {
  /**
   * Taker fee, fraction of notional, per side (entry and exit).
   * ASSUMPTION: Mudrex futures taker fee not verified from docs at build time.
   * Conservative placeholder — confirm your actual fee tier and update.
   */
  takerFeeRate: 0.0005,

  /**
   * Slippage, fraction of price, applied against us on every fill
   * (worse price on entry AND exit). ASSUMPTION: Mudrex does not expose
   * liquidity/depth data via REST; this is a conservative fixed estimate.
   */
  slippageRate: 0.0003,
} as const;

export const PAPER_DEFAULTS = {
  /** Starting equity for paper trading and backtests, in USDT. */
  startingEquityUsdt: 10_000,
} as const;

/**
 * Strategy parameters that shape HOW a setup's stop-loss / take-profit are
 * placed. These are risk-adjacent (they set the SL distance) so they live here
 * and are part of the same approval checkpoint as RISK_LIMITS.
 *
 * targetRewardRisk MUST be >= RISK_LIMITS.minRewardRisk, otherwise every setup
 * would fail the minimum reward:risk check (locked by a test).
 */
export const SETUP_PARAMS = {
  /**
   * Stop-loss distance = atrStopMultiplier * ATR(14, 15m).
   * 1.5 ATR is a common intraday buffer: wide enough to avoid noise stop-outs,
   * tight enough that position sizing keeps per-trade risk small.
   */
  atrStopMultiplier: 1.5,

  /**
   * Take-profit is placed so reward:risk equals this value.
   * 2.0 means we aim to make 2 units for every 1 unit risked.
   */
  targetRewardRisk: 2.0,
} as const;

export const TIMEFRAMES = {
  /** Candle timeframes used for intraday analysis. */
  analysis: ["5m", "15m", "1h"] as const,
  /** Timeframe used to derive the synthetic last price (see lib/market-data/ticker.ts). */
  syntheticTicker: "1m",
} as const;

export type RiskLimits = typeof RISK_LIMITS;
export type CostAssumptions = typeof COST_ASSUMPTIONS;
