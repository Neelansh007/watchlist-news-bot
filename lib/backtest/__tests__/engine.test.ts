import { describe, expect, it } from "vitest";
import { runBacktest, unavailableNewsBundle } from "../engine";
import { TrendingFixtureProvider } from "@/lib/exchange/providers/trending-fixture";
import { DeterministicProvider } from "@/lib/exchange/providers/deterministic";
import { WATCHLIST } from "@/lib/config/watchlist";
import { PAPER_DEFAULTS } from "@/lib/config/risk";
import type { BacktestResult } from "../types";

const ANCHOR = 1_704_067_200;
const START = ANCHOR + 200 * 3600; // 200h of warmup history before the first bar

/** Half the watchlist trends up (LONG setups), half trends down (SHORT setups). */
function trendingProvider(seed = 2024): TrendingFixtureProvider {
  const overrides: Record<string, 1 | -1> = {
    "BTC/USDT": 1,
    "ETH/USDT": 1,
    "SOL/USDT": 1,
    "XAU/USDT": -1,
    "XRP/USDT": -1,
    "BNB/USDT": -1,
    "HYPE/USDT": -1,
  };
  return new TrendingFixtureProvider({ seed, directionOverrides: overrides });
}

describe("runBacktest — plumbing over synthetic trending data", () => {
  let cached: BacktestResult | null = null;
  async function run(): Promise<BacktestResult> {
    if (cached) return cached;
    cached = await runBacktest({
      provider: trendingProvider(),
      startSeconds: START,
      endSeconds: START + 10 * 86_400, // 10 days
      decisionTimeframe: "15m",
      segmentLabel: "full",
    });
    return cached;
  }

  it("opens AND closes trades (the full lifecycle runs)", async () => {
    const r = await run();
    expect(r.metrics.tradeCount).toBeGreaterThan(0);
    // Every closed trade must have complete exit metadata.
    for (const t of r.trades) {
      expect(t.exitTimeSeconds).toBeGreaterThanOrEqual(t.entryTimeSeconds);
      expect(Number.isFinite(t.realizedPnl)).toBe(true);
      expect(["STOP_LOSS", "TAKE_PROFIT", "MAX_HOLD", "MANUAL"]).toContain(t.closeReason);
    }
  }, 120_000);

  it("exercises more than one exit reason (SL/TP/max-hold all wired)", async () => {
    const r = await run();
    const reasons = new Set(r.trades.map((t) => t.closeReason));
    expect(reasons.size).toBeGreaterThanOrEqual(2);
    expect(reasons.has("TAKE_PROFIT")).toBe(true);
    expect(reasons.has("STOP_LOSS")).toBe(true);
  }, 120_000);

  it("produces trades on BOTH sides across the mixed-direction watchlist", async () => {
    const r = await run();
    const sides = new Set(r.trades.map((t) => t.side));
    expect(sides.has("LONG")).toBe(true);
    expect(sides.has("SHORT")).toBe(true);
  }, 120_000);

  it("labels the run synthetic and attaches the disclaimer", async () => {
    const r = await run();
    expect(r.dataMode).toBe("synthetic");
    expect(r.disclaimer).toMatch(/DO NOT GUARANTEE LIVE PROFIT/i);
  }, 120_000);

  it("respects the frozen concurrency cap: open positions never exceed maxConcurrentPositions", async () => {
    // Reconstruct concurrent-open count from entry/exit intervals.
    const r = await run();
    const events: { t: number; d: number }[] = [];
    for (const t of r.trades) {
      events.push({ t: t.entryTimeSeconds, d: 1 });
      events.push({ t: t.exitTimeSeconds, d: -1 });
    }
    events.sort((a, b) => a.t - b.t || a.d - b.d); // exits before entries at the same ts
    let open = 0;
    let peak = 0;
    for (const e of events) {
      open += e.d;
      if (open > peak) peak = open;
    }
    expect(peak).toBeLessThanOrEqual(3); // RISK_LIMITS.maxConcurrentPositions
  }, 120_000);

  it("keeps equity accounting coherent: finalEquity == starting + netPnl (flat at end)", async () => {
    const r = await run();
    expect(r.metrics.finalEquity).toBeCloseTo(r.startingEquity + r.metrics.netPnl, 4);
  }, 120_000);

  it("records per-symbol breakdown rows for symbols that traded", async () => {
    const r = await run();
    expect(r.perSymbol.length).toBeGreaterThan(0);
    const tradedSymbols = new Set(r.trades.map((t) => t.symbol));
    for (const row of r.perSymbol) {
      expect(tradedSymbols.has(row.symbol)).toBe(true);
      expect(row.tradeCount).toBeGreaterThan(0);
    }
  }, 120_000);

  it("never trades a symbol outside the watchlist", async () => {
    const r = await run();
    for (const t of r.trades) {
      expect(WATCHLIST).toContain(t.symbol);
    }
  }, 120_000);
});

describe("runBacktest — fail-closed and guard behavior", () => {
  it("produces ZERO trades on edgeless random-walk data (consensus fails closed)", async () => {
    const r = await runBacktest({
      provider: new DeterministicProvider({ seed: 42 }),
      startSeconds: START,
      endSeconds: START + 5 * 86_400,
      decisionTimeframe: "15m",
    });
    expect(r.metrics.tradeCount).toBe(0);
    expect(r.trades).toEqual([]);
    expect(r.dataMode).toBe("synthetic");
  }, 120_000);

  it("rejects an inverted time range", async () => {
    await expect(
      runBacktest({
        provider: new DeterministicProvider(),
        startSeconds: START,
        endSeconds: START, // not after start
      }),
    ).rejects.toThrow(/end must be after start/i);
  });

  it("uses the injected news bundle when provided", async () => {
    const news = unavailableNewsBundle(WATCHLIST, START);
    expect(news.available).toBe(false);
    expect(news.bySymbol["BTC/USDT"]).toEqual([]);
    // Passing it explicitly should still run without error.
    const r = await runBacktest({
      provider: new DeterministicProvider({ seed: 1 }),
      startSeconds: START,
      endSeconds: START + 2 * 86_400,
      news,
    });
    expect(r.dataMode).toBe("synthetic");
  }, 120_000);

  it("honors a caller-supplied starting equity", async () => {
    const r = await runBacktest({
      provider: trendingProvider(7),
      startSeconds: START,
      endSeconds: START + 4 * 86_400,
      startingEquityUsdt: 5_000,
    });
    expect(r.startingEquity).toBe(5_000);
    expect(r.startingEquity).not.toBe(PAPER_DEFAULTS.startingEquityUsdt);
  }, 120_000);
});

describe("unavailableNewsBundle", () => {
  it("is unavailable, non-degraded, and empty for every requested symbol", () => {
    const b = unavailableNewsBundle(["BTC/USDT", "ETH/USDT"], 123);
    expect(b.available).toBe(false);
    expect(b.degraded).toBe(false);
    expect(b.fetchedAt).toBe(123);
    expect(b.marketWide).toEqual([]);
    expect(b.bySymbol["BTC/USDT"]).toEqual([]);
    expect(b.bySymbol["ETH/USDT"]).toEqual([]);
    expect(b.errors.length).toBeGreaterThan(0);
  });
});
