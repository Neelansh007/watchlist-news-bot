import { dbJson, parseLimit } from "@/lib/api/db-json";
import { getRecentRiskEvents } from "@/lib/persistence/repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const limit = parseLimit(request, 50, 500);
  return dbJson((db) => getRecentRiskEvents(db, limit));
}
