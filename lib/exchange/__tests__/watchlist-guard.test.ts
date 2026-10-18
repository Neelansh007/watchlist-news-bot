import { describe, expect, it } from "vitest";
import { loadFixture } from "../../../tests/helpers/load-fixture";
import { parseInstrumentsResponse } from "../parsers";
import { MockProvider } from "../providers/mock";
import { assertWatchlistSymbol, discoverWatchlistInstruments } from "../watchlist-guard";
import { SafetyError } from "@/lib/safety/errors";
import { WATCHLIST } from "@/lib/config/watchlist";

const fixtureInstruments = parseInstrumentsResponse(loadFixture("mudrex/futures-response.json"));

describe("assertWatchlistSymbol", () => {
  it("accepts every watchlist symbol", () => {
    for (const s of WATCHLIST) {
      expect(() => assertWatchlistSymbol(s)).not.toThrow();
    }
  });

  it("rejects symbols outside the watchlist, even exchange-listed ones", async () => {
    expect(() => assertWatchlistSymbol("DOGE/USDT")).toThrow(SafetyError);
    try {
      assertWatchlistSymbol("DOGE/USDT");
      expect.unreachable();
    } catch (e) {
      expect((e as SafetyError).code).toBe("SYMBOL_NOT_IN_WATCHLIST");
    }
  });

  it("rejects empty and hostile inputs", () => {
    expect(() => assertWatchlistSymbol("")).toThrow(SafetyError);
    expect(() => assertWatchlistSymbol("BTC/USDT'; DROP TABLE positions;--")).toThrow(SafetyError);
  });
});

describe("discoverWatchlistInstruments", () => {
  it("marks listed watchlist symbols AVAILABLE and missing ones UNAVAILABLE with a reason", async () => {
    // Fixture deliberately lists DOGEUSDT (non-watchlist) and omits XAUUSDT.
    const provider = new MockProvider({ instruments: fixtureInstruments });
    const result = await discoverWatchlistInstruments(provider);

    expect(result.entries).toHaveLength(WATCHLIST.length);
    expect(result.unavailable.map((e) => e.symbol)).toEqual(["XAU/USDT"]);
    expect(result.unavailable[0].reason).toMatch(/Not listed/);
    expect(result.unavailable[0].instrument).toBeNull();

    const btc = result.available.find((e) => e.symbol === "BTC/USDT")!;
    expect(btc.instrument?.exchangeSymbol).toBe("BTCUSDT");
  });

  it("never includes non-watchlist symbols in the discovery result", async () => {
    const provider = new MockProvider({ instruments: fixtureInstruments });
    const result = await discoverWatchlistInstruments(provider);
    expect(result.entries.map((e) => e.symbol)).not.toContain("DOGE/USDT");
  });

  it("marks EVERYTHING unavailable (never fakes data) when the exchange lists nothing", async () => {
    const provider = new MockProvider({ instruments: [] });
    const result = await discoverWatchlistInstruments(provider);
    expect(result.available).toHaveLength(0);
    expect(result.unavailable).toHaveLength(WATCHLIST.length);
  });
});
