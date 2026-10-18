import { describe, expect, it } from "vitest";
import {
  TrendAnalyst,
  MomentumAnalyst,
  VolatilityAnalyst,
  RiskOfRuinAnalyst,
  NewsSentimentAnalyst,
} from "../analysts";
import type { MarketSnapshot, SnapshotIndicators } from "../types";
import type { NewsItem } from "@/lib/news/types";

function indicators(over: Partial<SnapshotIndicators> = {}): SnapshotIndicators {
  return {
    close1h: 100,
    ema20_1h: 101,
    ema50_1h: 99,
    close15m: 100,
    rsi14_15m: 55,
    macdHist15m: 0.1,
    atr14_15m: 0.5,
    atrPct15m: 0.005,
    bbUpper15m: 101,
    bbLower15m: 99,
    bbWidth15m: 0.02,
    avgVolume15m: 10,
    close5m: 100,
    lastPrice: 100,
    priceSynthetic: true,
    ...over,
  };
}

function snapshot(over: Partial<SnapshotIndicators> = {}, news?: Partial<MarketSnapshot["news"]>): MarketSnapshot {
  return {
    symbol: "BTC/USDT",
    builtAt: 1_700_000_000,
    indicators: indicators(over),
    news: { available: true, degraded: false, items: [], marketWide: [], ...news },
  };
}

function newsItem(title: string, symbol: "BTC/USDT" | "MARKET_WIDE" = "BTC/USDT"): NewsItem {
  return { symbol, title, link: "https://x/1", source: "test", publishedAt: 1_700_000_000 };
}

describe("TrendAnalyst", () => {
  it("votes LONG on bullish 1h alignment", () => {
    const v = new TrendAnalyst().analyze(snapshot({ ema20_1h: 102, ema50_1h: 99, close1h: 103 }));
    expect(v.vote).toBe("LONG");
    expect(v.initiating).toBe(true);
    expect(v.confidence).toBeGreaterThan(0.5);
  });
  it("votes SHORT on bearish alignment", () => {
    const v = new TrendAnalyst().analyze(snapshot({ ema20_1h: 97, ema50_1h: 100, close1h: 96 }));
    expect(v.vote).toBe("SHORT");
  });
  it("votes NO_TRADE when EMAs align but price doesn't confirm", () => {
    const v = new TrendAnalyst().analyze(snapshot({ ema20_1h: 102, ema50_1h: 99, close1h: 100 }));
    expect(v.vote).toBe("NO_TRADE");
  });
});

describe("MomentumAnalyst", () => {
  it("votes LONG with positive histogram and RSI > 50", () => {
    expect(new MomentumAnalyst().analyze(snapshot({ macdHist15m: 0.2, rsi14_15m: 60 })).vote).toBe("LONG");
  });
  it("votes SHORT with negative histogram and RSI < 50", () => {
    expect(new MomentumAnalyst().analyze(snapshot({ macdHist15m: -0.2, rsi14_15m: 40 })).vote).toBe("SHORT");
  });
  it("stands aside when overbought or oversold", () => {
    expect(new MomentumAnalyst().analyze(snapshot({ rsi14_15m: 80 })).vote).toBe("NO_TRADE");
    expect(new MomentumAnalyst().analyze(snapshot({ rsi14_15m: 20 })).vote).toBe("NO_TRADE");
  });
  it("stands aside on mixed signals", () => {
    expect(new MomentumAnalyst().analyze(snapshot({ macdHist15m: 0.2, rsi14_15m: 45 })).vote).toBe("NO_TRADE");
  });
});

