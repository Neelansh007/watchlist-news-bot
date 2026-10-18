/**
 * Paper provider: real (or deterministic-fallback) market data, but ALL fills
 * are simulated locally by the paper OMS (Stage 6). This provider never sends
 * write operations to the exchange; if one is attempted before the OMS is
 * wired, it fails closed with a SafetyError.
 */
import type { Env } from "@/lib/config/env";
import { SafetyError } from "@/lib/safety/errors";
import { MudrexProvider } from "../mudrex-client";
import { DeterministicProvider } from "./deterministic";
import type {
  Candle,
  ExchangeProvider,
  Instrument,
  OrderRequest,
  OrderResult,
  Timeframe,
} from "../types";
import type { WatchlistSymbol } from "@/lib/config/watchlist";

export class PaperProvider implements ExchangeProvider {
  readonly kind = "paper" as const;

  /**
   * Market-data source: Mudrex when an API secret is configured,
   * otherwise the deterministic synthetic provider (clearly labeled).
   */
  readonly marketData: ExchangeProvider;

  constructor(env: Env, marketData?: ExchangeProvider) {
    this.marketData =
      marketData ??
      (env.MUDREX_API_SECRET ? new MudrexProvider(env) : new DeterministicProvider({ seed: 42 }));
  }

  async fetchInstruments(): Promise<Instrument[]> {
    return this.marketData.fetchInstruments();
  }

  async fetchCandles(
    symbol: WatchlistSymbol,
    timeframe: Timeframe,
    startTimeSeconds: number,
    endTimeSeconds: number,
  ): Promise<Candle[]> {
    return this.marketData.fetchCandles(symbol, timeframe, startTimeSeconds, endTimeSeconds);
  }

  async createOrder(_req: OrderRequest): Promise<OrderResult> {
    throw new SafetyError(
      "PAPER_FILLS_ARE_LOCAL",
      "Paper mode never routes orders to the exchange; fills are simulated by the local paper OMS.",
    );
  }

  async cancelOrder(_orderId: string): Promise<OrderResult> {
    throw new SafetyError(
      "PAPER_FILLS_ARE_LOCAL",
      "Paper mode never routes orders to the exchange; fills are simulated by the local paper OMS.",
    );
  }

  async setLeverage(_symbol: WatchlistSymbol, _leverage: number): Promise<void> {
    throw new SafetyError(
      "PAPER_FILLS_ARE_LOCAL",
      "Paper mode never routes orders to the exchange; fills are simulated by the local paper OMS.",
    );
  }
}
