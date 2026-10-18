import type { WatchlistSymbol } from "@/lib/config/watchlist";
import type {
  AnalystAgent,
  AnalystVote,
  ConsensusResult,
  MarketSnapshot,
  ReviewOutcome,
} from "@/lib/agents/types";
import type { TradeProposalForReview } from "@/lib/agents/review-agent";
import type { ExchangeProvider } from "@/lib/exchange/types";
import type { TickerSource } from "@/lib/market-data/ticker";
import type { NewsBundle } from "@/lib/news/types";
import type { Marks, PaperOMS } from "@/lib/oms/paper-oms";
import type { JournalEntry, PaperPosition, PortfolioView } from "@/lib/oms/types";
import type { RiskBreach } from "@/lib/risk/types";
import type { InstrumentConstraints, SizedPosition, TradeSetup } from "@/lib/trading/types";
import type { CycleStore } from "./store";

export type CycleMode = "paper-once" | "paper-autopilot" | "test";

export type CycleStatus = "OK" | "PARTIAL" | "ERROR";

/** Why one symbol did or did not trade in a cycle. */
export type SymbolStage =
  | "ALREADY_OPEN"
  | "NO_SNAPSHOT"
  | "NO_TRADE"
  | "SETUP_REJECTED"
  | "SIZE_REJECTED"
  | "RISK_BLOCKED"
  | "REVIEW_REJECTED"
  | "REVIEW_FLAGGED"
  | "OPENED"
  | "ERROR";

export interface SymbolOutcome {
  symbol: WatchlistSymbol;
  stage: SymbolStage;
  reason: string;
  snapshot?: MarketSnapshot;
  votes?: AnalystVote[];
  consensus?: ConsensusResult;
  review?: ReviewOutcome;
  setup?: TradeSetup;
  sized?: SizedPosition;
  riskBreaches?: RiskBreach[];
  /** Position id after DB assignment, when opened and persisted. */
  openedPositionId?: number;
}

export interface CycleResult {
  mode: CycleMode;
  cycleId: number | null;
  startedAtSeconds: number;
  finishedAtSeconds: number;
  status: CycleStatus;
  outcomes: SymbolOutcome[];
  /** Positions closed by SL/TP/max-hold during this cycle. */
  exits: PaperPosition[];
  portfolio: PortfolioView;
  journal: JournalEntry[];
  newsAvailable: boolean;
  newsDegraded: boolean;
  /** Newest closed 1m candle startTime that exit checks have consumed. */
  lastProcessedCandleTs: number | null;
  errors: string[];
}

export interface NewsServiceLike {
  fetchBundle(symbols?: readonly WatchlistSymbol[]): Promise<NewsBundle>;
}

export interface TradeReviewer {
  review(proposal: TradeProposalForReview): Promise<ReviewOutcome>;
}

export interface RunCycleConfig {
  mode: CycleMode;
  oms: PaperOMS;
  provider: ExchangeProvider;
  ticker: TickerSource;
  newsService: NewsServiceLike;
  reviewer: TradeReviewer;
  store?: CycleStore;
  /** Defaults to the fixed watchlist. */
  symbols?: readonly WatchlistSymbol[];
  /** Newest already-processed 1m candle startTime (from persisted settings). */
  lastProcessedCandleTs?: number | null;
  /** Injectable clock, epoch seconds. */
  nowSeconds?: () => number;
  /** Injectable analyst panel (tests). */
  panel?: AnalystAgent[];
}

export type { ExchangeProvider, InstrumentConstraints, Marks, PaperPosition, PortfolioView };
