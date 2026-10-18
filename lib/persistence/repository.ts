/**
 * Postgres persistence for the paper bot. Every write is explicit and typed;
 * numeric columns are stored as decimal strings and converted at the boundary.
 *
 * Reads used by the API/dashboard return plain JSON-friendly numbers, so the
 * UI never has to deal with drizzle row internals.
 */
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { tables } from "@/lib/db";
import type {
  JournalEntry as PaperJournalEntry,
  PaperPosition,
  PortfolioView,
} from "@/lib/oms/types";
import type { AnalystVote, ConsensusResult, ReviewOutcome } from "@/lib/agents/types";
import type { RiskBreach } from "@/lib/risk/types";
import type { WatchlistSymbol } from "@/lib/config/watchlist";
import {
  PAPER_SETTINGS_KEY,
  fromNumeric,
  fromPositionRow,
  newsToRows,
  parsePaperSettings,
  toConsensusRow,
  toJournalRow,
  toPositionRow,
  toReviewRow,
  toRiskEventRow,
  toVoteRow,
  type PaperSettings,
  type PositionDbRow,
} from "./mappers";

// -- cycles -----------------------------------------------------------------

export async function createCycle(db: Db, mode: string, startedAt: Date): Promise<number> {
  const rows = await db
    .insert(tables.cycles)
    .values({ mode, startedAt, status: "RUNNING" })
    .returning({ id: tables.cycles.id });
  return rows[0].id;
}

export async function finishCycle(
  db: Db,
  id: number,
  status: "OK" | "ERROR" | "PARTIAL",
  error?: string,
): Promise<void> {
  await db
    .update(tables.cycles)
    .set({ finishedAt: new Date(), status, error: error ?? null })
    .where(eq(tables.cycles.id, id));
}

// -- decisions --------------------------------------------------------------

export async function insertVotes(db: Db, cycleId: number, votes: AnalystVote[]): Promise<void> {
  if (votes.length === 0) return;
  await db.insert(tables.analystVotes).values(votes.map((v) => toVoteRow(cycleId, v)));
}

export async function insertConsensus(
  db: Db,
  cycleId: number,
  results: ConsensusResult[],
): Promise<void> {
  if (results.length === 0) return;
  await db.insert(tables.consensusResults).values(results.map((c) => toConsensusRow(cycleId, c)));
}

export async function insertReview(
  db: Db,
  cycleId: number,
  symbol: WatchlistSymbol,
  outcome: ReviewOutcome,
): Promise<void> {
  await db.insert(tables.reviewDecisions).values(toReviewRow(cycleId, symbol, outcome));
}

export async function insertRiskEvents(
  db: Db,
  cycleId: number | null,
  symbol: WatchlistSymbol | null,
  breaches: RiskBreach[],
): Promise<void> {
  if (breaches.length === 0) return;
  await db.insert(tables.riskEvents).values(breaches.map((b) => toRiskEventRow(cycleId, symbol, b)));
}

// -- journal / snapshots ----------------------------------------------------

export async function insertJournal(db: Db, cycleId: number | null, entries: PaperJournalEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await db.insert(tables.journal).values(entries.map((e) => toJournalRow(e, cycleId)));
}

export async function insertPortfolioSnapshot(
  db: Db,
  view: PortfolioView,
  ts: Date,
): Promise<void> {
  await db.insert(tables.portfolioSnapshots).values({
    ts,
    equity: view.equity.toFixed(12),
    cashBalance: view.cash.toFixed(12),
    unrealizedPnl: view.unrealizedPnl.toFixed(12),
    openPositionCount: view.openPositionCount,
  });
}

export async function insertNews(db: Db, rows: ReturnType<typeof newsToRows>): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(tables.newsItems).values(rows).onConflictDoNothing({ target: tables.newsItems.link });
}

// -- positions --------------------------------------------------------------

export async function insertPosition(
  db: Db,
  position: PaperPosition,
  openedCycleId: number | null,
): Promise<number> {
  const rows = await db
    .insert(tables.positions)
    .values({ ...toPositionRow(position), openedCycleId })
    .returning({ id: tables.positions.id });
  return rows[0].id;
}

export async function updatePosition(db: Db, id: number, position: PaperPosition): Promise<void> {
  await db.update(tables.positions).set(toPositionRow(position)).where(eq(tables.positions.id, id));
}

export async function loadAllPositions(db: Db): Promise<PaperPosition[]> {
  const rows = await db.select().from(tables.positions).orderBy(tables.positions.id);
  return rows.map((r) => fromPositionRow(r as PositionDbRow));
}

// -- settings ---------------------------------------------------------------

export async function loadPaperSettings(db: Db): Promise<PaperSettings | null> {
  const rows = await db
    .select()
    .from(tables.settings)
    .where(eq(tables.settings.key, PAPER_SETTINGS_KEY))
    .limit(1);
  if (rows.length === 0) return null;
  return parsePaperSettings(rows[0].value);
}

export async function savePaperSettings(db: Db, settings: PaperSettings): Promise<void> {
  await db
    .insert(tables.settings)
    .values({ key: PAPER_SETTINGS_KEY, value: settings, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: tables.settings.key,
      set: { value: settings, updatedAt: new Date() },
    });
}

