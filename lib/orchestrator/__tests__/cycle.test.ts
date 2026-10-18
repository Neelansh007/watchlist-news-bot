import { describe, expect, it } from "vitest";
import { PaperOMS } from "@/lib/oms/paper-oms";
import { TrendingFixtureProvider } from "@/lib/exchange/providers/trending-fixture";
import { SyntheticCandleTicker } from "@/lib/market-data/ticker";
import { WATCHLIST } from "@/lib/config/watchlist";
import { runCycle } from "@/lib/orchestrator/cycle";
import type { NewsServiceLike, TradeReviewer } from "@/lib/orchestrator/types";
import type { ReviewOutcome } from "@/lib/agents/types";
import type { Candle, ExchangeProvider } from "@/lib/exchange/types";
import {
  RecordingStore,
  StubProvider,
  bar,
  emptyNews,
  fixedPanel,
  openPaperPosition,
} from "./helpers";

const NOW = 1_800_000_000; // aligned to 1m, 15m and 1h
const ANCHOR = NOW - 14 * 86_400;

function trendingProvider(): ExchangeProvider {
  const overrides: Record<string, 1 | -1> = {};
  for (const s of WATCHLIST) overrides[s] = "BTC/USDT" === s || s === "ETH/USDT" || s === "SOL/USDT" ? 1 : -1;
  return new TrendingFixtureProvider({ seed: 2024, anchorEpoch: ANCHOR, directionOverrides: overrides });
}

function reviewerReturning(decision: ReviewOutcome["decision"]): TradeReviewer {
  return {
    review: async () => ({
      decision,
      reasoning: "stub reviewer",
      model: "stub-reviewer",
    }),
  };
}

function newsService(bundle = emptyNews(WATCHLIST, NOW, true)): NewsServiceLike {
  return { fetchBundle: async () => bundle };
}

function inRange(all: Candle[], start: number, end: number): Candle[] {
  return all.filter((c) => c.startTime >= start && c.startTime <= end);
}

