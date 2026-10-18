/**
 * Candle series validation: OHLC sanity, duplicates, ordering, gaps, staleness.
 * Fail closed — the orchestrator must treat any blocking issue as NO_TRADE
 * for the affected symbol. Nothing here mutates or "repairs" data.
 */
import type { Candle, Timeframe } from "@/lib/exchange/types";

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
};

export type ValidationIssueCode =
  | "EMPTY"
  | "OHLC_INVALID"
  | "NON_POSITIVE_PRICE"
  | "NEGATIVE_VOLUME"
  | "NON_FINITE"
  | "DUPLICATE"
  | "UNORDERED"
  | "GAP"
  | "STALE";

export interface ValidationIssue {
  code: ValidationIssueCode;
  /** Index in the input array when applicable. */
  index?: number;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  symbol: string;
  timeframe: Timeframe;
  candleCount: number;
  issues: ValidationIssue[];
}

export interface ValidateSeriesOptions {
  /** Current time in epoch seconds (injectable for tests). */
  nowSeconds: number;
  /** Max tolerated missing consecutive slots before a GAP issue is raised. Default 0 (zero tolerance). */
  maxGapSlots?: number;
  /** Max age of the newest candle's START time plus one slot. Default: 3 slots + 60s. */
  maxStalenessSeconds?: number;
}

/** Validate a single candle's OHLC integrity. */
export function validateCandleOHLC(c: Candle): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const values = [c.open, c.high, c.low, c.close, c.volume, c.startTime];
  if (values.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
    issues.push({ code: "NON_FINITE", message: `Non-finite numeric in candle @${c.startTime}` });
    return issues; // further checks meaningless
  }
  if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
    issues.push({ code: "NON_POSITIVE_PRICE", message: `Non-positive price in candle @${c.startTime}` });
  }
  if (c.volume < 0) {
    issues.push({ code: "NEGATIVE_VOLUME", message: `Negative volume in candle @${c.startTime}` });
  }
  const bodyHigh = Math.max(c.open, c.close);
  const bodyLow = Math.min(c.open, c.close);
  if (c.high < bodyHigh || c.low > bodyLow || c.high < c.low) {
    issues.push({
      code: "OHLC_INVALID",
      message:
        `OHLC invariant violated in candle @${c.startTime}: ` +
        `need high>=max(o,c), low<=min(o,c), high>=low; got o=${c.open} h=${c.high} l=${c.low} c=${c.close}`,
    });
  }
  return issues;
}

/** Validate a whole series (expected sorted ascending by startTime; violations are reported, not fixed). */
export function validateCandleSeries(
  symbol: string,
  timeframe: Timeframe,
  candles: Candle[],
  opts: ValidateSeriesOptions,
): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (candles.length === 0) {
    issues.push({ code: "EMPTY", message: `No candles returned for ${symbol} ${timeframe}` });
    return { ok: false, symbol, timeframe, candleCount: 0, issues };
  }

  const step = TIMEFRAME_SECONDS[timeframe];
  const maxGapSlots = opts.maxGapSlots ?? 0;
  const maxStaleness = opts.maxStalenessSeconds ?? step * 3 + 60;

  const seen = new Set<number>();
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    for (const issue of validateCandleOHLC(c)) issues.push({ ...issue, index: i });
    if (c.symbol !== symbol || c.timeframe !== timeframe) {
      issues.push({
        code: "OHLC_INVALID",
        index: i,
        message: `Candle label mismatch at ${i}: expected ${symbol}/${timeframe}, got ${c.symbol}/${c.timeframe}`,
      });
    }
    if (c.startTime % step !== 0) {
      issues.push({
        code: "OHLC_INVALID",
        index: i,
        message: `Candle startTime ${c.startTime} is not aligned to ${timeframe} slot (${step}s)`,
      });
    }
    if (seen.has(c.startTime)) {
      issues.push({ code: "DUPLICATE", index: i, message: `Duplicate candle startTime ${c.startTime}` });
    }
    seen.add(c.startTime);
    if (i > 0) {
      const prev = candles[i - 1];
      const delta = c.startTime - prev.startTime;
      if (delta < 0) {
        issues.push({
          code: "UNORDERED",
          index: i,
          message: `Candles out of order at ${i}: ${prev.startTime} -> ${c.startTime}`,
        });
      } else if (delta > step * (maxGapSlots + 1)) {
        const missing = delta / step - 1;
        issues.push({
          code: "GAP",
          index: i,
          message: `Gap of ${missing} missing ${timeframe} candle(s) between ${prev.startTime} and ${c.startTime}`,
        });
      }
    }
  }

  const newest = candles[candles.length - 1];
  const age = opts.nowSeconds - (newest.startTime + step);
  if (age > maxStaleness) {
    issues.push({
      code: "STALE",
      message:
        `Newest ${symbol} ${timeframe} candle is ${age}s old (limit ${maxStaleness}s). ` +
        `Data is stale — fail closed.`,
    });
  }

  return { ok: issues.length === 0, symbol, timeframe, candleCount: candles.length, issues };
}
