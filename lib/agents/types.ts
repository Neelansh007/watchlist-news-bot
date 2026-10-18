import type { WatchlistSymbol } from "@/lib/config/watchlist";
import type { NewsItem } from "@/lib/news/types";

export type VoteDirection = "LONG" | "SHORT" | "NO_TRADE";

export interface AnalystVote {
  agent: string;
  symbol: WatchlistSymbol;
  vote: VoteDirection;
  /** 0..1 */
  confidence: number;
  reasoning: string;
  /**
   * true = this vote counts toward the directional majority.
   * The news agent is NEVER initiating: news alone must never trigger a trade.
   */
  initiating: boolean;
  /** Only the news agent: blocks any trade on this symbol this cycle. */
  veto?: boolean;
  /** Only the news agent: -1..1, adjusts consensus confidence. */
  sentimentScore?: number;
}

export interface AnalystAgent {
  readonly name: string;
  analyze(snapshot: MarketSnapshot): AnalystVote;
}

/** Pre-computed indicator values for one symbol. All guaranteed non-null when a snapshot exists. */
export interface SnapshotIndicators {
  close1h: number;
  ema20_1h: number;
  ema50_1h: number;
  close15m: number;
  rsi14_15m: number;
  macdHist15m: number;
  atr14_15m: number;
  /** ATR as a fraction of price. */
  atrPct15m: number;
  bbUpper15m: number;
  bbLower15m: number;
  /** (upper-lower)/middle */
  bbWidth15m: number;
  avgVolume15m: number;
  close5m: number;
  lastPrice: number;
  /** Always true in this build (derived from 1m candle close; no REST ticker on Mudrex). */
  priceSynthetic: boolean;
}

export interface MarketSnapshot {
  symbol: WatchlistSymbol;
  builtAt: number; // epoch seconds
  indicators: SnapshotIndicators;
  news: {
    available: boolean;
    degraded: boolean;
    items: NewsItem[];
    marketWide: NewsItem[];
  };
}

export type SnapshotOutcome =
  | { ok: true; snapshot: MarketSnapshot }
  | { ok: false; reason: string };

export interface ConsensusResult {
  symbol: WatchlistSymbol;
  decision: VoteDirection;
  confidence: number;
  votesFor: number;
  votesAgainst: number;
  votesTotal: number;
  reason: string;
}

export type ReviewDecision = "APPROVE" | "REJECT" | "FLAG_FOR_HUMAN_REVIEW";

export interface ReviewOutcome {
  decision: ReviewDecision;
  reasoning: string;
  model: string;
}
