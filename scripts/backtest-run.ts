/**
 * backtest:run — walks the frozen strategy forward bar-by-bar over SYNTHETIC data
 * and prints honest metrics for the full / in-sample / out-of-sample segments.
 *
 * IMPORTANT — READ THIS: this run uses SYNTHETIC candles, NOT real market data.
 * Its ONLY purpose is to validate the plumbing end-to-end (snapshot -> analysts ->
 * consensus -> setup -> sizing -> risk -> OMS -> exits -> metrics) and to prove
 * the backtester opens AND closes trades with no lookahead. It says NOTHING about
 * real strategy edge. See the disclaimer printed at the end.
 *
 * Two data modes:
 *   --data=trend (default)  a clearly-synthetic DRIFTED series (some symbols up,
 *                           some down) so the frozen analysts can legitimately
 *                           reach consensus and the full entry/exit lifecycle runs.
 *   --data=walk             the seeded random-walk provider. This is EDGELESS
 *                           noise, so the conservative consensus engine correctly
 *                           refuses to trade and you will see ~0 trades. That is
 *                           the fail-closed system behaving exactly as designed.
 *
 * Usage:  npm run backtest:run
 *         npm run backtest:run -- --data=walk --days=20 --tf=15m --seed=7
 */
import { DeterministicProvider, TIMEFRAME_SECONDS } from "@/lib/exchange/providers/deterministic";
import { TrendingFixtureProvider } from "@/lib/exchange/providers/trending-fixture";
import type { ExchangeProvider, Timeframe } from "@/lib/exchange/types";
import { WATCHLIST } from "@/lib/config/watchlist";
import { runBacktest, splitRange, type BacktestResult } from "@/lib/backtest";

const ANCHOR_EPOCH = 1_704_067_200; // 2024-01-01T00:00:00Z

function arg<T>(name: string, fallback: T, parse: (v: string) => T): T {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return parse(hit.slice(name.length + 3));
}

const dataMode = arg<"trend" | "walk">("data", "trend", (v) => (v === "walk" ? "walk" : "trend"));
const days = arg("days", 14, Number);
const seed = arg("seed", 2024, Number);
const tf = arg<Timeframe>("tf", "15m", (v) => v as Timeframe);

if (!(TIMEFRAME_SECONDS[tf] > 0)) {
  console.error(`Unsupported timeframe: ${tf}`);
  process.exit(1);
}

// Leave 200h of synthetic history before the first decision bar so every
// timeframe (esp. 1h, which needs ~130 bars) is fully warmed up.
const start = ANCHOR_EPOCH + 200 * 3600;
const end = start + Math.max(1, Math.floor(days)) * 86_400;

function buildProvider(): ExchangeProvider {
  if (dataMode === "walk") return new DeterministicProvider({ seed });
  // Half the watchlist trends up (LONG setups), half trends down (SHORT setups),
  // so both exit directions are exercised.
  const up = { "BTC/USDT": 1, "ETH/USDT": 1, "SOL/USDT": 1 } as const;
  const overrides: Record<string, 1 | -1> = { ...up };
  for (const s of WATCHLIST) if (!(s in overrides)) overrides[s] = -1;
  return new TrendingFixtureProvider({ seed, directionOverrides: overrides });
}

function fmtMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function fmtPf(n: number): string {
  if (n === Infinity) return "inf (no losers)";
  return Number.isFinite(n) ? n.toFixed(2) : "n/a";
}

