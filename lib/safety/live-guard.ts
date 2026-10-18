/**
 * Live-trading gate. THREE independent gates must all be open before any
 * Mudrex write operation (createOrder/cancelOrder/setLeverage) may run:
 *
 *   1. env LIVE_TRADING_ALLOWED === "true"
 *   2. env LIVE_TRADING_CONFIRMATION === LIVE_CONFIRMATION_PHRASE
 *   3. code constant LIVE_TRADING_MASTER_SWITCH === true (false in this build)
 *
 * If any gate is closed, the trading mode is PAPER and write operations
 * throw SafetyError. There is no bypass path.
 */
import { SafetyError } from "./errors";
import type { Env } from "@/lib/config/env";

export const LIVE_CONFIRMATION_PHRASE = "I-UNDERSTAND-ENABLE-LIVE-TRADING";

/**
 * Code-level master switch. Deliberately `false` in this build.
 * Flipping it requires a source-code change plus both env gates above —
 * an intentional speed bump so live trading can never be enabled by
 * accident or by env injection alone.
 */
export const LIVE_TRADING_MASTER_SWITCH = false;

export type TradingMode = "paper" | "live";

export function resolveTradingMode(env: Pick<Env, "LIVE_TRADING_ALLOWED" | "LIVE_TRADING_CONFIRMATION">): TradingMode {
  if (
    LIVE_TRADING_MASTER_SWITCH &&
    env.LIVE_TRADING_ALLOWED === "true" &&
    env.LIVE_TRADING_CONFIRMATION === LIVE_CONFIRMATION_PHRASE
  ) {
    return "live";
  }
  return "paper";
}

/**
 * Guard used by every Mudrex write operation. Throws SafetyError unless
 * live mode is fully enabled. `operation` is for the error message only
 * (never contains secrets).
 */
export function assertLiveTradingEnabled(env: Env, operation: string): void {
  const mode = resolveTradingMode(env);
  if (mode !== "live") {
    throw new SafetyError(
      "LIVE_TRADING_DISABLED",
      `Refused exchange write operation "${operation}": bot is in PAPER mode. ` +
        `Live trading requires LIVE_TRADING_ALLOWED=true, LIVE_TRADING_CONFIRMATION="${LIVE_CONFIRMATION_PHRASE}", ` +
        `and the code-level master switch. This build ships with the master switch OFF.`,
    );
  }
}
