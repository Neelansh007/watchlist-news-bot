/**
 * paper:once — run exactly one full paper-trading decision cycle, print what
 * happened, persist the audit trail (when Postgres is available), and exit.
 *
 * Usage:  npm run paper:once
 *         npm run paper:once -- --no-db
 *         npm run paper:once -- --no-db --no-news --provider=trending
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runtime = await createPaperRuntime(args);
  printStartup(runtime, "paper:once");
  try {
    const result = await runCycle({
      mode: "paper-once",
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
    if (!runtime.persisted) {
      console.log(
        "\nNOTE: this run was IN-MEMORY ONLY. Positions/state will not exist in the next process.",
      );
    }
    if (result.status === "ERROR") process.exitCode = 1;
  } finally {
    await runtime.close();
  }
}

main().catch(async (err) => {
  console.error(`paper:once failed: ${err instanceof Error ? err.message : String(err)}`);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
