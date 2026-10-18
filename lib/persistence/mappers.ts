/**
 * Pure mapping between domain objects and database rows.
 *
 * All numeric columns are stored as fixed-precision decimal strings (never
 * floats in the DB). Reads convert back to numbers for the domain. Invalid
 * numeric input throws instead of writing garbage.
 */
import { z } from "zod";
import type { PaperPosition, JournalEntry } from "@/lib/oms/types";
import type { AnalystVote, ConsensusResult, ReviewOutcome } from "@/lib/agents/types";
import type { RiskBreach } from "@/lib/risk/types";
import type { NewsBundle } from "@/lib/news/types";
import type { WatchlistSymbol } from "@/lib/config/watchlist";

export const PAPER_SETTINGS_KEY = "paper_oms_state";

/** Round-trip-safe decimal string for numeric(30,12) columns. */
export function toNumeric(x: number): string {
  if (!Number.isFinite(x)) throw new Error(`cannot persist non-finite number: ${x}`);
  return x.toFixed(12);
}

export function fromNumeric(x: string | null | undefined): number | null {
  if (x === null || x === undefined || x.trim() === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/** Numeric column that must be present. Corrupt data is a hard error. */
export function requireNumeric(x: string | null | undefined, field: string): number {
  const n = fromNumeric(x);
  if (n === null) throw new Error(`corrupt numeric column "${field}"`);
  return n;
}

export interface PositionRowInput {
  symbol: string;
  side: "LONG" | "SHORT";
  qty: string;
  leverage: number;
  intendedEntryPrice: string;
  entryPrice: string;
  stopLoss: string;
  takeProfit: string;
  rewardRisk: string;
  margin: string;
  entryFee: string;
  openedAt: Date;
  maxHoldUntil: Date;
  status: "OPEN" | "CLOSED";
  closeReason: PaperPosition["closeReason"] | null;
  rawExitPrice: string | null;
  exitPrice: string | null;
  exitFee: string | null;
  realizedPnl: string | null;
  gapThroughStop: boolean;
  closedAt: Date | null;
}

export function toPositionRow(p: PaperPosition): PositionRowInput {
  return {
    symbol: p.symbol,
    side: p.side,
    qty: toNumeric(p.qty),
    leverage: p.leverage,
    intendedEntryPrice: toNumeric(p.intendedEntryPrice),
    entryPrice: toNumeric(p.entryFillPrice),
    stopLoss: toNumeric(p.stopLoss),
    takeProfit: toNumeric(p.takeProfit),
    rewardRisk: toNumeric(p.rewardRisk),
    margin: toNumeric(p.margin),
    entryFee: toNumeric(p.entryFee),
    openedAt: new Date(p.openedAtSeconds * 1000),
    maxHoldUntil: new Date(p.maxHoldUntilSeconds * 1000),
    status: p.status,
    closeReason: p.closeReason ?? null,
    rawExitPrice: p.rawExitPrice !== undefined ? toNumeric(p.rawExitPrice) : null,
    exitPrice: p.exitFillPrice !== undefined ? toNumeric(p.exitFillPrice) : null,
    exitFee: p.exitFee !== undefined ? toNumeric(p.exitFee) : null,
    realizedPnl: p.realizedPnl !== undefined ? toNumeric(p.realizedPnl) : null,
    gapThroughStop: p.gapThroughStop ?? false,
    closedAt: p.closedAtSeconds !== undefined ? new Date(p.closedAtSeconds * 1000) : null,
  };
}

export interface PositionDbRow {
  id: number;
  symbol: string;
  side: "LONG" | "SHORT";
  qty: string;
  leverage: number;
  intendedEntryPrice: string;
  entryPrice: string;
  stopLoss: string;
  takeProfit: string;
  rewardRisk: string;
  margin: string;
  entryFee: string;
  openedAt: Date;
  maxHoldUntil: Date;
  status: "OPEN" | "CLOSED";
  closeReason: PaperPosition["closeReason"] | null;
  rawExitPrice: string | null;
  exitPrice: string | null;
  exitFee: string | null;
  realizedPnl: string | null;
  gapThroughStop: boolean;
  closedAt: Date | null;
}

export function fromPositionRow(row: PositionDbRow): PaperPosition {
  const position: PaperPosition = {
    id: row.id,
    symbol: row.symbol as WatchlistSymbol,
    side: row.side,
    qty: requireNumeric(row.qty, "qty"),
    leverage: row.leverage,
    intendedEntryPrice: requireNumeric(row.intendedEntryPrice, "intended_entry_price"),
    entryFillPrice: requireNumeric(row.entryPrice, "entry_price"),
    stopLoss: requireNumeric(row.stopLoss, "stop_loss"),
    takeProfit: requireNumeric(row.takeProfit, "take_profit"),
    rewardRisk: requireNumeric(row.rewardRisk, "reward_risk"),
    margin: requireNumeric(row.margin, "margin"),
    entryFee: requireNumeric(row.entryFee, "entry_fee"),
    openedAtSeconds: Math.floor(row.openedAt.getTime() / 1000),
    maxHoldUntilSeconds: Math.floor(row.maxHoldUntil.getTime() / 1000),
    status: row.status,
  };
  if (row.closeReason) position.closeReason = row.closeReason;
  const rawExit = fromNumeric(row.rawExitPrice);
  if (rawExit !== null) position.rawExitPrice = rawExit;
  const exitFill = fromNumeric(row.exitPrice);
  if (exitFill !== null) position.exitFillPrice = exitFill;
  const exitFee = fromNumeric(row.exitFee);
  if (exitFee !== null) position.exitFee = exitFee;
  const realized = fromNumeric(row.realizedPnl);
  if (realized !== null) position.realizedPnl = realized;
  position.gapThroughStop = row.gapThroughStop;
  if (row.closedAt) position.closedAtSeconds = Math.floor(row.closedAt.getTime() / 1000);
  return position;
}

/** Persisted OMS runtime settings (daily anchors, halts, exit cursor). */
export const paperSettingsSchema = z.object({
  startingEquityUsdt: z.number().finite().positive(),
  equityPeak: z.number().finite().positive(),
  dayStartEquity: z.number().finite().positive(),
  dayKey: z.number().int().nonnegative(),
  dailyLossHalted: z.boolean(),
  drawdownHalted: z.boolean(),
  lastProcessedCandleTs: z.number().int().nullable(),
});
export type PaperSettings = z.infer<typeof paperSettingsSchema>;

export function parsePaperSettings(value: unknown): PaperSettings {
  return paperSettingsSchema.parse(value);
}

export function toVoteRow(cycleId: number, v: AnalystVote) {
  return {
    cycleId,
    agent: v.agent,
    symbol: v.symbol,
    vote: v.vote,
    confidence: v.confidence,
    reasoning: v.reasoning,
    initiating: v.initiating,
    veto: v.veto ?? false,
    sentimentScore: v.sentimentScore ?? null,
  };
}

export function toConsensusRow(cycleId: number, c: ConsensusResult) {
  return {
    cycleId,
    symbol: c.symbol,
    decision: c.decision,
    confidence: c.confidence,
    votesFor: c.votesFor,
    votesAgainst: c.votesAgainst,
    votesTotal: c.votesTotal,
    reason: c.reason,
  };
}

export function toReviewRow(cycleId: number, symbol: WatchlistSymbol, outcome: ReviewOutcome) {
  return {
    cycleId,
    symbol,
    decision: outcome.decision,
    model: outcome.model,
    reasoning: outcome.reasoning,
  };
}

export function toRiskEventRow(cycleId: number | null, symbol: WatchlistSymbol | null, breach: RiskBreach) {
  return {
    cycleId,
    symbol,
    limit: breach.limit,
    action: breach.action,
    message: breach.message,
  };
}

export function toJournalRow(entry: JournalEntry, cycleId: number | null) {
  return {
    ts: new Date(entry.tsSeconds * 1000),
    cycleId,
    symbol: entry.symbol ?? null,
    kind: entry.kind,
    message: entry.message,
    payload: entry.payload ?? null,
  };
}

/** Flatten a news bundle into news_items rows (per-symbol + market-wide). */
export function newsToRows(bundle: NewsBundle) {
  const rows: {
    symbol: string;
    title: string;
    link: string;
    source: string;
    publishedAt: Date | null;
  }[] = [];
  const seen = new Set<string>();
  const push = (symbol: string, item: NewsBundle["marketWide"][number]) => {
    if (seen.has(item.link)) return;
    seen.add(item.link);
    rows.push({
      symbol,
      title: item.title,
      link: item.link,
      source: item.source,
      publishedAt: item.publishedAt !== null ? new Date(item.publishedAt * 1000) : null,
    });
  };
  for (const [symbol, items] of Object.entries(bundle.bySymbol)) {
    for (const item of items) push(symbol, item);
  }
  for (const item of bundle.marketWide) push("MARKET_WIDE", item);
  return rows;
}
