/**
 * Drizzle-backed implementation of the orchestrator's CycleStore.
 * Lives outside lib/orchestrator so the cycle logic stays storage-agnostic.
 */
import type { Db } from "@/lib/db";
import type { CycleStore } from "@/lib/orchestrator/store";
import type { AnalystVote, ConsensusResult, ReviewOutcome } from "@/lib/agents/types";
import type { WatchlistSymbol } from "@/lib/config/watchlist";
import type { NewsBundle } from "@/lib/news/types";
import type { JournalEntry, PaperPosition, PortfolioView } from "@/lib/oms/types";
import type { RiskBreach } from "@/lib/risk/types";
import type { PaperSettings } from "./mappers";
import {
  createCycle,
  finishCycle,
  insertConsensus,
  insertJournal,
  insertNews,
  insertPortfolioSnapshot,
  insertPosition,
  insertReview,
  insertRiskEvents,
  insertVotes,
  loadAllPositions,
  loadPaperSettings,
  savePaperSettings,
  updatePosition,
  newsToRows,
} from "./repository";

export class PostgresCycleStore implements CycleStore {
  constructor(private readonly db: Db) {}

  async beginCycle(mode: string, startedAt: Date): Promise<number | null> {
    return createCycle(this.db, mode, startedAt);
  }

  async finishCycle(
    cycleId: number | null,
    status: "OK" | "PARTIAL" | "ERROR",
    error?: string,
  ): Promise<void> {
    if (cycleId === null) return;
    await finishCycle(this.db, cycleId, status, error);
  }

  async recordVotes(cycleId: number | null, votes: AnalystVote[]): Promise<void> {
    if (cycleId === null) return;
    await insertVotes(this.db, cycleId, votes);
  }

  async recordConsensus(cycleId: number | null, results: ConsensusResult[]): Promise<void> {
    if (cycleId === null) return;
    await insertConsensus(this.db, cycleId, results);
  }

  async recordReview(
    cycleId: number | null,
    symbol: WatchlistSymbol,
    outcome: ReviewOutcome,
  ): Promise<void> {
    if (cycleId === null) return;
    await insertReview(this.db, cycleId, symbol, outcome);
  }

  async recordRiskEvents(
    cycleId: number | null,
    symbol: WatchlistSymbol,
    breaches: RiskBreach[],
  ): Promise<void> {
    if (cycleId === null) return;
    await insertRiskEvents(this.db, cycleId, symbol, breaches);
  }

  async recordJournal(cycleId: number | null, entries: JournalEntry[]): Promise<void> {
    await insertJournal(this.db, cycleId, entries);
  }

  async recordPortfolio(view: PortfolioView, at: Date): Promise<void> {
    await insertPortfolioSnapshot(this.db, view, at);
  }

  async recordNews(bundle: NewsBundle): Promise<void> {
    await insertNews(this.db, newsToRows(bundle));
  }

  async recordPositionOpened(
    position: PaperPosition,
    cycleId: number | null,
  ): Promise<number | null> {
    return insertPosition(this.db, position, cycleId);
  }

  async recordPositionUpdated(position: PaperPosition): Promise<void> {
    await updatePosition(this.db, position.id, position);
  }

  async loadPositions(): Promise<PaperPosition[]> {
    return loadAllPositions(this.db);
  }

  async loadSettings(): Promise<PaperSettings | null> {
    return loadPaperSettings(this.db);
  }

  async saveSettings(settings: PaperSettings): Promise<void> {
    await savePaperSettings(this.db, settings);
  }
}
