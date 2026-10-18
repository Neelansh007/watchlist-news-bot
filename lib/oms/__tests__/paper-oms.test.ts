import { describe, expect, it } from "vitest";
import { PaperOMS } from "../paper-oms";
import { reconcile } from "../reconciliation";
import { COST_ASSUMPTIONS } from "@/lib/config/risk";
import type { SizedPosition } from "@/lib/trading/types";
import type { WatchlistSymbol } from "@/lib/config/watchlist";

const NOW = 1_700_000_000;
const SLIP = COST_ASSUMPTIONS.slippageRate; // 0.0003
const FEE = COST_ASSUMPTIONS.takerFeeRate; // 0.0005

function mkSized(over: Partial<SizedPosition> = {}): SizedPosition {
  const qty = over.qty ?? 1;
  const entryPrice = over.entryPrice ?? 100;
  const stopLoss = over.stopLoss ?? 97;
  const leverage = over.leverage ?? 3;
  const base: SizedPosition = {
    symbol: "BTC/USDT",
    side: "LONG",
    qty,
    entryPrice,
    stopLoss,
    takeProfit: 106,
    notional: qty * entryPrice,
    leverage,
    marginRequired: (qty * entryPrice) / leverage,
    riskAmount: Math.abs(entryPrice - stopLoss) * qty,
    rewardRisk: 2,
  };
  // Apply overrides last so symbol/side/etc. always win over the defaults.
  return { ...base, ...over };
}

function bc(symbol: WatchlistSymbol, o: number, h: number, l: number, c: number, startTime: number) {
  return { symbol, timeframe: "1m" as const, open: o, high: h, low: l, close: c, startTime, volume: 1 };
}

describe("PaperOMS — opening", () => {
  it("opens a position when the risk engine allows it", () => {
    const oms = new PaperOMS({ nowSeconds: NOW });
    const res = oms.openPosition(mkSized(), { "BTC/USDT": 100 }, NOW);
    expect(res.ok).toBe(true);
    expect(res.position?.status).toBe("OPEN");
    // LONG entry fill is worse (higher) by slippage.
    expect(res.position?.entryFillPrice).toBeCloseTo(100 * (1 + SLIP), 6);
    expect(oms.getOpenPositions()).toHaveLength(1);
    expect(reconcile(oms, { "BTC/USDT": 100 }).ok).toBe(true);
  });

  it("refuses an entry that breaches max leverage (no bypass path)", () => {
    const oms = new PaperOMS({ nowSeconds: NOW });
    const res = oms.openPosition(mkSized({ leverage: 5, marginRequired: 20 }), {}, NOW);
    expect(res.ok).toBe(false);
    expect(res.breaches?.some((b) => b.limit === "maxLeverage")).toBe(true);
    expect(oms.getOpenPositions()).toHaveLength(0);
    expect(oms.getJournal().some((j) => j.kind === "RISK_BLOCK")).toBe(true);
  });

  it("refuses an entry whose per-trade risk exceeds the budget", () => {
    const oms = new PaperOMS({ nowSeconds: NOW });
    const res = oms.openPosition(mkSized({ riskAmount: 9999 }), {}, NOW);
    expect(res.ok).toBe(false);
    expect(res.breaches?.some((b) => b.limit === "riskPerTradePct")).toBe(true);
  });

  it("enforces the max concurrent positions limit", () => {
    const oms = new PaperOMS({ nowSeconds: NOW });
    expect(oms.openPosition(mkSized({ symbol: "BTC/USDT" }), {}, NOW).ok).toBe(true);
    expect(oms.openPosition(mkSized({ symbol: "ETH/USDT" }), {}, NOW).ok).toBe(true);
    expect(oms.openPosition(mkSized({ symbol: "SOL/USDT" }), {}, NOW).ok).toBe(true);
    const fourth = oms.openPosition(mkSized({ symbol: "XRP/USDT" }), {}, NOW);
    expect(fourth.ok).toBe(false);
    expect(fourth.breaches?.some((b) => b.limit === "maxConcurrentPositions")).toBe(true);
  });
});

