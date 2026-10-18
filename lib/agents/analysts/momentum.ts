/**
 * Momentum analyst: 15m RSI(14) + MACD histogram.
 * Extremes (overbought/oversold) are treated as NO edge, not as fade signals —
 * fail closed rather than guess a reversal.
 */
import type { AnalystAgent, AnalystVote, MarketSnapshot, VoteDirection } from "../types";

export class MomentumAnalyst implements AnalystAgent {
  readonly name = "momentum";

  analyze(s: MarketSnapshot): AnalystVote {
    const { rsi14_15m, macdHist15m, atr14_15m } = s.indicators;
    let vote: VoteDirection = "NO_TRADE";
    let reason = "";

    if (rsi14_15m >= 75) {
      reason = `RSI ${rsi14_15m.toFixed(1)} overbought — chasing is negative-expectancy; stand aside.`;
    } else if (rsi14_15m <= 25) {
      reason = `RSI ${rsi14_15m.toFixed(1)} oversold — falling knife risk; stand aside.`;
    } else if (macdHist15m > 0 && rsi14_15m > 50) {
      vote = "LONG";
      reason = `Positive MACD histogram (${macdHist15m.toFixed(4)}) with RSI ${rsi14_15m.toFixed(1)} > 50.`;
    } else if (macdHist15m < 0 && rsi14_15m < 50) {
      vote = "SHORT";
      reason = `Negative MACD histogram (${macdHist15m.toFixed(4)}) with RSI ${rsi14_15m.toFixed(1)} < 50.`;
    } else {
      reason = `Momentum mixed (RSI ${rsi14_15m.toFixed(1)}, MACD hist ${macdHist15m.toFixed(4)}); no edge.`;
    }

    // Confidence scales with histogram magnitude relative to ATR (signal vs noise).
    const signalToNoise = atr14_15m > 0 ? Math.abs(macdHist15m) / atr14_15m : 0;
    const confidence =
      vote === "NO_TRADE" ? 0.2 : Math.min(0.9, Math.max(0.35, 0.4 + signalToNoise));

    return { agent: this.name, symbol: s.symbol, vote, confidence, reasoning: reason, initiating: true };
  }
}
