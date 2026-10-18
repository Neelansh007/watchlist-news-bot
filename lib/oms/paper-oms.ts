import { COST_ASSUMPTIONS, PAPER_DEFAULTS } from "@/lib/config/risk";
import type { WatchlistSymbol } from "@/lib/config/watchlist";
import type { Candle } from "@/lib/exchange/types";
import { evaluateEntry, deriveHaltState } from "@/lib/risk/engine";
import type { OpenPositionView, PortfolioState, RiskBreach } from "@/lib/risk/types";
import { maxHoldSeconds } from "@/lib/trading/setup";
import type { SizedPosition } from "@/lib/trading/types";
import {
  checkExit,
  applyEntrySlippage,
  applyExitSlippage,
  takerFee,
  grossPnl,
  realizedPnl,
  unrealizedPnl,
} from "./exit-fills";
import type { ExitReason, JournalEntry, PaperPosition, PortfolioView, EquityPoint } from "./types";

export type Marks = Partial<Record<WatchlistSymbol, number>>;

export interface OpenResult {
  ok: boolean;
  position?: PaperPosition;
  reason?: string;
  breaches?: RiskBreach[];
}

export interface CloseResult {
  ok: boolean;
  position?: PaperPosition;
  reason?: string;
}

export interface PaperOmsOptions {
  startingEquityUsdt?: number;
  takerFeeRate?: number;
  slippageRate?: number;
  /** Seconds in a UTC day, for the daily-loss anchor rollover. */
  nowSeconds?: number;
}

/**
 * Persisted runtime state used to rebuild an OMS between processes.
 * Cash and total realized PnL are DERIVED from the positions, so a corrupted
 * stored cash value can never be injected.
 */
export interface OmsRestoreState {
  startingEquityUsdt: number;
  positions: PaperPosition[];
  equityPeak: number;
  dayStartEquity: number;
  /** UTC day index (floor(epochSeconds / 86400)). */
  dayKey: number;
  dailyLossHalted: boolean;
  drawdownHalted: boolean;
}

const DAY_SECONDS = 86_400;

/**
 * In-memory paper order-management system. It is the SINGLE executor of trades:
 * every open runs the risk engine internally (no bypass path), and every close
 * applies the realistic exit-fill model plus fees/slippage. Portfolio accounting
 * is continuous: equity = cash + locked margin + unrealized PnL.
 */
export class PaperOMS {
  private cash: number;
  private readonly startingEquity: number;
  private readonly feeRate: number;
  private readonly slippage: number;
  private positions: PaperPosition[] = [];
  private journalEntries: JournalEntry[] = [];
  private equityCurve: EquityPoint[] = [];
  private nextId = 1;

  private equityPeak: number;
  private dayStartEquity: number;
  private dayKey: number;
  private dailyLossHalted = false;
  private drawdownHalted = false;
  private realizedPnlTotal = 0;

  constructor(opts: PaperOmsOptions = {}) {
    this.startingEquity = opts.startingEquityUsdt ?? PAPER_DEFAULTS.startingEquityUsdt;
    this.cash = this.startingEquity;
    this.feeRate = opts.takerFeeRate ?? COST_ASSUMPTIONS.takerFeeRate;
    this.slippage = opts.slippageRate ?? COST_ASSUMPTIONS.slippageRate;
    this.equityPeak = this.startingEquity;
    this.dayStartEquity = this.startingEquity;
    const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
    this.dayKey = Math.floor(now / DAY_SECONDS);
  }

  /**
   * Rebuild an OMS from persisted state. Cash and realized PnL are DERIVED
   * (never trusted from storage): each closed position contributes exactly its
   * realized PnL to cash, and each open position has already debited
   * margin + entry fee. This keeps the accounting identity intact across
   * process restarts.
   */
  static restore(state: OmsRestoreState): PaperOMS {
    const oms = new PaperOMS({
      startingEquityUsdt: state.startingEquityUsdt,
      nowSeconds: state.dayKey * DAY_SECONDS,
    });
    oms.positions = state.positions.map((p) => ({ ...p }));
    oms.nextId = oms.positions.reduce((m, p) => Math.max(m, p.id), 0) + 1;
    oms.realizedPnlTotal = oms.positions
      .filter((p) => p.status === "CLOSED")
      .reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
    const openDebits = oms.positions
      .filter((p) => p.status === "OPEN")
      .reduce((s, p) => s + p.margin + p.entryFee, 0);
    oms.cash = state.startingEquityUsdt + oms.realizedPnlTotal - openDebits;
    oms.equityPeak = Math.max(state.equityPeak, state.startingEquityUsdt);
    oms.dayStartEquity = state.dayStartEquity;
    oms.dayKey = state.dayKey;
    oms.dailyLossHalted = state.dailyLossHalted;
    oms.drawdownHalted = state.drawdownHalted;
    return oms;
  }