describe("runCycle — entries", () => {
  it("opens a paper position when the pipeline is approved, persists it, and adopts the DB id", async () => {
    const oms = new PaperOMS({ startingEquityUsdt: 10_000, nowSeconds: NOW });
    const store = new RecordingStore();
    const result = await runCycle({
      mode: "test",
      oms,
      provider: trendingProvider(),
      ticker: new SyntheticCandleTicker(trendingProvider(), { nowSeconds: () => NOW }),
      newsService: newsService(),
      reviewer: reviewerReturning("APPROVE"),
      store,
      symbols: ["BTC/USDT"],
      lastProcessedCandleTs: NOW - 60,
      nowSeconds: () => NOW,
      panel: fixedPanel("LONG", 0.9),
    });

    expect(result.status).toBe("OK");
    expect(result.errors).toEqual([]);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].stage).toBe("OPENED");
    expect(result.outcomes[0].openedPositionId).toBe(501); // recording store's DB id
    expect(oms.getOpenPositions()).toHaveLength(1);
    expect(oms.getOpenPositions()[0].id).toBe(store.positionDbId);
    expect(store.positionsOpened).toHaveLength(1);
    expect(store.finished?.status).toBe("OK");
    expect(store.votes).toHaveLength(4);
    expect(store.consensus).toHaveLength(1);
    expect(store.consensus[0].decision).toBe("LONG");
    expect(store.reviews).toHaveLength(1);
    expect(store.portfolioSnapshots).toHaveLength(1);
    expect(store.newsBundles).toHaveLength(1);
    expect(store.journal.some((e) => e.kind === "POSITION_OPENED")).toBe(true);
    expect(result.portfolio.openPositionCount).toBe(1);
    expect(result.lastProcessedCandleTs).toBe(NOW - 60);
  });

  it("never opens when the reviewer flags the trade (fail closed)", async () => {
    const oms = new PaperOMS({ startingEquityUsdt: 10_000, nowSeconds: NOW });
    const store = new RecordingStore();
    const result = await runCycle({
      mode: "test",
      oms,
      provider: trendingProvider(),
      ticker: new SyntheticCandleTicker(trendingProvider(), { nowSeconds: () => NOW }),
      newsService: newsService(),
      reviewer: reviewerReturning("FLAG_FOR_HUMAN_REVIEW"),
      store,
      symbols: ["BTC/USDT"],
      lastProcessedCandleTs: NOW - 60,
      nowSeconds: () => NOW,
      panel: fixedPanel("LONG", 0.9),
    });

    expect(result.outcomes[0].stage).toBe("REVIEW_FLAGGED");
    expect(oms.getOpenPositions()).toHaveLength(0);
    expect(store.positionsOpened).toHaveLength(0);
    expect(store.reviews).toHaveLength(1);
    expect(store.reviews[0].outcome.decision).toBe("FLAG_FOR_HUMAN_REVIEW");
  });

  it("never opens when the reviewer rejects the trade", async () => {
    const oms = new PaperOMS({ startingEquityUsdt: 10_000, nowSeconds: NOW });
    const result = await runCycle({
      mode: "test",
      oms,
      provider: trendingProvider(),
      ticker: new SyntheticCandleTicker(trendingProvider(), { nowSeconds: () => NOW }),
      newsService: newsService(),
      reviewer: reviewerReturning("REJECT"),
      symbols: ["BTC/USDT"],
      lastProcessedCandleTs: NOW - 60,
      nowSeconds: () => NOW,
      panel: fixedPanel("LONG", 0.9),
    });

    expect(result.outcomes[0].stage).toBe("REVIEW_REJECTED");
    expect(oms.getOpenPositions()).toHaveLength(0);
  });

  it("treats a throwing reviewer as FLAG (no trade)", async () => {
    const oms = new PaperOMS({ startingEquityUsdt: 10_000, nowSeconds: NOW });
    const result = await runCycle({
      mode: "test",
      oms,
      provider: trendingProvider(),
      ticker: new SyntheticCandleTicker(trendingProvider(), { nowSeconds: () => NOW }),
      newsService: newsService(),
      reviewer: {
        review: async () => {
          throw new Error("network down");
        },
      },
      symbols: ["BTC/USDT"],
      lastProcessedCandleTs: NOW - 60,
      nowSeconds: () => NOW,
      panel: fixedPanel("LONG", 0.9),
    });

    expect(result.outcomes[0].stage).toBe("REVIEW_FLAGGED");
    expect(result.outcomes[0].review?.reasoning).toContain("network down");
    expect(oms.getOpenPositions()).toHaveLength(0);
  });

  it("skips a symbol that already has an open position", async () => {
    const restored = PaperOMS.restore({
      startingEquityUsdt: 10_000,
      positions: [openPaperPosition({ openedAtSeconds: NOW - 3600 })],
      equityPeak: 10_000,
      dayStartEquity: 10_000,
      dayKey: Math.floor(NOW / 86_400),
      dailyLossHalted: false,
      drawdownHalted: false,
    });
    const candles = [
      bar(NOW - 240, 60_000, 60_300, 59_700, 60_000),
      bar(NOW - 180, 60_000, 60_300, 59_700, 60_000),
      bar(NOW - 120, 60_000, 60_300, 59_700, 60_000),
      bar(NOW - 60, 60_000, 60_300, 59_700, 60_000),
    ];
    const provider = new StubProvider((_s, _tf, start, end) => inRange(candles, start, end));
    const result = await runCycle({
      mode: "test",
      oms: restored,
      provider,
      ticker: new SyntheticCandleTicker(provider, { nowSeconds: () => NOW }),
      newsService: newsService(),
      reviewer: reviewerReturning("APPROVE"),
      symbols: ["BTC/USDT"],
      lastProcessedCandleTs: NOW - 300,
      nowSeconds: () => NOW,
      panel: fixedPanel("LONG", 0.9),
    });

    expect(result.outcomes[0].stage).toBe("ALREADY_OPEN");
    expect(restored.getOpenPositions()).toHaveLength(1);
  });

  it("fails closed with NO_SNAPSHOT when market data is unusable", async () => {
    const oms = new PaperOMS({ startingEquityUsdt: 10_000, nowSeconds: NOW });
    const result = await runCycle({
      mode: "test",
      oms,
      provider: new StubProvider(() => []),
      ticker: new SyntheticCandleTicker(trendingProvider(), { nowSeconds: () => NOW }),
      newsService: newsService(),
      reviewer: reviewerReturning("APPROVE"),
      symbols: ["BTC/USDT"],
      lastProcessedCandleTs: NOW - 60,
      nowSeconds: () => NOW,
      panel: fixedPanel("LONG", 0.9),
    });

    expect(result.outcomes[0].stage).toBe("NO_SNAPSHOT");
    expect(result.outcomes[0].reason).toContain("No candles");
    expect(oms.getOpenPositions()).toHaveLength(0);
    expect(result.status).toBe("OK");
  });

  it("fails closed with NO_TRADE when consensus is absent", async () => {
    const oms = new PaperOMS({ startingEquityUsdt: 10_000, nowSeconds: NOW });
    const result = await runCycle({
      mode: "test",
      oms,
      provider: trendingProvider(),
      ticker: new SyntheticCandleTicker(trendingProvider(), { nowSeconds: () => NOW }),
      newsService: newsService(),
      reviewer: reviewerReturning("APPROVE"),
      symbols: ["BTC/USDT"],
      lastProcessedCandleTs: NOW - 60,
      nowSeconds: () => NOW,
      panel: [
        {
          name: "no-trade",
          analyze: (snapshot) => ({
            agent: "no-trade",
            symbol: snapshot.symbol,
            vote: "NO_TRADE",
            confidence: 0.2,
            reasoning: "no edge",
            initiating: true,
          }),
        },
      ],
    });

    expect(result.outcomes[0].stage).toBe("NO_TRADE");
    expect(oms.getOpenPositions()).toHaveLength(0);
  });
});

