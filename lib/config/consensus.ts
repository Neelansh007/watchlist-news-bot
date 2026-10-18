/**
 * Consensus configuration. Like risk limits, these are frozen constants —
 * runtime code and model output can never change them.
 */
export const CONSENSUS_CONFIG = {
  /** Directional votes required to propose a trade (out of 4 initiating analysts). */
  minVotesFor: 3,
  /** Minimum adjusted average confidence of the agreeing votes. */
  minConfidence: 0.6,
  /** How much the news sentiment score (-1..1) shifts confidence. */
  sentimentWeight: 0.1,
  /** Confidence penalty applied when news could not be fetched at all. */
  newsUnavailableConfidencePenalty: 0.15,
} as const;

export type ConsensusConfig = typeof CONSENSUS_CONFIG;
