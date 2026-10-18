import { RISK_LIMITS } from "@/lib/config/risk";
import type { WatchlistSymbol } from "@/lib/config/watchlist";
import type { InstrumentConstraints, Side, SizedPosition, TradeSetup } from "./types";

export interface SizingInput {
  equity: number;
  /** Free cash available to post as margin. */
  cashBalance: number;
  /** Sum of notional already open on this symbol (for the per-symbol exposure cap). */
  existingSymbolNotional: number;
  instrument: InstrumentConstraints;
  setup: TradeSetup;
}

export type SizingOutcome =
  | { ok: true; position: SizedPosition }
  | { ok: false; reason: string };

/** Round a number down to the nearest multiple of `step`, cleaning float noise. */
export function roundDownToStep(qty: number, step: number): number {
  if (!Number.isFinite(qty) || !Number.isFinite(step) || step <= 0) return 0;
  const n = Math.floor(qty / step + 1e-9);
  return round12(n * step);
}

/** Round to 12 decimal places (matches the DB numeric(30,12) columns). */
export function round12(x: number): number {
  return Math.round(x * 1e12) / 1e12;
}

/**
 * Size a position so that the USDT lost if the stop is hit never exceeds
 * riskPerTradePct of equity, while also respecting the per-symbol exposure cap,
 * available margin at the chosen leverage, and the exchange's contract limits.
 *
 * The position is sized to the SMALLEST of the risk / exposure / margin caps,
 * then rounded DOWN to the quantity step. If the result cannot meet the
 * exchange minimums (min contract / min notional) we fail closed — we never
 * oversize to reach a minimum.
 */
export function sizePosition(input: SizingInput): SizingOutcome {
  const { equity, cashBalance, existingSymbolNotional, instrument, setup } = input;

  if (!Number.isFinite(equity) || equity <= 0) {
    return { ok: false, reason: `invalid equity: ${equity}` };
  }
  if (!Number.isFinite(cashBalance) || cashBalance < 0) {
    return { ok: false, reason: `invalid cash balance: ${cashBalance}` };
  }

  const perUnitRisk = Math.abs(setup.entryPrice - setup.stopLoss);
  if (!Number.isFinite(perUnitRisk) || perUnitRisk <= 0) {
    return { ok: false, reason: `invalid per-unit risk (entry==stop?): ${perUnitRisk}` };
  }

  // 1) Risk-per-trade cap.
  const riskBudget = equity * (RISK_LIMITS.riskPerTradePct / 100);
  const qtyByRisk = riskBudget / perUnitRisk;

  // 2) Per-symbol exposure cap (notional), net of what's already open.
  const exposureCapNotional =
    equity * (RISK_LIMITS.maxExposurePerSymbolPct / 100) - existingSymbolNotional;
  if (exposureCapNotional <= 0) {
    return { ok: false, reason: "per-symbol exposure cap already reached" };
  }
  const qtyByExposure = exposureCapNotional / setup.entryPrice;

  // 3) Leverage: the tighter of our config cap and the exchange cap. >= 1.
  const leverage = Math.max(
    1,
    Math.min(RISK_LIMITS.maxLeverage, Math.floor(instrument.maxLeverage)),
  );

  // 4) Margin cap: notional / leverage must fit in available cash.
  const qtyByMargin = (cashBalance * leverage) / setup.entryPrice;

  // 5) Exchange max contract.
  const rawQty = Math.min(
    qtyByRisk,
    qtyByExposure,
    qtyByMargin,
    instrument.maxContract,
  );
  if (!Number.isFinite(rawQty) || rawQty <= 0) {
    return { ok: false, reason: "computed quantity is non-positive (caps too tight)" };
  }

  const qty = roundDownToStep(rawQty, instrument.quantityStep);
  if (qty <= 0) {
    return { ok: false, reason: "quantity rounds to zero at the exchange step size" };
  }
  if (qty < instrument.minContract) {
    return {
      ok: false,
      reason: `quantity ${qty} below exchange min contract ${instrument.minContract}`,
    };
  }

  const notional = round12(qty * setup.entryPrice);
  if (notional < instrument.minNotional) {
    return {
      ok: false,
      reason: `notional ${notional} below exchange min notional ${instrument.minNotional}`,
    };
  }

  const marginRequired = round12(notional / leverage);
  if (marginRequired > cashBalance + 1e-9) {
    return {
      ok: false,
      reason: `margin required ${marginRequired} exceeds available cash ${cashBalance}`,
    };
  }

  const riskAmount = round12(perUnitRisk * qty);

  const position: SizedPosition = {
    symbol: setup.symbol as WatchlistSymbol,
    side: setup.side as Side,
    qty,
    entryPrice: setup.entryPrice,
    stopLoss: setup.stopLoss,
    takeProfit: setup.takeProfit,
    notional,
    leverage,
    marginRequired,
    riskAmount,
    rewardRisk: setup.rewardRisk,
  };
  return { ok: true, position };
}
