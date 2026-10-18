import type { WatchlistSymbol } from "@/lib/config/watchlist";
import type { Side } from "@/lib/trading/types";

/** Why a position was closed. Mirrors the DB `close_reason` enum. */
export type ExitReason = "STOP_LOSS" | "TAKE_PROFIT" | "MAX_HOLD" | "MANUAL";

export type PositionStatus = "OPEN" | "CLOSED";

/** A position held by the paper OMS. Prices are absolute; PnL is in quote (USDT). */
export interface PaperPosition {
  id: number;
  symbol: WatchlistSymbol;
  side: Side;
  qty: number;
  leverage: number;
  /** Price the strategy intended to enter at (before slippage). */
  intendedEntryPrice: number;
  /** Actual simulated entry fill (intended entry +/- slippage). */
  entryFillPrice: number;
  stopLoss: number;
  takeProfit: number;
  rewardRisk: number;
  /** Margin locked for this position (notional / leverage). */
  margin: number;
  /** Taker fee paid on entry (USDT). */
  entryFee: number;
  openedAtSeconds: number;
  maxHoldUntilSeconds: number;
  status: PositionStatus;

  // Populated on close:
  closeReason?: ExitReason;
  /** Raw exit price before slippage (SL/TP level, gap open, or close). */
  rawExitPrice?: number;
  /** Actual simulated exit fill (raw exit +/- slippage). */
  exitFillPrice?: number;
  exitFee?: number;
  /** Net realized PnL incl. entry+exit fees (USDT). Negative == loss. */
  realizedPnl?: number;
  closedAtSeconds?: number;
  /** True when the candle gapped through the stop and we filled at the open. */
  gapThroughStop?: boolean;
}

/** Append-only human-readable record of everything the OMS does. */
export interface JournalEntry {
  tsSeconds: number;
  kind:
    | "POSITION_OPENED"
    | "POSITION_CLOSED"
    | "MARK_TO_MARKET"
    | "RISK_BLOCK"
    | "HALT"
    | "RECONCILIATION"
    | "INFO";
  symbol?: WatchlistSymbol;
  positionId?: number;
  message: string;
  payload?: Record<string, unknown>;
}

/** Point-in-time portfolio view for the dashboard / equity curve. */
export interface PortfolioView {
  equity: number;
  cash: number;
  lockedMargin: number;
  unrealizedPnl: number;
  /** Cumulative realized PnL across all closed positions. */
  realizedPnl: number;
  openPositionCount: number;
  equityPeak: number;
  dayStartEquity: number;
  dailyLossHalted: boolean;
  drawdownHalted: boolean;
}

/** One point on the equity curve. */
export interface EquityPoint {
  tsSeconds: number;
  equity: number;
}
