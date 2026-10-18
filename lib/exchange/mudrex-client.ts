/**
 * Mudrex REST client (provider kind: "mudrex").
 *
 * Verified against docs.trade.mudrex.com (2026-10-04):
 *   - Base URL https://trade.mudrex.com/fapi/v1
 *   - Auth header: X-Authentication: <api secret>  (NOT x-api-key/x-api-secret)
 *   - GET /futures (auth), GET /price/kline (public)
 *
 * SAFETY: createOrder/cancelOrder/setLeverage call assertLiveTradingEnabled(),
 * which throws SafetyError unless all three live gates are open. In this build
 * the code-level master switch is OFF, so writes ALWAYS throw. Even with live
 * enabled, order routing is intentionally NOT implemented in this paper-first
 * build — there is no code path that can place a real order.
 *
 * The API secret is only ever placed in the X-Authentication header.
 * It is never logged, never included in error messages, never printed.
 */
import type { Env } from "@/lib/config/env";
import { DataError, ParseError, SafetyError } from "@/lib/safety/errors";
import { assertLiveTradingEnabled } from "@/lib/safety/live-guard";
import {
  parseInstrumentsResponse,
  parseKlineResponse,
  TIMEFRAME_TO_AGGREGATION,
} from "./parsers";
import { assertWatchlistSymbol } from "./watchlist-guard";
import type {
  Candle,
  ExchangeProvider,
  Instrument,
  OrderRequest,
  OrderResult,
  Timeframe,
} from "./types";
import type { WatchlistSymbol } from "@/lib/config/watchlist";

const REQUEST_TIMEOUT_MS = 15_000;

export class MudrexProvider implements ExchangeProvider {
  readonly kind = "mudrex" as const;

  constructor(private readonly env: Env) {}

  private async getJson(
    pathname: string,
    params: Record<string, string>,
    opts: { auth: boolean },
  ): Promise<unknown> {
    const url = new URL(this.env.MUDREX_BASE_URL.replace(/\/$/, "") + pathname);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.auth) {
      if (!this.env.MUDREX_API_SECRET) {
        throw new DataError(
          `MUDREX_API_SECRET is not set but GET ${pathname} requires authentication. ` +
            `Fill it in .env, or run in a mode that uses the deterministic/mock provider.`,
        );
      }
      headers["X-Authentication"] = this.env.MUDREX_API_SECRET;
    }

    let res: Response;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      // Network-level failure: fail closed with a clear error (no secret details).
      throw new DataError(
        `Network error calling Mudrex GET ${pathname}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok) {
      throw new DataError(`Mudrex HTTP ${res.status} for GET ${pathname}`);
    }
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new ParseError(`Mudrex GET ${pathname} returned non-JSON body (${text.length} bytes)`);
    }
  }

  async fetchInstruments(): Promise<Instrument[]> {
    const payload = await this.getJson("/futures", {}, { auth: true });
    return parseInstrumentsResponse(payload);
  }

  async fetchCandles(
    symbol: WatchlistSymbol,
    timeframe: Timeframe,
    startTimeSeconds: number,
    endTimeSeconds: number,
  ): Promise<Candle[]> {
    assertWatchlistSymbol(symbol);
    if (!Number.isInteger(startTimeSeconds) || !Number.isInteger(endTimeSeconds)) {
      throw new SafetyError(
        "INVALID_TIME_RANGE",
        "Candle start/end times must be integer epoch SECONDS (Mudrex convention).",
      );
    }
    // Catch ms-vs-seconds confusion loudly (epoch seconds stay < 4.1e9 until year 2100).
    if (startTimeSeconds < 0 || endTimeSeconds > 4_100_000_000) {
      throw new SafetyError(
        "INVALID_TIME_RANGE",
        `Candle times look like milliseconds, not epoch seconds (got ${startTimeSeconds}..${endTimeSeconds}). Mudrex uses SECONDS.`,
      );
    }
    const payload = await this.getJson(
      "/price/kline",
      {
        assets: symbol,
        aggregation: TIMEFRAME_TO_AGGREGATION[timeframe],
        start_time: String(startTimeSeconds),
        end_time: String(endTimeSeconds),
      },
      { auth: false },
    );
    return parseKlineResponse(payload, symbol, timeframe);
  }

  // --- Write operations: hard-guarded. No bypass path. ---

  async createOrder(_req: OrderRequest): Promise<OrderResult> {
    assertLiveTradingEnabled(this.env, "createOrder");
    throw new SafetyError(
      "LIVE_ORDER_ROUTING_NOT_IMPLEMENTED",
      "Live order routing is intentionally not implemented in this paper-first build.",
    );
  }

  async cancelOrder(_orderId: string): Promise<OrderResult> {
    assertLiveTradingEnabled(this.env, "cancelOrder");
    throw new SafetyError(
      "LIVE_ORDER_ROUTING_NOT_IMPLEMENTED",
      "Live order routing is intentionally not implemented in this paper-first build.",
    );
  }

  async setLeverage(_symbol: WatchlistSymbol, _leverage: number): Promise<void> {
    assertLiveTradingEnabled(this.env, "setLeverage");
    throw new SafetyError(
      "LIVE_ORDER_ROUTING_NOT_IMPLEMENTED",
      "Live leverage setting is intentionally not implemented in this paper-first build.",
    );
  }
}
