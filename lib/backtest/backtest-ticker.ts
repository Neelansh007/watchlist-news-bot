import type { WatchlistSymbol } from "@/lib/config/watchlist";
import { DataError } from "@/lib/safety/errors";
import type { Ticker, TickerSource } from "@/lib/market-data/ticker";

/**
 * Backtest ticker: the "last price" at a decision time is the CLOSE of the
 * decision bar that just completed. The engine sets it before each snapshot.
 *
 * Rationale: in live trading the last price comes from the synthetic 1m ticker.
 * In a backtest we drive decisions on a single timeframe, so using that bar's
 * close keeps the entry price on the SAME series used for SL/TP exit checks
 * (no cross-timeframe inconsistency), and avoids fetching 1m data entirely.
 * It is still labeled synthetic.
 */
export class BacktestTicker implements TickerSource {
  private readonly prices = new Map<WatchlistSymbol, { price: number; tsSeconds: number }>();

  setPrice(symbol: WatchlistSymbol, price: number, tsSeconds: number): void {
    this.prices.set(symbol, { price, tsSeconds });
  }

  async getLastPrice(symbol: WatchlistSymbol): Promise<Ticker> {
    const p = this.prices.get(symbol);
    if (!p || !Number.isFinite(p.price) || p.price <= 0) {
      throw new DataError(`backtest ticker has no price for ${symbol}`);
    }
    return {
      symbol,
      price: p.price,
      tsSeconds: p.tsSeconds,
      synthetic: true,
      source: "backtest-decision-close",
    };
  }
}
