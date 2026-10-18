/**
 * Shared bootstrap for the paper CLIs (paper:once / paper:autopilot).
 *
 * Safety posture:
 *  - Always PAPER: the exchange provider is paper/deterministic/trending and
 *    the live-trading master switch is off. A non-paper trading mode aborts.
 *  - Postgres is optional. When it is unreachable the bot runs IN-MEMORY ONLY
 *    with a loud warning; state is lost when the process exits.
 *  - If the Anthropic key is missing, the review gate flags every candidate,
 *    so no paper position is ever opened. That is intentional fail-closed
 *    behavior, not a bug.
 */
import "dotenv/config";
import type { Db } from "@/lib/db";
import { closeDb, getDb } from "@/lib/db";
import { parseEnv, type Env } from "@/lib/config/env";
import { PAPER_DEFAULTS } from "@/lib/config/risk";
import { WATCHLIST } from "@/lib/config/watchlist";
import { createNewsProviders, NewsService } from "@/lib/news";
import { PaperProvider } from "@/lib/exchange/providers/paper";
import { DeterministicProvider } from "@/lib/exchange/providers/deterministic";
import { TrendingFixtureProvider } from "@/lib/exchange/providers/trending-fixture";
import { MudrexProvider } from "@/lib/exchange/mudrex-client";
import type { ExchangeProvider } from "@/lib/exchange/types";
import { SyntheticCandleTicker } from "@/lib/market-data/ticker";
import { AnthropicReviewAgent } from "@/lib/agents/review-agent";
import { PaperOMS } from "@/lib/oms/paper-oms";
import { NULL_CYCLE_STORE, type CycleStore } from "@/lib/orchestrator/store";
import type { NewsServiceLike, TradeReviewer } from "@/lib/orchestrator/types";
import type { CycleResult } from "@/lib/orchestrator/types";
import { PostgresCycleStore } from "@/lib/persistence/cycle-store";
import { loadPaperSettings } from "@/lib/persistence/repository";
import type { PaperSettings } from "@/lib/persistence/mappers";
import { resolveTradingMode } from "@/lib/safety/live-guard";

export type ProviderChoice = "paper" | "deterministic" | "trending" | "mudrex";

export interface PaperArgs {
  noDb: boolean;
  noNews: boolean;
  provider: ProviderChoice;
  intervalSeconds: number;
  /** null = run forever (autopilot). */
  cycles: number | null;
}

export interface PaperRuntime {
  env: Env;
  args: PaperArgs;
  provider: ExchangeProvider;
  ticker: SyntheticCandleTicker;
  newsService: NewsServiceLike;
  reviewer: TradeReviewer;
  store: CycleStore;
  persisted: boolean;
  oms: PaperOMS;
  lastProcessedCandleTs: number | null;
  dataSource: string;
  warnings: string[];
  close: () => Promise<void>;
}

export function parseArgs(argv: string[]): PaperArgs {
  const value = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const providerRaw = value("provider") ?? "paper";
  const providers: ProviderChoice[] = ["paper", "deterministic", "trending", "mudrex"];
  if (!providers.includes(providerRaw as ProviderChoice)) {
    throw new Error(`Unknown --provider=${providerRaw}. Use one of: ${providers.join(", ")}`);
  }
  const intervalRaw = value("interval");
  const interval = intervalRaw === undefined ? 300 : Number(intervalRaw);
  if (!Number.isFinite(interval) || interval < 10) {
    throw new Error("--interval must be a number of seconds >= 10.");
  }
  const cyclesRaw = value("cycles");
  let cycles: number | null = null;
  if (cyclesRaw !== undefined) {
    const n = Number(cyclesRaw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new Error("--cycles must be an integer >= 0 (0 = unlimited).");
    }
    cycles = n === 0 ? null : n;
  }
  return {
    noDb: argv.includes("--no-db"),
    noNews: argv.includes("--no-news"),
    provider: providerRaw as ProviderChoice,
    intervalSeconds: interval,
    cycles,
  };
}

