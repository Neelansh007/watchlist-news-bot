import { describe, expect, it } from "vitest";
import {
  BACKTEST_DISCLAIMER,
  computeMetrics,
  maxDrawdown,
  perSymbolBreakdown,
} from "../metrics";
import type { BacktestTrade } from "../types";
import type { EquityPoint } from "@/lib/oms/types";

function trade(over: Partial<BacktestTrade> = {}): BacktestTrade {
  return {
    symbol: "BTC/USDT",
    side: "LONG",
    entryTimeSeconds: 0,
    exitTimeSeconds: 3600,
    entryPrice: 100,
    exitPrice: 105,
    qty: 1,
    leverage: 1,
    realizedPnl: 5,
    closeReason: "TAKE_PROFIT",
    gapThroughStop: false,
    holdMinutes: 60,
    ...over,
  };
}

function curve(...equities: number[]): EquityPoint[] {
  return equities.map((equity, i) => ({ tsSeconds: i * 900, equity }));
}

describe("maxDrawdown", () => {
  it("is zero for a monotonically rising curve", () => {
    expect(maxDrawdown([100, 110, 120])).toEqual({ abs: 0, pct: 0 });
  });

  it("measures peak-to-trough in absolute and percent terms", () => {
    const dd = maxDrawdown([100, 120, 90, 110]);
    expect(dd.abs).toBeCloseTo(30, 9); // peak 120 -> trough 90
    expect(dd.pct).toBeCloseTo(25, 9); // 30/120
  });

  it("ignores non-finite points", () => {
    expect(maxDrawdown([100, NaN, 95]).abs).toBeCloseTo(5, 9);
  });

  it("handles an empty series", () => {
    expect(maxDrawdown([])).toEqual({ abs: 0, pct: 0 });
  });
});

describe("computeMetrics", () => {
  it("returns zeros with no trades and final equity = starting", () => {
    const m = computeMetrics([], [], 10_000);
    expect(m).toMatchObject({
      tradeCount: 0,
      winRate: 0,
      profitFactor: 0,
      expectancy: 0,
      netPnl: 0,
      finalEquity: 10_000,
      returnPct: 0,
    });
  });

  it("counts wins, losses, net PnL and win rate", () => {
    const trades = [
      trade({ realizedPnl: 30 }),
      trade({ realizedPnl: -10 }),
      trade({ realizedPnl: 20 }),
      trade({ realizedPnl: 0 }), // break-even counts as a loss (not > 0)
    ];
    const m = computeMetrics(trades, curve(10_040), 10_000);
    expect(m.tradeCount).toBe(4);
    expect(m.wins).toBe(2);
    expect(m.losses).toBe(2);
    expect(m.winRate).toBeCloseTo(0.5, 9);
    expect(m.netPnl).toBeCloseTo(40, 9);
    expect(m.grossProfit).toBeCloseTo(50, 9);
    expect(m.grossLoss).toBeCloseTo(10, 9);
  });

  it("computes profit factor = grossProfit / grossLoss", () => {
    const trades = [trade({ realizedPnl: 60 }), trade({ realizedPnl: -20 })];
    const m = computeMetrics(trades, curve(10_040), 10_000);
    expect(m.profitFactor).toBeCloseTo(3, 9);
  });

  it("profit factor is Infinity when there are no losers", () => {
    const m = computeMetrics([trade({ realizedPnl: 10 })], curve(10_010), 10_000);
    expect(m.profitFactor).toBe(Infinity);
  });

  it("expectancy is net PnL per trade", () => {
    const trades = [trade({ realizedPnl: 30 }), trade({ realizedPnl: -10 })];
    const m = computeMetrics(trades, curve(10_020), 10_000);
    expect(m.expectancy).toBeCloseTo(10, 9);
  });

  it("takes drawdown from the equity curve (includes unrealized PnL)", () => {
    const m = computeMetrics([trade({ realizedPnl: 0 })], curve(10_000, 12_000, 9_000, 11_000), 10_000);
    expect(m.maxDrawdownAbs).toBeCloseTo(3_000, 6);
    expect(m.maxDrawdownPct).toBeCloseTo(25, 6);
    expect(m.finalEquity).toBe(11_000);
    expect(m.returnPct).toBeCloseTo(10, 6);
  });
});

describe("perSymbolBreakdown", () => {
  it("groups by symbol and sorts by net PnL descending", () => {
    const trades = [
      trade({ symbol: "BTC/USDT", realizedPnl: 10, exitTimeSeconds: 100 }),
      trade({ symbol: "ETH/USDT", realizedPnl: 50, exitTimeSeconds: 200 }),
      trade({ symbol: "BTC/USDT", realizedPnl: -5, exitTimeSeconds: 300 }),
    ];
    const rows = perSymbolBreakdown(trades);
    expect(rows.map((r) => r.symbol)).toEqual(["ETH/USDT", "BTC/USDT"]);
    const btc = rows.find((r) => r.symbol === "BTC/USDT")!;
    expect(btc.tradeCount).toBe(2);
    expect(btc.netPnl).toBeCloseTo(5, 9);
    expect(btc.winRate).toBeCloseTo(0.5, 9);
    expect(btc.profitFactor).toBeCloseTo(2, 9); // 10 / 5
  });

  it("computes a per-symbol drawdown from the cumulative realized-PnL walk", () => {
    const trades = [
      trade({ symbol: "SOL/USDT", realizedPnl: 40, exitTimeSeconds: 1 }),
      trade({ symbol: "SOL/USDT", realizedPnl: -25, exitTimeSeconds: 2 }),
      trade({ symbol: "SOL/USDT", realizedPnl: 5, exitTimeSeconds: 3 }),
    ];
    const rows = perSymbolBreakdown(trades);
    // cumulative: 0 -> 40 -> 15 -> 20 ; peak 40, trough 15 => dd 25
    expect(rows[0].maxDrawdownAbs).toBeCloseTo(25, 9);
  });

  it("returns an empty array when there are no trades", () => {
    expect(perSymbolBreakdown([])).toEqual([]);
  });
});

describe("BACKTEST_DISCLAIMER", () => {
  it("states plainly that backtests do not guarantee live profit", () => {
    expect(BACKTEST_DISCLAIMER).toMatch(/DO NOT GUARANTEE LIVE PROFIT/i);
    expect(BACKTEST_DISCLAIMER).toMatch(/SYNTHETIC/i);
  });
});
