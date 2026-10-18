/**
 * Trending fixture provider — CLEARLY SYNTHETIC, for plumbing validation only.
 *
 * Why this exists: the deterministic random-walk provider is edgeless noise, so
 * the (correctly conservative) consensus engine never opens a trade on it — that
 * is the RIGHT behavior, but it means a backtest over random-walk data cannot
 * exercise the entry -> SL/TP/max-hold -> PnL -> metrics lifecycle. This fixture
 * generates a coherent DRIFTED series (a real trend plus bounded noise) so the
 * frozen analysts can legitimately reach consensus, letting us prove the whole
 * pipeline works end to end.
 *
 * It says NOTHING about real strategy edge. It is never used for live trading and
 * writes always throw SafetyError.
 *
 * Construction: a single 1m base series (seeded drift + noise) is generated once
 * and AGGREGATED into 5m/15m/1h, so every timeframe is mutually consistent —
 * exactly like a real market — rather than each timeframe being an independent
 * random walk.
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
import { TIMEFRAME_SECONDS } from "./deterministic";

const ANCHOR_EPOCH = 1_704_067_200; // 2024-01-01T00:00:00Z

const BASE_PRICES: Record<string, number> = {
  "BTC/USDT": 60_000,
  "ETH/USDT": 3_000,
  "SOL/USDT": 140,
  "XRP/USDT": 0.6,
  "BNB/USDT": 550,
  "HYPE/USDT": 20,
  "XAU/USDT": 2_300,
};

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

export interface TrendingFixtureOptions {
  seed?: number;
  symbols?: readonly string[];
  /** Per-1m-bar fractional drift. Sign sets the trend direction. Default +0.00004. */
  driftPerMinute?: number;
  /** Per-1m-bar fractional noise (std of the random component). Default 0.0012. */
  noisePerMinute?: number;
  /** Series start (epoch seconds, aligned to 1h). Defaults to 2024-01-01. */
  anchorEpoch?: number;
  /**
  * Direction multiplier per symbol. Symbols not listed use the sign of
  * driftPerMinute. Use -1 to make a symbol trend the other way (SHORT setups).
  */
  directionOverrides?: Partial<Record<string, 1 | -1>>;
}

