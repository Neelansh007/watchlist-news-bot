import { describe, expect, it } from "vitest";
import { DeterministicProvider, TIMEFRAME_SECONDS } from "../providers/deterministic";
import { MockProvider, candleKey } from "../providers/mock";
import { validateCandleOHLC } from "@/lib/market-data/candle-validation";
import { SafetyError } from "@/lib/safety/errors";
import type { Candle } from "../types";

const A = 1_704_067_200; // provider anchor (2024-01-01 UTC)

describe("DeterministicProvider", () => {
  it("produces identical data for the same seed", async () => {
    const p1 = new DeterministicProvider({ seed: 7 });
    const p2 = new DeterministicProvider({ seed: 7 });
    const c1 = await p1.fetchCandles("BTC/USDT", "5m", A, A + 3600);
    const c2 = await p2.fetchCandles("BTC/USDT", "5m", A, A + 3600);
    expect(c1).toEqual(c2);
    expect(c1.length).toBe(13); // inclusive window: 12 slots + 1
  });

  it("produces different data for different seeds", async () => {
    const p1 = new DeterministicProvider({ seed: 7 });
    const p2 = new DeterministicProvider({ seed: 8 });
    const c1 = await p1.fetchCandles("BTC/USDT", "5m", A, A + 3600);
    const c2 = await p2.fetchCandles("BTC/USDT", "5m", A, A + 3600);
    expect(c1).not.toEqual(c2);
  });

  it("overlapping windows return the same bars (per-index determinism)", async () => {
    const p = new DeterministicProvider({ seed: 7 });
    const wide = await p.fetchCandles("ETH/USDT", "15m", A, A + 7200);
    const p2 = new DeterministicProvider({ seed: 7 });
    // fetch a later window first, then the earlier one — caches must agree
    const late = await p2.fetchCandles("ETH/USDT", "15m", A + 3600, A + 7200);
    const early = await p2.fetchCandles("ETH/USDT", "15m", A, A + 3600);
    const merged = [...early.filter((c) => c.startTime < A + 3600), ...late];
    expect(merged).toEqual(wide);
  });

  it("generates structurally valid OHLC candles", async () => {
    const p = new DeterministicProvider({ seed: 1 });
    const candles = await p.fetchCandles("SOL/USDT", "1h", A, A + 86_400);
    for (const c of candles) {
      expect(validateCandleOHLC(c)).toEqual([]);
      expect(c.startTime % TIMEFRAME_SECONDS["1h"]).toBe(0);
    }
  });

  it("lists only configured symbols and refuses non-watchlist symbols", async () => {
    const p = new DeterministicProvider({ seed: 1, symbols: ["BTC/USDT"] });
    const instruments = await p.fetchInstruments();
    expect(instruments.map((i) => i.canonicalSymbol)).toEqual(["BTC/USDT"]);
    await expect(p.fetchCandles("DOGE/USDT" as never, "5m", A, A + 300)).rejects.toThrow(
      SafetyError,
    );
    // watchlist symbol not configured as available: empty, not fabricated
    expect(await p.fetchCandles("ETH/USDT", "5m", A, A + 300)).toEqual([]);
  });

  it("refuses writes", async () => {
    const p = new DeterministicProvider({ seed: 1 });
    await expect(
      p.createOrder({ symbol: "BTC/USDT", side: "BUY", type: "MARKET", qty: 1 }),
    ).rejects.toThrow(SafetyError);
  });
});

describe("MockProvider", () => {
  const candles: Candle[] = [0, 1, 2, 3].map((i) => ({
    symbol: "BTC/USDT",
    timeframe: "5m",
    startTime: A + i * 300,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 1,
  }));

  it("filters by time window inclusively", async () => {
    const p = new MockProvider({ candles: { [candleKey("BTC/USDT", "5m")]: candles } });
    const got = await p.fetchCandles("BTC/USDT", "5m", A + 300, A + 900);
    expect(got.map((c) => c.startTime)).toEqual([A + 300, A + 600, A + 900]);
  });

  it("returns empty for unknown keys and refuses writes", async () => {
    const p = new MockProvider({ candles: {} });
    expect(await p.fetchCandles("BTC/USDT", "5m", A, A + 300)).toEqual([]);
    await expect(p.cancelOrder("x")).rejects.toThrow(SafetyError);
  });
});
