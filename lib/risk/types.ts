import type { WatchlistSymbol } from "@/lib/config/watchlist";
import type { Side, SizedPosition } from "@/lib/trading/types";

/** Read-only view of one open position, as the risk engine sees it. */
export interface OpenPositionView {
  symbol: WatchlistSymbol;
  side: Side;
  qty: number;
  entryPrice: number;
  /** qty * entryPrice */
  notional: number;
  leverage: number;
  /** Mark-to-market PnL (can be negative). */
  unrealizedPnl: number;
}

/**
 * Point-in-time portfolio state the risk engine evaluates against.
 * The engine is PURE: it reads this state and the frozen RISK_LIMITS constants
 * and returns breaches. It never mutates state and never accepts looser limits.
 */
export interface PortfolioState {
  /** Current total equity (cash + unrealized PnL), USDT. */
  equity: number;
  /** Free cash available for margin, USDT. */
  cashBalance: number;
  /** Equity at the start of the current UTC day (daily-loss anchor). */
  dayStartEquity: number;
  /** Highest equity ever observed (drawdown anchor). */
  equityPeak: number;
  /** Set true once the daily-loss limit is breached; blocks new entries for the day. */
  dailyLossHalted: boolean;
  /** Set true once the total-drawdown limit is breached; blocks ALL new entries until a human resets it. */
  drawdownHalted: boolean;
  openPositions: OpenPositionView[];
}

/** A proposed new entry, already sized, awaiting the risk decision. */
export interface ProposedEntry {
  position: SizedPosition;
}

export type RiskLimitName =
  | "requireStopLoss"
  | "minRewardRisk"
  | "maxConcurrentPositions"
  | "maxExposurePerSymbolPct"
  | "maxDailyLossPct"
  | "maxTotalDrawdownPct"
  | "maxLeverage"
  | "riskPerTradePct"
  | "HALTED"
  | "MARGIN";

export type RiskAction = "BLOCK_ENTRY" | "HALT_DAY" | "HALT_ALL";

export interface RiskBreach {
  limit: RiskLimitName;
  action: RiskAction;
  message: string;
}

export interface RiskDecision {
  allowed: boolean;
  breaches: RiskBreach[];
}
