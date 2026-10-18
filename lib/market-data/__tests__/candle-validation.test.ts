import { describe, expect, it } from "vitest";
import {
  validateCandleOHLC,
  validateCandleSeries,
  TIMEFRAME_SECONDS,
} from "../candle-validation";
import type { Candle } from "@/lib/exchange/types";

const A = 1_704_067_200; // aligned to all timeframes

function c(i: number, over: Partial<Candle> = {}): Candle {
  return {
    symbol: "BTC/USDT",
    timeframe: "5m",
    startTime: A + i * 300,
    open: 100,
    high: 102,
    low: 98,
    close: 101,
    volume: 5,
    ...over,
  };
}

const NOW = A + 5 * 300 + 60; // shortly after candle 4 closes... candle 4 ends A+5*300
const series = [c(0), c(1), c(2), c(3), c(4)];

function codes(report: { issues: { code: string }[] }): string[] {
  return report.issues.map((i) => i.code);
}

describe("validateCandleOHLC", () => {
  it("accepts a well-formed candle", () => {
    expect(validateCandleOHLC(c(0))).toEqual([]);
  });

  it("flags high below the body", () => {
    expect(codes({ issues: validateCandleOHLC(c(0, { high: 99 })) })).toContain("OHLC_INVALID");
  });

  it("flags low above the body", () => {
    expect(codes({ issues: validateCandleOHLC(c(0, { low: 101.5 })) })).toContain("OHLC_INVALID");
  });

  it("flags non-positive prices and negative volume", () => {
    expect(codes({ issues: validateCandleOHLC(c(0, { close: 0 })) })).toContain(
      "NON_POSITIVE_PRICE",
    );
    expect(codes({ issues: validateCandleOHLC(c(0, { volume: -1 })) })).toContain(
      "NEGATIVE_VOLUME",
    );
  });

  it("flags non-finite numbers", () => {
    expect(codes({ issues: validateCandleOHLC(c(0, { high: Number.NaN })) })).toContain(
      "NON_FINITE",
    );
  });
});

describe("validateCandleSeries", () => {
  it("accepts a clean, aligned, fresh series", () => {
    const r = validateCandleSeries("BTC/USDT", "5m", series, { nowSeconds: NOW });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("flags EMPTY series", () => {
    const r = validateCandleSeries("BTC/USDT", "5m", [], { nowSeconds: NOW });
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(["EMPTY"]);
  });

  it("flags duplicates", () => {
    const r = validateCandleSeries("BTC/USDT", "5m", [...series, c(4)], { nowSeconds: NOW });
    expect(codes(r)).toContain("DUPLICATE");
  });

  it("flags unordered input", () => {
    const r = validateCandleSeries("BTC/USDT", "5m", [c(1), c(0), c(2)], { nowSeconds: NOW + 3000 });
    expect(codes(r)).toContain("UNORDERED");
  });

  it("flags gaps with zero tolerance by default", () => {
    const gapped = [c(0), c(1), c(3), c(4)];
    const r = validateCandleSeries("BTC/USDT", "5m", gapped, { nowSeconds: NOW });
    expect(codes(r)).toContain("GAP");
    expect(r.issues.find((i) => i.code === "GAP")!.message).toMatch(/1 missing/);
  });

  it("tolerates gaps up to maxGapSlots", () => {
    const gapped = [c(0), c(1), c(3), c(4)];
    const r = validateCandleSeries("BTC/USDT", "5m", gapped, {
      nowSeconds: NOW,
      maxGapSlots: 1,
    });
    expect(codes(r)).not.toContain("GAP");
    expect(r.ok).toBe(true);
  });

  it("flags stale data (fail closed)", () => {
    const farFuture = NOW + 10 * TIMEFRAME_SECONDS["5m"];
    const r = validateCandleSeries("BTC/USDT", "5m", series, { nowSeconds: farFuture });
    expect(codes(r)).toContain("STALE");
    expect(r.ok).toBe(false);
  });

  it("flags misaligned timestamps and wrong labels", () => {
    const r = validateCandleSeries("BTC/USDT", "5m", [c(0, { startTime: A + 7 })], {
      nowSeconds: A + 3000,
      maxStalenessSeconds: 10_000,
    });
    expect(r.ok).toBe(false);
    const r2 = validateCandleSeries("BTC/USDT", "5m", [c(0, { symbol: "ETH/USDT" })], {
      nowSeconds: NOW,
    });
    expect(r2.ok).toBe(false);
  });

  it("reports per-candle OHLC violations inside a series", () => {
    const bad = [c(0), c(1, { high: 90 }), c(2)];
    const r = validateCandleSeries("BTC/USDT", "5m", bad, { nowSeconds: A + 3 * 300 + 60 });
    expect(codes(r)).toContain("OHLC_INVALID");
    expect(r.issues.some((i) => i.index === 1)).toBe(true);
  });
});
