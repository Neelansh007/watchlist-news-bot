/**
 * Trend analyst: 1h EMA20/EMA50 alignment plus price position.
 * Deterministic, rule-based (LLMs are used only for the independent review).
 */
import type { AnalystAgent, AnalystVote, MarketSnapshot, VoteDirection } from "../types";

export class TrendAnalyst implements AnalystAgent {
  readonly name = "trend";

  analyze(s: MarketSnapshot): AnalystVote {
    const { ema20_1h, ema50_1h, close1h } = s.indicators;
    const separation = Math.abs(ema20_1h - ema50_1h) / ema50_1h;
    let vote: VoteDirection = "NO_TRADE";
    if (ema20_1h > ema50_1h && close1h > ema20_1h) vote = "LONG";
    else if (ema20_1h < ema50_1h && close1h < ema20_1h) vote = "SHORT";

    const confidence =
      vote === "NO_TRADE"
        ? 0.2
        : Math.min(0.9, Math.max(0, 0.5 + separation * 20));

    return {
      agent: this.name,
      symbol: s.symbol,
      vote,
      confidence,
      reasoning:
        vote === "NO_TRADE"
          ? `No clean 1h trend alignment (ema20=${f(ema20_1h)}, ema50=${f(ema50_1h)}, close=${f(close1h)}).`
          : `1h trend aligned ${vote}: ema20=${f(ema20_1h)} ${vote === "LONG" ? ">" : "<"} ema50=${f(ema50_1h)}, close=${f(close1h)} confirms (separation ${(separation * 100).toFixed(2)}%).`,
      initiating: true,
    };
  }
}

function f(n: number): string {
  return n.toFixed(2);
}
