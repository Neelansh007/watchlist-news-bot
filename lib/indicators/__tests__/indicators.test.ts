import { describe, expect, it } from "vitest";
import { sma, ema, rsi, atr, macd, bollinger, latest, closes, trueRange } from "../index";
import type { Candle } from "@/lib/exchange/types";

function candle(i: number, o: number, h: number, l: number, c: number): Candle {
  return {
    symbol: "BTC/USDT",
    timeframe: "5m",
    startTime: 1_704_067_200 + i * 300,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 1,
  };
}

describe("sma", () => {
  it("computes a rolling mean with null warmup", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it("returns all nulls when data is insufficient (fail closed)", () => {
    expect(sma([1, 2], 5)).toEqual([null, null]);
  });
});

describe("ema", () => {
  it("equals the constant for a constant series", () => {
    const out = ema([5, 5, 5, 5, 5], 3);
    expect(out.slice(2)).toEqual([5, 5, 5]);
  });
  it("seeds with SMA and weights recent values more", () => {
    const out = ema([1, 2, 3, 4], 3);
    expect(out[2]).toBeCloseTo(2); // SMA(1,2,3)
    // EMA next = 4*(2/4) + 2*(2/4) = 3
    expect(out[3]!).toBeCloseTo(3);
  });
  it("all null when insufficient", () => {
    expect(ema([1, 2], 10)).toEqual([null, null]);
  });
});

describe("rsi (Wilder)", () => {
  it("is 100 for a strictly rising series", () => {
    const values = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(latest(rsi(values, 14))).toBe(100);
  });
  it("is 0 for a strictly falling series", () => {
    const values = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(latest(rsi(values, 14))).toBe(0);
  });
  it("is 50 for a symmetric alternating series", () => {
    const values: number[] = [100];
    for (let i = 0; i < 30; i++) values.push(i % 2 === 0 ? 101 : 100);
    // +1/-1 alternating equally => RSI near 50 (Wilder smoothing oscillates
    // slightly around 50 depending on where the series ends)
    const v = latest(rsi(values, 14))!;
    expect(v).toBeGreaterThan(45);
    expect(v).toBeLessThan(55);
  });
  it("stays within [0,100] and nulls warmup", () => {
    const values = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 5);
    const out = rsi(values, 14);
    expect(out.slice(0, 14)).toEqual(new Array(14).fill(null));
    for (const v of out.slice(14)) {
      expect(v!).toBeGreaterThanOrEqual(0);
      expect(v!).toBeLessThanOrEqual(100);
    }
  });
  it("null when insufficient data", () => {
    expect(rsi([1, 2, 3], 14)).toEqual([null, null, null]);
  });
});

describe("trueRange / atr", () => {
  it("handles gaps via previous close", () => {
    const candles = [candle(0, 100, 102, 99, 101), candle(1, 105, 110, 104, 109)];
    const tr = trueRange(candles);
    expect(tr[0]).toBeCloseTo(3); // 102-99
    // gap up: max(110-104, |110-101|, |104-101|) = 9
    expect(tr[1]).toBeCloseTo(9);
  });
  it("atr equals the constant TR for a uniform series", () => {
    const candles = Array.from({ length: 20 }, (_, i) => candle(i, 100, 101, 99, 100));
    const out = atr(candles, 5);
    expect(out.slice(5)).toEqual(new Array(15).fill(2));
    expect(out.slice(0, 5)).toEqual(new Array(5).fill(null));
  });
  it("null when insufficient", () => {
    expect(atr([candle(0, 1, 2, 0.5, 1.5)], 14)).toEqual([null]);
  });
});

describe("macd", () => {
  it("histogram = macd - signal wherever both exist", () => {
    const values = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.1);
    const { macd: m, signal: s, histogram: h } = macd(values);
    for (let i = 0; i < values.length; i++) {
      if (m[i] !== null && s[i] !== null) {
        expect(h[i]!).toBeCloseTo(m[i]! - s[i]!, 10);
      }
    }
    expect(latest(m)).not.toBeNull();
    expect(latest(s)).not.toBeNull();
  });
  it("returns nulls when data is insufficient", () => {
    const { macd: m, signal: s, histogram: h } = macd([1, 2, 3]);
    expect(m.every((v) => v === null)).toBe(true);
    expect(s.every((v) => v === null)).toBe(true);
    expect(h.every((v) => v === null)).toBe(true);
  });
});

describe("bollinger", () => {
  it("collapses to zero width on a constant series", () => {
    const { upper, middle, lower, width } = bollinger(new Array(25).fill(50), 20, 2);
    expect(middle[24]).toBe(50);
    expect(upper[24]).toBe(50);
    expect(lower[24]).toBe(50);
    expect(width[24]).toBe(0);
  });
  it("brackets the price", () => {
    const values = Array.from({ length: 30 }, (_, i) => 100 + i);
    const { upper, lower, middle } = bollinger(values, 20, 2);
    const i = 29;
    expect(upper[i]!).toBeGreaterThan(middle[i]!);
    expect(lower[i]!).toBeLessThan(middle[i]!);
  });
});

describe("helpers", () => {
  it("latest returns the last non-null and closes maps candles", () => {
    expect(latest([null, 1, 2, null])).toBe(2);
    expect(latest([null, null])).toBeNull();
    expect(closes([candle(0, 1, 2, 0.5, 1.5)])).toEqual([1.5]);
  });
  it("rejects invalid periods", () => {
    expect(() => sma([1, 2, 3], 0)).toThrow();
    expect(() => ema([1, 2, 3], 1.5)).toThrow();
  });
});