  /**
   * Replace an in-memory position id with the database id after an INSERT,
   * so later cycles update the same row instead of inserting a duplicate.
   */
  assignPersistedId(localId: number, dbId: number): void {
    const position = this.positions.find((p) => p.id === localId);
    if (position) position.id = dbId;
    if (dbId >= this.nextId) this.nextId = dbId + 1;
  }

  getStartingEquity(): number {
    return this.startingEquity;
  }

  // -- reads ---------------------------------------------------------------

  getOpenPositions(): PaperPosition[] {
    return this.positions.filter((p) => p.status === "OPEN");
  }

  getClosedPositions(): PaperPosition[] {
    return this.positions.filter((p) => p.status === "CLOSED");
  }

  getPosition(id: number): PaperPosition | undefined {
    return this.positions.find((p) => p.id === id);
  }

  getJournal(): JournalEntry[] {
    return [...this.journalEntries];
  }

  getEquityCurve(): EquityPoint[] {
    return [...this.equityCurve];
  }

  private lockedMargin(): number {
    return this.getOpenPositions().reduce((s, p) => s + p.margin, 0);
  }

  private totalUnrealized(marks: Marks): number {
    return this.getOpenPositions().reduce((s, p) => {
      const mark = marks[p.symbol] ?? p.entryFillPrice; // no mark -> flat (uPnL 0)
      return s + unrealizedPnl(p.side, p.qty, p.entryFillPrice, mark);
    }, 0);
  }

  computeEquity(marks: Marks): number {
    return this.cash + this.lockedMargin() + this.totalUnrealized(marks);
  }

  getPortfolioView(marks: Marks): PortfolioView {
    const open = this.getOpenPositions();
    return {
      equity: this.computeEquity(marks),
      cash: this.cash,
      lockedMargin: this.lockedMargin(),
      unrealizedPnl: this.totalUnrealized(marks),
      realizedPnl: this.realizedPnlTotal,
      openPositionCount: open.length,
      equityPeak: this.equityPeak,
      dayStartEquity: this.dayStartEquity,
      dailyLossHalted: this.dailyLossHalted,
      drawdownHalted: this.drawdownHalted,
    };
  }

  /** Bridge to the risk engine: a pure view of current state. */
  getRiskState(marks: Marks): PortfolioState {
    const openPositions: OpenPositionView[] = this.getOpenPositions().map((p) => ({
      symbol: p.symbol,
      side: p.side,
      qty: p.qty,
      entryPrice: p.entryFillPrice,
      notional: p.qty * p.entryFillPrice,
      leverage: p.leverage,
      unrealizedPnl: unrealizedPnl(p.side, p.qty, p.entryFillPrice, marks[p.symbol] ?? p.entryFillPrice),
    }));
    return {
      equity: this.computeEquity(marks),
      cashBalance: this.cash,
      dayStartEquity: this.dayStartEquity,
      equityPeak: this.equityPeak,
      dailyLossHalted: this.dailyLossHalted,
      drawdownHalted: this.drawdownHalted,
      openPositions,
    };
  }

  // -- writes --------------------------------------------------------------