describe("PaperOMS — exits (forced scenarios)", () => {
  it("REAL SL HIT: closes a LONG at the stop with a net loss incl. fees", () => {
    const oms = new PaperOMS({ nowSeconds: NOW });
    const open = oms.openPosition(mkSized(), { "BTC/USDT": 100 }, NOW);
    const closed = oms.processCandle(bc("BTC/USDT", 99, 100, 96, 98, NOW + 60));
    expect(closed).toHaveLength(1);
    const p = closed[0];
    expect(p.closeReason).toBe("STOP_LOSS");
    expect(p.gapThroughStop).toBe(false);
    expect(p.exitFillPrice).toBeCloseTo(97 * (1 - SLIP), 6);
    expect(p.realizedPnl!).toBeLessThan(0);
    // equity == starting + realized once fully flat
    expect(oms.getPortfolioView({}).equity).toBeCloseTo(10_000 + p.realizedPnl!, 6);
    expect(open.ok).toBe(true);
  });

  it("REAL TP HIT: closes a LONG at the target with a net profit", () => {
    const oms = new PaperOMS({ nowSeconds: NOW });
    oms.openPosition(mkSized(), { "BTC/USDT": 100 }, NOW);
    const closed = oms.processCandle(bc("BTC/USDT", 104, 107, 103, 106.5, NOW + 60));
    expect(closed[0].closeReason).toBe("TAKE_PROFIT");
    expect(closed[0].exitFillPrice).toBeCloseTo(106 * (1 - SLIP), 6);
    expect(closed[0].realizedPnl!).toBeGreaterThan(0);
  });

  it("GAP-THROUGH-STOP (LONG): fills at the worse OPEN, loss bigger than a normal stop", () => {
    const oms = new PaperOMS({ nowSeconds: NOW });
    oms.openPosition(mkSized(), { "BTC/USDT": 100 }, NOW);
    const closed = oms.processCandle(bc("BTC/USDT", 90, 91, 89, 90, NOW + 60));
    expect(closed[0].closeReason).toBe("STOP_LOSS");
    expect(closed[0].gapThroughStop).toBe(true);
    expect(closed[0].rawExitPrice).toBe(90);
    expect(closed[0].exitFillPrice).toBeCloseTo(90 * (1 - SLIP), 6);
    expect(closed[0].realizedPnl!).toBeLessThan(-9);
  });

  it("GAP-THROUGH-STOP (SHORT): fills at the worse OPEN", () => {
    const oms = new PaperOMS({ nowSeconds: NOW });
    oms.openPosition(
      mkSized({ side: "SHORT", stopLoss: 103, takeProfit: 94, riskAmount: 3 }),
      { "BTC/USDT": 100 },
      NOW,
    );
    const closed = oms.processCandle(bc("BTC/USDT", 110, 112, 109, 111, NOW + 60));
    expect(closed[0].closeReason).toBe("STOP_LOSS");
    expect(closed[0].gapThroughStop).toBe(true);
    expect(closed[0].rawExitPrice).toBe(110);
    expect(closed[0].realizedPnl!).toBeLessThan(0);
  });

  it("SHORT stop-loss and take-profit are correct", () => {
    const omsSl = new PaperOMS({ nowSeconds: NOW });
    omsSl.openPosition(mkSized({ side: "SHORT", stopLoss: 103, takeProfit: 94 }), { "BTC/USDT": 100 }, NOW);
    const sl = omsSl.processCandle(bc("BTC/USDT", 101, 104, 100, 102, NOW + 60));
    expect(sl[0].closeReason).toBe("STOP_LOSS");
    expect(sl[0].exitFillPrice).toBeCloseTo(103 * (1 + SLIP), 6);
    expect(sl[0].realizedPnl!).toBeLessThan(0);

    const omsTp = new PaperOMS({ nowSeconds: NOW });
    omsTp.openPosition(mkSized({ side: "SHORT", stopLoss: 103, takeProfit: 94 }), { "BTC/USDT": 100 }, NOW);
    const tp = omsTp.processCandle(bc("BTC/USDT", 96, 97, 93, 94, NOW + 60));
    expect(tp[0].closeReason).toBe("TAKE_PROFIT");
    expect(tp[0].realizedPnl!).toBeGreaterThan(0);
  });

  it("MAX_HOLD: flattens at the close once the hold deadline passes", () => {
    const oms = new PaperOMS({ nowSeconds: NOW });
    oms.openPosition(mkSized(), { "BTC/USDT": 100 }, NOW);
    const deadline = NOW + 240 * 60;
    const closed = oms.processCandle(bc("BTC/USDT", 100, 101, 99, 100.5, deadline));
    expect(closed[0].closeReason).toBe("MAX_HOLD");
    expect(closed[0].exitFillPrice).toBeCloseTo(100.5 * (1 - SLIP), 6);
  });

  it("MANUAL close works", () => {
    const oms = new PaperOMS({ nowSeconds: NOW });
    const open = oms.openPosition(mkSized(), { "BTC/USDT": 100 }, NOW);
    const res = oms.manualClose(open.position!.id, 102, NOW + 30);
    expect(res.ok).toBe(true);
    expect(res.position?.closeReason).toBe("MANUAL");
    expect(res.position?.exitFillPrice).toBeCloseTo(102 * (1 - SLIP), 6);
  });

  it("a candle that touches neither level leaves the position open", () => {
    const oms = new PaperOMS({ nowSeconds: NOW });
    oms.openPosition(mkSized(), { "BTC/USDT": 100 }, NOW);
    const closed = oms.processCandle(bc("BTC/USDT", 100, 103, 99, 101, NOW + 60));
    expect(closed).toHaveLength(0);
    expect(oms.getOpenPositions()).toHaveLength(1);
  });
});

