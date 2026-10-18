import { describe, expect, it } from "vitest";
import { sizePosition, roundDownToStep } from "../sizing";
import { RISK_LIMITS } from "@/lib/config/risk";
import type { InstrumentConstraints, SizedPosition, TradeSetup } from "../types";

const setup: TradeSetup = {
  symbol: "BTC/USDT",
  side: "LONG",
  entryPrice: 100,
  stopLoss: 97, // per-unit risk = 3
  takeProfit: 106,
  slDistance: 3,
  tpDistance: 6,
  rewardRisk: 2,
  atr: 2,
};

const instrument: InstrumentConstraints = {
  minContract: 0.001,
  maxContract: 1_000_000,
  quantityStep: 0.001,
  minNotional: 5,
  maxLeverage: 20,
};

function baseInput(over: Partial<Parameters<typeof sizePosition>[0]> = {}) {
  return {
    equity: 10_000,
    cashBalance: 10_000,
    existingSymbolNotional: 0,
    instrument,
    setup,
    ...over,
  };
}

describe("roundDownToStep", () => {
  it("rounds down to the nearest step and cleans float noise", () => {
    expect(roundDownToStep(16.6667, 0.001)).toBeCloseTo(16.666, 9);
    expect(roundDownToStep(2.9999, 1)).toBe(2);
    expect(roundDownToStep(5, 10)).toBe(0);
    expect(roundDownToStep(0.3, 0.1)).toBeCloseTo(0.3, 9);
  });
  it("returns 0 for invalid step", () => {
    expect(roundDownToStep(10, 0)).toBe(0);
    expect(roundDownToStep(10, -1)).toBe(0);
  });
});

describe("sizePosition", () => {
  it("sizes to the risk-per-trade budget when that is the tightest cap", () => {
    const out = sizePosition(baseInput());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const p: SizedPosition = out.position;
    // riskBudget = 10000 * 0.5% = 50 ; perUnitRisk 3 -> qty 16.666 (rounded down)
    expect(p.qty).toBeCloseTo(16.666, 3);
    expect(p.riskAmount).toBeLessThanOrEqual(50 + 1e-9);
    expect(p.leverage).toBe(RISK_LIMITS.maxLeverage); // min(3, 20)
    expect(p.notional).toBeCloseTo(p.qty * 100, 6);
    expect(p.marginRequired).toBeCloseTo(p.notional / p.leverage, 6);
  });

  it("caps size by per-symbol exposure when already partly invested", () => {
    // exposure cap notional = 20% * 10000 = 2000 ; existing 1900 -> 100 left -> qty 1
    const out = sizePosition(baseInput({ existingSymbolNotional: 1900 }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.position.qty).toBeCloseTo(1, 6);
  });

  it("fails closed when the per-symbol exposure cap is already reached", () => {
    const out = sizePosition(baseInput({ existingSymbolNotional: 2000 }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/exposure cap already reached/i);
  });

  it("caps size by available margin", () => {
    // cash 100, leverage 3 -> max notional 300 -> qty 3 (tighter than risk qty 16.6)
    const out = sizePosition(baseInput({ cashBalance: 100 }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.position.qty).toBeCloseTo(3, 6);
    expect(out.position.marginRequired).toBeLessThanOrEqual(100 + 1e-9);
  });

  it("uses the tighter of config leverage and exchange leverage", () => {
    const out = sizePosition(baseInput({ instrument: { ...instrument, maxLeverage: 2 } }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.position.leverage).toBe(2);
  });

  it("fails closed when the quantity rounds to zero at the step size", () => {
    // equity 100 -> riskBudget 0.5 -> qty ~0.166 ; step 10 -> 0
    const out = sizePosition(
      baseInput({ equity: 100, cashBalance: 100, instrument: { ...instrument, quantityStep: 10 } }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/rounds to zero/i);
  });

  it("fails closed when the size is below the exchange minimum contract", () => {
    const out = sizePosition(baseInput({ instrument: { ...instrument, minContract: 100 } }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/below exchange min contract/i);
  });

  it("fails closed when the notional is below the exchange minimum notional", () => {
    const out = sizePosition(baseInput({ instrument: { ...instrument, minNotional: 1_000_000_000 } }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/below exchange min notional/i);
  });

  it("fails closed on invalid equity / cash / zero stop distance", () => {
    expect(sizePosition(baseInput({ equity: 0 })).ok).toBe(false);
    expect(sizePosition(baseInput({ equity: -5 })).ok).toBe(false);
    expect(sizePosition(baseInput({ cashBalance: -1 })).ok).toBe(false);
    expect(
      sizePosition(baseInput({ setup: { ...setup, stopLoss: 100 } })).ok, // per-unit risk 0
    ).toBe(false);
  });

  it("never exceeds the risk budget after rounding down", () => {
    const out = sizePosition(baseInput());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const budget = 10_000 * (RISK_LIMITS.riskPerTradePct / 100);
    expect(out.position.riskAmount).toBeLessThanOrEqual(budget + 1e-9);
  });
});
