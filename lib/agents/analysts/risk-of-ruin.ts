/**
 * Risk-of-ruin analyst: refuses setups where the noise level or liquidity
 * makes stops unreliable, otherwise supports the higher-timeframe direction
 * with modest confidence. Deterministic rules only.
 */
import type { AnalystAgent, AnalystVote, MarketSnapshot, VoteDirection } from "../types";

/** 15m ATR fraction above which stop distance becomes ruinous vs the risk budget. */
export const MAX_NOISE_PCT = 0.015;
/** Minimum average 15m base-volume; below this, slippage assumptions are fantasy. */
export const MIN_AVG_VOLUME = 1;

export class RiskOfRuinAnalyst implements AnalystAgent {
  readonly name = "risk-of-ruin";

  analyze(s: MarketSnapshot): AnalystVote {
    const { atrPct15m, avgVolume15m, ema20_1h, ema50_1h } = s.indicators;
    let vote: VoteDirection = "NO_TRADE";
    let confidence = 0.2;
    let reason: string;

    if (avgVolume15m < MIN_AVG_VOLUME) {
      reason = `Average 15m volume ${avgVolume15m.toFixed(3)} below ${MIN_AVG_VOLUME} — too illiquid; exits could not be trusted.`;
    } else if (atrPct15m > MAX_NOISE_PCT) {
      reason = `Noise ${(atrPct15m * 100).toFixed(2)}% per 15m bar exceeds ${MAX_NOISE_PCT * 100}% — stop would sit inside the noise band (ruin risk).`;
    } else {
      const separation = Math.abs(ema20_1h - ema50_1h) / ema50_1h;
      if (ema20_1h > ema50_1h) vote = "LONG";
      else if (ema20_1h < ema50_1h) vote = "SHORT";
      confidence = vote === "NO_TRADE" ? 0.2 : Math.min(0.75, 0.45 + separation * 10);
      reason =
        vote === "NO_TRADE"
          ? "No higher-timeframe direction to lean on."
          : `Survivable setup: noise ${(atrPct15m * 100).toFixed(2)}%/bar, volume ${avgVolume15m.toFixed(2)}; leans with 1h trend (${vote}).`;
    }

    return { agent: this.name, symbol: s.symbol, vote, confidence, reasoning: reason, initiating: true };
  }
}
