import { RISK_LIMITS } from "@/lib/config/risk";
import { round12 } from "@/lib/trading/sizing";
import type {
  PortfolioState,
  ProposedEntry,
  RiskBreach,
  RiskDecision,
} from "./types";

/**
 * The risk engine is PURE and reads the frozen RISK_LIMITS constants directly.
 * There is no parameter, option, or code path that lets a caller loosen a limit
 * at runtime — the only inputs are the portfolio state and an already-sized
 * proposal. Every check returns a RiskBreach (or null) and is independently
 * tested. A breach never throws; it is reported so the caller can halt + log.
 */

/** Float tolerance so a value sitting exactly on a limit is not treated as over. */
const EPS = 1e-9;

// ---------------------------------------------------------------------------
// Portfolio-level checks (evaluated before/independently of any single trade)
// ---------------------------------------------------------------------------

/** True when the day's loss has reached/exceeded the daily-loss limit. */
export function isDailyLossBreached(state: PortfolioState): boolean {
  if (!Number.isFinite(state.dayStartEquity) || state.dayStartEquity <= 0) return true; // fail closed
  const limit = state.dayStartEquity * (RISK_LIMITS.maxDailyLossPct / 100);
  const loss = state.dayStartEquity - state.equity; // positive == losing
  return loss > limit + EPS;
}

/** True when peak-to-equity drawdown has reached/exceeded the total-drawdown limit. */
export function isDrawdownBreached(state: PortfolioState): boolean {
  if (!Number.isFinite(state.equityPeak) || state.equityPeak <= 0) return true; // fail closed
  const drawdownPct = ((state.equityPeak - state.equity) / state.equityPeak) * 100;
  return drawdownPct > RISK_LIMITS.maxTotalDrawdownPct + EPS;
}

export function checkHalted(state: PortfolioState): RiskBreach | null {
  if (state.drawdownHalted) {
    return {
      limit: "HALTED",
      action: "HALT_ALL",
      message: "new entries blocked: total-drawdown halt is active (requires human reset)",
    };
  }
  if (state.dailyLossHalted) {
    return {
      limit: "HALTED",
      action: "HALT_DAY",
      message: "new entries blocked: daily-loss halt is active for the rest of the UTC day",
    };
  }
  return null;
}

export function checkDailyLoss(state: PortfolioState): RiskBreach | null {
  if (!Number.isFinite(state.dayStartEquity) || state.dayStartEquity <= 0) {
    return {
      limit: "maxDailyLossPct",
      action: "HALT_DAY",
      message: "cannot verify daily loss: invalid day-start equity anchor (fail closed)",
    };
  }
  if (!isDailyLossBreached(state)) return null;
  const loss = round12(state.dayStartEquity - state.equity);
  const limit = round12(state.dayStartEquity * (RISK_LIMITS.maxDailyLossPct / 100));
  return {
    limit: "maxDailyLossPct",
    action: "HALT_DAY",
    message: `daily loss ${loss} USDT exceeds max ${limit} USDT (${RISK_LIMITS.maxDailyLossPct}% of day-start equity)`,
  };
}

export function checkTotalDrawdown(state: PortfolioState): RiskBreach | null {
  if (!Number.isFinite(state.equityPeak) || state.equityPeak <= 0) {
    return {
      limit: "maxTotalDrawdownPct",
      action: "HALT_ALL",
      message: "cannot verify drawdown: invalid equity-peak anchor (fail closed)",
    };
  }
  if (!isDrawdownBreached(state)) return null;
  const drawdownPct = ((state.equityPeak - state.equity) / state.equityPeak) * 100;
  return {
    limit: "maxTotalDrawdownPct",
    action: "HALT_ALL",
    message: `drawdown ${drawdownPct.toFixed(2)}% exceeds max ${RISK_LIMITS.maxTotalDrawdownPct}% of peak equity`,
  };
}

export function checkConcurrentPositions(state: PortfolioState): RiskBreach | null {
  if (state.openPositions.length >= RISK_LIMITS.maxConcurrentPositions) {
    return {
      limit: "maxConcurrentPositions",
      action: "BLOCK_ENTRY",
      message: `${state.openPositions.length} open positions already at max ${RISK_LIMITS.maxConcurrentPositions}`,
    };
  }
  return null;
}

/**
 * Portfolio-level health, independent of any specific proposal. The orchestrator
 * calls this to decide whether to consider entries at all and to persist halt
 * flags. Returns every active breach (does not short-circuit) for logging.
 */
export function evaluatePortfolioHealth(state: PortfolioState): RiskBreach[] {
  const breaches: RiskBreach[] = [];
  const halted = checkHalted(state);
  if (halted) breaches.push(halted);
  const daily = checkDailyLoss(state);
  if (daily) breaches.push(daily);
  const dd = checkTotalDrawdown(state);
  if (dd) breaches.push(dd);
  return breaches;
}

// ---------------------------------------------------------------------------
// Per-trade checks (evaluated against an already-sized proposal)
// ---------------------------------------------------------------------------

export function checkStopLoss(entry: ProposedEntry): RiskBreach | null {
  const p = entry.position;
  if (!RISK_LIMITS.requireStopLoss) {
    return {
      limit: "requireStopLoss",
      action: "BLOCK_ENTRY",
      message: "stop-loss is required but disabled in config (illegal state)",
    };
  }
  if (!Number.isFinite(p.stopLoss) || p.stopLoss <= 0) {
    return {
      limit: "requireStopLoss",
      action: "BLOCK_ENTRY",
      message: `missing/invalid stop-loss: ${p.stopLoss}`,
    };
  }
  const correctSide =
    p.side === "LONG" ? p.stopLoss < p.entryPrice : p.stopLoss > p.entryPrice;
  if (!correctSide) {
    return {
      limit: "requireStopLoss",
      action: "BLOCK_ENTRY",
      message: `stop-loss ${p.stopLoss} on wrong side of entry ${p.entryPrice} for ${p.side}`,
    };
  }
  return null;
}

