/**
 * Market snapshot builder.
 *
 * Fetches 5m/15m/1h candles + the synthetic last price for ONE watchlist
 * symbol, validates everything strictly, computes indicators, and attaches
 * news context. ANY problem (missing data, stale data, invalid OHLC, null
 * indicators) returns {ok:false, reason} — callers must treat that as
 * NO_TRADE. Never guesses, never fills gaps.
 */
import type { WatchlistSymbol } from "@/lib/config/watchlist";
import type { ExchangeProvider, Candle } from "@/lib/exchange/types";
import type { TickerSource } from "@/lib/market-data/ticker";
import { validateCandleSeries } from "@/lib/market-data/candle-validation";
import type { NewsBundle, NewsItem } from "@/lib/news/types";
import { atr, bollinger, closes, ema, latest, macd, rsi } from "@/lib/indicators";
import type { MarketSnapshot, SnapshotOutcome } from "./types";

/** Bars requested per timeframe (enough for indicator warmup). */
export const LOOKBACK_BARS = { "5m": 96, "15m": 96, "1h": 130 } as const;
const LOOKBACK_SECONDS = { "5m": 96 * 300, "15m": 96 * 900, "1h": 130 * 3600 } as const;
/** Minimum bars required after validation. */
export const MIN_BARS = { "5m": 48, "15m": 40, "1h": 60 } as const;

export interface BuildSnapshotDeps {
  provider: ExchangeProvider;
  ticker: TickerSource;
  news: NewsBundle;
  /** Injectable clock (epoch seconds). */
  nowSeconds?: () => number;
}

export async function buildMarketSnapshot(
  symbol: WatchlistSymbol,
  deps: BuildSnapshotDeps,
): Promise<SnapshotOutcome> {
  const now = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1000);

  let series: Record<"5m" | "15m" | "1h", Candle[]>;
  try {
    const fetched = await Promise.all(
      (["5m", "15m", "1h"] as const).map((tf) =>
        deps.provider.fetchCandles(symbol, tf, now - LOOKBACK_SECONDS[tf], now),
      ),
    );
    series = { "5m": fetched[0], "15m": fetched[1], "1h": fetched[2] };
  } catch (err) {
    return { ok: false, reason: `candle fetch failed for ${symbol}: ${errMessage(err)}` };
  }

  for (const tf of ["5m", "15m", "1h"] as const) {
    const report = validateCandleSeries(symbol, tf, series[tf], { nowSeconds: now });
    if (!report.ok) {
      return {
        ok: false,
        reason: `candle validation failed for ${symbol} ${tf}: ${report.issues
          .map((i) => `${i.code}: ${i.message}`)
          .join("; ")}`,
      };
    }
    if (series[tf].length < MIN_BARS[tf]) {
      return {
        ok: false,
        reason: `insufficient candles for ${symbol} ${tf}: ${series[tf].length} < ${MIN_BARS[tf]}`,
      };
    }
  }

  let tickerPrice: { price: number; synthetic: boolean };
  try {
    const t = await deps.ticker.getLastPrice(symbol);
    tickerPrice = { price: t.price, synthetic: t.synthetic };
  } catch (err) {
    return { ok: false, reason: `synthetic ticker unavailable for ${symbol}: ${errMessage(err)}` };
  }

  const c15 = closes(series["15m"]);
  const c1h = closes(series["1h"]);
  const c5 = closes(series["5m"]);

  const ema20_1h = latest(ema(c1h, 20));
  const ema50_1h = latest(ema(c1h, 50));
  const rsi14_15m = latest(rsi(c15, 14));
  const macdRes = macd(c15, 12, 26, 9);
  const macdHist15m = latest(macdRes.histogram);
  const atr14_15m = latest(atr(series["15m"], 14));
  const bb = bollinger(c15, 20, 2);
  const bbUpper = latest(bb.upper);
  const bbLower = latest(bb.lower);
  const bbWidth = latest(bb.width);

  const required: Record<string, number | null> = {
    ema20_1h,
    ema50_1h,
    rsi14_15m,
    macdHist15m,
    atr14_15m,
    bbUpper,
    bbLower,
    bbWidth,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => v === null || !Number.isFinite(v as number))
    .map(([k]) => k);
  if (missing.length > 0) {
    // Fail closed: indicators need warmup; without them any vote would be a guess.
    return {
      ok: false,
      reason: `indicators unavailable for ${symbol} (insufficient data): ${missing.join(", ")}`,
    };
  }

  const close15m = c15[c15.length - 1];
  const volumes = series["15m"].slice(-20).map((c) => c.volume);
  const avgVolume15m = volumes.reduce((a, b) => a + b, 0) / volumes.length;

  const newsItems: NewsItem[] = deps.news.bySymbol[symbol] ?? [];
  const snapshot: MarketSnapshot = {
    symbol,
    builtAt: now,
    indicators: {
      close1h: c1h[c1h.length - 1],
      ema20_1h: ema20_1h!,
      ema50_1h: ema50_1h!,
      close15m,
      rsi14_15m: rsi14_15m!,
      macdHist15m: macdHist15m!,
      atr14_15m: atr14_15m!,
      atrPct15m: atr14_15m! / close15m,
      bbUpper15m: bbUpper!,
      bbLower15m: bbLower!,
      bbWidth15m: bbWidth!,
      avgVolume15m,
      close5m: c5[c5.length - 1],
      lastPrice: tickerPrice.price,
      priceSynthetic: tickerPrice.synthetic,
    },
    news: {
      available: deps.news.available,
      degraded: deps.news.degraded,
      items: newsItems,
      marketWide: deps.news.marketWide,
    },
  };
  return { ok: true, snapshot };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
