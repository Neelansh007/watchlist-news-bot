/**
 * Consensus engine.
 *
 * Rules (fail closed at every step):
 *  - No votes at all, or any malformed vote  -> NO_TRADE.
 *  - News veto present                      -> NO_TRADE (major adverse event).
 *  - Directional majority among INITIATING votes must reach minVotesFor and
 *    strictly beat the opposite side.
 *  - Average confidence of agreeing votes is adjusted by news sentiment
 *    (news can only raise/lower confidence, never initiate) and penalized
 *    when news is unavailable; result must reach minConfidence.
 *  - The review agent and the risk engine run AFTER this and can still block.
 */
import { CONSENSUS_CONFIG, type ConsensusConfig } from "@/lib/config/consensus";
import type { AnalystVote, ConsensusResult, VoteDirection } from "./types";
import type { WatchlistSymbol } from "@/lib/config/watchlist";

export function evaluateConsensus(
  symbol: WatchlistSymbol,
  votes: AnalystVote[],
  cfg: ConsensusConfig = CONSENSUS_CONFIG,
  newsAvailable = true,
): ConsensusResult {
  const noTrade = (reason: string, partial?: Partial<ConsensusResult>): ConsensusResult => ({
    symbol,
    decision: "NO_TRADE" as VoteDirection,
    confidence: 0,
    votesFor: 0,
    votesAgainst: 0,
    votesTotal: votes.length,
    reason,
    ...partial,
  });

  if (votes.length === 0) {
    return noTrade("No analyst votes received — fail closed.");
  }

  // Malformed vote anywhere -> fail closed for the whole symbol.
  for (const v of votes) {
    if (
      !["LONG", "SHORT", "NO_TRADE"].includes(v.vote) ||
      typeof v.confidence !== "number" ||
      !Number.isFinite(v.confidence) ||
      v.confidence < 0 ||
      v.confidence > 1 ||
      (v.initiating === undefined && v.veto === undefined)
    ) {
      return noTrade(`Malformed vote from analyst "${v.agent}" — fail closed.`);
    }
  }

  const veto = votes.find((v) => v.veto);
  if (veto) {
    return noTrade(`Blocked by news veto (${veto.agent}): ${veto.reasoning}`);
  }

  const initiating = votes.filter((v) => v.initiating);
  const longs = initiating.filter((v) => v.vote === "LONG");
  const shorts = initiating.filter((v) => v.vote === "SHORT");
  const side: VoteDirection = longs.length > shorts.length ? "LONG" : longs.length < shorts.length ? "SHORT" : "NO_TRADE";
  const agreeing = side === "LONG" ? longs : shorts;

  if (side === "NO_TRADE" || agreeing.length < cfg.minVotesFor) {
    return noTrade(
      `No directional majority: LONG=${longs.length}, SHORT=${shorts.length}, required ${cfg.minVotesFor} agreeing votes.`,
      { votesFor: agreeing.length, votesAgainst: side === "LONG" ? shorts.length : longs.length },
    );
  }

  const avgConf =
    agreeing.reduce((sum, v) => sum + v.confidence, 0) / agreeing.length;

  const newsVote = votes.find((v) => v.sentimentScore !== undefined);
  const sentimentScore = newsVote?.sentimentScore ?? 0;

  let confidence = avgConf + sentimentScore * cfg.sentimentWeight;
  const adjustments: string[] = [`avg vote confidence ${avgConf.toFixed(3)}`];
  if (sentimentScore !== 0) {
    adjustments.push(`news sentiment ${sentimentScore > 0 ? "+" : ""}${sentimentScore.toFixed(2)} (${(sentimentScore * cfg.sentimentWeight).toFixed(3)})`);
  }
  if (!newsAvailable) {
    confidence -= cfg.newsUnavailableConfidencePenalty;
    adjustments.push(`news unavailable (-${cfg.newsUnavailableConfidencePenalty})`);
  }
  confidence = Math.max(0, Math.min(1, confidence));

  if (confidence < cfg.minConfidence) {
    return noTrade(
      `Confidence ${confidence.toFixed(3)} below minimum ${cfg.minConfidence} [${adjustments.join("; ")}].`,
      { votesFor: agreeing.length, votesAgainst: side === "LONG" ? shorts.length : longs.length },
    );
  }

  return {
    symbol,
    decision: side,
    confidence,
    votesFor: agreeing.length,
    votesAgainst: side === "LONG" ? shorts.length : longs.length,
    votesTotal: votes.length,
    reason: `${side} consensus: ${agreeing.length}/${initiating.length} initiating votes [${adjustments.join("; ")}].`,
  };
}
