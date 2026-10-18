import { describe, expect, it } from "vitest";
import { parseEnv, EnvError } from "../env";
import { resolveTradingMode } from "@/lib/safety/live-guard";

const minimal = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/watchlist_bot",
};

describe("parseEnv", () => {
  it("accepts a minimal valid env and applies safe defaults", () => {
    const env = parseEnv(minimal);
    expect(env.LIVE_TRADING_ALLOWED).toBe("false");
    expect(env.LIVE_TRADING_CONFIRMATION).toBe("");
    expect(env.REVIEW_MODEL).toBe("claude-sonnet-5-5");
    expect(env.MUDREX_BASE_URL).toBe("https://trade.mudrex.com/fapi/v1");
    expect(env.NEWS_LOOKBACK_HOURS).toBe(24);
    expect(resolveTradingMode(env)).toBe("paper");
  });

  it("fails closed when DATABASE_URL is missing", () => {
    expect(() => parseEnv({})).toThrow(EnvError);
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expect(() =>
      parseEnv({ DATABASE_URL: "mysql://user:pass@localhost/db" }),
    ).toThrow(/postgres/);
  });

  it("lists every problem at once", () => {
    try {
      parseEnv({ DATABASE_URL: "nope", LIVE_TRADING_ALLOWED: "yes" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      expect((e as EnvError).issues.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("defaults to paper mode even when both live env gates are set (master switch is off in code)", () => {
    const env = parseEnv({
      ...minimal,
      LIVE_TRADING_ALLOWED: "true",
      LIVE_TRADING_CONFIRMATION: "I-UNDERSTAND-ENABLE-LIVE-TRADING",
    });
    expect(resolveTradingMode(env)).toBe("paper");
  });

  it("rejects invalid boolean strings for LIVE_TRADING_ALLOWED", () => {
    expect(() =>
      parseEnv({ ...minimal, LIVE_TRADING_ALLOWED: "1" }),
    ).toThrow(EnvError);
  });
});
