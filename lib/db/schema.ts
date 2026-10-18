import {
  pgTable,
  serial,
  bigserial,
  text,
  integer,
  bigint,
  numeric,
  doublePrecision,
  timestamp,
  jsonb,
  boolean,
  uniqueIndex,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";

export const sideEnum = pgEnum("side", ["LONG", "SHORT"]);
export const positionStatusEnum = pgEnum("position_status", ["OPEN", "CLOSED"]);
export const closeReasonEnum = pgEnum("close_reason", [
  "STOP_LOSS",
  "TAKE_PROFIT",
  "MAX_HOLD",
  "MANUAL",
]);
export const instrumentStatusEnum = pgEnum("instrument_status", [
  "AVAILABLE",
  "UNAVAILABLE",
]);
export const voteEnum = pgEnum("vote", ["LONG", "SHORT", "NO_TRADE"]);
export const reviewDecisionEnum = pgEnum("review_decision", [
  "APPROVE",
  "REJECT",
  "FLAG_FOR_HUMAN_REVIEW",
]);

/** Instruments discovered from Mudrex /futures, intersected with the fixed watchlist. */
export const instruments = pgTable("instruments", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull().unique(),
  baseAsset: text("base_asset").notNull(),
  quoteAsset: text("quote_asset").notNull(),
  mudrexAssetId: text("mudrex_asset_id"),
  status: instrumentStatusEnum("status").notNull(),
  tradable: boolean("tradable").notNull().default(false),
  unavailableReason: text("unavailable_reason"),
  /** Raw exchange payload, kept for audit. Parsed strictly before use. */
  raw: jsonb("raw"),
  pricePrecision: integer("price_precision"),
  qtyPrecision: integer("qty_precision"),
  minQty: numeric("min_qty", { precision: 30, scale: 12 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Validated candles. startTime is epoch SECONDS (Mudrex convention). */
export const candles = pgTable(
  "candles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    startTime: bigint("start_time", { mode: "number" }).notNull(),
    open: numeric("open", { precision: 30, scale: 12 }).notNull(),
    high: numeric("high", { precision: 30, scale: 12 }).notNull(),
    low: numeric("low", { precision: 30, scale: 12 }).notNull(),
    close: numeric("close", { precision: 30, scale: 12 }).notNull(),
    volume: numeric("volume", { precision: 30, scale: 12 }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("candles_symbol_tf_start_idx").on(t.symbol, t.timeframe, t.startTime),
    index("candles_symbol_tf_idx").on(t.symbol, t.timeframe),
  ],
);

/** One decision cycle of the bot (fetch -> analysts -> consensus -> review -> risk -> execute). */
export const cycles = pgTable("cycles", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  mode: text("mode").notNull(),
  status: text("status").notNull().default("RUNNING"),
  error: text("error"),
});

export const analystVotes = pgTable(
  "analyst_votes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    cycleId: integer("cycle_id").notNull(),
    agent: text("agent").notNull(),
    symbol: text("symbol").notNull(),
    vote: voteEnum("vote").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    reasoning: text("reasoning").notNull(),
    /** true = counted toward the directional majority. */
    initiating: boolean("initiating").notNull().default(true),
    /** News agent only: blocks any trade this cycle. */
    veto: boolean("veto").notNull().default(false),
    /** News agent only: -1..1 sentiment nudge. */
    sentimentScore: doublePrecision("sentiment_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("votes_cycle_symbol_idx").on(t.cycleId, t.symbol)],
);

export const consensusResults = pgTable("consensus_results", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  cycleId: integer("cycle_id").notNull(),
  symbol: text("symbol").notNull(),
  decision: voteEnum("decision").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  votesFor: integer("votes_for").notNull(),
  votesAgainst: integer("votes_against").notNull(),
  votesTotal: integer("votes_total").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviewDecisions = pgTable("review_decisions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  cycleId: integer("cycle_id").notNull(),
  symbol: text("symbol").notNull(),
  decision: reviewDecisionEnum("decision").notNull(),
  model: text("model").notNull(),
  reasoning: text("reasoning"),
  raw: jsonb("raw"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Every risk-engine block/halt is recorded here. Append-only audit trail. */
export const riskEvents = pgTable(
  "risk_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    cycleId: integer("cycle_id"),
    symbol: text("symbol"),
    limit: text("limit").notNull(),
    action: text("action").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("risk_events_created_idx").on(t.createdAt)],
);

export const newsItems = pgTable(
  "news_items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    symbol: text("symbol").notNull(),
    /** Sanitized headline. Raw untrusted text is NEVER stored or shown unescaped. */
    title: text("title").notNull(),
    link: text("link").notNull().unique(),
    source: text("source").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("news_symbol_published_idx").on(t.symbol, t.publishedAt)],
);

export const positions = pgTable(
  "positions",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    side: sideEnum("side").notNull(),
    qty: numeric("qty", { precision: 30, scale: 12 }).notNull(),
    leverage: integer("leverage").notNull(),
    /** Strategy price before slippage. */
    intendedEntryPrice: numeric("intended_entry_price", { precision: 30, scale: 12 }).notNull(),
    /** Actual simulated entry fill (intended +/- slippage). */
    entryPrice: numeric("entry_price", { precision: 30, scale: 12 }).notNull(),
    stopLoss: numeric("stop_loss", { precision: 30, scale: 12 }).notNull(),
    takeProfit: numeric("take_profit", { precision: 30, scale: 12 }).notNull(),
    rewardRisk: numeric("reward_risk", { precision: 30, scale: 12 }).notNull(),
    /** Locked margin (notional / leverage). */
    margin: numeric("margin", { precision: 30, scale: 12 }).notNull(),
    entryFee: numeric("entry_fee", { precision: 30, scale: 12 }).notNull().default("0"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    openedCycleId: integer("opened_cycle_id"),
    maxHoldUntil: timestamp("max_hold_until", { withTimezone: true }).notNull(),
    status: positionStatusEnum("status").notNull().default("OPEN"),
    closeReason: closeReasonEnum("close_reason"),
    /** Raw exit price before slippage (SL/TP level, gap open, or close). */
    rawExitPrice: numeric("raw_exit_price", { precision: 30, scale: 12 }),
    /** Actual simulated exit fill. */
    exitPrice: numeric("exit_price", { precision: 30, scale: 12 }),
    exitFee: numeric("exit_fee", { precision: 30, scale: 12 }),
    realizedPnl: numeric("realized_pnl", { precision: 30, scale: 12 }),
    gapThroughStop: boolean("gap_through_stop").notNull().default(false),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("positions_status_idx").on(t.status)],
);

/** Append-only human-readable journal of everything the bot does. */
export const journal = pgTable(
  "journal",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    cycleId: integer("cycle_id"),
    symbol: text("symbol"),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    payload: jsonb("payload"),
  },
  (t) => [index("journal_ts_idx").on(t.ts)],
);

export const portfolioSnapshots = pgTable("portfolio_snapshots", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  equity: numeric("equity", { precision: 30, scale: 12 }).notNull(),
  cashBalance: numeric("cash_balance", { precision: 30, scale: 12 }).notNull(),
  unrealizedPnl: numeric("unrealized_pnl", { precision: 30, scale: 12 }).notNull(),
  openPositionCount: integer("open_position_count").notNull(),
});

/** Key/value runtime state (daily loss anchor, equity peak, halted flags, etc.). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
