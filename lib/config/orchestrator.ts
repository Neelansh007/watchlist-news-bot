/**
 * Orchestrator runtime settings. Not safety limits — those live in risk.ts
 * and are frozen. These control loop/CLI behavior only.
 */
export const ORCHESTRATOR = {
  /** Default seconds between autopilot cycles. */
  defaultCycleIntervalSeconds: 300,
  /**
   * Exits in paper mode are checked against closed 1m candles (the finest data
   * the exchange exposes), so SL/TP are not delayed until the next 5m/15m bar.
   */
  exitCheckTimeframe: "1m" as const,
  /** Max minutes of missed 1m bars to replay after downtime (bounds catch-up work). */
  maxCatchUpMinutes: 360,
  /** Max cycles to keep in the CLI's own summary history. */
  summaryHistoryLimit: 50,
} as const;
