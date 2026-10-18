/**
 * Deterministic provider: seeded synthetic random-walk candles.
 * Same seed + same request => byte-identical data, which makes tests and
 * backtests reproducible. Clearly synthetic: never presented as real market data.
 * Writes always throw SafetyError.
 */
import { WATCHLIST, type WatchlistSymbol } from "@/lib/config/watchlist";
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

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
};

/** Default series anchor: 2024-01-01T00:00:00Z, aligned to every timeframe. */
const ANCHOR_EPOCH = 1_704_067_200;

const BASE_PRICES: Record<string, number> = {
  "BTC/USDT": 60_000,
  "ETH/USDT": 3_000,
  "SOL/USDT": 140,
  "XRP/USDT": 0.6,
  "BNB/USDT": 550,
  "HYPE/USDT": 20,
  "XAU/USDT": 2_300,
};

/** mulberry32 PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface DeterministicProviderOptions {
  seed?: number;
  /** Subset of the watchlist to list as available (default: all). */
  symbols?: readonly string[];
  /** Per-bar volatility (fraction). */
  volatility?: number;
  /**
   * Series start (epoch seconds, aligned to 1h). Defaults to 2024-01-01.
   * Paper mode anchors near "now" so generating an unbounded history from
   * 2024 does not allocate millions of candles. Backtests keep the default.
   */
  anchorEpoch?: number;
}

export class DeterministicProvider implements ExchangeProvider {
  readonly kind = "deterministic" as const;
  private readonly seed: number;
  private readonly symbols: readonly string[];
  private readonly volatility: number;
  private readonly anchorEpoch: number;
  private readonly cache = new Map<string, Candle[]>();

  constructor(opts: DeterministicProviderOptions = {}) {
    this.seed = opts.seed ?? 42;
    this.symbols = opts.symbols ?? WATCHLIST;
    this.volatility = opts.volatility ?? 0.004;
    const anchor = opts.anchorEpoch ?? ANCHOR_EPOCH;
    if (!Number.isInteger(anchor) || anchor < 0 || anchor % 3600 !== 0) {
      throw new Error("DeterministicProvider anchorEpoch must be epoch seconds aligned to 1h.");
    }
    this.anchorEpoch = anchor;
  }

  async fetchInstruments(): Promise<Instrument[]> {
    return this.symbols.map((symbol) => {
      const [base, quote] = symbol.split("/");
      return {
        exchangeSymbol: `${base}${quote}`,
        canonicalSymbol: symbol,
        id: `det-${symbol.toLowerCase()}`,
        name: `${base} (deterministic synthetic)`,
        minContract: 0.001,
        maxContract: 1_000_000,
        quantityStep: 0.001,
        minNotionalValue: 5,
        minLeverage: 1,
        maxLeverage: 3,
        price: BASE_PRICES[symbol] ?? 100,
        raw: { synthetic: true, seed: this.seed },
      };
    });
  }

  async fetchCandles(
    symbol: WatchlistSymbol,
    timeframe: Timeframe,
    startTimeSeconds: number,
    endTimeSeconds: number,
  ): Promise<Candle[]> {
    assertWatchlistSymbol(symbol);
    if (!this.symbols.includes(symbol)) return [];
    const step = TIMEFRAME_SECONDS[timeframe];
    const firstIndex = Math.max(0, Math.ceil((startTimeSeconds - this.anchorEpoch) / step));
    const lastIndex = Math.floor((endTimeSeconds - this.anchorEpoch) / step);
    if (lastIndex < firstIndex) return [];

    const series = this.seriesUpTo(symbol, timeframe, lastIndex);
    return series.slice(firstIndex, lastIndex + 1);
  }

  /** Generates (and caches) the walk from the anchor through `endIndex`. */
  private seriesUpTo(symbol: string, timeframe: Timeframe, endIndex: number): Candle[] {
    const key = `${symbol}|${timeframe}`;
    let series = this.cache.get(key);
    if (!series) {
      series = [];
      this.cache.set(key, series);
    }
    if (series.length > endIndex) return series;

    const step = TIMEFRAME_SECONDS[timeframe];
    let price = series.length > 0 ? series[series.length - 1].close : (BASE_PRICES[symbol] ?? 100);
    for (let i = series.length; i <= endIndex; i++) {
      // Per-index seeding: bar i is always identical for a given seed/key,
      // independent of how the request windows are sliced.
      const rng = mulberry32(hashString(`${this.seed}:${key}:${i}`));
      const drift = (rng() - 0.5) * 2 * this.volatility;
      const open = price;
      const close = open * (1 + drift);
      const high = Math.max(open, close) * (1 + rng() * this.volatility * 0.5);
      const low = Math.min(open, close) * (1 - rng() * this.volatility * 0.5);
      const volume = 10 * (0.5 + rng());
      series.push({
        symbol,
        timeframe,
        startTime: this.anchorEpoch + i * step,
        open,
        high,
        low,
        close,
        volume,
      });
      price = close;
    }
    return series;
  }

  async createOrder(_req: OrderRequest): Promise<OrderResult> {
    throw new SafetyError(
      "DETERMINISTIC_WRITE_REFUSED",
      "DeterministicProvider refuses all write operations.",
    );
  }

  async cancelOrder(_orderId: string): Promise<OrderResult> {
    throw new SafetyError(
      "DETERMINISTIC_WRITE_REFUSED",
      "DeterministicProvider refuses all write operations.",
    );
  }

  async setLeverage(_symbol: WatchlistSymbol, _leverage: number): Promise<void> {
    throw new SafetyError(
      "DETERMINISTIC_WRITE_REFUSED",
      "DeterministicProvider refuses all write operations.",
    );
  }
}