// -- dashboard / API reads --------------------------------------------------

export interface PortfolioSnapshotView {
  ts: string;
  equity: number;
  cashBalance: number;
  unrealizedPnl: number;
  openPositionCount: number;
}

export async function getLatestPortfolioSnapshot(db: Db): Promise<PortfolioSnapshotView | null> {
  const rows = await db
    .select()
    .from(tables.portfolioSnapshots)
    .orderBy(desc(tables.portfolioSnapshots.ts))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    ts: r.ts.toISOString(),
    equity: fromNumeric(r.equity) ?? 0,
    cashBalance: fromNumeric(r.cashBalance) ?? 0,
    unrealizedPnl: fromNumeric(r.unrealizedPnl) ?? 0,
    openPositionCount: r.openPositionCount,
  };
}

export interface PositionView {
  id: number;
  symbol: string;
  side: "LONG" | "SHORT";
  qty: number;
  leverage: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  margin: number;
  openedAt: string;
  maxHoldUntil: string;
  status: "OPEN" | "CLOSED";
  closeReason: string | null;
  exitPrice: number | null;
  realizedPnl: number | null;
  gapThroughStop: boolean;
  closedAt: string | null;
}

function toPositionView(row: PositionDbRow): PositionView {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    qty: fromNumeric(row.qty) ?? 0,
    leverage: row.leverage,
    entryPrice: fromNumeric(row.entryPrice) ?? 0,
    stopLoss: fromNumeric(row.stopLoss) ?? 0,
    takeProfit: fromNumeric(row.takeProfit) ?? 0,
    margin: fromNumeric(row.margin) ?? 0,
    openedAt: row.openedAt.toISOString(),
    maxHoldUntil: row.maxHoldUntil.toISOString(),
    status: row.status,
    closeReason: row.closeReason ?? null,
    exitPrice: fromNumeric(row.exitPrice),
    realizedPnl: fromNumeric(row.realizedPnl),
    gapThroughStop: row.gapThroughStop,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  };
}

export async function getOpenPositionViews(db: Db): Promise<PositionView[]> {
  const rows = await db
    .select()
    .from(tables.positions)
    .where(eq(tables.positions.status, "OPEN"))
    .orderBy(desc(tables.positions.openedAt));
  return rows.map((r) => toPositionView(r as PositionDbRow));
}

export async function getClosedPositionViews(db: Db, limit = 25): Promise<PositionView[]> {
  const rows = await db
    .select()
    .from(tables.positions)
    .where(eq(tables.positions.status, "CLOSED"))
    .orderBy(desc(tables.positions.closedAt))
    .limit(limit);
  return rows.map((r) => toPositionView(r as PositionDbRow));
}

export interface JournalView {
  id: number;
  ts: string;
  cycleId: number | null;
  symbol: string | null;
  kind: string;
  message: string;
}

export async function getJournalViews(db: Db, limit = 50): Promise<JournalView[]> {
  const rows = await db
    .select()
    .from(tables.journal)
    .orderBy(desc(tables.journal.ts))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts.toISOString(),
    cycleId: r.cycleId,
    symbol: r.symbol,
    kind: r.kind,
    message: r.message,
  }));
}

export async function getEquityCurve(db: Db, limit = 500): Promise<{ ts: string; equity: number }[]> {
  const rows = await db
    .select({ ts: tables.portfolioSnapshots.ts, equity: tables.portfolioSnapshots.equity })
    .from(tables.portfolioSnapshots)
    .orderBy(desc(tables.portfolioSnapshots.ts))
    .limit(limit);
  return rows
    .map((r) => ({ ts: r.ts.toISOString(), equity: fromNumeric(r.equity) ?? 0 }))
    .reverse();
}

export interface CycleView {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  mode: string;
  status: string;
  error: string | null;
}

export async function getRecentCycles(db: Db, limit = 10): Promise<CycleView[]> {
  const rows = await db.select().from(tables.cycles).orderBy(desc(tables.cycles.id)).limit(limit);
  return rows.map((r) => ({
    id: r.id,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    mode: r.mode,
    status: r.status,
    error: r.error,
  }));
}

export interface RiskEventView {
  id: number;
  createdAt: string;
  symbol: string | null;
  limit: string;
  action: string;
  message: string;
}

export async function getRecentRiskEvents(db: Db, limit = 20): Promise<RiskEventView[]> {
  const rows = await db
    .select()
    .from(tables.riskEvents)
    .orderBy(desc(tables.riskEvents.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    symbol: r.symbol,
    limit: r.limit,
    action: r.action,
    message: r.message,
  }));
}

export async function getRecentReviewViews(
  db: Db,
  limit = 20,
): Promise<{ id: number; createdAt: string; symbol: string; decision: string; model: string; reasoning: string | null }[]> {
  const rows = await db
    .select()
    .from(tables.reviewDecisions)
    .orderBy(desc(tables.reviewDecisions.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    symbol: r.symbol,
    decision: r.decision,
    model: r.model,
    reasoning: r.reasoning,
  }));
}

export { newsToRows };
