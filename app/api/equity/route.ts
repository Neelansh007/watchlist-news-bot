import { dbJson, parseLimit } from "@/lib/api/db-json";
import { getEquityCurve } from "@/lib/persistence/repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const limit = parseLimit(request, 500, 2_000);
  return dbJson((db) => getEquityCurve(db, limit));
}