export async function createPaperRuntime(args: PaperArgs): Promise<PaperRuntime> {
  const env = parseEnv();
  if (resolveTradingMode(env) !== "paper") {
    throw new Error(
      "REFUSING TO START: trading mode resolved to LIVE. These CLIs are paper-only and ship with the live master switch off.",
    );
  }

  const warnings: string[] = [];
  if (env.ANTHROPIC_API_KEY === "") {
    warnings.push(
      "ANTHROPIC_API_KEY is empty: the review agent flags EVERY candidate trade, so no paper position will be opened.",
    );
  }
  if (args.noNews) {
    warnings.push("--no-news: news is reported unavailable; consensus confidence is penalized.");
  }

  let provider: ExchangeProvider;
  let dataSource: string;
  const now = Math.floor(Date.now() / 1000);
  // Synthetic series are anchored near "now" (14 days of history) so the
  // generator never has to allocate months/years of 1m candles at startup.
  const syntheticAnchor = Math.floor((now - 14 * 86_400) / 3_600) * 3_600;
  switch (args.provider) {
    case "paper": {
      const marketData = env.MUDREX_API_SECRET
        ? new MudrexProvider(env)
        : new DeterministicProvider({ seed: 42, anchorEpoch: syntheticAnchor });
      const paper = new PaperProvider(env, marketData);
      provider = paper;
      if (paper.marketData.kind === "mudrex") {
        dataSource = "Mudrex public klines (real market data; fills simulated locally)";
      } else {
        dataSource = "SYNTHETIC deterministic candles (MUDREX_API_SECRET empty — not real prices)";
        warnings.push(
          "MUDREX_API_SECRET is empty: using the deterministic synthetic provider. Results validate plumbing only, never edge.",
        );
      }
      break;
    }
    case "deterministic":
      provider = new DeterministicProvider({ seed: 42, anchorEpoch: syntheticAnchor });
      dataSource = "SYNTHETIC deterministic candles (explicit --provider=deterministic)";
      break;
    case "trending": {
      const up = new Set(["BTC/USDT", "ETH/USDT", "SOL/USDT"]);
      const overrides: Record<string, 1 | -1> = {};
      for (const s of WATCHLIST) overrides[s] = up.has(s) ? 1 : -1;
      provider = new TrendingFixtureProvider({
        seed: 2024,
        directionOverrides: overrides,
        anchorEpoch: syntheticAnchor,
      });
      dataSource = "SYNTHETIC trending fixture (explicit --provider=trending; demo only)";
      break;
    }
    case "mudrex":
      provider = new MudrexProvider(env);
      dataSource = "Mudrex public klines (direct provider; fills simulated locally)";
      break;
  }

  const ticker = new SyntheticCandleTicker(provider);
  const newsService: NewsServiceLike = args.noNews
    ? new NewsService([], { lookbackHours: env.NEWS_LOOKBACK_HOURS })
    : new NewsService(createNewsProviders(env), {
        lookbackHours: env.NEWS_LOOKBACK_HOURS,
      });
  const reviewer: TradeReviewer = new AnthropicReviewAgent(env);

  const { store, persisted, settings, positions } = await openStore(args, warnings);
  const oms = buildOms(positions, settings, now, warnings);

  return {
    env,
    args,
    provider,
    ticker,
    newsService,
    reviewer,
    store,
    persisted,
    oms,
    lastProcessedCandleTs: settings?.lastProcessedCandleTs ?? null,
    dataSource,
    warnings,
    close: async () => {
      if (persisted) await closeDb();
    },
  };
}

async function openStore(
  args: PaperArgs,
  warnings: string[],
): Promise<{
  store: CycleStore;
  persisted: boolean;
  settings: PaperSettings | null;
  positions: Awaited<ReturnType<CycleStore["loadPositions"]>>;
}> {
  if (args.noDb) {
    warnings.push(
      "--no-db: Postgres persistence is DISABLED. Paper state is in-memory only and will be lost on exit.",
    );
    return { store: NULL_CYCLE_STORE, persisted: false, settings: null, positions: [] };
  }
  try {
    const db: Db = getDb();
    const settings = await withTimeout(loadPaperSettings(db), 7_000, "database preflight");
    const store = new PostgresCycleStore(db);
    const positions = await store.loadPositions();
    console.log("Persistence: PostgreSQL (paper state is saved between cycles).");
    return { store, persisted: true, settings, positions };
  } catch (err) {
    await closeDb().catch(() => undefined);
    warnings.push(
      `PostgreSQL unavailable (${errMessage(err)}). Running IN-MEMORY ONLY — paper state will be lost on exit. ` +
        "Fix DATABASE_URL in .env, then run `npm run setup:db`.",
    );
    return { store: NULL_CYCLE_STORE, persisted: false, settings: null, positions: [] };
  }
}

