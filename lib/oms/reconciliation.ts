import type { Marks } from "./paper-oms";
import type { PaperPosition, PortfolioView } from "./types";

/** The minimal slice of state reconciliation needs (PaperOMS satisfies this). */
export interface ReconcilableState {
  getPortfolioView(marks: Marks): PortfolioView;
  getOpenPositions(): PaperPosition[];
  getClosedPositions(): PaperPosition[];
}

export interface ReconciliationResult {
  ok: boolean;
  discrepancies: string[];
  checked: {
    openPositions: number;
    closedPositions: number;
    equity: number;
    cash: number;
    lockedMargin: number;
    realizedPnlTotal: number;
  };
}

const TOL = 1e-6;

/**
 * Verify the OMS's internal accounting is self-consistent. This is a safety net
 * against bookkeeping bugs (double-counted fees, lost margin, PnL drift). It
 * never mutates state; it only reports discrepancies. Any discrepancy means the
 * run should be treated as untrustworthy and halted for inspection.
 */
export function reconcile(oms: ReconcilableState, marks: Marks): ReconciliationResult {
  const discrepancies: string[] = [];
  const view = oms.getPortfolioView(marks);
  const open = oms.getOpenPositions();
  const closed = oms.getClosedPositions();

  // 1) Equity identity: equity == cash + locked margin + unrealized PnL.
  const identity = view.cash + view.lockedMargin + view.unrealizedPnl;
  if (Math.abs(identity - view.equity) > TOL) {
    discrepancies.push(
      `equity identity broken: cash(${view.cash}) + margin(${view.lockedMargin}) + uPnL(${view.unrealizedPnl}) != equity(${view.equity})`,
    );
  }

  // 2) Locked margin equals the sum of open positions' margin.
  const marginSum = open.reduce((s, p) => s + p.margin, 0);
  if (Math.abs(marginSum - view.lockedMargin) > TOL) {
    discrepancies.push(`locked margin ${view.lockedMargin} != sum of open margins ${marginSum}`);
  }

  // 3) Cumulative realized PnL equals the sum of closed positions' realized PnL.
  const realizedSum = closed.reduce((s, p) => s + (p.realizedPnl ?? Number.NaN), 0);
  if (!Number.isFinite(realizedSum)) {
    discrepancies.push("a closed position is missing realizedPnl");
  } else if (Math.abs(realizedSum - view.realizedPnl) > TOL) {
    discrepancies.push(`realized PnL total ${view.realizedPnl} != sum of closed PnL ${realizedSum}`);
  }

  // 4) Open-position count matches.
  if (view.openPositionCount !== open.length) {
    discrepancies.push(`openPositionCount ${view.openPositionCount} != actual ${open.length}`);
  }

  // 5) Every open position has a valid, correctly-sided stop-loss.
  for (const p of open) {
    if (!Number.isFinite(p.stopLoss) || p.stopLoss <= 0) {
      discrepancies.push(`open position ${p.id} has invalid stop-loss ${p.stopLoss}`);
    } else if (p.side === "LONG" && p.stopLoss >= p.entryFillPrice) {
      discrepancies.push(`open LONG ${p.id} stop-loss not below entry`);
    } else if (p.side === "SHORT" && p.stopLoss <= p.entryFillPrice) {
      discrepancies.push(`open SHORT ${p.id} stop-loss not above entry`);
    }
  }

  // 6) Every closed position has the closing fields populated.
  for (const p of closed) {
    if (p.exitFillPrice === undefined || p.closeReason === undefined || p.closedAtSeconds === undefined) {
      discrepancies.push(`closed position ${p.id} is missing exit metadata`);
    }
  }

  // 7) Cash must never go meaningfully negative in a long-only-margin paper model.
  if (view.cash < -TOL) {
    discrepancies.push(`cash is negative: ${view.cash}`);
  }

  // 8) Equity peak must be at least current equity.
  if (view.equityPeak < view.equity - TOL) {
    discrepancies.push(`equity peak ${view.equityPeak} below current equity ${view.equity}`);
  }

  return {
    ok: discrepancies.length === 0,
    discrepancies,
    checked: {
      openPositions: open.length,
      closedPositions: closed.length,
      equity: view.equity,
      cash: view.cash,
      lockedMargin: view.lockedMargin,
      realizedPnlTotal: view.realizedPnl,
    },
  };
}
