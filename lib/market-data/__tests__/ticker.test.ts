import { describe, expect, it } from "vitest";
import { SyntheticCandleTicker } from "../ticker";
import { MockProvider, candleKey } from "@/lib/exchange/providers/mock";
import { DataError, SafetyError } from "@/lib/safety/errors";
import type { Candle } from "@/lib/exchange/types";

const NOW = 1_700_000_100; // divisible by 60

function minuteCandles(count: number, endStart: number): Candle[] {
  return Array.from({ length: count }, (_, k) => {
    const i = count - 1 - k;
    const startTime = endStart - i * 60;
    return {
      symbol: "BTC/USDT",
      timeframe: "1m" as const,
      startTime,
      open: 100 + i * 0.1,
      high: 101 + i * 0.1,
      low: 99 + i * 0.1,
      close: 100.5 + i * 0.1,
      volume: 3,
    };
  });
}

function tickerWith(candles: Candle[], extraOpts: { lookbackSeconds?: number } = {}) {
  const provider = new MockProvider({
    candles: { [candleKey("BTC/USDT", "1m")]: candles },
  });
  return new SyntheticCandleTicker(provider, { nowSeconds: () => NOW, ...extraOpts });
}

describe("SyntheticCandleTicker", () => {
  it("derives the last price from the newest closed 1m candle and labels it synthetic", async () => {
    const candles = minuteCandles(5, NOW - 60); // newest candle covers [NOW-60, NOW)
    const t = await tickerWith(candles).getLastPrice("BTC/USDT");
    expect(t.price).toBeCloseTo(100.5); // newest candle is the last element
    expect(t.synthetic).toBe(true);
    expect(t.source).toBe("1m-candle-close");
    expect(t.tsSeconds).toBe(NOW - 60);
  });

  it("fails closed with DataError when no candles are available", async () => {
    await expect(tickerWith([]).getLastPrice("BTC/USDT")).rejects.toThrow(DataError);
  });

  it("fails closed with DataError when the newest candle is stale", async () => {
    const candles = minuteCandles(3, NOW - 3600); // an hour old
    await expect(
      tickerWith(candles, { lookbackSeconds: 7200 }).getLastPrice("BTC/USDT"),
    ).rejects.toThrow(/stale|STALE/i);
  });

  it("fails closed when the series has invalid OHLC data", async () => {
    const candles = minuteCandles(3, NOW - 60);
    candles[2].high = 1; // violates OHLC invariant
    await expect(tickerWith(candles).getLastPrice("BTC/USDT")).rejects.toThrow(DataError);
  });

  it("refuses non-watchlist symbols", async () => {
    await expect(tickerWith([]).getLastPrice("DOGE/USDT" as never)).rejects.toThrow(SafetyError);
  });
});
