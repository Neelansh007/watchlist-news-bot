import { describe, expect, it } from "vitest";
import {
  evaluateEntry,
  evaluatePortfolioHealth,
  deriveHaltState,
  checkStopLoss,
  checkRewardRisk,
  checkLeverage,
  checkRiskPerTrade,
  checkExposurePerSymbol,
  checkMargin,
  checkConcurrentPositions,
  checkDailyLoss,
  checkTotalDrawdown,
  checkHalted,
} from "../engine";
import { RISK_LIMITS } from "@/lib/config/risk";
import type { PortfolioState, ProposedEntry, OpenPositionView } from "../types";
import type { SizedPosition } from "@/lib/trading/types";

function mkPosition(over: Partial<SizedPosition> = {}): SizedPosition {
  return {
    symbol: "BTC/USDT",
    side: "LONG",
    qty: 1,
    entryPrice: 100,
    stopLoss: 97,
    takeProfit: 106,
    notional: 100,
    leverage: 3,
    marginRequired: 33.333333333333,
    riskAmount: 3,
    rewardRisk: 2,
    ...over,
  };
}

function mkState(over: Partial<PortfolioState> = {}): PortfolioState {
  return {
    equity: 10_000,
    cashBalance: 10_000,
    dayStartEquity: 10_000,
    equityPeak: 10_000,
    dailyLossHalted: false,
    drawdownHalted: false,
    openPositions: [],
    ...over,
  };
}

function openPos(over: Partial<OpenPositionView> = {}): OpenPositionView {
  return {
    symbol: "ETH/USDT",
    side: "LONG",
    qty: 1,
    entryPrice: 100,
    notional: 100,
    leverage: 3,
    unrealizedPnl: 0,
    ...over,
  };
}

const entry = (p: SizedPosition): ProposedEntry => ({ position: p });

describe("risk engine — healthy baseline", () => {
  it("allows a correctly-sized trade with no breaches", () => {
    const d = evaluateEntry(entry(mkPosition()), mkState());
    expect(d.allowed).toBe(true);
    expect(d.breaches).toEqual([]);
  });
});

describe("risk engine — each limit independently", () => {
  it("requireStopLoss: blocks a missing/zero stop", () => {
    expect(checkStopLoss(entry(mkPosition({ stopLoss: 0 })))?.limit).toBe("requireStopLoss");
  });
  it("requireStopLoss: blocks a stop on the wrong side (LONG)", () => {
    expect(checkStopLoss(entry(mkPosition({ stopLoss: 103 })))?.limit).toBe("requireStopLoss");
  });
  it("requireStopLoss: accepts a valid LONG stop", () => {
    expect(checkStopLoss(entry(mkPosition()))).toBeNull();
  });

  it("minRewardRisk: blocks reward:risk below the minimum", () => {
    expect(checkRewardRisk(entry(mkPosition({ rewardRisk: 1.0 })))?.limit).toBe("minRewardRisk");
  });
  it("minRewardRisk: accepts reward:risk at the minimum", () => {
    expect(checkRewardRisk(entry(mkPosition({ rewardRisk: RISK_LIMITS.minRewardRisk })))).toBeNull();
  });

  it("maxLeverage: blocks leverage above the cap", () => {
    expect(checkLeverage(entry(mkPosition({ leverage: RISK_LIMITS.maxLeverage + 1 })))?.limit).toBe("maxLeverage");
  });
  it("maxLeverage: accepts leverage exactly at the cap", () => {
    expect(checkLeverage(entry(mkPosition({ leverage: RISK_LIMITS.maxLeverage })))).toBeNull();
  });
  it("maxLeverage: blocks leverage below 1", () => {
    expect(checkLeverage(entry(mkPosition({ leverage: 0 })))?.limit).toBe("maxLeverage");
  });

  it("riskPerTradePct: blocks risk above the per-trade budget", () => {
    const budget = 10_000 * (RISK_LIMITS.riskPerTradePct / 100); // 50
    expect(checkRiskPerTrade(entry(mkPosition({ riskAmount: budget + 0.01 })), mkState())?.limit).toBe(
      "riskPerTradePct",
    );
  });
  it("riskPerTradePct: accepts risk exactly at the budget (no override slack)", () => {
    const budget = 10_000 * (RISK_LIMITS.riskPerTradePct / 100);
    expect(checkRiskPerTrade(entry(mkPosition({ riskAmount: budget })), mkState())).toBeNull();
  });
  it("riskPerTradePct: fails closed on invalid equity", () => {
    expect(checkRiskPerTrade(entry(mkPosition()), mkState({ equity: 0 }))?.limit).toBe("riskPerTradePct");
  });

  it("maxExposurePerSymbolPct: blocks when projected symbol notional exceeds the cap", () => {
    // cap = 20% * 10000 = 2000 ; existing 1950 + new 100 = 2050 > 2000
    const state = mkState({ openPositions: [openPos({ symbol: "BTC/USDT", notional: 1950 })] });
    expect(checkExposurePerSymbol(entry(mkPosition()), state)?.limit).toBe("maxExposurePerSymbolPct");
  });
  it("maxExposurePerSymbolPct: ignores other symbols' notional", () => {
    const state = mkState({ openPositions: [openPos({ symbol: "ETH/USDT", notional: 1950 })] });
    expect(checkExposurePerSymbol(entry(mkPosition()), state)).toBeNull();
  });

  it("maxConcurrentPositions: blocks when already at the max", () => {
    const positions = Array.from({ length: RISK_LIMITS.maxConcurrentPositions }, () => openPos());
    expect(checkConcurrentPositions(mkState({ openPositions: positions }))?.limit).toBe(
      "maxConcurrentPositions",
    );
  });
  it("maxConcurrentPositions: accepts one below the max", () => {
    const positions = Array.from({ length: RISK_LIMITS.maxConcurrentPositions - 1 }, () => openPos());
    expect(checkConcurrentPositions(mkState({ openPositions: positions }))).toBeNull();
  });

  it("MARGIN: blocks when margin required exceeds available cash", () => {
    expect(checkMargin(entry(mkPosition({ marginRequired: 500 })), mkState({ cashBalance: 100 }))?.limit).toBe(
      "MARGIN",
    );
  });

  it("maxDailyLossPct: halts the day when the loss exceeds the limit", () => {
    // limit = 2% * 10000 = 200 ; equity 9700 -> loss 300 > 200
    const b = checkDailyLoss(mkState({ equity: 9700 }));
    expect(b?.limit).toBe("maxDailyLossPct");
    expect(b?.action).toBe("HALT_DAY");
  });
  it("maxDailyLossPct: no breach while under the limit", () => {
    expect(checkDailyLoss(mkState({ equity: 9900 }))).toBeNull(); // loss 100 < 200
  });
  it("maxDailyLossPct: fails closed on an invalid day-start anchor", () => {
    expect(checkDailyLoss(mkState({ dayStartEquity: 0 }))?.action).toBe("HALT_DAY");
  });

  it("maxTotalDrawdownPct: halts everything when drawdown exceeds the limit", () => {
    // limit 10% ; peak 10000, equity 8900 -> 11% > 10%
    const b = checkTotalDrawdown(mkState({ equity: 8900 }));
    expect(b?.limit).toBe("maxTotalDrawdownPct");
    expect(b?.action).toBe("HALT_ALL");
  });
  it("maxTotalDrawdownPct: no breach while under the limit", () => {
    expect(checkTotalDrawdown(mkState({ equity: 9500 }))).toBeNull(); // 5%
  });
  it("maxTotalDrawdownPct: fails closed on an invalid peak anchor", () => {
    expect(checkTotalDrawdown(mkState({ equityPeak: 0 }))?.action).toBe("HALT_ALL");
  });

  it("HALTED: an active daily-loss halt blocks new entries", () => {
    expect(checkHalted(mkState({ dailyLossHalted: true }))?.action).toBe("HALT_DAY");
  });
  it("HALTED: an active drawdown halt blocks new entries", () => {
    expect(checkHalted(mkState({ drawdownHalted: true }))?.action).toBe("HALT_ALL");
  });
});

