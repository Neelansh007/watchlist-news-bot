/**
 * paper:autopilot — run the paper decision cycle on a fixed interval.
 *
 * Usage:  npm run paper:autopilot
 *         npm run paper:autopilot -- --no-db --cycles=3 --interval=60
 *
 * Ctrl+C finishes the in-flight cycle and then exits. Nothing this process
 * does can send a live order: the live-trading master switch is OFF and every
 * exchange write path is guarded by SafetyError.
 */
import "dotenv/config";
import { closeDb } from "@/lib/db";
import { runCycle } from "@/lib/orchestrator";
import {
  createPaperRuntime,
  parseArgs,
  persistRuntimeState,
  printCycle,
  printStartup,
} from "./paper-common";

let stopping = false;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runtime = await createPaperRuntime(args);
  printStartup(runtime, "paper:autopilot");
  console.log(
    `Interval       : ${args.intervalSeconds}s per cycle; run limit: ${args.cycles ?? "unlimited (Ctrl+C to stop)"}`,
  );

  const requestStop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${signal} received: finishing the current cycle, then stopping.`);
  };
  process.on("SIGINT", () => requestStop("SIGINT"));
  process.on("SIGTERM", () => requestStop("SIGTERM"));

  let ran = 0;
  try {
    while (!stopping) {
      ran++;
      const startedAt = new Date().toISOString();
      console.log(`\n=== cycle ${ran} started ${startedAt} ===`);
      try {
        const result = await runCycle({
          mode: "paper-autopilot",
          oms: runtime.oms,
          provider: runtime.provider,
          ticker: runtime.ticker,
          newsService: runtime.newsService,
          reviewer: runtime.reviewer,
          store: runtime.store,
          lastProcessedCandleTs: runtime.lastProcessedCandleTs,
        });
        printCycle(result);
        const persistError = await persistRuntimeState(runtime, result);
        if (persistError) console.error(`Persistence error: ${persistError}`);
      } catch (err) {
        // Never let one bad cycle kill the loop; the next cycle re-derives
        // state from the OMS + persisted settings and fails closed if needed.
        console.error(
          `Cycle ${ran} failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (stopping) break;
      if (args.cycles !== null && ran >= args.cycles) break;
      console.log(`  Waiting ${args.intervalSeconds}s (Ctrl+C to stop)...`);
      await sleepInterruptible(args.intervalSeconds * 1000);
    }
  } finally {
    await runtime.close();
  }
  console.log(`\nPaper autopilot stopped after ${ran} cycle(s). No live orders were sent.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepInterruptible(totalMs: number): Promise<void> {
  const step = 250;
  let elapsed = 0;
  while (elapsed < totalMs && !stopping) {
    const chunk = Math.min(step, totalMs - elapsed);
    await sleep(chunk);
    elapsed += chunk;
  }
}

main().catch(async (err) => {
  console.error(`paper:autopilot failed: ${err instanceof Error ? err.message : String(err)}`);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