export function checkRewardRisk(entry: ProposedEntry): RiskBreach | null {
  const rr = entry.position.rewardRisk;
  if (!Number.isFinite(rr) || rr < RISK_LIMITS.minRewardRisk - EPS) {
    return {
      limit: "minRewardRisk",
      action: "BLOCK_ENTRY",
      message: `reward:risk ${Number.isFinite(rr) ? rr.toFixed(3) : rr} below minimum ${RISK_LIMITS.minRewardRisk}`,
    };
  }
  return null;
}

export function checkLeverage(entry: ProposedEntry): RiskBreach | null {
  const lev = entry.position.leverage;
  if (!Number.isFinite(lev) || lev > RISK_LIMITS.maxLeverage) {
    return {
      limit: "maxLeverage",
      action: "BLOCK_ENTRY",
      message: `leverage ${lev} exceeds max ${RISK_LIMITS.maxLeverage}`,
    };
  }
  if (lev < 1) {
    return {
      limit: "maxLeverage",
      action: "BLOCK_ENTRY",
      message: `leverage ${lev} below 1 (invalid)`,
    };
  }
  return null;
}

export function checkRiskPerTrade(entry: ProposedEntry, state: PortfolioState): RiskBreach | null {
  if (!Number.isFinite(state.equity) || state.equity <= 0) {
    return {
      limit: "riskPerTradePct",
      action: "BLOCK_ENTRY",
      message: "cannot verify per-trade risk: invalid equity (fail closed)",
    };
  }
  const limit = state.equity * (RISK_LIMITS.riskPerTradePct / 100);
  const risk = entry.position.riskAmount;
  if (!Number.isFinite(risk) || risk > limit + EPS) {
    return {
      limit: "riskPerTradePct",
      action: "BLOCK_ENTRY",
      message: `per-trade risk ${round12(risk)} USDT exceeds max ${round12(limit)} USDT (${RISK_LIMITS.riskPerTradePct}% of equity)`,
    };
  }
  return null;
}

export function checkExposurePerSymbol(entry: ProposedEntry, state: PortfolioState): RiskBreach | null {
  if (!Number.isFinite(state.equity) || state.equity <= 0) {
    return {
      limit: "maxExposurePerSymbolPct",
      action: "BLOCK_ENTRY",
      message: "cannot verify exposure: invalid equity (fail closed)",
    };
  }
  const symbol = entry.position.symbol;
  const existing = state.openPositions
    .filter((p) => p.symbol === symbol)
    .reduce((sum, p) => sum + (Number.isFinite(p.notional) ? p.notional : 0), 0);
  const limit = state.equity * (RISK_LIMITS.maxExposurePerSymbolPct / 100);
  const projected = existing + entry.position.notional;
  if (projected > limit + EPS) {
    return {
      limit: "maxExposurePerSymbolPct",
      action: "BLOCK_ENTRY",
      message: `${symbol} exposure ${round12(projected)} USDT would exceed max ${round12(limit)} USDT (${RISK_LIMITS.maxExposurePerSymbolPct}% of equity)`,
    };
  }
  return null;
}

export function checkMargin(entry: ProposedEntry, state: PortfolioState): RiskBreach | null {
  const margin = entry.position.marginRequired;
  if (!Number.isFinite(margin) || margin > state.cashBalance + EPS) {
    return {
      limit: "MARGIN",
      action: "BLOCK_ENTRY",
      message: `margin required ${round12(margin)} USDT exceeds available cash ${round12(state.cashBalance)} USDT`,
    };
  }
  return null;
}

/**
 * Full pre-entry risk evaluation. Runs EVERY check (no short-circuit) so the
 * log captures all reasons, then allows the entry only if there are no breaches.
 * A halt or any hard-limit breach => allowed:false.
 */
export function evaluateEntry(entry: ProposedEntry, state: PortfolioState): RiskDecision {
  const breaches: RiskBreach[] = [];

  // Portfolio-level gates first.
  breaches.push(...evaluatePortfolioHealth(state));

  const concurrent = checkConcurrentPositions(state);
  if (concurrent) breaches.push(concurrent);

  // Per-trade gates.
  const checks: (RiskBreach | null)[] = [
    checkStopLoss(entry),
    checkRewardRisk(entry),
    checkLeverage(entry),
    checkRiskPerTrade(entry, state),
    checkExposurePerSymbol(entry, state),
    checkMargin(entry, state),
  ];
  for (const b of checks) if (b) breaches.push(b);

  return { allowed: breaches.length === 0, breaches };
}

/**
 * Derive the halt flags that SHOULD be persisted for the next cycle, given the
 * current state. Once a halt trips it stays tripped (the orchestrator persists
 * these; a human must clear drawdownHalted, dailyLossHalted clears at UTC rollover).
 */
export function deriveHaltState(state: PortfolioState): {
  dailyLossHalted: boolean;
  drawdownHalted: boolean;
} {
  return {
    dailyLossHalted: state.dailyLossHalted || isDailyLossBreached(state),
    drawdownHalted: state.drawdownHalted || isDrawdownBreached(state),
  };
}
