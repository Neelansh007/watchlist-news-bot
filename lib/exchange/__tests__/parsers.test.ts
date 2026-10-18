import { describe, expect, it } from "vitest";
import { loadFixture } from "../../../tests/helpers/load-fixture";
import {
  parseInstrumentsResponse,
  parseKlineResponse,
  canonicalFromExchangeSymbol,
} from "../parsers";
import { ParseError } from "@/lib/safety/errors";

const futuresFixture = loadFixture("mudrex/futures-response.json");
const klineFixture = loadFixture("mudrex/kline-response.json");

describe("parseInstrumentsResponse (fixture shape verified against docs)", () => {
  it("parses the fixture into typed instruments with numbers, not strings", () => {
    const instruments = parseInstrumentsResponse(futuresFixture);
    expect(instruments.length).toBe(7);
    const btc = instruments.find((i) => i.exchangeSymbol === "BTCUSDT")!;
    expect(btc.canonicalSymbol).toBe("BTC/USDT");
    expect(btc.minContract).toBe(0.001);
    expect(btc.maxLeverage).toBe(150);
    expect(btc.price).toBe(83579.9);
    expect(typeof btc.minNotionalValue).toBe("number");
    // raw payload kept for audit
    expect((btc.raw as Record<string, unknown>).min_contract).toBe("0.001");
  });

  it("canonicalizes only USDT-quoted symbols", () => {
    expect(canonicalFromExchangeSymbol("BTCUSDT")).toBe("BTC/USDT");
    expect(canonicalFromExchangeSymbol("btcusdt")).toBe("BTC/USDT");
    expect(canonicalFromExchangeSymbol("BTCUSD")).toBeNull();
    expect(canonicalFromExchangeSymbol("USDT")).toBeNull();
  });

  it("rejects a malformed payload with ParseError", () => {
    expect(() => parseInstrumentsResponse({ foo: 1 })).toThrow(ParseError);
    expect(() => parseInstrumentsResponse({ success: true })).toThrow(ParseError);
    expect(() => parseInstrumentsResponse({ success: "yes", data: [] })).toThrow(ParseError);
    expect(() => parseInstrumentsResponse(null)).toThrow(ParseError);
  });

  it("rejects success=false", () => {
    expect(() => parseInstrumentsResponse({ success: false, data: [] })).toThrow(
      /success=false/,
    );
  });

  it("rejects an instrument with a non-numeric string field", () => {
    const bad = {
      success: true,
      data: [
        {
          id: "x",
          name: "Fake",
          symbol: "FAKEUSDT",
          min_contract: "soon",
          max_contract: "1",
          quantity_step: "1",
          min_notional_value: "5",
          min_leverage: "1",
          max_leverage: "10",
          price: "1",
        },
      ],
    };
    expect(() => parseInstrumentsResponse(bad)).toThrow(ParseError);
  });

  it("rejects an instrument missing required fields", () => {
    expect(() =>
      parseInstrumentsResponse({ success: true, data: [{ id: "x", name: "y", symbol: "ZUSDT" }] }),
    ).toThrow(ParseError);
  });
});

describe("parseKlineResponse (fixture shape verified against docs)", () => {
  it("parses positional [ts,o,h,l,c,v] arrays keyed by lowercase symbol", () => {
    const candles = parseKlineResponse(klineFixture, "BTC/USDT", "5m");
    expect(candles).toHaveLength(3);
    expect(candles[0]).toEqual({
      symbol: "BTC/USDT",
      timeframe: "5m",
      startTime: 1680312600,
      open: 28436.6,
      high: 28449.81,
      low: 28430.1,
      close: 28449.81,
      volume: 0.742521,
    });
    // epoch SECONDS, not ms
    expect(candles[0].startTime).toBeLessThan(10_000_000_000);
  });

  it("returns an empty array when the exchange silently dropped the pair (never fabricate)", () => {
    const candles = parseKlineResponse(klineFixture, "XAU/USDT", "5m");
    expect(candles).toEqual([]);
  });

  it("rejects malformed payloads with ParseError", () => {
    expect(() => parseKlineResponse({}, "BTC/USDT", "5m")).toThrow(ParseError);
    expect(() => parseKlineResponse({ data: {} }, "BTC/USDT", "5m")).toThrow(ParseError);
    expect(() => parseKlineResponse({ success: false, data: { asset_ticks: {} } }, "BTC/USDT", "5m")).toThrow(
      /success=false/,
    );
  });

  it("rejects candle arrays with the wrong length or element types", () => {
    const short = { data: { asset_ticks: { "btc/usdt": [[1680312600, 1, 2, 3, 4]] } } };
    expect(() => parseKlineResponse(short, "BTC/USDT", "5m")).toThrow(ParseError);
    const badType = { data: { asset_ticks: { "btc/usdt": [[1680312600, "x", 2, 3, 4, 5]] } } };
    expect(() => parseKlineResponse(badType, "BTC/USDT", "5m")).toThrow(ParseError);
  });

  it("accepts numeric strings as well as numbers (documented tolerance)", () => {
    const strNums = {
      data: { asset_ticks: { "btc/usdt": [["1680312600", "1", "2", "0.5", "1.5", "10"]] } },
    };
    const candles = parseKlineResponse(strNums, "BTC/USDT", "5m");
    expect(candles[0]).toMatchObject({ startTime: 1680312600, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 });
  });
});