describe("runCycle — exits", () => {
  it("fills a gap-through-stop at the candle open (LONG) and persists the close", async () => {
    const position = openPaperPosition({ openedAtSeconds: NOW - 3600 });
    const oms = PaperOMS.restore({
      startingEquityUsdt: 10_000,
      positions: [position],
      equityPeak: 10_000,
      dayStartEquity: 10_000,
      dayKey: Math.floor(NOW / 86_400),
      dailyLossHalted: false,
      drawdownHalted: false,
    });
    const candles = [
      bar(NOW - 240, 60_000, 60_300, 59_700, 60_000),
      bar(NOW - 180, 60_000, 60_300, 59_700, 60_000),
      bar(NOW - 120, 58_000, 58_500, 57_000, 58_000),
      bar(NOW - 60, 58_000, 58_200, 57_800, 58_000),
    ];
    const provider = new StubProvider((_s, _tf, start, end) => inRange(candles, start, end));
    const store = new RecordingStore();

    const result = await runCycle({
      mode: "test",
      oms,
      provider,
      ticker: new SyntheticCandleTicker(provider, { nowSeconds: () => NOW }),
      newsService: newsService(),
      reviewer: reviewerReturning("APPROVE"),
      store,
      symbols: ["BTC/USDT"],
      lastProcessedCandleTs: NOW - 300,
      nowSeconds: () => NOW,
      panel: fixedPanel("LONG", 0.9),
    });

    expect(result.status).toBe("OK");
    expect(result.exits).toHaveLength(1);
    const closed = result.exits[0];
    expect(closed.closeReason).toBe("STOP_LOSS");
    expect(closed.gapThroughStop).toBe(true);
    expect(closed.rawExitPrice).toBe(58_000);
    expect(closed.exitFillPrice).toBeCloseTo(58_000 * (1 - 0.0003), 6);
    expect(closed.realizedPnl).toBeLessThan(-150);
    expect(oms.getOpenPositions()).toHaveLength(0);
    expect(oms.getClosedPositions()).toHaveLength(1);
    expect(store.positionsUpdated).toHaveLength(1);
    expect(store.positionsUpdated[0].status).toBe("CLOSED");
    // Now flat, the cycle tries a fresh decision but this stub only serves 1m
    // candles — so it correctly fails closed instead of inventing higher TFs.
    expect(result.outcomes[0].stage).toBe("NO_SNAPSHOT");
    expect(result.lastProcessedCandleTs).toBe(NOW - 60);
    // Accounting: final equity = starting + realized PnL (nothing open).
    expect(result.portfolio.equity).toBeCloseTo(10_000 + (closed.realizedPnl ?? 0), 6);
  });

  it("does not advance the exit cursor and skips entries when 1m data is unavailable", async () => {
    const oms = PaperOMS.restore({
      startingEquityUsdt: 10_000,
      positions: [openPaperPosition({ openedAtSeconds: NOW - 3600 })],
      equityPeak: 10_000,
      dayStartEquity: 10_000,
      dayKey: Math.floor(NOW / 86_400),
      dailyLossHalted: false,
      drawdownHalted: false,
    });
    const provider = new StubProvider(() => [], { failTimeframes: ["1m"] });

    const result = await runCycle({
      mode: "test",
      oms,
      provider,
      ticker: new SyntheticCandleTicker(provider, { nowSeconds: () => NOW }),
      newsService: newsService(),
      reviewer: reviewerReturning("APPROVE"),
      symbols: ["BTC/USDT"],
      lastProcessedCandleTs: NOW - 300,
      nowSeconds: () => NOW,
      panel: fixedPanel("LONG", 0.9),
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.errors.some((e) => e.includes("Exit candle fetch failed"))).toBe(true);
    expect(result.errors.some((e) => e.includes("New entries skipped"))).toBe(true);
    expect(result.outcomes).toHaveLength(0);
    expect(result.lastProcessedCandleTs).toBe(NOW - 300);
    expect(oms.getOpenPositions()).toHaveLength(1);
  });

  it("does not warn about a missing exit cursor on a clean first run", async () => {
    const oms = new PaperOMS({ startingEquityUsdt: 10_000, nowSeconds: NOW });
    const result = await runCycle({
      mode: "test",
      oms,
      provider: new StubProvider(() => []),
      ticker: new SyntheticCandleTicker(trendingProvider(), { nowSeconds: () => NOW }),
      newsService: newsService(),
      reviewer: reviewerReturning("APPROVE"),
      symbols: ["BTC/USDT"],
      lastProcessedCandleTs: null,
      nowSeconds: () => NOW,
      panel: fixedPanel("LONG", 0.9),
    });

    expect(result.errors.some((e) => e.toLowerCase().includes("exit cursor"))).toBe(false);
    expect(result.lastProcessedCandleTs).toBe(NOW - 60);
  });
});

describe("runCycle — persistence resilience", () => {
  it("still opens in memory but reports PARTIAL when the position insert fails", async () => {
    const failing = new RecordingStore();
    failing.failPositionInsert = true;
    const oms = new PaperOMS({ startingEquityUsdt: 10_000, nowSeconds: NOW });
    const result = await runCycle({
      mode: "test",
      oms,
      provider: trendingProvider(),
      ticker: new SyntheticCandleTicker(trendingProvider(), { nowSeconds: () => NOW }),
      newsService: newsService(),
      reviewer: reviewerReturning("APPROVE"),
      store: failing,
      symbols: ["BTC/USDT"],
      lastProcessedCandleTs: NOW - 60,
      nowSeconds: () => NOW,
      panel: fixedPanel("LONG", 0.9),
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.errors.some((e) => e.includes("db write failed"))).toBe(true);
    expect(result.outcomes[0].stage).toBe("OPENED");
    expect(oms.getOpenPositions()).toHaveLength(1);
  });
});
