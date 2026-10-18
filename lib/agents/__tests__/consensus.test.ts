import { describe, expect, it } from "vitest";
import { evaluateConsensus } from "../consensus";
import { CONSENSUS_CONFIG } from "@/lib/config/consensus";
import type { AnalystVote } from "../types";

function vote(agent: string, v: AnalystVote["vote"], confidence: number, over: Partial<AnalystVote> = {}): AnalystVote {
  return { agent, symbol: "BTC/USDT", vote: v, confidence, reasoning: `${agent}: ${v}`, initiating: true, ...over };
}

function newsVote(score: number, over: Partial<AnalystVote> = {}): AnalystVote {
  return vote("news-sentiment", "NO_TRADE", 0.5, { initiating: false, sentimentScore: score, ...over });
}

const threeLong = [
  vote("trend", "LONG", 0.7),
  vote("momentum", "LONG", 0.7),
  vote("risk-of-ruin", "LONG", 0.7),
  vote("volatility-range", "NO_TRADE", 0.2),
];

describe("evaluateConsensus", () => {
  it("proposes LONG with 3/4 initiating votes and sufficient confidence", () => {
    const r = evaluateConsensus("BTC/USDT", [...threeLong, newsVote(0)]);
    expect(r.decision).toBe("LONG");
    expect(r.votesFor).toBe(3);
    expect(r.confidence).toBeCloseTo(0.7, 5);
  });

  it("requires the configured majority (2 votes is not enough)", () => {
    const votes = [
      vote("trend", "LONG", 0.9),
      vote("momentum", "LONG", 0.9),
      vote("volatility-range", "NO_TRADE", 0.2),
      vote("risk-of-ruin", "NO_TRADE", 0.2),
    ];
    expect(evaluateConsensus("BTC/USDT", votes).decision).toBe("NO_TRADE");
  });

  it("news votes NEVER count toward the majority (news cannot initiate)", () => {
    const votes = [
      vote("trend", "LONG", 0.9),
      vote("momentum", "LONG", 0.9),
      vote("volatility-range", "NO_TRADE", 0.2),
      vote("risk-of-ruin", "NO_TRADE", 0.2),
      // even a hypothetical initiating news vote is ignored: it is non-initiating
      newsVote(1),
    ];
    expect(evaluateConsensus("BTC/USDT", votes).decision).toBe("NO_TRADE");
  });

  it("positive news sentiment raises confidence; negative lowers it", () => {
    // Use 0.75 base confidence so that even after the -0.1 sentiment penalty
    // the result stays above minConfidence (0.6) — otherwise the decision
    // flips to NO_TRADE (confidence 0) and we'd test the wrong thing.
    const longs = [
      vote("trend", "LONG", 0.75),
      vote("momentum", "LONG", 0.75),
      vote("risk-of-ruin", "LONG", 0.75),
      vote("volatility-range", "NO_TRADE", 0.2),
    ];
    const up = evaluateConsensus("BTC/USDT", [...longs, newsVote(1)]);
    const down = evaluateConsensus("BTC/USDT", [...longs, newsVote(-1)]);
    expect(up.decision).toBe("LONG");
    expect(down.decision).toBe("LONG");
    expect(up.confidence).toBeCloseTo(0.75 + CONSENSUS_CONFIG.sentimentWeight, 5);
    expect(down.confidence).toBeCloseTo(0.75 - CONSENSUS_CONFIG.sentimentWeight, 5);
    expect(up.confidence).toBeGreaterThan(down.confidence);
  });

  it("news unavailability penalizes confidence and can block the trade", () => {
    const votes = [
      vote("trend", "LONG", 0.65),
      vote("momentum", "LONG", 0.65),
      vote("risk-of-ruin", "LONG", 0.65),
      vote("volatility-range", "NO_TRADE", 0.2),
    ];
    const withNews = evaluateConsensus("BTC/USDT", votes, CONSENSUS_CONFIG, true);
    const withoutNews = evaluateConsensus("BTC/USDT", votes, CONSENSUS_CONFIG, false);
    expect(withNews.decision).toBe("LONG");
    expect(withoutNews.decision).toBe("NO_TRADE");
    expect(withoutNews.reason).toMatch(/news unavailable/i);
  });

  it("a news veto blocks the trade regardless of votes", () => {
    const vetoed = [
      ...threeLong.map((v) => ({ ...v, confidence: 0.95 })),
      newsVote(-1, { veto: true, reasoning: "VETO — exchange hacked" }),
    ];
    const r = evaluateConsensus("BTC/USDT", vetoed);
    expect(r.decision).toBe("NO_TRADE");
    expect(r.reason).toMatch(/veto/i);
  });

  it("ties produce NO_TRADE", () => {
    const votes = [
      vote("trend", "LONG", 0.9),
      vote("momentum", "LONG", 0.9),
      vote("volatility-range", "SHORT", 0.9),
      vote("risk-of-ruin", "SHORT", 0.9),
    ];
    expect(evaluateConsensus("BTC/USDT", votes).decision).toBe("NO_TRADE");
  });

  it("rejects when average confidence is below the minimum", () => {
    const votes = [
      vote("trend", "LONG", 0.4),
      vote("momentum", "LONG", 0.4),
      vote("risk-of-ruin", "LONG", 0.4),
    ];
    const r = evaluateConsensus("BTC/USDT", votes);
    expect(r.decision).toBe("NO_TRADE");
    expect(r.reason).toMatch(/below minimum/i);
  });

  it("fails closed on empty or malformed votes", () => {
    expect(evaluateConsensus("BTC/USDT", []).decision).toBe("NO_TRADE");
    const malformed = [...threeLong, vote("bad", "LONG", 1.5)];
    expect(evaluateConsensus("BTC/USDT", malformed).decision).toBe("NO_TRADE");
    const nanVote = [...threeLong, vote("bad", "LONG", Number.NaN)];
    expect(evaluateConsensus("BTC/USDT", nanVote).decision).toBe("NO_TRADE");
  });
});
