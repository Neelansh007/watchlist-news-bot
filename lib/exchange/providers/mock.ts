/**
 * Mock provider: serves injected fixtures. Used in tests to exercise the full
 * pipeline without any network access. Writes always throw SafetyError.
 */
import { SafetyError } from "@/lib/safety/errors";
import { assertWatchlistSymbol } from "../watchlist-guard";
import type {
  Candle,
  ExchangeProvider,
  Instrument,
  OrderRequest,
  OrderResult,
  Timeframe,
} from "../types";
import type { WatchlistSymbol } from "@/lib/config/watchlist";

export interface MockProviderOptions {
  instruments?: Instrument[];
  /** Candles keyed by `${symbol}|${timeframe}`. */
  candles?: Record<string, Candle[]>;
}

export function candleKey(symbol: string, timeframe: Timeframe): string {
  return `${symbol}|${timeframe}`;
}

export class MockProvider implements ExchangeProvider {
  readonly kind = "mock" as const;

  constructor(private readonly opts: MockProviderOptions = {}) {}

  async fetchInstruments(): Promise<Instrument[]> {
    return this.opts.instruments ?? [];
  }

  async fetchCandles(
    symbol: WatchlistSymbol,
    timeframe: Timeframe,
    startTimeSeconds: number,
    endTimeSeconds: number,
  ): Promise<Candle[]> {
    assertWatchlistSymbol(symbol);
    const all = this.opts.candles?.[candleKey(symbol, timeframe)] ?? [];
    return all.filter(
      (c) => c.startTime >= startTimeSeconds && c.startTime <= endTimeSeconds,
    );
  }

  async createOrder(_req: OrderRequest): Promise<OrderResult> {
    throw new SafetyError("MOCK_WRITE_REFUSED", "MockProvider refuses all write operations.");
  }

  async cancelOrder(_orderId: string): Promise<OrderResult> {
    throw new SafetyError("MOCK_WRITE_REFUSED", "MockProvider refuses all write operations.");
  }

  async setLeverage(_symbol: WatchlistSymbol, _leverage: number): Promise<void> {
    throw new SafetyError("MOCK_WRITE_REFUSED", "MockProvider refuses all write operations.");
  }
}
