/**
 * Technical indicators — pure functions, no side effects.
 *
 * Conventions:
 *  - Every function returns arrays ALIGNED with the input (index i = value
 *    using data up to and including input[i]), with `null` where there is not
 *    enough data. null always means "insufficient data" and callers must
 *    FAIL CLOSED (treat as NO_TRADE), never substitute 0 or guess.
 *  - Standard textbook formulas (Wilder smoothing for RSI/ATR).
 */
import type { Candle } from "@/lib/exchange/types";

function checkPeriod(period: number): void {
  if (!Number.isInteger(period) || period < 1) {
    throw new Error(`Indicator period must be a positive integer, got ${period}`);
  }
}

export function sma(values: number[], period: number): (number | null)[] {
  checkPeriod(period);
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  checkPeriod(period);
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  checkPeriod(period);
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i] - values[i - 1];
    if (ch >= 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function trueRange(candles: Candle[]): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length === 0) return out;
  out[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    out[i] = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  }
  return out;
}

export function atr(candles: Candle[], period = 14): (number | null)[] {
  checkPeriod(period);
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return out;
  const tr = trueRange(candles);
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i]!;
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]!) / period;
    out[i] = prev;
  }
  return out;
}

export interface MacdResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  checkPeriod(fast);
  checkPeriod(slow);
  checkPeriod(signalPeriod);
  const n = values.length;
  const empty = {
    macd: new Array<number | null>(n).fill(null),
    signal: new Array<number | null>(n).fill(null),
    histogram: new Array<number | null>(n).fill(null),
  };
  if (n < slow) return empty;

  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine: (number | null)[] = new Array(n).fill(null);
  const macdValues: number[] = [];
  const macdIndexes: number[] = [];
  for (let i = 0; i < n; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) {
      const v = emaFast[i]! - emaSlow[i]!;
      macdLine[i] = v;
      macdValues.push(v);
      macdIndexes.push(i);
    }
  }
  if (macdValues.length < signalPeriod) {
    return { macd: macdLine, signal: empty.signal, histogram: empty.histogram };
  }
  const sig = ema(macdValues, signalPeriod);
  const signalLine: (number | null)[] = new Array(n).fill(null);
  const histogram: (number | null)[] = new Array(n).fill(null);
  for (let j = 0; j < sig.length; j++) {
    if (sig[j] !== null) {
      const i = macdIndexes[j];
      signalLine[i] = sig[j];
      histogram[i] = macdLine[i]! - sig[j]!;
    }
  }
  return { macd: macdLine, signal: signalLine, histogram };
}

export interface BollingerResult {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
  width: (number | null)[];
}

export function bollinger(values: number[], period = 20, mult = 2): BollingerResult {
  checkPeriod(period);
  const n = values.length;
  const middle = sma(values, period);
  const upper: (number | null)[] = new Array(n).fill(null);
  const lower: (number | null)[] = new Array(n).fill(null);
  const width: (number | null)[] = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let varSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      varSum += (values[j] - middle[i]!) ** 2;
    }
    const sd = Math.sqrt(varSum / period);
    upper[i] = middle[i]! + mult * sd;
    lower[i] = middle[i]! - mult * sd;
    width[i] = middle[i]! === 0 ? null : (upper[i]! - lower[i]!) / middle[i]!;
  }
  return { upper, middle, lower, width };
}

/** Convenience: latest non-null value of an indicator array (null if none). */
export function latest(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null) return arr[i];
  }
  return null;
}

/** Convenience: closes of a candle series. */
export function closes(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}