  /**
   * Open a position. Runs the risk engine internally; if the entry is not
   * allowed it journals a RISK_BLOCK and refuses (no bypass path).
   */
  openPosition(sized: SizedPosition, marks: Marks, nowSeconds: number): OpenResult {
    const decision = evaluateEntry({ position: sized }, this.getRiskState(marks));
    if (!decision.allowed) {
      const reason = decision.breaches.map((b) => `${b.limit}: ${b.message}`).join(" | ");
      this.journal(nowSeconds, "RISK_BLOCK", sized.symbol, undefined, reason, {
        breaches: decision.breaches,
      });
      return { ok: false, reason, breaches: decision.breaches };
    }

    // Structural validation (defense in depth).
    if (!(sized.qty > 0) || !Number.isFinite(sized.entryPrice) || sized.entryPrice <= 0) {
      return { ok: false, reason: "invalid sized position (qty/entry)" };
    }
    if (!Number.isFinite(sized.stopLoss) || sized.stopLoss <= 0) {
      return { ok: false, reason: "stop-loss is mandatory" };
    }

    const entryFill = applyEntrySlippage(sized.side, sized.entryPrice, this.slippage);
    const entryFee = takerFee(sized.qty, entryFill, this.feeRate);
    const margin = sized.marginRequired;

    if (margin + entryFee > this.cash + 1e-9) {
      return { ok: false, reason: "insufficient cash for margin + entry fee" };
    }

    this.cash -= margin + entryFee;
    const position: PaperPosition = {
      id: this.nextId++,
      symbol: sized.symbol,
      side: sized.side,
      qty: sized.qty,
      leverage: sized.leverage,
      intendedEntryPrice: sized.entryPrice,
      entryFillPrice: entryFill,
      stopLoss: sized.stopLoss,
      takeProfit: sized.takeProfit,
      rewardRisk: sized.rewardRisk,
      margin,
      entryFee,
      openedAtSeconds: nowSeconds,
      maxHoldUntilSeconds: nowSeconds + maxHoldSeconds(),
      status: "OPEN",
    };
    this.positions.push(position);
    this.journal(nowSeconds, "POSITION_OPENED", position.symbol, position.id, 
      `${position.side} ${position.qty} @ ${entryFill.toFixed(4)} (SL ${position.stopLoss.toFixed(4)}, TP ${position.takeProfit.toFixed(4)})`,
      { leverage: position.leverage, margin, entryFee });
    return { ok: true, position };
  }

  /** Close an open position at a raw exit price; applies slippage + exit fee. */
  closePosition(
    id: number,
    params: { reason: ExitReason; rawExitPrice: number; nowSeconds: number; gapThroughStop?: boolean },
  ): CloseResult {
    const position = this.getPosition(id);
    if (!position || position.status !== "OPEN") {
      return { ok: false, reason: `no open position with id ${id}` };
    }
    const { reason, rawExitPrice, nowSeconds, gapThroughStop } = params;
    if (!Number.isFinite(rawExitPrice) || rawExitPrice <= 0) {
      return { ok: false, reason: `invalid exit price ${rawExitPrice}` };
    }

    const exitFill = applyExitSlippage(position.side, rawExitPrice, this.slippage);
    const exitFee = takerFee(position.qty, exitFill, this.feeRate);
    const gross = grossPnl(position.side, position.qty, position.entryFillPrice, exitFill);
    const rpnl = realizedPnl(
      position.side,
      position.qty,
      position.entryFillPrice,
      exitFill,
      position.entryFee,
      exitFee,
    );

    // Return locked margin and credit the P&L net of the exit fee
    // (the entry fee was already debited at open).
    this.cash += position.margin + gross - exitFee;
    this.realizedPnlTotal += rpnl;

    position.status = "CLOSED";
    position.closeReason = reason;
    position.rawExitPrice = rawExitPrice;
    position.exitFillPrice = exitFill;
    position.exitFee = exitFee;
    position.realizedPnl = rpnl;
    position.closedAtSeconds = nowSeconds;
    position.gapThroughStop = gapThroughStop ?? false;

    this.journal(nowSeconds, "POSITION_CLOSED", position.symbol, position.id,
      `${reason} ${position.side} ${position.qty} @ ${exitFill.toFixed(4)} -> realized ${rpnl.toFixed(4)} USDT`,
      { exitFee, gapThroughStop: position.gapThroughStop, realizedPnl: rpnl });
    return { ok: true, position };
  }

  /** Journal a pre-entry risk block. Purely informational; never executes. */
  noteRiskBlock(symbol: WatchlistSymbol, breaches: RiskBreach[], nowSeconds: number): void {
    this.journal(
      nowSeconds,
      "RISK_BLOCK",
      symbol,
      undefined,
      breaches.map((b) => `${b.limit}: ${b.message}`).join(" | "),
      { breaches },
    );
  }

