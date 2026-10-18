/**
 * Volatility / range analyst: 15m Bollinger band state + ATR regime filter.
 * Only trades band breakouts inside a "normal" volatility regime; compressed
 * (no movement) or exploded (dangerous) regimes are NO_TRADE.
 */
import type { AnalystAgent, AnalystVote, MarketSnapshot, VoteDirection } from "../types";

/** Regime bounds for normalized Bollinger width (fraction of middle band). */
export const WIDTH_BOUNDS = { min: 0.004, max: 0.08 } as const;
/** ATR-per-bar fraction above which the regime is considered too wild to enter. */
export const MAX_ATR_PCT = 0.02;

export class VolatilityAnalyst implements AnalystAgent {
  readonly name = "volatility-range";

  analyze(s: MarketSnapshot): AnalystVote {
    const { bbWidth15m, bbUpper15m, bbLower15m, close15m, atrPct15m } = s.indicators;
    let vote: VoteDirection = "NO_TRADE";
    let confidence = 0.2;
    let reason: string;

    if (atrPct15m > MAX_ATR_PCT) {
      reason = `ATR ${(atrPct15m * 100).toFixed(2)}% of price per 15m bar exceeds ${MAX_ATR_PCT * 100}% — regime too volatile, stops would be noise.`;
    } else if (bbWidth15m < WIDTH_BOUNDS.min) {
      reason = `Bollinger width ${(bbWidth15m * 100).toFixed(3)}% below ${WIDTH_BOUNDS.min * 100}% — compressed range, no directional edge.`;
    } else if (bbWidth15m > WIDTH_BOUNDS.max) {
      reason = `Bollinger width ${(bbWidth15m * 100).toFixed(3)}% above ${WIDTH_BOUNDS.max * 100}% — range too wide, adverse-selection risk.`;
    } else if (close15m > bbUpper15m) {
      vote = "LONG";
      confidence = 0.55;
      reason = `15m close ${close15m.toFixed(2)} broke above upper band ${bbUpper15m.toFixed(2)} in a normal-volatility regime (width ${(bbWidth15m * 100).toFixed(2)}%).`;
    } else if (close15m < bbLower15m) {
      vote = "SHORT";
      confidence = 0.55;
      reason = `15m close ${close15m.toFixed(2)} broke below lower band ${bbLower15m.toFixed(2)} in a normal-volatility regime (width ${(bbWidth15m * 100).toFixed(2)}%).`;
    } else {
      reason = `Price inside bands (close ${close15m.toFixed(2)}, range ${bbLower15m.toFixed(2)}–${bbUpper15m.toFixed(2)}); no breakout.`;
    }

    return { agent: this.name, symbol: s.symbol, vote, confidence, reasoning: reason, initiating: true };
  }
}
