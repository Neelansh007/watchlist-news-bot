import type { WatchlistSymbol } from "@/lib/config/watchlist";
import type { Timeframe } from "@/lib/exchange/types";
import type { ExchangeProvider } from "@/lib/exchange/types";
import type { NewsBundle } from "@/lib/news/types";
import type { InstrumentConstraints, Side } from "@/lib/trading/types";
import type { ExitReason } from "@/lib/oms/types";

export type DataMode = "synthetic" | "real";
export type SegmentLabel = "full" | "in-sample" | "out-of-sample";

export interface BacktestConfig {
  provider: ExchangeProvider;
  symbols?: readonly WatchlistSymbol[];
  startSeconds: number;
  endSeconds: number;
  /** Timeframe the strategy steps on (entries decided at each bar close). Default "15m". */
  decisionTimeframe?: Timeframe;
  startingEquityUsdt?: number;
  /** News context. Default: unavailable (no historical news in a backtest). */
  news?: NewsBundle;
  /** Per-symbol contract constraints. Default: derived from provider.fetchInstruments(). */
  instruments?: Partial<Record<WatchlistSymbol, InstrumentConstraints>>;
  segmentLabel?: SegmentLabel;
}

export interface BacktestTrade {
  symbol: WatchlistSymbol;
  side: Side;
  entryTimeSeconds: number;
  exitTimeSeconds: number;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  leverage: number;
  realizedPnl: number;
  closeReason: ExitReason;
  gapThroughStop: boolean;
  holdMinutes: number;
}

export interface BacktestMetrics {
  tradeCount: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  /** grossProfit / grossLoss; Infinity when there are no losers, 0 when no trades. */
  profitFactor: number;
  /** Average net PnL per trade. */
  expectancy: number;
  netPnl: number;
  maxDrawdownAbs: number;
  maxDrawdownPct: number;
  finalEquity: number;
  returnPct: number;
}

export interface SymbolBreakdown {
  symbol: WatchlistSymbol;
  tradeCount: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdownAbs: number;
}

export interface BacktestResult {
  segmentLabel: SegmentLabel;
  dataMode: DataMode;
  decisionTimeframe: Timeframe;
  startSeconds: number;
  endSeconds: number;
  startingEquity: number;
  metrics: BacktestMetrics;
  perSymbol: SymbolBreakdown[];
  trades: BacktestTrade[];
  /** Count of entries the risk engine refused (with the limiting reason). */
  rejections: { symbol: WatchlistSymbol; timeSeconds: number; reason: string }[];
  /** Always present: backtests do not guarantee live profit. */
  disclaimer: string;
}