describe("risk engine — aggregation & no-override", () => {
  it("evaluateEntry reports every breach, not just the first", () => {
    const bad = entry(
      mkPosition({ leverage: 9, rewardRisk: 0.5, riskAmount: 9999, marginRequired: 9999 }),
    );
    const d = evaluateEntry(bad, mkState({ cashBalance: 10 }));
    expect(d.allowed).toBe(false);
    const limits = d.breaches.map((b) => b.limit);
    expect(limits).toContain("maxLeverage");
    expect(limits).toContain("minRewardRisk");
    expect(limits).toContain("riskPerTradePct");
    expect(limits).toContain("MARGIN");
  });

  it("evaluateEntry blocks any new trade while a halt is active", () => {
    const d = evaluateEntry(entry(mkPosition()), mkState({ drawdownHalted: true }));
    expect(d.allowed).toBe(false);
    expect(d.breaches.some((b) => b.action === "HALT_ALL")).toBe(true);
  });

  it("evaluatePortfolioHealth surfaces halts/loss/drawdown without a proposal", () => {
    const breaches = evaluatePortfolioHealth(mkState({ equity: 8000 })); // 20% drawdown
    expect(breaches.some((b) => b.limit === "maxTotalDrawdownPct")).toBe(true);
  });

  it("deriveHaltState trips on breach and stays tripped", () => {
    const tripped = deriveHaltState(mkState({ equity: 8000 }));
    expect(tripped.drawdownHalted).toBe(true);
    // Even if equity recovers, an already-set flag persists (human must clear it).
    const stillTripped = deriveHaltState(mkState({ equity: 10_000, drawdownHalted: true }));
    expect(stillTripped.drawdownHalted).toBe(true);
  });

  it("deriveHaltState trips the daily-loss halt independently", () => {
    expect(deriveHaltState(mkState({ equity: 9700 })).dailyLossHalted).toBe(true);
  });

  it("enforces the frozen limits with zero slack (epsilon over => blocked)", () => {
    const budget = 10_000 * (RISK_LIMITS.riskPerTradePct / 100);
    expect(evaluateEntry(entry(mkPosition({ riskAmount: budget })), mkState()).allowed).toBe(true);
    expect(evaluateEntry(entry(mkPosition({ riskAmount: budget + 1e-6 })), mkState()).allowed).toBe(false);
  });
});
