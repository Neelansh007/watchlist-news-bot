import type { WatchlistSymbol } from "@/lib/config/watchlist";
import type { AnalystVote, ConsensusResult, ReviewOutcome } from "@/lib/agents/types";
import type { NewsBundle } from "@/lib/news/types";
import type { JournalEntry, PaperPosition, PortfolioView } from "@/lib/oms/types";
import type { RiskBreach } from "@/lib/risk/types";
import type { PaperSettings } from "@/lib/persistence/mappers";

/**
 * Persistence boundary for a cycle. The orchestrator never imports Drizzle;
 * the concrete Postgres implementation lives in lib/persistence/cycle-store.ts.
 * Every method is best-effort: a store failure is recorded on the cycle, but
 * never blocks exit handling or risk checks.
 */
export interface CycleStore {
  beginCycle(mode: string, startedAt: Date): Promise<number | null>;
  finishCycle(
    cycleId: number | null,
    status: "OK" | "PARTIAL" | "ERROR",
    error?: string,
  ): Promise<void>;
  recordVotes(cycleId: number | null, votes: AnalystVote[]): Promise<void>;
  recordConsensus(cycleId: number | null, results: ConsensusResult[]): Promise<void>;
  recordReview(
    cycleId: number | null,
    symbol: WatchlistSymbol,
    outcome: ReviewOutcome,
  ): Promise<void>;
  recordRiskEvents(
    cycleId: number | null,
    symbol: WatchlistSymbol,
    breaches: RiskBreach[],
  ): Promise<void>;
  recordJournal(cycleId: number | null, entries: JournalEntry[]): Promise<void>;
  recordPortfolio(view: PortfolioView, at: Date): Promise<void>;
  recordNews(bundle: NewsBundle): Promise<void>;
  /** Returns the database id to adopt, or null when not persisted. */
  recordPositionOpened(position: PaperPosition, cycleId: number | null): Promise<number | null>;
  recordPositionUpdated(position: PaperPosition): Promise<void>;

  // -- process bootstrap ----------------------------------------------------
  loadPositions(): Promise<PaperPosition[]>;
  loadSettings(): Promise<PaperSettings | null>;
  saveSettings(settings: PaperSettings): Promise<void>;
}

/** No-op store used by tests and by the CLIs when Postgres is unavailable. */
export class NullCycleStore implements CycleStore {
  async beginCycle(): Promise<number | null> {
    return null;
  }
  async finishCycle(): Promise<void> {}
  async recordVotes(): Promise<void> {}
  async recordConsensus(): Promise<void> {}
  async recordReview(): Promise<void> {}
  async recordRiskEvents(): Promise<void> {}
  async recordJournal(): Promise<void> {}
  async recordPortfolio(): Promise<void> {}
  async recordNews(): Promise<void> {}
  async recordPositionOpened(): Promise<number | null> {
    return null;
  }
  async recordPositionUpdated(): Promise<void> {}
  async loadPositions(): Promise<PaperPosition[]> {
    return [];
  }
  async loadSettings(): Promise<PaperSettings | null> {
    return null;
  }
  async saveSettings(): Promise<void> {}
}

export const NULL_CYCLE_STORE = new NullCycleStore();
