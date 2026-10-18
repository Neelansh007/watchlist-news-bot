import { describe, expect, it } from "vitest";
import { TrendingFixtureProvider } from "../trending-fixture";
import { TIMEFRAME_SECONDS } from "../deterministic";
import { SafetyError } from "@/lib/safety/errors";
import { validateCandleSeries } from "@/lib/market-data/candle-validation";
import type { Timeframe } from "@/lib/exchange/types";

const ANCHOR = 1_704_067_200;
const START = ANCHOR + 200 * 3600;

describe("TrendingFixtureProvider", () => {
  it("is deterministic: same seed => byte-identical candles", async () => {
    const a = new TrendingFixtureProvider({ seed: 99 });
    const b = new TrendingFixtureProvider({ seed: 99 });
    const ca = await a.fetchCandles("BTC/USDT", "15m", START, START + 50 * 900);
    const cb = await b.fetchCandles("BTC/USDT", "15m", START, START + 50 * 900);
    expect(ca).toEqual(cb);
  });

  it("different seeds produce different series", async () => {
    const a = new TrendingFixtureProvider({ seed: 1 });
    const b = new TrendingFixtureProvider({ seed: 2 });
    const ca = await a.fetchCandles("BTC/USDT", "15m", START, START + 50 * 900);
    const cb = await b.fetchCandles("BTC/USDT", "15m", START, START + 50 * 900);
    expect(ca).not.toEqual(cb);
  });

  it("produces a genuine trend: close rises over the window for an up-trending symbol", async () => {
    const p = new TrendingFixtureProvider({ seed: 5, driftPerMinute: 0.0002, noisePerMinute: 0.0002 });
    const c = await p.fetchCandles("BTC/USDT", "1h", START, START + 40 * 3600);
    expect(c.length).toBeGreaterThan(10);
    expect(c[c.length - 1].close).toBeGreaterThan(c[0].open);
  });

  it("trends DOWN for a symbol with a negative direction override", async () => {
    const p = new TrendingFixtureProvider({
      seed: 5,
      driftPerMinute: 0.0002,
      noisePerMinute: 0.0002,
      directionOverrides: { "ETH/USDT": -1 },
    });
    const c = await p.fetchCandles("ETH/USDT", "1h", START, START + 40 * 3600);
    expect(c[c.length - 1].close).toBeLessThan(c[0].open);
  });

  it.each(["5m", "15m", "1h"] as Timeframe[])(
    "aggregated %s candles pass strict series validation (OHLC, ordering, no gaps)",
    async (tf) => {
      const p = new TrendingFixtureProvider({ seed: 7 });
      const step = TIMEFRAME_SECONDS[tf];
      const end = START + 80 * step;
      const c = await p.fetchCandles("BTC/USDT", tf, START, end);
      expect(c.length).toBeGreaterThan(0);
      const report = validateCandleSeries("BTC/USDT", tf, c, { nowSeconds: end });
      expect(report.issues).toEqual([]);
      expect(report.ok).toBe(true);
    },
  );

  it("keeps every candle's OHLC invariant (high>=max(o,c), low<=min(o,c))", async () => {
    const p = new TrendingFixtureProvider({ seed: 11 });
    const c = await p.fetchCandles("SOL/USDT", "15m", START, START + 100 * 900);
    for (const bar of c) {
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      expect(bar.high).toBeGreaterThanOrEqual(bar.low);
      expect(bar.close).toBeGreaterThan(0);
    }
  });

  it("is consistent across timeframes: a 1h close equals the last 15m close in that hour", async () => {
    const p = new TrendingFixtureProvider({ seed: 13 });
    const hourly = await p.fetchCandles("BTC/USDT", "1h", START, START + 5 * 3600);
    const min15 = await p.fetchCandles("BTC/USDT", "15m", START, START + 5 * 3600);
    const h = hourly[2];
    const inHour = min15.filter((m) => m.startTime >= h.startTime && m.startTime < h.startTime + 3600);
    expect(inHour.length).toBe(4);
    expect(inHour[inHour.length - 1].close).toBeCloseTo(h.close, 9);
    expect(inHour[0].open).toBeCloseTo(h.open, 9);
  });

  it("lists instruments for the watchlist with sane contract constraints", async () => {
    const p = new TrendingFixtureProvider({ seed: 3, symbols: ["BTC/USDT", "ETH/USDT"] });
    const inst = await p.fetchInstruments();
    expect(inst).toHaveLength(2);
    for (const i of inst) {
      expect(i.minContract).toBeGreaterThan(0);
      expect(i.maxContract).toBeGreaterThan(i.minContract);
      expect(i.quantityStep).toBeGreaterThan(0);
      expect(i.minNotionalValue).toBeGreaterThan(0);
      expect(i.raw).toMatchObject({ synthetic: true, fixture: "trending" });
    }
  });

  it("returns [] for a symbol not in its configured subset", async () => {
    const p = new TrendingFixtureProvider({ seed: 3, symbols: ["BTC/USDT"] });
    expect(await p.fetchCandles("ETH/USDT", "15m", START, START + 10 * 900)).toEqual([]);
  });

  it("returns [] for an empty time window", async () => {
    const p = new TrendingFixtureProvider({ seed: 3 });
    expect(await p.fetchCandles("BTC/USDT", "15m", START, START - 900)).toEqual([]);
  });

  it("refuses ALL write operations with SafetyError", async () => {
    const p = new TrendingFixtureProvider({ seed: 3 });
    await expect(
      p.createOrder({ symbol: "BTC/USDT", side: "BUY", type: "MARKET", qty: 1 }),
    ).rejects.toBeInstanceOf(SafetyError);
    await expect(p.cancelOrder("any")).rejects.toBeInstanceOf(SafetyError);
    await expect(p.setLeverage("BTC/USDT", 2)).rejects.toBeInstanceOf(SafetyError);
  });
});
