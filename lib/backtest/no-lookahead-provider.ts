import type {
  Candle,
  ExchangeProvider,
  Instrument,
  OrderRequest,
  OrderResult,
  Timeframe,
} from "@/lib/exchange/types";
import type { WatchlistSymbol } from "@/lib/config/watchlist";
import { TIMEFRAME_SECONDS } from "@/lib/exchange/providers/deterministic";

/**
 * Wraps any ExchangeProvider so that a fetch ending at time `end` only returns
 * candles that are FULLY CLOSED by `end` (startTime + timeframeStep <= end).
 *
 * This is the core anti-lookahead guard for the backtester: the snapshot builder
 * asks for candles up to "now", and without this filter the bar that is still
 * forming at "now" would leak future information into the decision. Writes are
 * delegated unchanged (they remain safety-guarded by the underlying provider).
 */
export class NoLookaheadProvider implements ExchangeProvider {
  readonly kind: ExchangeProvider["kind"];

  constructor(private readonly inner: ExchangeProvider) {
    this.kind = inner.kind;
  }

  fetchInstruments(): Promise<Instrument[]> {
    return this.inner.fetchInstruments();
  }

  async fetchCandles(
    symbol: WatchlistSymbol,
    timeframe: Timeframe,
    startTimeSeconds: number,
    endTimeSeconds: number,
  ): Promise<Candle[]> {
    const candles = await this.inner.fetchCandles(symbol, timeframe, startTimeSeconds, endTimeSeconds);
    const step = TIMEFRAME_SECONDS[timeframe];
    return candles.filter((c) => c.startTime + step <= endTimeSeconds);
  }

  createOrder(req: OrderRequest): Promise<OrderResult> {
    return this.inner.createOrder(req);
  }

  cancelOrder(orderId: string): Promise<OrderResult> {
    return this.inner.cancelOrder(orderId);
  }

  setLeverage(symbol: WatchlistSymbol, leverage: number): Promise<void> {
    return this.inner.setLeverage(symbol, leverage);
  }
}
