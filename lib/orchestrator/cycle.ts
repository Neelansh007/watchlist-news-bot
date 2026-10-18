/**
 * One paper-trading decision cycle.
 *
 * Order of operations (each phase fails closed, never guesses):
 *   1. Fetch news (soft-fail: agents get a confidence penalty).
 *   2. Exit phase: replay closed 1m candles since the persisted cursor through
 *      the paper OMS so SL/TP/max-hold are applied before any new risk.
 *   3. Mark the portfolio (day rollover, halt flags, equity point).
 *   4. Per-symbol decisions for symbols with no open position:
 *      snapshot -> analysts -> consensus -> setup -> sizing -> risk pre-check
 *      -> independent review -> OMS open (the OMS re-runs the risk engine).
 *   5. Persist the audit trail (votes, consensus, reviews, risk events,
 *      journal, portfolio snapshot) through the injected store.
 *
 * If exit data cannot be verified, NEW ENTRIES ARE SKIPPED for that cycle.
 * The cursor is not advanced, so the window is retried by the next cycle.
 */
import { CONSENSUS_CONFIG } from "@/lib/config/consensus";
import { ORCHESTRATOR } from "@/lib/config/orchestrator";
import { WATCHLIST, type WatchlistSymbol } from "@/lib/config/watchlist";
import { buildMarketSnapshot, createAnalystPanel, evaluateConsensus } from "@/lib/agents";
import type {
  AnalystAgent,
  AnalystVote,
  ConsensusResult,
  ReviewOutcome,
} from "@/lib/agents/types";
import type { TradeProposalForReview } from "@/lib/agents/review-agent";
import type { Candle, ExchangeProvider, Timeframe } from "@/lib/exchange/types";
import { validateCandleOHLC } from "@/lib/market-data/candle-validation";
import type { NewsBundle } from "@/lib/news/types";
import type { Marks } from "@/lib/oms/paper-oms";
import type { PaperPosition } from "@/lib/oms/types";
import { evaluateEntry } from "@/lib/risk/engine";
import type { RiskBreach } from "@/lib/risk/types";
import { buildTradeSetup } from "@/lib/trading/setup";
import { sizePosition } from "@/lib/trading/sizing";
import type { InstrumentConstraints } from "@/lib/trading/types";
import { NULL_CYCLE_STORE, type CycleStore } from "./store";
import type {
  CycleResult,
  CycleStatus,
  NewsServiceLike,
  RunCycleConfig,
  SymbolOutcome,
} from "./types";

const EXIT_TF: Timeframe = ORCHESTRATOR.exitCheckTimeframe;
const MINUTE = 60;

interface AuditBuffers {
  votes: AnalystVote[];
  consensus: ConsensusResult[];
  reviews: { symbol: WatchlistSymbol; outcome: ReviewOutcome }[];
  riskEvents: { symbol: WatchlistSymbol; breaches: RiskBreach[] }[];
}

interface ExitPhaseResult {
  marks: Marks;
  closed: PaperPosition[];
  cursor: number | null;
  ok: boolean;
}