  /** Manual close at an explicit price. */
  manualClose(id: number, price: number, nowSeconds: number): CloseResult {
    return this.closePosition(id, { reason: "MANUAL", rawExitPrice: price, nowSeconds });
  }

  /**
   * Process one candle: apply SL/TP/max-hold exits to every open position on
   * that symbol, then (by default) mark the survivors at the candle close and
   * refresh halts/equity curve. Pass `{ mark: false }` when driving several
   * symbols bar-by-bar and marking them all together once per timestamp.
   * Returns the positions closed by this candle.
   */
  processCandle(
    candle: Pick<Candle, "symbol" | "open" | "high" | "low" | "close" | "startTime">,
    opts: { mark?: boolean } = {},
  ): PaperPosition[] {
    const closed: PaperPosition[] = [];
    for (const p of this.getOpenPositions()) {
      if (p.symbol !== candle.symbol) continue;
      const exit = checkExit({
        side: p.side,
        stopLoss: p.stopLoss,
        takeProfit: p.takeProfit,
        candle,
        maxHoldUntilSeconds: p.maxHoldUntilSeconds,
      });
      if (exit.triggered && exit.reason && exit.rawExitPrice !== undefined) {
        const res = this.closePosition(p.id, {
          reason: exit.reason,
          rawExitPrice: exit.rawExitPrice,
          nowSeconds: candle.startTime,
          gapThroughStop: exit.gapThroughStop,
        });
        if (res.ok && res.position) closed.push(res.position);
      }
    }
    if (opts.mark !== false) {
      // Mark survivors to the candle close and refresh halts/equity curve.
      this.markToMarket({ [candle.symbol as WatchlistSymbol]: candle.close } as Marks, candle.startTime);
    }
    return closed;
  }

  /**
   * Mark all open positions to the given prices, roll the UTC day if needed,
   * update the equity peak, persist halt flags, and record an equity point.
   */
  markToMarket(marks: Marks, nowSeconds: number): PortfolioView {
    const equity = this.computeEquity(marks);
    const newDayKey = Math.floor(nowSeconds / DAY_SECONDS);
    if (newDayKey !== this.dayKey) {
      this.dayKey = newDayKey;
      this.dayStartEquity = equity;
      this.dailyLossHalted = false; // daily-loss halt clears at UTC rollover
      this.journal(nowSeconds, "INFO", undefined, undefined, `new UTC day; day-start equity ${equity.toFixed(2)}`);
    }
    if (equity > this.equityPeak) this.equityPeak = equity;

    const halt = deriveHaltState(this.getRiskState(marks));
    if (halt.dailyLossHalted && !this.dailyLossHalted) {
      this.journal(nowSeconds, "HALT", undefined, undefined, "daily-loss limit breached; new entries halted for the day");
    }
    if (halt.drawdownHalted && !this.drawdownHalted) {
      this.journal(nowSeconds, "HALT", undefined, undefined, "total-drawdown limit breached; ALL new entries halted (human reset required)");
    }
    this.dailyLossHalted = halt.dailyLossHalted;
    this.drawdownHalted = halt.drawdownHalted;

    this.equityCurve.push({ tsSeconds: nowSeconds, equity });
    return this.getPortfolioView(marks);
  }

  /** Flatten every open position at the provided per-symbol prices. */
  closeAll(marks: Marks, nowSeconds: number, reason: ExitReason = "MANUAL"): PaperPosition[] {
    const closed: PaperPosition[] = [];
    for (const p of this.getOpenPositions()) {
      const price = marks[p.symbol] ?? p.entryFillPrice;
      const res = this.closePosition(p.id, { reason, rawExitPrice: price, nowSeconds });
      if (res.ok && res.position) closed.push(res.position);
    }
    return closed;
  }

  /** A human clears the drawdown halt (the daily-loss halt clears on rollover). */
  resetDrawdownHalt(nowSeconds: number): void {
    this.drawdownHalted = false;
    this.journal(nowSeconds, "INFO", undefined, undefined, "drawdown halt manually cleared by human");
  }

  private journal(
    tsSeconds: number,
    kind: JournalEntry["kind"],
    symbol?: WatchlistSymbol,
    positionId?: number,
    message = "",
    payload?: Record<string, unknown>,
  ): void {
    this.journalEntries.push({ tsSeconds, kind, symbol, positionId, message, payload });
  }
}
