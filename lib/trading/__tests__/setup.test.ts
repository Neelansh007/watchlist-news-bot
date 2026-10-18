import { describe, expect, it } from "vitest";
import { buildTradeSetup, findSetupViolation, maxHoldSeconds } from "../setup";
import { RISK_LIMITS, SETUP_PARAMS } from "@/lib/config/risk";
import type { TradeSetup } from "../types";

const LONG = { symbol: "BTC/USDT" as const, side: "LONG" as const, entryPrice: 100, atr: 2 };

describe("buildTradeSetup", () => {
  it("places an ATR stop below entry and a RR target above for a LONG", () => {
    const out = buildTradeSetup(LONG);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const s = out.setup;
    // slDistance = 1.5 * 2 = 3 ; tpDistance = 3 * 2 = 6
    expect(s.stopLoss).toBeCloseTo(97, 9);
    expect(s.takeProfit).toBeCloseTo(106, 9);
    expect(s.slDistance).toBeCloseTo(3, 9);
    expect(s.tpDistance).toBeCloseTo(6, 9);
    expect(s.rewardRisk).toBeCloseTo(SETUP_PARAMS.targetRewardRisk, 9);
  });

  it("mirrors stop/target for a SHORT", () => {
    const out = buildTradeSetup({ ...LONG, side: "SHORT" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.setup.stopLoss).toBeCloseTo(103, 9);
    expect(out.setup.takeProfit).toBeCloseTo(94, 9);
  });

  it("fails closed on a non-positive / non-finite entry price", () => {
    for (const entryPrice of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(buildTradeSetup({ ...LONG, entryPrice }).ok).toBe(false);
    }
  });

  it("fails closed on a non-positive / non-finite ATR", () => {
    for (const atr of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(buildTradeSetup({ ...LONG, atr }).ok).toBe(false);
    }
  });

  it("fails closed when a wide ATR pushes the LONG stop to/below zero", () => {
    // entry 10, atr 10 -> slDistance 15 -> stop = -5
    const out = buildTradeSetup({ ...LONG, entryPrice: 10, atr: 10 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/stop-loss non-positive/i);
  });

  it("fails closed when a wide ATR pushes the SHORT target to/below zero", () => {
    // entry 10, atr 10 -> SL 25 (ok), tpDistance 30 -> target = -20
    const out = buildTradeSetup({ symbol: "BTC/USDT", side: "SHORT", entryPrice: 10, atr: 10 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/take-profit non-positive/i);
  });

  it("target reward:risk is configured at or above the hard minimum (locked)", () => {
    expect(SETUP_PARAMS.targetRewardRisk).toBeGreaterThanOrEqual(RISK_LIMITS.minRewardRisk);
  });

  it("maxHoldSeconds reflects the configured max hold minutes", () => {
    expect(maxHoldSeconds()).toBe(RISK_LIMITS.maxHoldMinutes * 60);
  });
});

describe("findSetupViolation", () => {
  const base: TradeSetup = {
    symbol: "BTC/USDT",
    side: "LONG",
    entryPrice: 100,
    stopLoss: 97,
    takeProfit: 106,
    slDistance: 3,
    tpDistance: 6,
    rewardRisk: 2,
    atr: 2,
  };

  it("accepts a valid LONG setup", () => {
    expect(findSetupViolation(base)).toBeNull();
  });

  it("rejects a LONG stop above entry", () => {
    expect(findSetupViolation({ ...base, stopLoss: 103 })).toMatch(/LONG stop-loss must be below entry/);
  });

  it("rejects a SHORT stop below entry", () => {
    expect(
      findSetupViolation({ ...base, side: "SHORT", stopLoss: 97, takeProfit: 94 }),
    ).toMatch(/SHORT stop-loss must be above entry/);
  });

  it("rejects reward:risk below the minimum", () => {
    expect(findSetupViolation({ ...base, rewardRisk: 1.0 })).toMatch(/below minimum/);
  });

  it("rejects a non-positive take-profit", () => {
    expect(findSetupViolation({ ...base, takeProfit: 0 })).toMatch(/take-profit must be finite and positive/);
  });
});