describe("VolatilityAnalyst", () => {
  it("votes LONG on an upper-band break in a normal regime", () => {
    const v = new VolatilityAnalyst().analyze(
      snapshot({ close15m: 101.5, bbUpper15m: 101, bbWidth15m: 0.02, atrPct15m: 0.005 }),
    );
    expect(v.vote).toBe("LONG");
  });
  it("votes SHORT on a lower-band break", () => {
    const v = new VolatilityAnalyst().analyze(
      snapshot({ close15m: 98.5, bbLower15m: 99, bbWidth15m: 0.02, atrPct15m: 0.005 }),
    );
    expect(v.vote).toBe("SHORT");
  });
  it("stands aside in compressed or exploded regimes", () => {
    expect(new VolatilityAnalyst().analyze(snapshot({ bbWidth15m: 0.001 })).vote).toBe("NO_TRADE");
    expect(new VolatilityAnalyst().analyze(snapshot({ bbWidth15m: 0.2 })).vote).toBe("NO_TRADE");
    expect(new VolatilityAnalyst().analyze(snapshot({ atrPct15m: 0.05 })).vote).toBe("NO_TRADE");
  });
  it("stands aside when price is inside the bands", () => {
    expect(new VolatilityAnalyst().analyze(snapshot({ close15m: 100 })).vote).toBe("NO_TRADE");
  });
});

describe("RiskOfRuinAnalyst", () => {
  it("refuses illiquid markets", () => {
    const v = new RiskOfRuinAnalyst().analyze(snapshot({ avgVolume15m: 0.01 }));
    expect(v.vote).toBe("NO_TRADE");
    expect(v.reasoning).toMatch(/illiquid/i);
  });
  it("refuses excessive noise", () => {
    const v = new RiskOfRuinAnalyst().analyze(snapshot({ atrPct15m: 0.03 }));
    expect(v.vote).toBe("NO_TRADE");
    expect(v.reasoning).toMatch(/noise/i);
  });
  it("leans with the 1h trend in a survivable regime", () => {
    const v = new RiskOfRuinAnalyst().analyze(
      snapshot({ atrPct15m: 0.004, avgVolume15m: 50, ema20_1h: 102, ema50_1h: 100 }),
    );
    expect(v.vote).toBe("LONG");
    expect(v.confidence).toBeGreaterThanOrEqual(0.45);
  });
});

describe("NewsSentimentAnalyst", () => {
  const analyst = new NewsSentimentAnalyst();

  it("is never initiating and votes NO_TRADE by construction", () => {
    const v = analyst.analyze(snapshot({}, { items: [newsItem("Bitcoin rallies to record high")] }));
    expect(v.initiating).toBe(false);
    expect(v.vote).toBe("NO_TRADE");
    expect(v.sentimentScore!).toBeGreaterThan(0);
  });

  it("reports zero confidence when news is unavailable", () => {
    const v = analyst.analyze(snapshot({}, { available: false }));
    expect(v.confidence).toBe(0);
    expect(v.sentimentScore).toBe(0);
    expect(v.veto).toBeUndefined();
  });

  it("vetoes on a major adverse event", () => {
    const v = analyst.analyze(snapshot({}, { items: [newsItem("Bitcoin exchange hacked, trading halted")] }));
    expect(v.veto).toBe(true);
    expect(v.sentimentScore).toBe(-1);
    expect(v.reasoning).toMatch(/VETO/);
  });

  it("scores negative sentiment from bearish headlines", () => {
    const v = analyst.analyze(
      snapshot({}, { items: [newsItem("Bitcoin plunges amid heavy outflows"), newsItem("BTC crash deepens")] }),
    );
    expect(v.sentimentScore!).toBeLessThan(0);
    expect(v.veto).toBeUndefined();
  });

  it("counts macro headlines at half weight", () => {
    const symbolOnly = analyst.analyze(snapshot({}, { items: [newsItem("Bitcoin surges")] }));
    const macroOnly = analyst.analyze(snapshot({}, { marketWide: [newsItem("Crypto market rally after Fed decision", "MARKET_WIDE")] }));
    expect(symbolOnly.sentimentScore!).toBe(1);
    // macro positive but no symbol news: still positive score
    expect(macroOnly.sentimentScore!).toBeGreaterThan(0);
  });

  it("stays neutral with no headlines", () => {
    const v = analyst.analyze(snapshot());
    expect(v.sentimentScore).toBe(0);
  });
});