describe("PaperOMS — halts (forced scenarios)", () => {
  it("REAL DRAWDOWN: a big unrealized loss trips the total-drawdown halt", () => {
    const oms = new PaperOMS({ nowSeconds: NOW });
    oms.openPosition(mkSized({ qty: 16, riskAmount: 48, notional: 1600, marginRequired: 1600 / 3 }), {}, NOW);
    const view = oms.markToMarket({ "BTC/USDT": 30 }, NOW + 60);
    expect(view.drawdownHalted).toBe(true);
    expect(view.equity).toBeLessThan(10_000 * 0.9);
    expect(oms.getJournal().some((j) => j.kind === "HALT")).toBe(true);
  });

  it("RISK-LIMIT HALT: once drawdown-halted, new entries are refused", () => {
    const oms = new PaperOMS({ nowSeconds: NOW });
    oms.openPosition(mkSized({ qty: 16, riskAmount: 48, notional: 1600, marginRequired: 1600 / 3 }), {}, NOW);
    oms.markToMarket({ "BTC/USDT": 30 }, NOW + 60);
    const res = oms.openPosition(mkSized({ symbol: "ETH/USDT" }), {}, NOW + 120);
    expect(res.ok).toBe(false);
    expect(res.breaches?.some((b) => b.action === "HALT_ALL")).toBe(true);
  });

  it("daily-loss halt trips independently of drawdown and clears on UTC rollover", () => {
    const oms = new PaperOMS({ nowSeconds: NOW });
    oms.openPosition(mkSized({ qty: 16, riskAmount: 48, notional: 1600, marginRequired: 1600 / 3 }), {}, NOW);
    // ~3% loss: over the 2% daily limit, under the 10% drawdown limit
    const v1 = oms.markToMarket({ "BTC/USDT": 81 }, NOW + 60);
    expect(v1.dailyLossHalted).toBe(true);
    expect(v1.drawdownHalted).toBe(false);

    // Next UTC day, price recovered: the daily-loss halt clears.
    const nextDay = NOW + 86_400;
    const v2 = oms.markToMarket({ "BTC/USDT": 100 }, nextDay);
    expect(v2.dailyLossHalted).toBe(false);
  });

  it("a human can clear the drawdown halt", () => {
    const oms = new PaperOMS({ nowSeconds: NOW });
    oms.openPosition(mkSized({ qty: 16, riskAmount: 48, notional: 1600, marginRequired: 1600 / 3 }), {}, NOW);
    oms.markToMarket({ "BTC/USDT": 30 }, NOW + 60);
    expect(oms.getPortfolioView({ "BTC/USDT": 30 }).drawdownHalted).toBe(true);
    oms.resetDrawdownHalt(NOW + 120);
    expect(oms.getPortfolioView({ "BTC/USDT": 30 }).drawdownHalted).toBe(false);
  });
});

describe("PaperOMS — accounting", () => {
  it("equity equals starting + realized PnL once flat, and reconciles", () => {
    const oms = new PaperOMS({ nowSeconds: NOW });
    oms.openPosition(mkSized(), { "BTC/USDT": 100 }, NOW);
    oms.processCandle(bc("BTC/USDT", 104, 107, 103, 106.5, NOW + 60)); // TP
    const view = oms.getPortfolioView({});
    expect(view.openPositionCount).toBe(0);
    expect(view.equity).toBeCloseTo(10_000 + view.realizedPnl, 6);
    expect(reconcile(oms, {}).ok).toBe(true);
  });

  it("records an equity-curve point on every mark", () => {
    const oms = new PaperOMS({ nowSeconds: NOW });
    oms.openPosition(mkSized(), { "BTC/USDT": 100 }, NOW);
    oms.markToMarket({ "BTC/USDT": 101 }, NOW + 60);
    oms.markToMarket({ "BTC/USDT": 102 }, NOW + 120);
    expect(oms.getEquityCurve().length).toBeGreaterThanOrEqual(2);
  });

  it("fees reduce equity: entry fee is applied at open", () => {
    const oms = new PaperOMS({ nowSeconds: NOW });
    oms.openPosition(mkSized(), { "BTC/USDT": 100.03 }, NOW); // mark == entry fill -> uPnL 0
    const view = oms.getPortfolioView({ "BTC/USDT": 100.03 });
    const entryFee = 1 * (100 * (1 + SLIP)) * FEE;
    expect(view.equity).toBeCloseTo(10_000 - entryFee, 6);
  });
});
