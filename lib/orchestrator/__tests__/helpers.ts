import type {
  Candle,
  ExchangeProvider,
  Instrument,
  OrderRequest,
  OrderResult,
  Timeframe,
} from "@/lib/exchange/types";
import type { WatchlistSymbol } from "@/lib/config/watchlist";
import { WATCHLIST } from "@/lib/config/watchlist";
import type { AnalystAgent } from "@/lib/agents/types";
import type { NewsBundle } from "@/lib/news/types";
import type { CycleStore } from "@/lib/orchestrator/store";
import type { AnalystVote, ConsensusResult, ReviewOutcome } from "@/lib/agents/types";
import type { JournalEntry, PaperPosition, PortfolioView } from "@/lib/oms/types";
import type { RiskBreach } from "@/lib/risk/types";
import type { PaperSettings } from "@/lib/persistence/mappers";
import { SafetyError } from "@/lib/safety/errors";

export type CandleSource = (
  symbol: WatchlistSymbol,
  timeframe: Timeframe,
  start: number,
  end: number,
) => Candle[];

export interface StubProviderOptions {
  instruments?: Instrument[];
  failTimeframes?: Timeframe[];
}

export function stubInstruments(symbols: readonly string[] = WATCHLIST): Instrument[] {
  return symbols.map((symbol) => {
    const [base, quote] = symbol.split("/");
    return {
      exchangeSymbol: `${base}${quote}`,
      canonicalSymbol: symbol,
      id: `stub-${symbol.toLowerCase()}`,
      name: `${base} stub`,
      minContract: 0.001,
      maxContract: 1_000_000,
      quantityStep: 0.001,
      minNotionalValue: 5,
      minLeverage: 1,
      maxLeverage: 3,
      price: null,
      raw: { stub: true },
    };
  });
}

export class StubProvider implements ExchangeProvider {
  readonly kind = "deterministic" as const;
  readonly failTimeframes: Set<Timeframe>;

  constructor(
    private readonly source: CandleSource,
    private readonly opts: StubProviderOptions = {},
  ) {
    this.failTimeframes = new Set(opts.failTimeframes ?? []);
  }

  async fetchInstruments(): Promise<Instrument[]> {
    return this.opts.instruments ?? stubInstruments();
  }

  async fetchCandles(
    symbol: WatchlistSymbol,
    timeframe: Timeframe,
    start: number,
    end: number,
  ): Promise<Candle[]> {
    if (this.failTimeframes.has(timeframe)) {
      throw new Error(`stub failure for ${timeframe}`);
    }
    return this.source(symbol, timeframe, start, end);
  }

  async createOrder(_req: OrderRequest): Promise<OrderResult> {
    throw new SafetyError("STUB_WRITE_REFUSED", "StubProvider never writes.");
  }
  async cancelOrder(_orderId: string): Promise<OrderResult> {
    throw new SafetyError("STUB_WRITE_REFUSED", "StubProvider never writes.");
  }
  async setLeverage(_symbol: WatchlistSymbol, _leverage: number): Promise<void> {
    throw new SafetyError("STUB_WRITE_REFUSED", "StubProvider never writes.");
  }
}

export function emptyNews(
  symbols: readonly WatchlistSymbol[] = WATCHLIST,
  now = 0,
  available = true,
): NewsBundle {
  return {
    available,
    degraded: false,
    errors: [],
    fetchedAt: now,
    bySymbol: Object.fromEntries(symbols.map((s) => [s, []])),
    marketWide: [],
  };
}

export function fixedPanel(
  vote: "LONG" | "SHORT",
  confidence = 0.9,
): AnalystAgent[] {
  return Array.from({ length: 4 }, (_, i) => ({
    name: `stub-${i}`,
    analyze: (snapshot) => ({
      agent: `stub-${i}`,
      symbol: snapshot.symbol,
      vote,
      confidence,
      reasoning: "test analyst",
      initiating: true,
    }),
  }));
}

export function bar(
  start: number,
  open: number,
  high: number,
  low: number,
  close: number,
  opts: { symbol?: WatchlistSymbol; timeframe?: Timeframe } = {},
): Candle {
  return {
    symbol: opts.symbol ?? "BTC/USDT",
    timeframe: opts.timeframe ?? "1m",
    startTime: start,
    open,
    high,
    low,
    close,
    volume: 10,
  };
}

export function openPaperPosition(overrides: Partial<PaperPosition> = {}): PaperPosition {
  return {
    id: 1,
    symbol: "BTC/USDT",
    side: "LONG",
    qty: 0.1,
    leverage: 2,
    intendedEntryPrice: 60_000,
    entryFillPrice: 60_000,
    stopLoss: 59_000,
    takeProfit: 62_000,
    rewardRisk: 2,
    margin: 3_000,
    entryFee: 3,
    openedAtSeconds: 1_800_000_000 - 3_600,
    maxHoldUntilSeconds: 1_800_000_000 + 3_600,
    status: "OPEN",
    ...overrides,
  };
}

export class RecordingStore implements CycleStore {
  readonly cycleId = 77;
  readonly positionDbId = 501;
  votes: AnalystVote[] = [];
  consensus: ConsensusResult[] = [];
  reviews: { symbol: string; outcome: ReviewOutcome }[] = [];
  riskEvents: { symbol: string; breaches: RiskBreach[] }[] = [];
  journal: JournalEntry[] = [];
  portfolioSnapshots: PortfolioView[] = [];
  newsBundles: NewsBundle[] = [];
  positionsOpened: PaperPosition[] = [];
  positionsUpdated: PaperPosition[] = [];
  finished: { status: string; error?: string } | null = null;
  settings: PaperSettings | null = null;
  failPositionInsert = false;

  async beginCycle(): Promise<number> {
    return this.cycleId;
  }
  async finishCycle(
    _cycleId: number | null,
    status: "OK" | "PARTIAL" | "ERROR",
    error?: string,
  ): Promise<void> {
    this.finished = { status, error };
  }
  async recordVotes(_cycleId: number | null, votes: AnalystVote[]): Promise<void> {
    this.votes.push(...votes);
  }
  async recordConsensus(_cycleId: number | null, results: ConsensusResult[]): Promise<void> {
    this.consensus.push(...results);
  }
  async recordReview(
    _cycleId: number | null,
    symbol: WatchlistSymbol,
    outcome: ReviewOutcome,
  ): Promise<void> {
    this.reviews.push({ symbol, outcome });
  }
  async recordRiskEvents(
    _cycleId: number | null,
    symbol: WatchlistSymbol,
    breaches: RiskBreach[],
  ): Promise<void> {
    this.riskEvents.push({ symbol, breaches });
  }
  async recordJournal(_cycleId: number | null, entries: JournalEntry[]): Promise<void> {
    this.journal.push(...entries);
  }
  async recordPortfolio(view: PortfolioView): Promise<void> {
    this.portfolioSnapshots.push(view);
  }
  async recordNews(bundle: NewsBundle): Promise<void> {
    this.newsBundles.push(bundle);
  }
  async recordPositionOpened(position: PaperPosition): Promise<number> {
    if (this.failPositionInsert) throw new Error("db write failed");
    this.positionsOpened.push({ ...position });
    return this.positionDbId;
  }
  async recordPositionUpdated(position: PaperPosition): Promise<void> {
    this.positionsUpdated.push({ ...position });
  }
  async loadPositions(): Promise<PaperPosition[]> {
    return [];
  }
  async loadSettings(): Promise<PaperSettings | null> {
    return this.settings;
  }
  async saveSettings(settings: PaperSettings): Promise<void> {
    this.settings = settings;
  }
}
