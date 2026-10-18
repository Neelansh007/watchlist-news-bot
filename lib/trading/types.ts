import type { WatchlistSymbol } from "@/lib/config/watchlist";

export type Side = "LONG" | "SHORT";

/** Exchange-specific contract constraints, parsed from Mudrex /futures. */
export interface InstrumentConstraints {
  /** Minimum order quantity (contracts/base units). */
  minContract: number;
  /** Maximum order quantity. */
  maxContract: number;
  /** Quantity must be an integer multiple of this step. */
  quantityStep: number;
  /** Minimum order notional value (qty * price), in quote (USDT). */
  minNotional: number;
  /** Exchange-imposed maximum leverage for this instrument. */
  maxLeverage: number;
}

/** A fully-specified trade idea with entry, stop-loss and take-profit. */
export interface TradeSetup {
  symbol: WatchlistSymbol;
  side: Side;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  /** |entry - stopLoss| */
  slDistance: number;
  /** |takeProfit - entry| */
  tpDistance: number;
  /** tpDistance / slDistance */
  rewardRisk: number;
  /** ATR(14,15m) used to derive the stop distance. */
  atr: number;
}

/** A TradeSetup sized against the current portfolio and instrument limits. */
export interface SizedPosition {
  symbol: WatchlistSymbol;
  side: Side;
  qty: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  /** qty * entryPrice */
  notional: number;
  /** Leverage actually used (min of config cap and instrument cap). */
  leverage: number;
  /** notional / leverage — the margin this position ties up. */
  marginRequired: number;
  /** |entry - stopLoss| * qty — USDT lost if the stop is hit (before fees). */
  riskAmount: number;
  rewardRisk: number;
}