export async function runCycle(cfg: RunCycleConfig): Promise<CycleResult> {
  const store: CycleStore = cfg.store ?? NULL_CYCLE_STORE;
  const symbols = (cfg.symbols ?? WATCHLIST) as readonly WatchlistSymbol[];
  const panel = cfg.panel ?? createAnalystPanel();
  const now = cfg.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
  const journalStart = cfg.oms.getJournal().length;
  const errors: string[] = [];
  const outcomes: SymbolOutcome[] = [];
  const audit: AuditBuffers = { votes: [], consensus: [], reviews: [], riskEvents: [] };
  let exits: PaperPosition[] = [];
  let marks: Marks = {};
  let lastProcessed = normalizeCursor(cfg.lastProcessedCandleTs);
  let status: CycleStatus = "OK";
  let cycleId: number | null = null;

  try {
    cycleId = await store.beginCycle(cfg.mode, new Date(now * 1000));
  } catch (err) {
    errors.push(`Could not record cycle start: ${errMessage(err)}`);
  }

  const news = await fetchNews(cfg.newsService, symbols, now, errors);
  await safeStore(errors, "news", () => store.recordNews(news));

  try {
    // ---- 1. exits --------------------------------------------------------
    const exitPhase = await processExits(cfg, now, lastProcessed, errors);
    exits = exitPhase.closed;
    marks = exitPhase.marks;
    lastProcessed = exitPhase.cursor;
    for (const closed of exits) {
      await safeStore(errors, `close position ${closed.id}`, () =>
        store.recordPositionUpdated(closed),
      );
    }

    // Refresh halts / day anchor / equity curve before considering new risk.
    cfg.oms.markToMarket(marks, now);

    // ---- 2. decisions ----------------------------------------------------
    let entriesAllowed = exitPhase.ok;
    let instruments: Partial<Record<WatchlistSymbol, InstrumentConstraints>> = {};
    if (entriesAllowed) {
      try {
        instruments = await loadInstrumentConstraints(cfg.provider, symbols);
      } catch (err) {
        entriesAllowed = false;
        errors.push(`Instrument constraints unavailable: ${errMessage(err)}`);
      }
    }

    if (!entriesAllowed) {
      errors.push(
        "New entries skipped this cycle: exit data or instrument constraints could not be verified (fail closed).",
      );
    } else {
      let openedThisCycle = 0;
      for (const symbol of symbols) {
        if (cfg.oms.getOpenPositions().some((p) => p.symbol === symbol)) {
          outcomes.push({
            symbol,
            stage: "ALREADY_OPEN",
            reason: "Already holding a position on this symbol; one per symbol.",
          });
          continue;
        }
        try {
          const outcome = await decideSymbol({
            symbol,
            cfg,
            panel,
            news,
            instruments,
            marks,
            now,
            store,
            cycleId,
            audit,
            errors,
          });
          outcomes.push(outcome);
          if (outcome.stage === "OPENED") openedThisCycle++;
        } catch (err) {
          const reason = `Unhandled error while deciding ${symbol}: ${errMessage(err)}`;
          errors.push(reason);
          outcomes.push({ symbol, stage: "ERROR", reason });
        }
      }
      if (openedThisCycle > 0) cfg.oms.markToMarket(marks, now);
    }
  } catch (err) {
    errors.push(`Cycle failed unexpectedly: ${errMessage(err)}`);
    status = "ERROR";
  }

  // ---- 3. persist the audit trail ---------------------------------------
  await safeStore(errors, "analyst votes", () => store.recordVotes(cycleId, audit.votes));
  await safeStore(errors, "consensus results", () =>
    store.recordConsensus(cycleId, audit.consensus),
  );
  for (const review of audit.reviews) {
    await safeStore(errors, `review ${review.symbol}`, () =>
      store.recordReview(cycleId, review.symbol, review.outcome),
    );
  }
  for (const event of audit.riskEvents) {
    await safeStore(errors, `risk event ${event.symbol}`, () =>
      store.recordRiskEvents(cycleId, event.symbol, event.breaches),
    );
  }

  const journal = cfg.oms.getJournal().slice(journalStart);
  if (errors.length > 0) {
    journal.push({
      tsSeconds: now,
      kind: "INFO",
      message: `Cycle issues: ${errors.slice(0, 5).join(" | ")}`,
    });
  }
  await safeStore(errors, "journal", () => store.recordJournal(cycleId, journal));

  const portfolio = cfg.oms.getPortfolioView(marks);
  await safeStore(errors, "portfolio snapshot", () =>
    store.recordPortfolio(portfolio, new Date(now * 1000)),
  );

  if (status !== "ERROR" && errors.length > 0) status = "PARTIAL";

  await safeStore(errors, "cycle finish", () =>
    store.finishCycle(
      cycleId,
      status,
      errors.length > 0 ? errors.join(" | ").slice(0, 4000) : undefined,
    ),
  );

  return {
    mode: cfg.mode,
    cycleId,
    startedAtSeconds: now,
    finishedAtSeconds: now,
    status,
    outcomes,
    exits,
    portfolio,
    journal,
    newsAvailable: news.available,
    newsDegraded: news.degraded,
    lastProcessedCandleTs: lastProcessed,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Exits
// ---------------------------------------------------------------------------

async function processExits(
  cfg: RunCycleConfig,
  now: number,
  cursorIn: number | null,
  errors: string[],
): Promise<ExitPhaseResult> {
  const endClosed = Math.floor(now / MINUTE) * MINUTE - MINUTE;
  const openSymbols = [
    ...new Set(cfg.oms.getOpenPositions().map((p) => p.symbol)),
  ];
  let cursor = cursorIn;
  if (cursor === null) {
    cursor = endClosed - MINUTE;
    if (openSymbols.length > 0) {
      errors.push(
        "No persisted exit cursor: only the newest closed 1m candle is checked this cycle.",
      );
    }
  }
  const initialCursor = cursor;

  let start = cursor + MINUTE;
  const capStart = endClosed - ORCHESTRATOR.maxCatchUpMinutes * MINUTE + MINUTE;
  if (start < capStart) {
    errors.push(
      `Exit catch-up capped at ${ORCHESTRATOR.maxCatchUpMinutes} minutes; older 1m bars were not replayed.`,
    );
    start = capStart;
  }

  const marks: Marks = {};
  const closed: PaperPosition[] = [];
  if (openSymbols.length === 0) {
    return { marks, closed, cursor: Math.max(cursor, endClosed), ok: true };
  }

  let ok = true;
  let advanced = cursor;
  for (const symbol of openSymbols) {
    try {
      const from = Math.min(start, endClosed);
      const raw = await cfg.provider.fetchCandles(symbol, EXIT_TF, from, endClosed);
      const bars = sanitizeExitCandles(raw, symbol, from, endClosed, errors);
      if (bars.length === 0) {
        ok = false;
        errors.push(
          `No valid 1m candles for ${symbol} in ${from}..${endClosed}; exit checks incomplete (will retry).`,
        );
        continue;
      }
      const newest = bars[bars.length - 1];
      marks[symbol] = newest.close;
      if (newest.startTime < endClosed) {
        errors.push(
          `Newest 1m candle for ${symbol} is ${endClosed - newest.startTime}s behind the expected close; stop checks may be delayed.`,
        );
      }
      for (let i = 1; i < bars.length; i++) {
        if (bars[i].startTime - bars[i - 1].startTime > MINUTE) {
          errors.push(
            `1m data gap for ${symbol} between ${bars[i - 1].startTime} and ${bars[i].startTime}; missing bars are not invented.`,
          );
          break;
        }
      }
      for (const bar of bars) {
        if (bar.startTime <= cursor || bar.startTime > endClosed) continue;
        closed.push(...cfg.oms.processCandle(bar, { mark: false }));
        advanced = Math.max(advanced, bar.startTime);
      }
    } catch (err) {
      ok = false;
      errors.push(`Exit candle fetch failed for ${symbol}: ${errMessage(err)}`);
    }
  }

  // If a symbol's candles were unavailable, try the synthetic ticker for the
  // mark only; the position stays open and the cursor is not advanced.
  for (const symbol of openSymbols) {
    if (marks[symbol] !== undefined) continue;
    try {
      const ticker = await cfg.ticker.getLastPrice(symbol);
      marks[symbol] = ticker.price;
    } catch (err) {
      errors.push(`Could not mark ${symbol} for exit phase: ${errMessage(err)}`);
    }
  }

  return {
    marks,
    closed,
    cursor: ok ? Math.max(advanced, endClosed) : initialCursor,
    ok,
  };
}

function sanitizeExitCandles(
  raw: Candle[],
  symbol: WatchlistSymbol,
  from: number,
  to: number,
  errors: string[],
): Candle[] {
  const byTime = new Map<number, Candle>();
  let malformed = 0;
  for (const candle of raw) {
    if (candle.symbol !== symbol || candle.timeframe !== EXIT_TF) {
      malformed++;
      continue;
    }
    if (!Number.isInteger(candle.startTime) || candle.startTime < from || candle.startTime > to) {
      continue;
    }
    if (validateCandleOHLC(candle).length > 0) {
      malformed++;
      continue;
    }
    byTime.set(candle.startTime, candle);
  }
  if (malformed > 0) {
    errors.push(`Ignored ${malformed} malformed 1m candle(s) for ${symbol}.`);
  }
  return [...byTime.values()].sort((a, b) => a.startTime - b.startTime);
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

interface DecideInput {
  symbol: WatchlistSymbol;
  cfg: RunCycleConfig;
  panel: AnalystAgent[];
  news: NewsBundle;
  instruments: Partial<Record<WatchlistSymbol, InstrumentConstraints>>;
  marks: Marks;
  now: number;
  store: CycleStore;
  cycleId: number | null;
  audit: AuditBuffers;
  errors: string[];
}

async function decideSymbol(input: DecideInput): Promise<SymbolOutcome> {
  const { symbol, cfg, panel, news, instruments, marks, now, store, cycleId, audit, errors } =
    input;

  const snapshot = await buildMarketSnapshot(symbol, {
    provider: cfg.provider,
    ticker: cfg.ticker,
    news,
    nowSeconds: () => now,
  });
  if (!snapshot.ok) {
    return { symbol, stage: "NO_SNAPSHOT", reason: snapshot.reason };
  }
  const snap = snapshot.snapshot;

  let votes: AnalystVote[];
  try {
    votes = panel.map((agent) => agent.analyze(snap));
  } catch (err) {
    return {
      symbol,
      stage: "ERROR",
      reason: `Analyst error: ${errMessage(err)}`,
      snapshot: snap,
    };
  }
  audit.votes.push(...votes);

  const consensus = evaluateConsensus(symbol, votes, CONSENSUS_CONFIG, news.available);
  audit.consensus.push(consensus);
  if (consensus.decision === "NO_TRADE") {
    return {
      symbol,
      stage: "NO_TRADE",
      reason: consensus.reason,
      snapshot: snap,
      votes,
      consensus,
    };
  }

  const ind = snap.indicators;
  const setup = buildTradeSetup({
    symbol,
    side: consensus.decision,
    entryPrice: ind.lastPrice,
    atr: ind.atr14_15m,
  });
  if (!setup.ok) {
    return {
      symbol,
      stage: "SETUP_REJECTED",
      reason: setup.reason,
      snapshot: snap,
      votes,
      consensus,
    };
  }

  const instrument = instruments[symbol];
  if (!instrument) {
    return {
      symbol,
      stage: "SIZE_REJECTED",
      reason: "No validated exchange instrument constraints for this symbol; failing closed.",
      snapshot: snap,
      votes,
      consensus,
      setup: setup.setup,
    };
  }

  const view = cfg.oms.getPortfolioView(marks);
  const existingSymbolNotional = cfg.oms
    .getOpenPositions()
    .filter((p) => p.symbol === symbol)
    .reduce((sum, p) => sum + p.qty * p.entryFillPrice, 0);
  const sized = sizePosition({
    equity: view.equity,
    cashBalance: view.cash,
    existingSymbolNotional,
    instrument,
    setup: setup.setup,
  });
  if (!sized.ok) {
    return {
      symbol,
      stage: "SIZE_REJECTED",
      reason: sized.reason,
      snapshot: snap,
      votes,
      consensus,
      setup: setup.setup,
    };
  }

  const sizedPosition = sized.position;
  const riskState = cfg.oms.getRiskState(marks);
  const preCheck = evaluateEntry({ position: sizedPosition }, riskState);
  if (!preCheck.allowed) {
    cfg.oms.noteRiskBlock(symbol, preCheck.breaches, now);
    audit.riskEvents.push({ symbol, breaches: preCheck.breaches });
    return {
      symbol,
      stage: "RISK_BLOCKED",
      reason: preCheck.breaches.map((b) => `${b.limit}: ${b.message}`).join(" | "),
      snapshot: snap,
      votes,
      consensus,
      setup: setup.setup,
      sized: sizedPosition,
      riskBreaches: preCheck.breaches,
    };
  }

  const proposal: TradeProposalForReview = {
    symbol,
    side: sizedPosition.side,
    entryPrice: sizedPosition.entryPrice,
    stopLoss: sizedPosition.stopLoss,
    takeProfit: sizedPosition.takeProfit,
    qty: sizedPosition.qty,
    leverage: sizedPosition.leverage,
    rewardRisk: sizedPosition.rewardRisk,
    consensus: {
      decision: consensus.decision,
      confidence: consensus.confidence,
      votesFor: consensus.votesFor,
      votesAgainst: consensus.votesAgainst,
    },
    news: {
      available: news.available,
      headlines: [...snap.news.items, ...snap.news.marketWide].slice(0, 10).map((item) => ({
        title: item.title,
        source: item.source,
        publishedAt: item.publishedAt,
      })),
    },
    riskSummary: ["all pre-trade risk limits passed (engine re-checks again at execution)"],
  };

  let review: ReviewOutcome;
  try {
    review = await cfg.reviewer.review(proposal);
  } catch (err) {
    review = {
      decision: "FLAG_FOR_HUMAN_REVIEW",
      reasoning: `Review agent threw (${errMessage(err)}); failing closed.`,
      model: "unavailable",
    };
  }
  audit.reviews.push({ symbol, outcome: review });

  if (review.decision !== "APPROVE") {
    return {
      symbol,
      stage: review.decision === "REJECT" ? "REVIEW_REJECTED" : "REVIEW_FLAGGED",
      reason: `${review.decision} by reviewer (${review.model}): ${review.reasoning}`,
      snapshot: snap,
      votes,
      consensus,
      setup: setup.setup,
      sized: sizedPosition,
      review,
    };
  }

  const opened = cfg.oms.openPosition(sizedPosition, marks, now);
  if (!opened.ok || !opened.position) {
    const breaches = opened.breaches ?? [];
    if (breaches.length > 0) audit.riskEvents.push({ symbol, breaches });
    return {
      symbol,
      stage: "RISK_BLOCKED",
      reason: opened.reason ?? "OMS refused the entry",
      snapshot: snap,
      votes,
      consensus,
      setup: setup.setup,
      sized: sizedPosition,
      review,
      riskBreaches: breaches,
    };
  }

  const position = opened.position;
  await safeStore(errors, `persist open ${symbol}`, async () => {
    const dbId = await store.recordPositionOpened(position, cycleId);
    if (dbId !== null) cfg.oms.assignPersistedId(position.id, dbId);
  });
  marks[symbol] = ind.lastPrice;

  return {
    symbol,
    stage: "OPENED",
    reason: `Opened ${position.side} ${position.qty} ${symbol} at ${position.entryFillPrice.toFixed(4)} (SL ${position.stopLoss.toFixed(4)}, TP ${position.takeProfit.toFixed(4)}).`,
    snapshot: snap,
    votes,
    consensus,
    setup: setup.setup,
    sized: sizedPosition,
    review,
    openedPositionId: position.id,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchNews(
  service: NewsServiceLike,
  symbols: readonly WatchlistSymbol[],
  now: number,
  errors: string[],
): Promise<NewsBundle> {
  try {
    return await service.fetchBundle(symbols);
  } catch (err) {
    errors.push(`News fetch failed: ${errMessage(err)}`);
    return {
      available: false,
      degraded: false,
      errors: [`news service error: ${errMessage(err)}`],
      fetchedAt: now,
      bySymbol: Object.fromEntries(symbols.map((s) => [s, []])),
      marketWide: [],
    };
  }
}

async function loadInstrumentConstraints(
  provider: ExchangeProvider,
  symbols: readonly WatchlistSymbol[],
): Promise<Partial<Record<WatchlistSymbol, InstrumentConstraints>>> {
  const instruments = await provider.fetchInstruments();
  const map: Partial<Record<WatchlistSymbol, InstrumentConstraints>> = {};
  for (const inst of instruments) {
    const symbol = inst.canonicalSymbol;
    if (!symbol || !(symbols as readonly string[]).includes(symbol)) continue;
    const constraints: InstrumentConstraints = {
      minContract: inst.minContract,
      maxContract: inst.maxContract,
      quantityStep: inst.quantityStep,
      minNotional: inst.minNotionalValue,
      maxLeverage: inst.maxLeverage,
    };
    const valid = Object.values(constraints).every(
      (v) => Number.isFinite(v) && v > 0,
    );
    if (valid) map[symbol as WatchlistSymbol] = constraints;
  }
  return map;
}

/** Cursor must be an aligned 1m timestamp; anything else is discarded (fail closed). */
function normalizeCursor(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0 || value % MINUTE !== 0) return null;
  return value;
}

async function safeStore(
  errors: string[],
  label: string,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (err) {
    errors.push(`Persistence failed (${label}): ${errMessage(err)}`);
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
