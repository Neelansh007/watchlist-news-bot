/**
 * News / sentiment analyst.
 *
 * HARD RULES:
 *  - NEVER initiating: news alone can never create the directional majority.
 *    It only supplies a sentiment score (adjusts confidence) and a veto
 *    (major adverse event blocks the trade).
 *  - If news is unavailable, it says so with zero confidence — the consensus
 *    engine then applies its own penalty. Never crashes, never guesses.
 *  - Input titles are ALREADY sanitized upstream (lib/news); this agent only
 *    does keyword scoring, so hostile text is inert data here.
 */
import type { AnalystAgent, AnalystVote, MarketSnapshot } from "../types";
import type { NewsItem } from "@/lib/news/types";

const POSITIVE =
  /\b(rally|rallies|surge|surges|soar|soars|gains?|bullish|approval|approved|inflows?|record high|breakout|adoption|partnership|upgrade|accumulat\w*)\b/i;
const NEGATIVE =
  /\b(crash\w*|plunge\w*|dumps?|bearish|hacks?|hacked|exploits?|scams?|fraud|lawsuits?|sues|sued|bans?|banned|crackdown|outflows?|liquidat\w+|selloff|sell-off|fined|penalt\w+|delist\w*|insolven\w+|collaps\w+|ponzi|sec charges)\b/i;
/** Words that always trigger a veto regardless of score. */
const SEVERE_ADVERSE =
  /\b(hacks?|hacked|exploits?|exploited|delist\w*|insolven\w+|collaps\w+|ponzi|fraud|scams?|bans?|banned|sec charges)\b/i;

export interface SentimentTally {
  positive: number;
  negative: number;
  severe: boolean;
  severeHeadline: string | null;
}

export function tallySentiment(items: NewsItem[], marketWide: NewsItem[]): SentimentTally {
  let positive = 0;
  let negative = 0;
  let severe = false;
  let severeHeadline: string | null = null;

  const scan = (item: NewsItem, weight: number) => {
    if (POSITIVE.test(item.title)) positive += weight;
    if (NEGATIVE.test(item.title)) negative += weight;
    if (SEVERE_ADVERSE.test(item.title) && !severe) {
      severe = true;
      severeHeadline = item.title;
    }
  };
  for (const i of items) scan(i, 1);
  for (const i of marketWide) scan(i, 0.5); // macro news counts half per symbol

  return { positive, negative, severe, severeHeadline };
}

export class NewsSentimentAnalyst implements AnalystAgent {
  readonly name = "news-sentiment";

  analyze(s: MarketSnapshot): AnalystVote {
    const base = {
      agent: this.name,
      symbol: s.symbol,
      initiating: false, // news can never initiate a trade
    };

    if (!s.news.available) {
      return {
        ...base,
        vote: "NO_TRADE",
        confidence: 0,
        sentimentScore: 0,
        reasoning: "News unavailable this cycle — confidence must be reduced; no sentiment signal.",
      };
    }

    const tally = tallySentiment(s.news.items, s.news.marketWide);

    if (tally.severe) {
      return {
        ...base,
        vote: "NO_TRADE",
        confidence: 0.9,
        veto: true,
        sentimentScore: -1,
        reasoning: `VETO — major adverse event in headlines: "${tally.severeHeadline}"`,
      };
    }

    const total = tally.positive + tally.negative;
    const score = total === 0 ? 0 : (tally.positive - tally.negative) / total;
    const clamped = Math.max(-1, Math.min(1, score));

    return {
      ...base,
      vote: "NO_TRADE",
      confidence: total === 0 ? 0.1 : Math.min(0.8, 0.3 + Math.abs(clamped) * 0.5),
      sentimentScore: clamped,
      reasoning:
        total === 0
          ? "No symbol-relevant or macro headlines in the lookback window; neutral."
          : `Sentiment ${clamped > 0 ? "positive" : clamped < 0 ? "negative" : "neutral"} (${tally.positive} pos / ${tally.negative} neg headlines). Context only — cannot initiate a trade.`,
    };
  }
}
