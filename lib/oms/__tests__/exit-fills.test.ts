import { describe, expect, it } from "vitest";
import {
  checkExit,
  applyEntrySlippage,
  applyExitSlippage,
  takerFee,
  grossPnl,
  realizedPnl,
  unrealizedPnl,
} from "../exit-fills";

function candle(o: number, h: number, l: number, c: number, startTime = 0) {
  return { open: o, high: h, low: l, close: c, startTime };
}

const FAR = Number.MAX_SAFE_INTEGER; // max-hold effectively disabled

describe("checkExit — LONG", () => {
  const base = { side: "LONG" as const, stopLoss: 97, takeProfit: 106, maxHoldUntilSeconds: FAR };

  it("fills at the stop when the low touches it (no gap)", () => {
    const r = checkExit({ ...base, candle: candle(99, 100, 96, 98) });
    expect(r).toMatchObject({ triggered: true, reason: "STOP_LOSS", rawExitPrice: 97, gapThroughStop: false });
  });

  it("GAP-THROUGH-STOP: opens beyond the stop -> fills at the worse OPEN", () => {
    const r = checkExit({ ...base, candle: candle(95, 96, 94, 95) });
    expect(r).toMatchObject({ triggered: true, reason: "STOP_LOSS", rawExitPrice: 95, gapThroughStop: true });
  });

  it("fills at the target when the high reaches it", () => {
    const r = checkExit({ ...base, candle: candle(104, 107, 103, 106.5) });
    expect(r).toMatchObject({ triggered: true, reason: "TAKE_PROFIT", rawExitPrice: 106 });
  });

  it("does NOT assume a favorable TP gap: opens beyond target -> still fills at TP", () => {
    const r = checkExit({ ...base, candle: candle(108, 110, 107, 109) });
    expect(r).toMatchObject({ triggered: true, reason: "TAKE_PROFIT", rawExitPrice: 106 });
  });

  it("when one candle touches BOTH stop and target, the STOP wins", () => {
    const r = checkExit({ ...base, candle: candle(100, 107, 96, 100) });
    expect(r).toMatchObject({ triggered: true, reason: "STOP_LOSS", rawExitPrice: 97 });
  });

  it("no exit when neither level is touched and max-hold not reached", () => {
    expect(checkExit({ ...base, candle: candle(100, 103, 99, 101) }).triggered).toBe(false);
  });

  it("MAX_HOLD flattens at the close once the deadline passes", () => {
    const r = checkExit({ ...base, maxHoldUntilSeconds: 1000, candle: candle(100, 103, 99, 101, 1000) });
    expect(r).toMatchObject({ triggered: true, reason: "MAX_HOLD", rawExitPrice: 101 });
  });

  it("stop/target take precedence over max-hold in the same candle", () => {
    const r = checkExit({ ...base, maxHoldUntilSeconds: 1000, candle: candle(99, 100, 96, 98, 1000) });
    expect(r).toMatchObject({ triggered: true, reason: "STOP_LOSS", rawExitPrice: 97 });
  });
});

describe("checkExit — SHORT", () => {
  const base = { side: "SHORT" as const, stopLoss: 103, takeProfit: 94, maxHoldUntilSeconds: FAR };

  it("fills at the stop when the high touches it", () => {
    const r = checkExit({ ...base, candle: candle(101, 104, 100, 102) });
    expect(r).toMatchObject({ triggered: true, reason: "STOP_LOSS", rawExitPrice: 103, gapThroughStop: false });
  });

  it("GAP-THROUGH-STOP: opens beyond the stop -> fills at the worse OPEN", () => {
    const r = checkExit({ ...base, candle: candle(105, 106, 104, 105) });
    expect(r).toMatchObject({ triggered: true, reason: "STOP_LOSS", rawExitPrice: 105, gapThroughStop: true });
  });

  it("fills at the target when the low reaches it", () => {
    const r = checkExit({ ...base, candle: candle(96, 97, 93, 94) });
    expect(r).toMatchObject({ triggered: true, reason: "TAKE_PROFIT", rawExitPrice: 94 });
  });

  it("when one candle touches BOTH, the STOP wins", () => {
    const r = checkExit({ ...base, candle: candle(100, 104, 93, 100) });
    expect(r).toMatchObject({ triggered: true, reason: "STOP_LOSS", rawExitPrice: 103 });
  });

  it("MAX_HOLD flattens at the close once the deadline passes", () => {
    const r = checkExit({ ...base, maxHoldUntilSeconds: 500, candle: candle(100, 101, 99, 100, 500) });
    expect(r).toMatchObject({ triggered: true, reason: "MAX_HOLD", rawExitPrice: 100 });
  });
});

describe("checkExit — fail closed", () => {
  it("does not invent an exit on non-finite levels or prices", () => {
    expect(checkExit({ side: "LONG", stopLoss: Number.NaN, takeProfit: 106, candle: candle(100, 107, 96, 98), maxHoldUntilSeconds: FAR }).triggered).toBe(false);
    expect(checkExit({ side: "LONG", stopLoss: 97, takeProfit: 106, candle: candle(100, Number.NaN, 96, 98), maxHoldUntilSeconds: FAR }).triggered).toBe(false);
  });
});

describe("slippage / fee / pnl helpers", () => {
  it("entry slippage is against us (LONG higher, SHORT lower)", () => {
    expect(applyEntrySlippage("LONG", 100, 0.01)).toBeCloseTo(101, 9);
    expect(applyEntrySlippage("SHORT", 100, 0.01)).toBeCloseTo(99, 9);
  });
  it("exit slippage is against us (LONG lower, SHORT higher)", () => {
    expect(applyExitSlippage("LONG", 100, 0.01)).toBeCloseTo(99, 9);
    expect(applyExitSlippage("SHORT", 100, 0.01)).toBeCloseTo(101, 9);
  });
  it("taker fee is qty*price*rate", () => {
    expect(takerFee(2, 100, 0.0005)).toBeCloseTo(0.1, 9);
  });
  it("gross PnL is correct for LONG and SHORT", () => {
    expect(grossPnl("LONG", 2, 100, 110)).toBeCloseTo(20, 9);
    expect(grossPnl("SHORT", 2, 100, 90)).toBeCloseTo(20, 9);
    expect(grossPnl("LONG", 2, 100, 90)).toBeCloseTo(-20, 9);
  });
  it("realized PnL subtracts both fees", () => {
    expect(realizedPnl("LONG", 2, 100, 110, 0.1, 0.1)).toBeCloseTo(19.8, 9);
  });
  it("unrealized PnL marks to the current price", () => {
    expect(unrealizedPnl("LONG", 2, 100, 105)).toBeCloseTo(10, 9);
    expect(unrealizedPnl("SHORT", 2, 100, 95)).toBeCloseTo(10, 9);
  });
});