/** A single generated 1m close, plus its OHLC, cached and aggregated upward. */
interface MinuteBar {
  startTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class TrendingFixtureProvider implements ExchangeProvider {
  readonly kind = "deterministic" as const;
  private readonly seed: number;
  private readonly symbols: readonly string[];
  private readonly drift: number;
  private readonly noise: number;
  private readonly dirs: Partial<Record<string, 1 | -1>>;
  private readonly anchorEpoch: number;
  /** symbol -> generated 1m bars (dense from the anchor). */
  private readonly minuteCache = new Map<string, MinuteBar[]>();
  /** symbol|timeframe -> aggregated candles. */
  private readonly tfCache = new Map<string, Candle[]>();

  constructor(opts: TrendingFixtureOptions = {}) {
    this.seed = opts.seed ?? 2024;
    this.symbols = opts.symbols ?? WATCHLIST;
    this.drift = opts.driftPerMinute ?? 0.00004;
    this.noise = opts.noisePerMinute ?? 0.0012;
    this.dirs = opts.directionOverrides ?? {};
    const anchor = opts.anchorEpoch ?? ANCHOR_EPOCH;
    if (!Number.isInteger(anchor) || anchor < 0 || anchor % 3600 !== 0) {
      throw new Error("TrendingFixtureProvider anchorEpoch must be epoch seconds aligned to 1h.");
    }
    this.anchorEpoch = anchor;
  }

  async fetchInstruments(): Promise<Instrument[]> {
    return this.symbols.map((symbol) => {
      const [base, quote] = symbol.split("/");
      return {
        exchangeSymbol: `${base}${quote}`,
        canonicalSymbol: symbol,
        id: `trend-${symbol.toLowerCase()}`,
        name: `${base} (trending synthetic fixture)`,
        minContract: 0.001,
        maxContract: 1_000_000,
        quantityStep: 0.001,
        minNotionalValue: 5,
        minLeverage: 1,
        maxLeverage: 3,
        price: BASE_PRICES[symbol] ?? 100,
        raw: { synthetic: true, seed: this.seed, fixture: "trending" },
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

  /** Direction multiplier for a symbol (defaults to the sign of drift). */
  private dirFor(symbol: string): number {
    const override = this.dirs[symbol];
    if (override !== undefined) return override;
    return this.drift >= 0 ? 1 : -1;
  }

  /** Generate (and cache) the dense 1m base series through minute index `endMin`. */
  private minutesUpTo(symbol: string, endMin: number): MinuteBar[] {
    let bars = this.minuteCache.get(symbol);
    if (!bars) {
      bars = [];
      this.minuteCache.set(symbol, bars);
    }
    if (bars.length > endMin) return bars;

    const dir = this.dirFor(symbol);
    const drift = Math.abs(this.drift) * dir;
    let price = bars.length > 0 ? bars[bars.length - 1].close : (BASE_PRICES[symbol] ?? 100);

    for (let i = bars.length; i <= endMin; i++) {
      const rng = mulberry32(hashString(`${this.seed}:${symbol}:1m:${i}`));
      // Symmetric noise in [-1,1] scaled by noisePerMinute, plus a steady drift.
      const shock = (rng() - 0.5) * 2 * this.noise;
      const open = price;
      const close = Math.max(1e-9, open * (1 + drift + shock));
      const hi = Math.max(open, close) * (1 + rng() * this.noise * 0.5);
      const lo = Math.min(open, close) * (1 - rng() * this.noise * 0.5);
      const volume = 12 * (0.6 + rng());
      bars.push({ startTime: this.anchorEpoch + i * 60, open, high: hi, low: lo, close, volume });
      price = close;
    }
    return bars;
  }

  /** Aggregate the 1m base into `timeframe` candles, cached, through `endIndex`. */
  private seriesUpTo(symbol: string, timeframe: Timeframe, endIndex: number): Candle[] {
    const key = `${symbol}|${timeframe}`;
    let series = this.tfCache.get(key);
    if (!series) {
      series = [];
      this.tfCache.set(key, series);
    }
    if (series.length > endIndex) return series;

    const step = TIMEFRAME_SECONDS[timeframe];
    const minutesPerBar = step / 60;
    // Ensure the 1m base covers through the last needed minute.
    const neededMin = (endIndex + 1) * minutesPerBar - 1;
    const minutes = this.minutesUpTo(symbol, neededMin);

    for (let i = series.length; i <= endIndex; i++) {
      const from = i * minutesPerBar;
      const to = from + minutesPerBar; // exclusive
      const slice = minutes.slice(from, to);
      if (slice.length === 0) break;
      const open = slice[0].open;
      const close = slice[slice.length - 1].close;
      let high = -Infinity;
      let low = Infinity;
      let volume = 0;
      for (const m of slice) {
        if (m.high > high) high = m.high;
        if (m.low < low) low = m.low;
        volume += m.volume;
      }
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
    }
    return series;
  }

  async createOrder(_req: OrderRequest): Promise<OrderResult> {
    throw new SafetyError(
      "TRENDING_FIXTURE_WRITE_REFUSED",
      "TrendingFixtureProvider refuses all write operations.",
    );
  }

  async cancelOrder(_orderId: string): Promise<OrderResult> {
    throw new SafetyError(
      "TRENDING_FIXTURE_WRITE_REFUSED",
      "TrendingFixtureProvider refuses all write operations.",
    );
  }

  async setLeverage(_symbol: WatchlistSymbol, _leverage: number): Promise<void> {
    throw new SafetyError(
      "TRENDING_FIXTURE_WRITE_REFUSED",
      "TrendingFixtureProvider refuses all write operations.",
    );
  }
}