function buildOms(
  positions: Awaited<ReturnType<CycleStore["loadPositions"]>>,
  settings: PaperSettings | null,
  now: number,
  warnings: string[],
): PaperOMS {
  if (!settings && positions.length === 0) {
    return new PaperOMS({
      startingEquityUsdt: PAPER_DEFAULTS.startingEquityUsdt,
      nowSeconds: now,
    });
  }
  if (!settings && positions.length > 0) {
    warnings.push(
      "Found saved positions but no saved OMS settings. Using conservative defaults for day-start equity and halts.",
    );
  }
  const startingEquity = settings?.startingEquityUsdt ?? PAPER_DEFAULTS.startingEquityUsdt;
  return PaperOMS.restore({
    startingEquityUsdt: startingEquity,
    positions,
    equityPeak: settings?.equityPeak ?? startingEquity,
    dayStartEquity: settings?.dayStartEquity ?? startingEquity,
    dayKey: settings?.dayKey ?? Math.floor(now / 86_400),
    dailyLossHalted: settings?.dailyLossHalted ?? false,
    drawdownHalted: settings?.drawdownHalted ?? false,
  });
}

/** Persist the OMS state that must survive a restart. Returns an error string or null. */
export async function persistRuntimeState(
  runtime: PaperRuntime,
  result: CycleResult,
): Promise<string | null> {
  if (!runtime.persisted) return null;
  const settings: PaperSettings = {
    startingEquityUsdt: runtime.oms.getStartingEquity(),
    equityPeak: result.portfolio.equityPeak,
    dayStartEquity: result.portfolio.dayStartEquity,
    dayKey: Math.floor(result.finishedAtSeconds / 86_400),
    dailyLossHalted: result.portfolio.dailyLossHalted,
    drawdownHalted: result.portfolio.drawdownHalted,
    lastProcessedCandleTs: result.lastProcessedCandleTs,
  };
  try {
    await runtime.store.saveSettings(settings);
    runtime.lastProcessedCandleTs = result.lastProcessedCandleTs;
    return null;
  } catch (err) {
    return `Could not persist OMS settings: ${errMessage(err)}`;
  }
}

export function printStartup(
  runtime: PaperRuntime,
  title: string,
): void {
  console.log("=".repeat(78));
  console.log(`watchlist-news-bot — ${title}`);
  console.log("=".repeat(78));
  console.log("Mode           : PAPER (live trading disabled; code master switch is OFF)");
  console.log(`Market data    : ${runtime.dataSource}`);
  console.log(`Persistence    : ${runtime.persisted ? "PostgreSQL" : "IN-MEMORY ONLY (not saved)"}`);
  console.log(`News           : ${runtime.args.noNews ? "disabled (--no-news)" : "public RSS feeds"}`);
  console.log(
    `Review agent   : ${runtime.env.ANTHROPIC_API_KEY ? `Anthropic (${runtime.env.REVIEW_MODEL})` : "UNAVAILABLE — all candidates will be flagged"}`,
  );
  console.log("Live orders    : NONE can be sent in this build.");
  for (const warning of runtime.warnings) console.log(`WARNING        : ${warning}`);
  console.log("=".repeat(78));
}

export function printCycle(result: CycleResult): void {
  const time = new Date(result.finishedAtSeconds * 1000).toISOString();
  console.log(`\n[cycle ${result.cycleId ?? "-"}] ${time} — ${result.status}`);
  console.log(
    `  News: ${result.newsAvailable ? (result.newsDegraded ? "available (degraded)" : "available") : "UNAVAILABLE (confidence penalty applied)"}`,
  );
  if (result.exits.length > 0) {
    console.log(`  Exits:`);
    for (const p of result.exits) {
      console.log(
        `    - ${p.symbol} ${p.side} closed ${p.closeReason} @ ${p.exitFillPrice?.toFixed(4)} → PnL ${fmtMoney(p.realizedPnl ?? 0)}`,
      );
    }
  }
  console.log("  Decisions:");
  for (const o of result.outcomes) {
    const reason = o.reason.length > 150 ? `${o.reason.slice(0, 147)}...` : o.reason;
    console.log(`    - ${o.symbol.padEnd(9)} ${o.stage.padEnd(16)} ${reason}`);
  }
  if (result.outcomes.length === 0) console.log("    (none — no symbol was eligible this cycle)");
  const p = result.portfolio;
  console.log(
    `  Portfolio: equity ${fmtMoney(p.equity)} | cash ${fmtMoney(p.cash)} | uPnL ${fmtMoney(p.unrealizedPnl)} | realized ${fmtMoney(p.realizedPnl)} | open ${p.openPositionCount}`,
  );
  if (p.dailyLossHalted || p.drawdownHalted) {
    console.log(
      `  HALTS: dailyLoss=${p.dailyLossHalted} drawdown=${p.drawdownHalted} — new entries blocked`,
    );
  }
  if (result.errors.length > 0) {
    console.log(`  Issues (${result.errors.length}):`);
    for (const err of result.errors.slice(0, 8)) console.log(`    ! ${err}`);
    if (result.errors.length > 8) console.log(`    ! ... ${result.errors.length - 8} more`);
  }
}

export function fmtMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
