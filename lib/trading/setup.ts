import { RISK_LIMITS, SETUP_PARAMS } from "@/lib/config/risk";
import type { WatchlistSymbol } from "@/lib/config/watchlist";
import type { Side, TradeSetup } from "./types";

export interface BuildSetupInput {
  symbol: WatchlistSymbol;
  side: Side;
  /** Price we would enter at (synthetic last price). Must be finite and > 0. */
  entryPrice: number;
  /** ATR(14, 15m) from the snapshot. Must be finite and > 0. */
  atr: number;
}

export type SetupOutcome =
  | { ok: true; setup: TradeSetup }
  | { ok: false; reason: string };

/**
 * Build a trade setup: an ATR-buffered stop-loss and a take-profit placed to
 * hit the target reward:risk. Fails closed (never guesses) on any invalid or
 * non-sensical input — e.g. a stop that would sit at/below zero, or a target
 * that would sit at/below zero for a SHORT.
 */
export function buildTradeSetup(input: BuildSetupInput): SetupOutcome {
  const { symbol, side, entryPrice, atr } = input;

  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return { ok: false, reason: `invalid entry price: ${entryPrice}` };
  }
  if (!Number.isFinite(atr) || atr <= 0) {
    return { ok: false, reason: `invalid ATR: ${atr}` };
  }
  if (side !== "LONG" && side !== "SHORT") {
    return { ok: false, reason: `invalid side: ${String(side)}` };
  }

  const slDistance = SETUP_PARAMS.atrStopMultiplier * atr;
  if (!Number.isFinite(slDistance) || slDistance <= 0) {
    return { ok: false, reason: `invalid stop distance: ${slDistance}` };
  }
  const tpDistance = slDistance * SETUP_PARAMS.targetRewardRisk;

  let stopLoss: number;
  let takeProfit: number;
  if (side === "LONG") {
    stopLoss = entryPrice - slDistance;
    takeProfit = entryPrice + tpDistance;
  } else {
    stopLoss = entryPrice + slDistance;
    takeProfit = entryPrice - tpDistance;
  }

  // Fail closed if the stop or target crosses zero (can happen on a very wide
  // ATR relative to price). We never place a non-positive or inverted level.
  if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
    return { ok: false, reason: `stop-loss non-positive for ${side} @ ${entryPrice} (ATR too wide)` };
  }
  if (!Number.isFinite(takeProfit) || takeProfit <= 0) {
    return { ok: false, reason: `take-profit non-positive for ${side} @ ${entryPrice} (ATR too wide)` };
  }

  const setup: TradeSetup = {
    symbol,
    side,
    entryPrice,
    stopLoss,
    takeProfit,
    slDistance,
    tpDistance,
    rewardRisk: tpDistance / slDistance,
    atr,
  };

  // Defense in depth: re-validate the freshly built setup against the hard
  // limits before returning it. This should always pass by construction, but
  // if SETUP_PARAMS ever drift below RISK_LIMITS we fail closed instead of
  // emitting an illegal setup.
  const invalid = findSetupViolation(setup);
  if (invalid) return { ok: false, reason: invalid };

  return { ok: true, setup };
}

/**
 * Independent validation of a setup against the frozen hard limits.
 * Returns a reason string if the setup violates any invariant, else null.
 * Used both after building and again inside the risk engine.
 */
export function findSetupViolation(setup: TradeSetup): string | null {
  const { side, entryPrice, stopLoss, takeProfit, rewardRisk } = setup;

  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return "entry price must be finite and positive";
  if (!Number.isFinite(stopLoss) || stopLoss <= 0) return "stop-loss must be finite and positive";
  if (!Number.isFinite(takeProfit) || takeProfit <= 0) return "take-profit must be finite and positive";

  // Stop-loss is mandatory and must be on the correct side of entry.
  if (!RISK_LIMITS.requireStopLoss) return "stop-loss is required but disabled (illegal config)";
  if (side === "LONG" && stopLoss >= entryPrice) {
    return "LONG stop-loss must be below entry";
  }
  if (side === "SHORT" && stopLoss <= entryPrice) {
    return "SHORT stop-loss must be above entry";
  }
  // Take-profit must be on the correct side of entry too.
  if (side === "LONG" && takeProfit <= entryPrice) {
    return "LONG take-profit must be above entry";
  }
  if (side === "SHORT" && takeProfit >= entryPrice) {
    return "SHORT take-profit must be below entry";
  }

  if (!Number.isFinite(rewardRisk) || rewardRisk < RISK_LIMITS.minRewardRisk) {
    return `reward:risk ${rewardRisk.toFixed(3)} below minimum ${RISK_LIMITS.minRewardRisk}`;
  }
  return null;
}

/** Max seconds a position may stay open before it must be flattened. */
export function maxHoldSeconds(): number {
  return RISK_LIMITS.maxHoldMinutes * 60;
}
