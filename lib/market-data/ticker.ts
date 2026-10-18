/**
 * Synthetic ticker.
 *
 * Mudrex has NO REST ticker endpoint (verified: docs list only WebSocket
 * streams for live tickers). Until a WebSocket ticker is added, the "last
 * price" is derived from the most recent closed 1-minute candle close and is
 * explicitly labeled synthetic. The TickerSource interface is designed so a
 * WebSocket implementation can be dropped in later without touching callers.
 */
import type { ExchangeProvider, Timeframe } from "@/lib/exchange/types";
import { assertWatchlistSymbol } from "@/lib/exchange/watchlist-guard";
import { DataError } from "@/lib/safety/errors";
import { validateCandleSeries } from "./candle-validation";
import type { WatchlistSymbol } from "@/lib/config/watchlist";

export interface Ticker {
  symbol: string;
  price: number;
  /** Epoch seconds of the candle this price came from. */
  tsSeconds: number;
  /** true = derived from candles, NOT a real exchange tick. Always surfaced in UI/logs. */
  synthetic: boolean;
  source: "1m-candle-close" | "websocket" | "backtest-decision-close";
}

export interface TickerSource {
  getLastPrice(symbol: WatchlistSymbol): Promise<Ticker>;
}

export interface SyntheticTickerOptions {
  /** How far back to look for 1m candles. Default 900s (15 min). */
  lookbackSeconds?: number;
  /** Max tolerated age of the newest closed 1m candle. Default 180s. */
  maxStalenessSeconds?: number;
  /** Injectable clock for tests (epoch seconds). */
  nowSeconds?: () => number;
}

const TF: Timeframe = "1m";

export class SyntheticCandleTicker implements TickerSource {
  constructor(
    private readonly provider: ExchangeProvider,
    private readonly opts: SyntheticTickerOptions = {},
  ) {}

  async getLastPrice(symbol: WatchlistSymbol): Promise<Ticker> {
    assertWatchlistSymbol(symbol);
    const now = this.opts.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    const lookback = this.opts.lookbackSeconds ?? 900;
    const maxStaleness = this.opts.maxStalenessSeconds ?? 180;

    const candles = await this.provider.fetchCandles(symbol, TF, now - lookback, now);
    const report = validateCandleSeries(symbol, TF, candles, {
      nowSeconds: now,
      maxStalenessSeconds: maxStaleness,
      // A single missing minute is common on illiquid pairs; still fail if more.
      maxGapSlots: 1,
    });
    if (!report.ok) {
      throw new DataError(
        `Synthetic ticker unavailable for ${symbol}: ${report.issues
          .map((i) => i.message)
          .join("; ")}`,
      );
    }
    const last = candles[candles.length - 1];
    return {
      symbol,
      price: last.close,
      tsSeconds: last.startTime,
      synthetic: true,
      source: "1m-candle-close",
    };
  }
}
