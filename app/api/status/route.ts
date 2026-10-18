import { dbJson } from "@/lib/api/db-json";
import {
  getClosedPositionViews,
  getLatestPortfolioSnapshot,
  getOpenPositionViews,
  getRecentCycles,
} from "@/lib/persistence/repository";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return dbJson(async (db) => {
    const [portfolio, openPositions, closedPositions, cycles] = await Promise.all([
      getLatestPortfolioSnapshot(db),
      getOpenPositionViews(db),
      getClosedPositionViews(db, 10),
      getRecentCycles(db, 5),
    ]);
    return {
      mode: "PAPER",
      liveTradingEnabled: false,
      portfolio,
      openPositions,
      closedPositions,
      cycles,
    };
  });
}
