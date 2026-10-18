export interface Range {
  start: number;
  end: number;
}

export interface WalkForwardSplit {
  inSample: Range;
  outOfSample: Range;
}

/**
 * Split [start, end] into an in-sample and an out-of-sample segment at a bar
 * boundary. Because the strategy's parameters are FROZEN (nothing is fitted to
 * the in-sample data), this split is a robustness/consistency check — it shows
 * whether behavior holds on data the config never saw — NOT an overfitting guard.
 * That distinction is stated honestly in the report.
 */
export function splitRange(start: number, end: number, isFraction: number, step: number): WalkForwardSplit {
  if (!(end > start)) throw new Error(`invalid range: start ${start} >= end ${end}`);
  if (!(isFraction > 0 && isFraction < 1)) throw new Error(`isFraction must be in (0,1), got ${isFraction}`);
  if (!(step > 0)) throw new Error(`step must be > 0, got ${step}`);

  const total = end - start;
  // Align the split to a whole number of bars so no bar straddles the boundary.
  const bars = Math.floor((total * isFraction) / step);
  let splitAt = start + bars * step;
  // Guarantee both segments are non-empty.
  if (splitAt <= start) splitAt = start + step;
  if (splitAt >= end) splitAt = end - step;
  return {
    inSample: { start, end: splitAt },
    outOfSample: { start: splitAt, end },
  };
}
