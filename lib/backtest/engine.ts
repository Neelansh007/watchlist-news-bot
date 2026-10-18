import { WATCHLIST, type WatchlistSymbol } from "@/lib/config/watchlist";
import { CONSENSUS_CONFIG } from "@/lib/config/consensus";
import { PAPER_DEFAULTS } from "@/lib/config/risk";
import type { Candle, Timeframe } from "@/lib/exchange/types";
import { TIMEFRAME_SECONDS } from "@/lib/exchange/providers/deterministic";
import { buildMarketSnapshot, createAnalystPanel, evaluateConsensus } from "@/lib/agents";
import { buildTradeSetup } from "@/lib/trading/setup";
import { sizePosition } from "@/lib/trading/sizing";
import type { InstrumentConstraints } from "@/lib/trading/types";
import { PaperOMS, type Marks } from "@/lib/oms/paper-oms";
import type { PaperPosition } from "@/lib/oms/types";
import type { NewsBundle } from "@/lib/news/types";
import { computeMetrics, perSymbolBreakdown, BACKTEST_DISCLAIMER } from "./metrics";
import { NoLookaheadProvider } from "./no-lookahead-provider";
import { BacktestTicker } from "./backtest-ticker";
import type { BacktestConfig, BacktestResult, BacktestTrade, DataMode } from "./types";

/** A news bundle that reports "unavailable" — the honest default for a backtest. */
export function unavailableNewsBundle(symbols: readonly WatchlistSymbol[], fetchedAt: number): NewsBundle {
  const bySymbol: Record<string, never[]> = {};
  for (const s of symbols) bySymbol[s] = [];
  return {
    available: false,
    degraded: false,
    errors: ["backtest: historical news not available"],
    fetchedAt,
    bySymbol,
    marketWide: [],
  };
}

async function deriveInstrumentConstraints(
  provider: BacktestConfig["provider"],
  symbols: readonly WatchlistSymbol[],
): Promise<Partial<Record<WatchlistSymbol, InstrumentConstraints>>> {
  const map: Partial<Record<WatchlistSymbol, InstrumentConstraints>> = {};
  let instruments;
  try {
    instruments = await provider.fetchInstruments();
  } catch {
    return map; // no constraints -> those symbols are skipped (fail closed)
  }
  for (const inst of instruments) {
    const sym = inst.canonicalSymbol;
    if (!sym || !symbols.includes(sym as WatchlistSymbol)) continue;
    const c: InstrumentConstraints = {
      minContract: inst.minContract,
      maxContract: inst.maxContract,
      quantityStep: inst.quantityStep,
      minNotional: inst.minNotionalValue,
      maxLeverage: inst.maxLeverage,
    };
    const valid = Object.values(c).every((v) => Number.isFinite(v) && v > 0);
    if (valid) map[sym as WatchlistSymbol] = c;
  }
  return map;
}

function toTrade(p: PaperPosition): BacktestTrade {
  const exitTime = p.closedAtSeconds ?? p.openedAtSeconds;
  return {
    symbol: p.symbol,
    side: p.side,
    entryTimeSeconds: p.openedAtSeconds,
    exitTimeSeconds: exitTime,
    entryPrice: p.entryFillPrice,
    exitPrice: p.exitFillPrice ?? p.entryFillPrice,
    qty: p.qty,
    leverage: p.leverage,
    realizedPnl: p.realizedPnl ?? 0,
    closeReason: p.closeReason ?? "MANUAL",
    gapThroughStop: p.gapThroughStop ?? false,
    holdMinutes: (exitTime - p.openedAtSeconds) / 60,
  };
}

/**
 * Walk-forward backtest. Steps bar-by-bar over the decision timeframe and, at
 * each bar CLOSE: (1) applies SL/TP/max-hold exits to open positions using that
 * bar's OHLC, (2) marks the portfolio, (3) runs the SAME live decision pipeline
 * (snapshot -> analysts -> consensus -> setup -> sizing -> risk -> OMS open) for
 * symbols with no open position. A position opened at bar close T is first
 * exit-checked at bar T+1, so there is no same-bar lookahead, and the
 * NoLookaheadProvider guarantees snapshots only ever see fully-closed bars.
 *
 * The Anthropic review gate is intentionally EXCLUDED (cost + non-determinism);
 * since it can only REJECT/FLAG, live trading is strictly more conservative than
 * this backtest. That caveat is in the disclaimer.
 */
