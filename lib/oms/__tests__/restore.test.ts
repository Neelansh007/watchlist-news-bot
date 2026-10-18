import { describe, expect, it } from "vitest";
import { PaperOMS } from "@/lib/oms/paper-oms";
import type { PaperPosition } from "@/lib/oms/types";

const openPosition: PaperPosition = {
  id: 3,
  symbol: "BTC/USDT",
  side: "LONG",
  qty: 0.05,
  leverage: 2,
  intendedEntryPrice: 60_000,
  entryFillPrice: 60_000,
  stopLoss: 59_000,
  takeProfit: 62_000,
  rewardRisk: 2,
  margin: 1_000,
  entryFee: 1,
  openedAtSeconds: 1_800_000_000,
  maxHoldUntilSeconds: 1_800_014_400,
  status: "OPEN",
  gapThroughStop: false,
};

const closedPosition: PaperPosition = {
  ...openPosition,
  id: 2,
  status: "CLOSED",
  closeReason: "TAKE_PROFIT",
  rawExitPrice: 62_000,
  exitFillPrice: 61_981.4,
  exitFee: 3.1,
  realizedPnl: 120,
  closedAtSeconds: 1_800_003_600,
  gapThroughStop: false,
};

const restoreState = {
  startingEquityUsdt: 10_000,
  positions: [closedPosition, openPosition],
  equityPeak: 10_400,
  dayStartEquity: 10_100,
  dayKey: Math.floor(1_800_000_000 / 86_400),
  dailyLossHalted: false,
  drawdownHalted: true,
};

describe("PaperOMS.restore", () => {
  it("derives cash from closed PnL and open debits instead of trusting stored cash", () => {
    const oms = PaperOMS.restore(restoreState);

    expect(oms.getStartingEquity()).toBe(10_000);
    expect(oms.getOpenPositions()).toHaveLength(1);
    expect(oms.getClosedPositions()).toHaveLength(1);

    // cash = 10,000 + realized 120 - (margin 1,000 + entry fee 1)
    const view = oms.getPortfolioView({});
    expect(view.cash).toBe(9_119);
    expect(view.lockedMargin).toBe(1_000);
    expect(view.realizedPnl).toBe(120);
    // mark missing -> entry price -> zero unrealized
    expect(view.equity).toBe(10_119);
    expect(view.equityPeak).toBe(10_400);
    expect(view.dayStartEquity).toBe(10_100);
    expect(view.drawdownHalted).toBe(true);
  });

  it("continues position ids after the restored maximum and adopts DB ids", () => {
    const oms = PaperOMS.restore({ ...restoreState, drawdownHalted: false });
    oms.assignPersistedId(3, 900);

    const view = oms.getOpenPositions()[0];
    expect(view.id).toBe(900);

    const opened = oms.openPosition(
      {
        symbol: "ETH/USDT",
        side: "LONG",
        qty: 0.1,
        entryPrice: 3_000,
        stopLoss: 2_900,
        takeProfit: 3_200,
        notional: 300,
        leverage: 2,
        marginRequired: 150,
        riskAmount: 10,
        rewardRisk: 2,
      },
      { "ETH/USDT": 3_000 },
      1_800_000_060,
    );
    expect(opened.ok).toBe(true);
    expect(opened.position?.id).toBe(901);
  });

  it("keeps halt flags and can close a restored position with correct accounting", () => {
    const oms = PaperOMS.restore(restoreState);
    const closed = oms.closePosition(3, {
      reason: "STOP_LOSS",
      rawExitPrice: 59_000,
      nowSeconds: 1_800_001_000,
    });
    expect(closed.ok).toBe(true);
    expect(closed.position?.realizedPnl).toBeLessThan(0);

    const view = oms.getPortfolioView({});
    // Equity = starting + all realized PnL (no positions open).
    expect(view.openPositionCount).toBe(0);
    expect(view.equity).toBeCloseTo(
      10_000 + 120 + (closed.position?.realizedPnl ?? 0),
      6,
    );
    // Drawdown halt persists across restoration until a human clears it.
    expect(view.drawdownHalted).toBe(true);
  });
});
