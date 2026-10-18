import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/config/env";
import { SafetyError } from "../errors";
import {
  assertLiveTradingEnabled,
  resolveTradingMode,
  LIVE_TRADING_MASTER_SWITCH,
  LIVE_CONFIRMATION_PHRASE,
} from "../live-guard";

const minimal = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/watchlist_bot",
};

function envWith(overrides: Record<string, string> = {}) {
  return parseEnv({ ...minimal, ...overrides });
}

describe("live-trading guard", () => {
  it("master switch is OFF in this build", () => {
    expect(LIVE_TRADING_MASTER_SWITCH).toBe(false);
  });

  it("resolves to paper by default", () => {
    expect(resolveTradingMode(envWith())).toBe("paper");
  });

  it("resolves to paper when only the env flag is set", () => {
    expect(resolveTradingMode(envWith({ LIVE_TRADING_ALLOWED: "true" }))).toBe("paper");
  });

  it("resolves to paper when only the confirmation phrase is set", () => {
    expect(
      resolveTradingMode(envWith({ LIVE_TRADING_CONFIRMATION: LIVE_CONFIRMATION_PHRASE })),
    ).toBe("paper");
  });

  it("resolves to paper when both env gates are set but master switch is off", () => {
    expect(
      resolveTradingMode(
        envWith({
          LIVE_TRADING_ALLOWED: "true",
          LIVE_TRADING_CONFIRMATION: LIVE_CONFIRMATION_PHRASE,
        }),
      ),
    ).toBe("paper");
  });

  it("rejects a wrong confirmation phrase", () => {
    expect(
      resolveTradingMode(
        envWith({
          LIVE_TRADING_ALLOWED: "true",
          LIVE_TRADING_CONFIRMATION: "sure why not",
        }),
      ),
    ).toBe("paper");
  });

  it("exchange write operations throw SafetyError in paper mode", () => {
    const env = envWith({
      LIVE_TRADING_ALLOWED: "true",
      LIVE_TRADING_CONFIRMATION: LIVE_CONFIRMATION_PHRASE,
    });
    expect(() => assertLiveTradingEnabled(env, "createOrder")).toThrow(SafetyError);
    expect(() => assertLiveTradingEnabled(env, "cancelOrder")).toThrow(
      /LIVE_TRADING_DISABLED|PAPER mode/i,
    );
    expect(() => assertLiveTradingEnabled(env, "setLeverage")).toThrow(SafetyError);
  });

  it("SafetyError carries a stable code for logging", () => {
    try {
      assertLiveTradingEnabled(envWith(), "createOrder");
      expect.unreachable();
    } catch (e) {
      expect((e as SafetyError).code).toBe("LIVE_TRADING_DISABLED");
    }
  });
});