export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const symbols = (config.symbols ?? WATCHLIST) as readonly WatchlistSymbol[];
  const tf: Timeframe = config.decisionTimeframe ?? "15m";
  const step = TIMEFRAME_SECONDS[tf];
  const startingEquity = config.startingEquityUsdt ?? PAPER_DEFAULTS.startingEquityUsdt;
  const segmentLabel = config.segmentLabel ?? "full";

  if (!(config.endSeconds > config.startSeconds)) {
    throw new Error("backtest end must be after start");
  }

  const provider = new NoLookaheadProvider(config.provider);
  const ticker = new BacktestTicker();
  const news = config.news ?? unavailableNewsBundle(symbols, config.startSeconds);
  const dataMode: DataMode = config.provider.kind === "mudrex" ? "real" : "synthetic";
  const instruments = config.instruments ?? (await deriveInstrumentConstraints(config.provider, symbols));

  const panel = createAnalystPanel();
  const oms = new PaperOMS({ startingEquityUsdt: startingEquity, nowSeconds: config.startSeconds });
  const rejections: BacktestResult["rejections"] = [];

  // Pre-index the decision-timeframe bars per symbol for O(1) exit lookups.
  const barMaps = new Map<WatchlistSymbol, Map<number, Candle>>();
  for (const s of symbols) {
    const bars = await config.provider.fetchCandles(s, tf, config.startSeconds - step, config.endSeconds);
    const m = new Map<number, Candle>();
    for (const b of bars) m.set(b.startTime, b);
    barMaps.set(s, m);
  }

  const firstT = Math.ceil(config.startSeconds / step) * step;
  for (let t = firstT; t + step <= config.endSeconds; t += step) {
    const tc = t + step; // decision time = this bar's close

    // 1) Exits against bar [t, tc) for every symbol (defer marking).
    const marks: Marks = {};
    for (const s of symbols) {
      const bar = barMaps.get(s)?.get(t);
      if (bar) marks[s] = bar.close;
    }
    for (const s of symbols) {
      const bar = barMaps.get(s)?.get(t);
      if (bar) oms.processCandle(bar, { mark: false });
    }
    // 2) Mark all survivors together and refresh halts/equity curve.
    oms.markToMarket(marks, tc);

    // 3) Decisions at tc for flat symbols.
    for (const s of symbols) {
      if (oms.getOpenPositions().some((p) => p.symbol === s)) continue;
      const bar = barMaps.get(s)?.get(t);
      const instr = instruments[s];
      if (!bar || !instr) continue;

      ticker.setPrice(s, bar.close, tc);
      const snap = await buildMarketSnapshot(s, { provider, ticker, news, nowSeconds: () => tc });
      if (!snap.ok) continue; // fail closed: no data -> no trade

      const votes = panel.map((a) => a.analyze(snap.snapshot));
      const consensus = evaluateConsensus(s, votes, CONSENSUS_CONFIG, news.available);
      if (consensus.decision === "NO_TRADE") continue;

      const ind = snap.snapshot.indicators;
      const setupOut = buildTradeSetup({
        symbol: s,
        side: consensus.decision,
        entryPrice: ind.lastPrice,
        atr: ind.atr14_15m,
      });
      if (!setupOut.ok) continue;

      const view = oms.getPortfolioView(marks);
      const existingSymbolNotional = oms
        .getOpenPositions()
        .filter((p) => p.symbol === s)
        .reduce((sum, p) => sum + p.qty * p.entryFillPrice, 0);
      const sizedOut = sizePosition({
        equity: view.equity,
        cashBalance: view.cash,
        existingSymbolNotional,
        instrument: instr,
        setup: setupOut.setup,
      });
      if (!sizedOut.ok) continue;

      const openRes = oms.openPosition(sizedOut.position, marks, tc);
      if (!openRes.ok) {
        rejections.push({ symbol: s, timeSeconds: tc, reason: openRes.reason ?? "blocked by risk engine" });
      }
    }
  }

  // Flatten anything still open at the last bar close so PnL is realized.
  const lastT = firstT + Math.floor((config.endSeconds - firstT) / step - 1) * step;
  const finalMarks: Marks = {};
  for (const s of symbols) {
    const bar = barMaps.get(s)?.get(lastT) ?? barMaps.get(s)?.get(lastT + step);
    if (bar) finalMarks[s] = bar.close;
  }
  if (oms.getOpenPositions().length > 0) {
    oms.closeAll(finalMarks, config.endSeconds, "MANUAL");
    oms.markToMarket(finalMarks, config.endSeconds);
  }

  const trades = oms.getClosedPositions().map(toTrade);
  const metrics = computeMetrics(trades, oms.getEquityCurve(), startingEquity);
  const perSymbol = perSymbolBreakdown(trades);

  return {
    segmentLabel,
    dataMode,
    decisionTimeframe: tf,
    startSeconds: config.startSeconds,
    endSeconds: config.endSeconds,
    startingEquity,
    metrics,
    perSymbol,
    trades,
    rejections,
    disclaimer: BACKTEST_DISCLAIMER,
  };
}
