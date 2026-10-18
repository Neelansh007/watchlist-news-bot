import { dbJson, parseLimit } from "@/lib/api/db-json";
import { getClosedPositionViews, getOpenPositionViews } from "@/lib/persistence/repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const closedLimit = parseLimit(request, 25, 200);
  return dbJson(async (db) => {
    const [open, closed] = await Promise.all([
      getOpenPositionViews(db),
      getClosedPositionViews(db, closedLimit),
    ]);
    return { open, closed };
  });
}
