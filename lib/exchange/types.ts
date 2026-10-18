import type { WatchlistSymbol } from "@/lib/config/watchlist";

/** Candle timeframes this bot uses (intraday focus). */
export type Timeframe = "1m" | "5m" | "15m" | "1h";

export interface Candle {
  /** Canonical watchlist form, e.g. "BTC/USDT". */
  symbol: string;
  timeframe: Timeframe;
  /** Epoch SECONDS of the candle open time (Mudrex convention). */
  startTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A futures instrument as listed by the exchange, mapped to domain fields. */
export interface Instrument {
  /** Exchange-native symbol, e.g. "BTCUSDT". */
  exchangeSymbol: string;
  /** Canonical "BASE/QUOTE" form, or null if the quote asset isn't USDT. */
  canonicalSymbol: string | null;
  id: string;
  name: string;
  minContract: number;
  maxContract: number;
  quantityStep: number;
  minNotionalValue: number;
  minLeverage: number;
  maxLeverage: number;
  /** Last known price reported with the instrument listing, if present. */
  price: number | null;
  /** Raw exchange payload kept for audit (never trusted without parsing). */
  raw: unknown;
}

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";

export interface OrderRequest {
  symbol: WatchlistSymbol;
  side: OrderSide;
  type: OrderType;
  qty: number;
  /** Required for LIMIT orders. */
  price?: number;
  /** Idempotency key. */
  clientOrderId?: string;
}

export interface OrderResult {
  orderId: string;
  status: string;
  filledQty: number;
  avgPrice: number | null;
  raw: unknown;
}

/**
 * Exchange abstraction. Four implementations: mock (fixtures), deterministic
 * (seeded synthetic), paper (reads via mudrex/deterministic, fills simulated
 * locally), mudrex (real REST API; writes are safety-guarded).
 *
 * All write operations MUST throw SafetyError unless live trading is fully
 * enabled (see lib/safety/live-guard.ts).
 */
export interface ExchangeProvider {
  readonly kind: "mock" | "deterministic" | "paper" | "mudrex";
  fetchInstruments(): Promise<Instrument[]>;
  fetchCandles(
    symbol: WatchlistSymbol,
    timeframe: Timeframe,
    startTimeSeconds: number,
    endTimeSeconds: number,
  ): Promise<Candle[]>;
  createOrder(req: OrderRequest): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<OrderResult>;
  setLeverage(symbol: WatchlistSymbol, leverage: number): Promise<void>;
}
