import type { EquityPoint } from "@/lib/oms/types";
import type { WatchlistSymbol } from "@/lib/config/watchlist";
import type { BacktestMetrics, BacktestTrade, SymbolBreakdown } from "./types";

export const BACKTEST_DISCLAIMER =
  "BACKTESTS DO NOT GUARANTEE LIVE PROFIT. This is a historical simulation using modeled " +
  "fees/slippage and conservative fill assumptions (gap-through-stop fills at the open; " +
  "stop assumed first when a bar touches both stop and target). It excludes the live " +
  "Anthropic review gate, so live behavior is strictly more conservative. Results on " +
  "SYNTHETIC data validate plumbing only and say NOTHING about real strategy edge. " +
  "Past performance is not indicative of future results.";

/** Max peak-to-trough drawdown over an equity sequence. */
export function maxDrawdown(points: number[]): { abs: number; pct: number } {
  let peak = -Infinity;
  let maxAbs = 0;
  let maxPct = 0;
  for (const v of points) {
    if (!Number.isFinite(v)) continue;
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxAbs) maxAbs = dd;
    const pct = peak > 0 ? (dd / peak) * 100 : 0;
    if (pct > maxPct) maxPct = pct;
  }
  return { abs: maxAbs, pct: maxPct };
}

function profitFactorOf(grossProfit: number, grossLoss: number): number {
  if (grossLoss > 0) return grossProfit / grossLoss;
  return grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;
}

/**
 * Compute headline metrics from closed trades plus the marked equity curve.
 * Drawdown is taken from the equity curve (includes unrealized PnL), which is
 * the honest measure of what the account experienced.
 */
export function computeMetrics(
  trades: BacktestTrade[],
  equityCurve: EquityPoint[],
  startingEquity: number,
): BacktestMetrics {
  const tradeCount = trades.length;
  const wins = trades.filter((t) => t.realizedPnl > 0).length;
  const losses = trades.filter((t) => t.realizedPnl <= 0).length;
  const grossProfit = trades.reduce((s, t) => s + (t.realizedPnl > 0 ? t.realizedPnl : 0), 0);
  const grossLoss = Math.abs(trades.reduce((s, t) => s + (t.realizedPnl < 0 ? t.realizedPnl : 0), 0));
  const netPnl = trades.reduce((s, t) => s + t.realizedPnl, 0);

  const curve = equityCurve.length > 0 ? equityCurve.map((p) => p.equity) : [startingEquity];
  const finalEquity = curve[curve.length - 1];
  const dd = maxDrawdown([startingEquity, ...curve]);

  return {
    tradeCount,
    wins,
    losses,
    winRate: tradeCount > 0 ? wins / tradeCount : 0,
    grossProfit,
    grossLoss,
    profitFactor: profitFactorOf(grossProfit, grossLoss),
    expectancy: tradeCount > 0 ? netPnl / tradeCount : 0,
    netPnl,
    maxDrawdownAbs: dd.abs,
    maxDrawdownPct: dd.pct,
    finalEquity,
    returnPct: startingEquity > 0 ? ((finalEquity - startingEquity) / startingEquity) * 100 : 0,
  };
}

/** Per-symbol breakdown. Drawdown here is from cumulative realized PnL (per symbol). */
export function perSymbolBreakdown(trades: BacktestTrade[]): SymbolBreakdown[] {
  const bySymbol = new Map<WatchlistSymbol, BacktestTrade[]>();
  for (const t of trades) {
    const arr = bySymbol.get(t.symbol) ?? [];
    arr.push(t);
    bySymbol.set(t.symbol, arr);
  }
  const out: SymbolBreakdown[] = [];
  for (const [symbol, list] of bySymbol) {
    const sorted = [...list].sort((a, b) => a.exitTimeSeconds - b.exitTimeSeconds);
    const grossProfit = sorted.reduce((s, t) => s + (t.realizedPnl > 0 ? t.realizedPnl : 0), 0);
    const grossLoss = Math.abs(sorted.reduce((s, t) => s + (t.realizedPnl < 0 ? t.realizedPnl : 0), 0));
    const netPnl = sorted.reduce((s, t) => s + t.realizedPnl, 0);
    const wins = sorted.filter((t) => t.realizedPnl > 0).length;
    // cumulative realized-PnL walk for a per-symbol drawdown
    let cum = 0;
    const cumSeries: number[] = [0];
    for (const t of sorted) {
      cum += t.realizedPnl;
      cumSeries.push(cum);
    }
    const dd = maxDrawdown(cumSeries);
    out.push({
      symbol,
      tradeCount: sorted.length,
      winRate: sorted.length > 0 ? wins / sorted.length : 0,
      netPnl,
      profitFactor: profitFactorOf(grossProfit, grossLoss),
      expectancy: sorted.length > 0 ? netPnl / sorted.length : 0,
      maxDrawdownAbs: dd.abs,
    });
  }
  return out.sort((a, b) => b.netPnl - a.netPnl);
}
