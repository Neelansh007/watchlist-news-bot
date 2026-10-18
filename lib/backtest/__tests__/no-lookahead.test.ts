import { describe, expect, it } from "vitest";
import { NoLookaheadProvider } from "../no-lookahead-provider";
import { BacktestTicker } from "../backtest-ticker";
import { DeterministicProvider, TIMEFRAME_SECONDS } from "@/lib/exchange/providers/deterministic";
import { SafetyError } from "@/lib/safety/errors";
import type { Candle, ExchangeProvider, Timeframe } from "@/lib/exchange/types";

const ANCHOR = 1_704_067_200;

function makeCandle(startTime: number, tf: Timeframe = "15m"): Candle {
  return { symbol: "BTC/USDT", timeframe: tf, startTime, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 };
}

/** A stub provider returning a fixed dense 15m series, recording each request. */
function stubProvider(candles: Candle[]) {
  const calls: { start: number; end: number }[] = [];
  const inner: ExchangeProvider = {
    kind: "mock",
    async fetchInstruments() {
      return [];
    },
    async fetchCandles(_s, _tf, start, end) {
      calls.push({ start, end });
      return candles.filter((c) => c.startTime >= start && c.startTime <= end);
    },
    async createOrder() {
      throw new SafetyError("X", "no");
    },
    async cancelOrder() {
      throw new SafetyError("X", "no");
    },
    async setLeverage() {
      throw new SafetyError("X", "no");
    },
  };
  return { inner, calls };
}

describe("NoLookaheadProvider", () => {
  it("drops the bar still forming at `end` (startTime + step > end)", async () => {
    const step = TIMEFRAME_SECONDS["15m"];
    const t0 = ANCHOR;
    const candles = [makeCandle(t0), makeCandle(t0 + step), makeCandle(t0 + 2 * step)];
    const { inner } = stubProvider(candles);
    const nla = new NoLookaheadProvider(inner);

    // Request ending exactly at the close of bar[1] (t0+step) => bar[1] is closed (start+step == end)
    // and bar[2] is out of range anyway. The forming bar at `end` is excluded.
    const out = await nla.fetchCandles("BTC/USDT", "15m", t0, t0 + 2 * step);
    const times = out.map((c) => c.startTime);
    // bar[2] starts at t0+2*step; start+step = t0+3*step > end (t0+2*step) => excluded.
    expect(times).toEqual([t0, t0 + step]);
    expect(times).not.toContain(t0 + 2 * step);
  });

  it("keeps a bar exactly when it is fully closed by `end`", async () => {
    const step = TIMEFRAME_SECONDS["15m"];
    const t0 = ANCHOR;
    const { inner } = stubProvider([makeCandle(t0)]);
    const nla = new NoLookaheadProvider(inner);
    const out = await nla.fetchCandles("BTC/USDT", "15m", t0, t0 + step);
    expect(out.map((c) => c.startTime)).toEqual([t0]);
  });

  it("preserves the wrapped provider's kind", () => {
    const det = new DeterministicProvider();
    expect(new NoLookaheadProvider(det).kind).toBe("deterministic");
  });

  it("delegates writes unchanged (they remain safety-guarded)", async () => {
    const det = new DeterministicProvider();
    const nla = new NoLookaheadProvider(det);
    await expect(
      nla.createOrder({ symbol: "BTC/USDT", side: "BUY", type: "MARKET", qty: 1 }),
    ).rejects.toBeInstanceOf(SafetyError);
    await expect(nla.setLeverage("BTC/USDT", 2)).rejects.toBeInstanceOf(SafetyError);
  });
});

describe("BacktestTicker", () => {
  it("returns the price set for a symbol, labeled synthetic", async () => {
    const t = new BacktestTicker();
    t.setPrice("BTC/USDT", 123.45, 999);
    const tick = await t.getLastPrice("BTC/USDT");
    expect(tick).toMatchObject({
      symbol: "BTC/USDT",
      price: 123.45,
      tsSeconds: 999,
      synthetic: true,
      source: "backtest-decision-close",
    });
  });

  it("throws DataError when no price has been set", async () => {
    const t = new BacktestTicker();
    await expect(t.getLastPrice("ETH/USDT")).rejects.toThrow(/no price/i);
  });

  it("throws DataError on a non-positive or non-finite price", async () => {
    const t = new BacktestTicker();
    t.setPrice("BTC/USDT", 0, 1);
    await expect(t.getLastPrice("BTC/USDT")).rejects.toThrow();
    t.setPrice("BTC/USDT", NaN, 1);
    await expect(t.getLastPrice("BTC/USDT")).rejects.toThrow();
  });
});
