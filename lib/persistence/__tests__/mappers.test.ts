import { describe, expect, it } from "vitest";
import {
  PAPER_SETTINGS_KEY,
  fromNumeric,
  fromPositionRow,
  newsToRows,
  parsePaperSettings,
  toConsensusRow,
  toJournalRow,
  toNumeric,
  toPositionRow,
  toReviewRow,
  toRiskEventRow,
  toVoteRow,
  type PositionDbRow,
} from "@/lib/persistence/mappers";
import type { NewsBundle } from "@/lib/news/types";
import type { PaperPosition } from "@/lib/oms/types";

const openPosition: PaperPosition = {
  id: 3,
  symbol: "ETH/USDT",
  side: "SHORT",
  qty: 1.234567890123,
  leverage: 3,
  intendedEntryPrice: 3_000.5,
  entryFillPrice: 3_001.2,
  stopLoss: 3_050.75,
  takeProfit: 2_900.25,
  rewardRisk: 2,
  margin: 1_234.5,
  entryFee: 1.5,
  openedAtSeconds: 1_800_000_000,
  maxHoldUntilSeconds: 1_800_014_400,
  status: "OPEN",
  gapThroughStop: false,
};

const closedPosition: PaperPosition = {
  ...openPosition,
  id: 4,
  status: "CLOSED",
  closeReason: "STOP_LOSS",
  rawExitPrice: 3_050.75,
  exitFillPrice: 3_051.66,
  exitFee: 1.9,
  realizedPnl: -63.21,
  closedAtSeconds: 1_800_003_600,
  gapThroughStop: true,
};

function rowFor(p: PaperPosition, id = p.id): PositionDbRow {
  return { id, ...toPositionRow(p) };
}

describe("numeric mapping", () => {
  it("round-trips numbers through fixed-precision strings", () => {
    expect(toNumeric(1.234567890123)).toBe("1.234567890123");
    expect(fromNumeric(toNumeric(0.1))).toBe(0.1);
    expect(fromNumeric("  ")).toBeNull();
    expect(fromNumeric("")).toBeNull();
    expect(fromNumeric("not-a-number")).toBeNull();
    expect(fromNumeric(null)).toBeNull();
  });

  it("refuses to persist non-finite numbers", () => {
    expect(() => toNumeric(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
    expect(() => toNumeric(Number.NaN)).toThrow(/non-finite/);
  });
});

describe("position mapping", () => {
  it("round-trips an open position exactly", () => {
    expect(fromPositionRow(rowFor(openPosition))).toEqual(openPosition);
  });

  it("round-trips a closed position with all exit fields", () => {
    expect(fromPositionRow(rowFor(closedPosition))).toEqual(closedPosition);
  });

  it("throws on a corrupt numeric column instead of guessing", () => {
    const row = { ...rowFor(openPosition), qty: "garbage" };
    expect(() => fromPositionRow(row)).toThrow(/corrupt numeric column "qty"/);
  });
});

describe("paper settings", () => {
  it("parses a complete settings object", () => {
    const settings = {
      startingEquityUsdt: 10_000,
      equityPeak: 10_500,
      dayStartEquity: 10_200,
      dayKey: 20_833,
      dailyLossHalted: false,
      drawdownHalted: false,
      lastProcessedCandleTs: 1_800_000_000,
    };
    expect(parsePaperSettings(settings)).toEqual(settings);
    expect(PAPER_SETTINGS_KEY).toBe("paper_oms_state");
  });

  it("rejects malformed settings", () => {
    expect(() => parsePaperSettings({ startingEquityUsdt: 10_000 })).toThrow();
    expect(() =>
      parsePaperSettings({
        startingEquityUsdt: -1,
        equityPeak: 10_500,
        dayStartEquity: 10_200,
        dayKey: 20_833,
        dailyLossHalted: false,
        drawdownHalted: false,
        lastProcessedCandleTs: null,
      }),
    ).toThrow();
  });
});

describe("decision row mapping", () => {
  it("maps votes including news-only fields", () => {
    const vote = {
      agent: "news-sentiment",
      symbol: "BTC/USDT" as const,
      vote: "NO_TRADE" as const,
      confidence: 0.3,
      reasoning: "neutral",
      initiating: false,
      veto: true,
      sentimentScore: -0.5,
    };
    expect(toVoteRow(9, vote)).toEqual({
      cycleId: 9,
      agent: "news-sentiment",
      symbol: "BTC/USDT",
      vote: "NO_TRADE",
      confidence: 0.3,
      reasoning: "neutral",
      initiating: false,
      veto: true,
      sentimentScore: -0.5,
    });
  });

  it("maps consensus, review, risk events and journal entries", () => {
    const consensus = {
      symbol: "BTC/USDT" as const,
      decision: "LONG" as const,
      confidence: 0.72,
      votesFor: 3,
      votesAgainst: 1,
      votesTotal: 5,
      reason: "majority",
    };
    expect(toConsensusRow(1, consensus)).toMatchObject({ cycleId: 1, decision: "LONG" });

    expect(
      toReviewRow(2, "BTC/USDT", {
        decision: "APPROVE",
        reasoning: "ok",
        model: "m",
      }),
    ).toEqual({ cycleId: 2, symbol: "BTC/USDT", decision: "APPROVE", model: "m", reasoning: "ok" });

    expect(
      toRiskEventRow(3, "BTC/USDT", {
        limit: "maxLeverage",
        action: "BLOCK_ENTRY",
        message: "too much",
      }),
    ).toEqual({
      cycleId: 3,
      symbol: "BTC/USDT",
      limit: "maxLeverage",
      action: "BLOCK_ENTRY",
      message: "too much",
    });

    const journal = toJournalRow(
      {
        tsSeconds: 1_800_000_000,
        kind: "POSITION_OPENED",
        symbol: "BTC/USDT",
        positionId: 4,
        message: "opened",
        payload: { leverage: 2 },
      },
      5,
    );
    expect(journal.ts.getTime()).toBe(1_800_000_000_000);
    expect(journal.payload).toEqual({ leverage: 2 });
    expect(journal.cycleId).toBe(5);
  });
});

describe("news flattening", () => {
  it("de-duplicates links and keeps per-symbol and market-wide rows", () => {
    const bundle: NewsBundle = {
      available: true,
      degraded: false,
      errors: [],
      fetchedAt: 1_800_000_000,
      bySymbol: {
        "BTC/USDT": [
          {
            symbol: "BTC/USDT",
            title: "Bitcoin rallies",
            link: "https://example.com/a",
            source: "src",
            publishedAt: 1_799_999_000,
          },
          {
            symbol: "BTC/USDT",
            title: "Shared story",
            link: "https://example.com/shared",
            source: "src",
            publishedAt: null,
          },
        ],
        "ETH/USDT": [
          {
            symbol: "ETH/USDT",
            title: "Shared story",
            link: "https://example.com/shared",
            source: "src",
            publishedAt: null,
          },
        ],
      },
      marketWide: [
        {
          symbol: "MARKET_WIDE",
          title: "Macro news",
          link: "https://example.com/macro",
          source: "src",
          publishedAt: 1_799_998_000,
        },
      ],
    };

    const rows = newsToRows(bundle);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.link).sort()).toEqual([
      "https://example.com/a",
      "https://example.com/macro",
      "https://example.com/shared",
    ]);
    expect(rows.find((r) => r.link === "https://example.com/macro")?.symbol).toBe("MARKET_WIDE");
    expect(rows.find((r) => r.link === "https://example.com/a")?.publishedAt?.getTime()).toBe(
      1_799_999_000_000,
    );
  });
});
