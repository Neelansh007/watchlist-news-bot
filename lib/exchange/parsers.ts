/**
 * Strict parsers for Mudrex REST responses.
 *
 * VERIFIED against docs.trade.mudrex.com on 2026-10-04:
 *  - GET /fapi/v1/futures         -> { success, data: [ {id, name, symbol, min_contract, ... , price} ] }
 *    all numeric fields are STRINGS; funding_interval/previous_funding_interval are integer numbers.
 *  - GET /fapi/v1/price/kline     -> { success, data: { asset_ticks: { "btc/usdt": [[ts,o,h,l,c,v], ...] } } }
 *    keys are lowercase "base/quote"; ts is epoch seconds; OHLCV are JSON numbers in the doc example.
 *
 * ASSUMPTION (documented, to verify in the live-API test):
 *  - Numeric tolerance: instrument fields are parsed as string|number and kline
 *    values as number|string. The docs show strings for instruments and numbers
 *    for klines; accepting both is deliberate robustness, everything else is strict.
 *  - Unknown extra fields are stripped (exchanges add fields over time); MISSING
 *    or malformed required fields always raise ParseError -> caller must NO_TRADE.
 */
import { z } from "zod";
import { ParseError } from "@/lib/safety/errors";
import { normalizeSymbol } from "@/lib/config/watchlist";
import type { Candle, Instrument, Timeframe } from "./types";

const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;

/** Accepts a JSON number or a numeric string; yields a finite number. */
const numericField = z
  .union([z.number(), z.string().regex(NUMERIC_STRING, "not a numeric string")])
  .transform((v) => (typeof v === "number" ? v : Number(v)))
  .refine((n) => Number.isFinite(n), "not finite");

const epochSecondsField = z
  .union([z.number().int(), z.string().regex(/^\d+$/)])
  .transform((v) => (typeof v === "number" ? v : Number(v)));

// --- GET /futures -----------------------------------------------------------

const mudrexInstrumentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  symbol: z.string().min(1),
  min_contract: numericField,
  max_contract: numericField,
  quantity_step: numericField,
  min_notional_value: numericField,
  min_leverage: numericField,
  max_leverage: numericField,
  price: numericField.nullish(),
});

const instrumentsEnvelopeSchema = z.object({
  success: z.boolean(),
  data: z.array(z.unknown()),
});

/** "BTCUSDT" -> "BTC/USDT" (all Mudrex futures are USDT-quoted per docs example). */
export function canonicalFromExchangeSymbol(exchangeSymbol: string): string | null {
  const s = normalizeSymbol(exchangeSymbol);
  if (s.length > 4 && s.endsWith("USDT")) {
    return `${s.slice(0, -4)}/USDT`;
  }
  return null;
}

export function parseInstrumentsResponse(payload: unknown): Instrument[] {
  const envelope = instrumentsEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new ParseError(
      `Malformed GET /futures response: ${envelope.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  if (envelope.data.success !== true) {
    throw new ParseError("Mudrex GET /futures returned success=false");
  }
  return envelope.data.data.map((rawItem, idx) => {
    const parsed = mudrexInstrumentSchema.safeParse(rawItem);
    if (!parsed.success) {
      throw new ParseError(
        `Malformed instrument at GET /futures data[${idx}]: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
    }
    const raw = parsed.data;
    return {
      exchangeSymbol: normalizeSymbol(raw.symbol),
      canonicalSymbol: canonicalFromExchangeSymbol(raw.symbol),
      id: raw.id,
      name: raw.name,
      minContract: raw.min_contract,
      maxContract: raw.max_contract,
      quantityStep: raw.quantity_step,
      minNotionalValue: raw.min_notional_value,
      minLeverage: raw.min_leverage,
      maxLeverage: raw.max_leverage,
      price: raw.price ?? null,
      raw: rawItem, // original payload as received, for audit
    };
  });
}

// --- GET /price/kline --------------------------------------------------------

/**
 * ASSUMPTION to verify live: minute aggregations use a "t" suffix in the docs
 * (3t, 5t, 10t, 15t, 30t) while "1m" is one minute and "1mth" is one month.
 */
export const TIMEFRAME_TO_AGGREGATION: Record<Timeframe, string> = {
  "1m": "1m",
  "5m": "5t",
  "15m": "15t",
  "1h": "1h",
};

const candleTupleSchema = z.tuple([
  epochSecondsField,
  numericField,
  numericField,
  numericField,
  numericField,
  numericField,
]);

const klineResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z.object({
    asset_ticks: z.record(z.string(), z.array(candleTupleSchema)),
  }),
});

/**
 * Parse a kline response for ONE requested symbol.
 * Docs: unrecognized pairs are dropped SILENTLY — a missing key therefore
 * yields an empty array (caller must treat that as UNAVAILABLE, never guess).
 */
export function parseKlineResponse(payload: unknown, symbol: string, timeframe: Timeframe): Candle[] {
  const result = klineResponseSchema.safeParse(payload);
  if (!result.success) {
    throw new ParseError(
      `Malformed GET /price/kline response: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  if (result.data.success === false) {
    throw new ParseError("Mudrex GET /price/kline returned success=false");
  }
  const key = normalizeSymbol(symbol).toLowerCase();
  const rows = result.data.data.asset_ticks[key] ?? [];
  return rows.map(([startTime, open, high, low, close, volume]) => ({
    symbol: normalizeSymbol(symbol),
    timeframe,
    startTime,
    open,
    high,
    low,
    close,
    volume,
  }));
}