function printResult(r: BacktestResult): void {
  const m = r.metrics;
  console.log(`\n=== Segment: ${r.segmentLabel} ===`);
  console.log(`  Data mode        : ${r.dataMode}   (SYNTHETIC — plumbing check only, not edge)`);
  console.log(`  Timeframe        : ${r.decisionTimeframe}`);
  console.log(
    `  Window           : ${new Date(r.startSeconds * 1000).toISOString()} -> ${new Date(r.endSeconds * 1000).toISOString()}`,
  );
  console.log(`  Starting equity  : ${fmtMoney(r.startingEquity)}`);
  console.log(`  Final equity     : ${fmtMoney(m.finalEquity)}  (${m.returnPct.toFixed(2)}%)`);
  console.log(`  Net PnL          : ${fmtMoney(m.netPnl)}`);
  console.log(`  Trades           : ${m.tradeCount}  (wins ${m.wins} / losses ${m.losses})`);
  console.log(`  Win rate         : ${(m.winRate * 100).toFixed(1)}%`);
  console.log(`  Profit factor    : ${fmtPf(m.profitFactor)}`);
  console.log(`  Expectancy/trade : ${fmtMoney(m.expectancy)}`);
  console.log(`  Max drawdown     : ${fmtMoney(m.maxDrawdownAbs)}  (${m.maxDrawdownPct.toFixed(2)}%)`);
  console.log(`  Risk rejections  : ${r.rejections.length}`);

  if (r.perSymbol.length > 0) {
    console.log("  Per-symbol:");
    for (const s of r.perSymbol) {
      console.log(
        `    ${s.symbol.padEnd(10)} trades=${String(s.tradeCount).padStart(3)}  ` +
          `win=${(s.winRate * 100).toFixed(0).padStart(3)}%  net=${fmtMoney(s.netPnl).padStart(12)}  ` +
          `pf=${fmtPf(s.profitFactor)}`,
      );
    }
  } else {
    console.log("  Per-symbol: (no completed trades)");
  }
}

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  WATCHLIST-NEWS-BOT  ·  BACKTEST  ·  SYNTHETIC DATA           ║");
  console.log("║  Plumbing validation only — NOT real market data, NOT edge.   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`Config: data=${dataMode}  seed=${seed}  days=${days}  decisionTimeframe=${tf}`);
  if (dataMode === "walk") {
    console.log(
      "Note: --data=walk is EDGELESS random-walk noise. Expect ~0 trades — that is\n" +
        "      the conservative consensus engine correctly refusing to trade (fail closed).",
    );
  }

  const provider = buildProvider();
  const step = TIMEFRAME_SECONDS[tf];

  const full = await runBacktest({
    provider,
    startSeconds: start,
    endSeconds: end,
    decisionTimeframe: tf,
    segmentLabel: "full",
  });
  printResult(full);

  const { inSample, outOfSample } = splitRange(start, end, 0.6, step);

  const inRes = await runBacktest({
    provider,
    startSeconds: inSample.start,
    endSeconds: inSample.end,
    decisionTimeframe: tf,
    segmentLabel: "in-sample",
  });
  printResult(inRes);

  const oosRes = await runBacktest({
    provider,
    startSeconds: outOfSample.start,
    endSeconds: outOfSample.end,
    decisionTimeframe: tf,
    segmentLabel: "out-of-sample",
  });
  printResult(oosRes);

  console.log("\n──────────────────────────────────────────────────────────────");
  console.log("WALK-FORWARD NOTE: strategy parameters are FROZEN (nothing is");
  console.log("fitted to in-sample data), so the in/out-of-sample split is a");
  console.log("robustness/consistency check — NOT an overfitting guard.");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`\nDISCLAIMER:\n${full.disclaimer}\n`);

  const totalTrades = full.metrics.tradeCount;
  if (totalTrades === 0) {
    console.log(
      dataMode === "walk"
        ? "OK (expected): 0 trades on edgeless random-walk data — fail-closed confirmed.\n" +
            "   Re-run with --data=trend to see the full entry/exit lifecycle exercised."
        : "WARNING: 0 completed trades in trend mode. Try a longer --days window.",
    );
  } else {
    console.log(
      `OK: ${totalTrades} completed trade(s) — the full pipeline is wired end-to-end\n` +
        `    (entries, SL/TP/max-hold exits, realized PnL, per-symbol metrics).`,
    );
  }
}

main().catch((err) => {
  console.error("backtest:run failed:", err);
  process.exit(1);
});
