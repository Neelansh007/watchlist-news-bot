import { describe, expect, it } from "vitest";
import { RISK_LIMITS, COST_ASSUMPTIONS, PAPER_DEFAULTS } from "../risk";
import { WATCHLIST, isWatchlistSymbol, normalizeSymbol } from "../watchlist";

describe("risk limits (conservative defaults locked by test)", () => {
  it("stop-loss is mandatory and not configurable off", () => {
    expect(RISK_LIMITS.requireStopLoss).toBe(true);
  });

  it("risk per trade is a small fraction of equity", () => {
    expect(RISK_LIMITS.riskPerTradePct).toBeGreaterThan(0);
    expect(RISK_LIMITS.riskPerTradePct).toBeLessThanOrEqual(1);
  });

  it("leverage cap is low", () => {
    expect(RISK_LIMITS.maxLeverage).toBeGreaterThanOrEqual(1);
    expect(RISK_LIMITS.maxLeverage).toBeLessThanOrEqual(5);
  });

  it("daily loss and total drawdown limits halt trading", () => {
    expect(RISK_LIMITS.maxDailyLossPct).toBeGreaterThan(0);
    expect(RISK_LIMITS.maxTotalDrawdownPct).toBeGreaterThan(RISK_LIMITS.maxDailyLossPct);
  });

  it("minimum reward:risk is at least 1:1", () => {
    expect(RISK_LIMITS.minRewardRisk).toBeGreaterThanOrEqual(1);
  });

  it("max hold is intraday (< 24h)", () => {
    expect(RISK_LIMITS.maxHoldMinutes).toBeGreaterThan(0);
    expect(RISK_LIMITS.maxHoldMinutes).toBeLessThan(24 * 60);
  });

  it("cost assumptions are positive fractions", () => {
    expect(COST_ASSUMPTIONS.takerFeeRate).toBeGreaterThan(0);
    expect(COST_ASSUMPTIONS.slippageRate).toBeGreaterThan(0);
    expect(COST_ASSUMPTIONS.takerFeeRate).toBeLessThan(0.01);
    expect(COST_ASSUMPTIONS.slippageRate).toBeLessThan(0.01);
    expect(PAPER_DEFAULTS.startingEquityUsdt).toBeGreaterThan(0);
  });
});

describe("watchlist", () => {
  it("contains exactly the seven agreed symbols", () => {
    expect([...WATCHLIST].sort()).toEqual(
      ["BNB/USDT", "BTC/USDT", "ETH/USDT", "HYPE/USDT", "SOL/USDT", "XAU/USDT", "XRP/USDT"].sort(),
    );
  });

  it("accepts watchlist symbols with sloppy formatting", () => {
    expect(isWatchlistSymbol("btc/usdt")).toBe(true);
    expect(isWatchlistSymbol("  ETH/USDT ")).toBe(true);
    expect(isWatchlistSymbol(normalizeSymbol("sol/usdt"))).toBe(true);
  });

  it("rejects everything outside the watchlist", () => {
    expect(isWatchlistSymbol("DOGE/USDT")).toBe(false);
    expect(isWatchlistSymbol("BTC/USD")).toBe(false);
    expect(isWatchlistSymbol("BTCUSDT")).toBe(false);
    expect(isWatchlistSymbol("")).toBe(false);
    expect(isWatchlistSymbol("DROP TABLE positions;--/USDT")).toBe(false);
  });
});
