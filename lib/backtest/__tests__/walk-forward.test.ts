import { describe, expect, it } from "vitest";
import { splitRange } from "../walk-forward";

const STEP = 900; // 15m

describe("splitRange", () => {
  it("splits at ~the requested fraction, aligned to a whole number of bars", () => {
    const start = 1_704_067_200;
    const end = start + 100 * STEP;
    const { inSample, outOfSample } = splitRange(start, end, 0.6, STEP);
    expect(inSample.start).toBe(start);
    expect(outOfSample.end).toBe(end);
    expect(inSample.end).toBe(outOfSample.start);
    // 60 bars in-sample (0.6 * 100), aligned exactly to a bar boundary.
    expect((inSample.end - start) % STEP).toBe(0);
    expect(inSample.end - start).toBe(60 * STEP);
  });

  it("produces contiguous, non-overlapping segments covering the whole range", () => {
    const start = 0;
    const end = 1000 * STEP;
    const { inSample, outOfSample } = splitRange(start, end, 0.75, STEP);
    expect(inSample.end).toBe(outOfSample.start);
    expect(outOfSample.end - inSample.start).toBe(end - start);
  });

  it("guarantees both segments are non-empty even for a tiny fraction", () => {
    const start = 0;
    const end = 10 * STEP;
    const { inSample, outOfSample } = splitRange(start, end, 0.001, STEP);
    expect(inSample.end).toBeGreaterThan(inSample.start);
    expect(outOfSample.end).toBeGreaterThan(outOfSample.start);
  });

  it("guarantees both segments are non-empty even for a huge fraction", () => {
    const start = 0;
    const end = 10 * STEP;
    const { inSample, outOfSample } = splitRange(start, end, 0.999, STEP);
    expect(inSample.end).toBeGreaterThan(inSample.start);
    expect(outOfSample.end).toBeGreaterThan(outOfSample.start);
  });

  it("rejects an inverted range", () => {
    expect(() => splitRange(100, 100, 0.5, STEP)).toThrow();
    expect(() => splitRange(200, 100, 0.5, STEP)).toThrow();
  });

  it("rejects a fraction outside (0,1)", () => {
    expect(() => splitRange(0, 100 * STEP, 0, STEP)).toThrow();
    expect(() => splitRange(0, 100 * STEP, 1, STEP)).toThrow();
    expect(() => splitRange(0, 100 * STEP, -0.2, STEP)).toThrow();
  });

  it("rejects a non-positive step", () => {
    expect(() => splitRange(0, 100, 0.5, 0)).toThrow();
  });
});
