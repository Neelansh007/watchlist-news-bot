import { describe, expect, it } from "vitest";
import { reconcile } from "../reconciliation";
import type { ReconcilableState } from "../reconciliation";
import type { PaperPosition, PortfolioView } from "../types";

function mkPosition(over: Partial<PaperPosition> = {}): PaperPosition {
  return {
    id: 1,
    symbol: "BTC/USDT",
    side: "LONG",
    qty: 1,
    leverage: 3,
    intendedEntryPrice: 100,
    entryFillPrice: 100,
    stopLoss: 97,
    takeProfit: 106,
    rewardRisk: 2,
    margin: 33.333333,
    entryFee: 0.05,
    openedAtSeconds: 0,
    maxHoldUntilSeconds: 14_400,
    status: "OPEN",
    ...over,
  };
}

function mkView(over: Partial<PortfolioView> = {}): PortfolioView {
  return {
    equity: 10_000,
    cash: 9_000,
    lockedMargin: 1_000,
    unrealizedPnl: 0,
    realizedPnl: 0,
    openPositionCount: 1,
    equityPeak: 10_000,
    dayStartEquity: 10_000,
    dailyLossHalted: false,
    drawdownHalted: false,
    ...over,
  };
}

function fakeState(view: PortfolioView, open: PaperPosition[], closed: PaperPosition[] = []): ReconcilableState {
  return {
    getPortfolioView: () => view,
    getOpenPositions: () => open,
    getClosedPositions: () => closed,
  };
}

// A consistent baseline: one open position with margin 1000, SL below entry.
const healthyOpen = mkPosition({ margin: 1000, entryFillPrice: 100, stopLoss: 97 });
const healthy = () => fakeState(mkView(), [healthyOpen]);

describe("reconcile", () => {
  it("reports ok for a self-consistent state", () => {
    expect(reconcile(healthy(), {}).ok).toBe(true);
  });

  it("catches a broken equity identity", () => {
    const s = fakeState(mkView({ equity: 9_999 }), [healthyOpen]);
    const r = reconcile(s, {});
    expect(r.ok).toBe(false);
    expect(r.discrepancies.join()).toMatch(/equity identity broken/i);
  });

  it("catches locked margin != sum of open margins", () => {
    const s = fakeState(mkView({ lockedMargin: 999, equity: 9_999, cash: 9_000 }), [healthyOpen]);
    expect(reconcile(s, {}).discrepancies.join()).toMatch(/locked margin/i);
  });

  it("catches realized PnL total != sum of closed PnL", () => {
    const closed = [mkPosition({ status: "CLOSED", realizedPnl: 50, exitFillPrice: 105, closeReason: "TAKE_PROFIT", closedAtSeconds: 10 })];
    const s = fakeState(mkView({ realizedPnl: 999 }), [healthyOpen], closed);
    expect(reconcile(s, {}).discrepancies.join()).toMatch(/realized PnL total/i);
  });

  it("catches a closed position missing realizedPnl", () => {
    const closed = [mkPosition({ status: "CLOSED", exitFillPrice: 105, closeReason: "MANUAL", closedAtSeconds: 10 })];
    const s = fakeState(mkView(), [healthyOpen], closed);
    expect(reconcile(s, {}).discrepancies.join()).toMatch(/missing realizedPnl/i);
  });

  it("catches an open-position count mismatch", () => {
    const s = fakeState(mkView({ openPositionCount: 5 }), [healthyOpen]);
    expect(reconcile(s, {}).discrepancies.join()).toMatch(/openPositionCount/i);
  });

  it("catches an open LONG whose stop is not below entry", () => {
    const bad = mkPosition({ margin: 1000, entryFillPrice: 100, stopLoss: 103 });
    const s = fakeState(mkView(), [bad]);
    expect(reconcile(s, {}).discrepancies.join()).toMatch(/stop-loss not below entry/i);
  });

  it("catches a closed position missing exit metadata", () => {
    const closed = [mkPosition({ status: "CLOSED", realizedPnl: 0 })]; // no exitFillPrice/closeReason
    const s = fakeState(mkView(), [healthyOpen], closed);
    expect(reconcile(s, {}).discrepancies.join()).toMatch(/missing exit metadata/i);
  });

  it("catches negative cash", () => {
    const s = fakeState(mkView({ cash: -5, equity: 995, lockedMargin: 1000 }), [healthyOpen]);
    expect(reconcile(s, {}).discrepancies.join()).toMatch(/cash is negative/i);
  });

  it("catches an equity peak below current equity", () => {
    const s = fakeState(mkView({ equityPeak: 9_000 }), [healthyOpen]);
    expect(reconcile(s, {}).discrepancies.join()).toMatch(/equity peak/i);
  });
});
