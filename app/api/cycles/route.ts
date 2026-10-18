import { dbJson, parseLimit } from "@/lib/api/db-json";
import { getRecentCycles } from "@/lib/persistence/repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const limit = parseLimit(request, 20, 200);
  return dbJson((db) => getRecentCycles(db, limit));
}
