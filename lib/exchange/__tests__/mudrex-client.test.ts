import { describe, expect, it, vi, afterEach } from "vitest";
import { parseEnv } from "@/lib/config/env";
import { MudrexProvider } from "../mudrex-client";
import { SafetyError, ParseError, DataError } from "@/lib/safety/errors";
import { loadFixture } from "../../../tests/helpers/load-fixture";

const SECRET = "test-secret-DO-NOT-LEAK";

function envWith(overrides: Record<string, string> = {}) {
  return parseEnv({
    DATABASE_URL: "postgres://u:p@localhost:5432/watchlist_bot",
    MUDREX_API_SECRET: SECRET,
    ...overrides,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MudrexProvider reads", () => {
  it("fetchInstruments sends the X-Authentication header and parses the fixture", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(loadFixture("mudrex/futures-response.json")));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new MudrexProvider(envWith());
    const instruments = await provider.fetchInstruments();

    expect(instruments.length).toBe(7);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/fapi/v1/futures");
    expect((init.headers as Record<string, string>)["X-Authentication"]).toBe(SECRET);
    // no legacy auth headers
    expect(init.headers).not.toHaveProperty("x-api-key");
    expect(init.headers).not.toHaveProperty("x-api-secret");
  });

  it("fetchCandles builds a public kline request with epoch-seconds params", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(loadFixture("mudrex/kline-response.json")));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new MudrexProvider(envWith());
    const candles = await provider.fetchCandles("BTC/USDT", "5m", 1680312600, 1680313200);

    expect(candles).toHaveLength(3);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/fapi/v1/price/kline");
    expect(url.searchParams.get("assets")).toBe("BTC/USDT");
    expect(url.searchParams.get("aggregation")).toBe("5t");
    expect(url.searchParams.get("start_time")).toBe("1680312600");
    expect(url.searchParams.get("end_time")).toBe("1680313200");
    // public endpoint: no auth header
    expect(init.headers).not.toHaveProperty("X-Authentication");
  });

  it("refuses non-integer (e.g. millisecond) timestamps", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const provider = new MudrexProvider(envWith());
    await expect(provider.fetchCandles("BTC/USDT", "5m", 1680312600000.5, 99)).rejects.toThrow(
      SafetyError,
    );
  });

  it("refuses symbols outside the watchlist before any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new MudrexProvider(envWith());
    await expect(provider.fetchCandles("DOGE/USDT" as never, "5m", 0, 100)).rejects.toThrow(
      SafetyError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed with DataError when the secret is missing for an authed call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new MudrexProvider(envWith({ MUDREX_API_SECRET: "" }));
    await expect(provider.fetchInstruments()).rejects.toThrow(DataError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed with DataError on HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ msg: "boom" }, 500)));
    const provider = new MudrexProvider(envWith());
    await expect(provider.fetchInstruments()).rejects.toThrow(DataError);
  });

  it("fails closed with ParseError on non-JSON bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>oops</html>", { status: 200 })),
    );
    const provider = new MudrexProvider(envWith());
    await expect(provider.fetchInstruments()).rejects.toThrow(ParseError);
  });

  it("never leaks the API secret into error messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );
    const provider = new MudrexProvider(envWith());
    try {
      await provider.fetchInstruments();
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain(SECRET);
    }
  });
});

describe("MudrexProvider writes (hard safety rules)", () => {
  it("createOrder/cancelOrder/setLeverage all throw SafetyError without any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new MudrexProvider(
      envWith({
        LIVE_TRADING_ALLOWED: "true",
        LIVE_TRADING_CONFIRMATION: "I-UNDERSTAND-ENABLE-LIVE-TRADING",
      }),
    );
    await expect(
      provider.createOrder({ symbol: "BTC/USDT", side: "BUY", type: "MARKET", qty: 1 }),
    ).rejects.toThrow(SafetyError);
    await expect(provider.cancelOrder("some-order-id")).rejects.toThrow(SafetyError);
    await expect(provider.setLeverage("BTC/USDT", 2)).rejects.toThrow(SafetyError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
