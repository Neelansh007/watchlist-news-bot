import type { Candle } from "@/lib/exchange/types";
import type { Side } from "@/lib/trading/types";
import type { ExitReason } from "./types";

/**
 * REALISTIC EXIT FILL MODEL (pure, no state).
 *
 * Conservative rules, per spec:
 *  - Gap-through-stop: if the candle OPENS beyond the stop, the position is
 *    filled at the OPEN (a WORSE price than the stop), not at the stop level.
 *  - Take-profit gaps are NOT assumed favorable: even if the candle opens beyond
 *    the TP, we fill at the TP level (the conservative price), never better.
 *  - If one candle touches BOTH stop and target, the STOP is assumed to hit
 *    first (worst case for us).
 *  - Max-hold: if no stop/target triggered and the candle starts at/after the
 *    max-hold deadline, flatten at the candle CLOSE.
 *
 * checkExit returns the RAW exit price (before slippage/fees). The OMS applies
 * slippage and fees on top.
 */

export interface ExitCheckInput {
  side: Side;
  stopLoss: number;
  takeProfit: number;
  candle: Pick<Candle, "open" | "high" | "low" | "close" | "startTime">;
  /** Position must be flattened once candle.startTime >= this. */
  maxHoldUntilSeconds: number;
}

export interface ExitFill {
  triggered: boolean;
  reason?: ExitReason;
  /** Exit price before slippage/fees. */
  rawExitPrice?: number;
  /** True when the candle gapped through the stop (filled at the open). */
  gapThroughStop?: boolean;
}

const NO_EXIT: ExitFill = { triggered: false };

export function checkExit(input: ExitCheckInput): ExitFill {
  const { side, stopLoss, takeProfit, candle, maxHoldUntilSeconds } = input;

  // Reject nonsense levels defensively (fail closed: do not invent an exit).
  if (!Number.isFinite(stopLoss) || !Number.isFinite(takeProfit)) return NO_EXIT;
  const { open, high, low, close } = candle;
  if (![open, high, low, close].every((p) => Number.isFinite(p))) return NO_EXIT;

  if (side === "LONG") {
    // 1) Gap down through the stop -> fill at the (worse) open.
    if (open <= stopLoss) {
      return { triggered: true, reason: "STOP_LOSS", rawExitPrice: open, gapThroughStop: true };
    }
    const stopHit = low <= stopLoss;
    const targetHit = high >= takeProfit;
    // 2) Both touched in the same candle -> assume the STOP hit first.
    if (stopHit && targetHit) {
      return { triggered: true, reason: "STOP_LOSS", rawExitPrice: stopLoss, gapThroughStop: false };
    }
    // 3) Stop only.
    if (stopHit) {
      return { triggered: true, reason: "STOP_LOSS", rawExitPrice: stopLoss, gapThroughStop: false };
    }
    // 4) Target only -> conservative fill at the TP level (never the better gap).
    if (targetHit) {
      return { triggered: true, reason: "TAKE_PROFIT", rawExitPrice: takeProfit, gapThroughStop: false };
    }
  } else {
    // SHORT
    // 1) Gap up through the stop -> fill at the (worse) open.
    if (open >= stopLoss) {
      return { triggered: true, reason: "STOP_LOSS", rawExitPrice: open, gapThroughStop: true };
    }
    const stopHit = high >= stopLoss;
    const targetHit = low <= takeProfit;
    // 2) Both touched -> STOP first.
    if (stopHit && targetHit) {
      return { triggered: true, reason: "STOP_LOSS", rawExitPrice: stopLoss, gapThroughStop: false };
    }
    // 3) Stop only.
    if (stopHit) {
      return { triggered: true, reason: "STOP_LOSS", rawExitPrice: stopLoss, gapThroughStop: false };
    }
    // 4) Target only -> conservative fill at the TP level.
    if (targetHit) {
      return { triggered: true, reason: "TAKE_PROFIT", rawExitPrice: takeProfit, gapThroughStop: false };
    }
  }

  // 5) No intra-candle trigger: enforce the max-hold timeout at the candle close.
  if (Number.isFinite(maxHoldUntilSeconds) && candle.startTime >= maxHoldUntilSeconds) {
    return { triggered: true, reason: "MAX_HOLD", rawExitPrice: close, gapThroughStop: false };
  }

  return NO_EXIT;
}

// ---------------------------------------------------------------------------
// Slippage / fee / PnL helpers (pure). Slippage is always applied AGAINST us.
// ---------------------------------------------------------------------------

/** Entry fill: a LONG buys (worse = higher), a SHORT sells (worse = lower). */
export function applyEntrySlippage(side: Side, price: number, slippageRate: number): number {
  return side === "LONG" ? price * (1 + slippageRate) : price * (1 - slippageRate);
}

/** Exit fill: a LONG sells (worse = lower), a SHORT buys back (worse = higher). */
export function applyExitSlippage(side: Side, price: number, slippageRate: number): number {
  return side === "LONG" ? price * (1 - slippageRate) : price * (1 + slippageRate);
}

/** Taker fee on a fill, in quote (USDT). */
export function takerFee(qty: number, fillPrice: number, feeRate: number): number {
  return Math.abs(qty * fillPrice * feeRate);
}

/** Gross PnL from price movement only (before fees), in quote (USDT). */
export function grossPnl(side: Side, qty: number, entryFill: number, exitFill: number): number {
  return side === "LONG"
    ? (exitFill - entryFill) * qty
    : (entryFill - exitFill) * qty;
}

/** Net realized PnL incl. both fees, in quote (USDT). Negative == loss. */
export function realizedPnl(
  side: Side,
  qty: number,
  entryFill: number,
  exitFill: number,
  entryFee: number,
  exitFee: number,
): number {
  return grossPnl(side, qty, entryFill, exitFill) - entryFee - exitFee;
}

/** Unrealized (mark-to-market) PnL for an open position, before fees. */
export function unrealizedPnl(side: Side, qty: number, entryFill: number, markPrice: number): number {
  return grossPnl(side, qty, entryFill, markPrice);
}
