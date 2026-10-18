/**
 * Shared wrapper for read-only API routes that read from Postgres.
 *
 * Database failures degrade to a 503 with a generic message: no connection
 * strings, credentials, or SQL details ever reach the client.
 */
import { getDb } from "@/lib/db";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function dbJson<T>(read: (db: ReturnType<typeof getDb>) => Promise<T>): Promise<Response> {
  try {
    const data = await read(getDb());
    return Response.json({ ok: true, data }, { headers: NO_STORE });
  } catch (err) {
    // Log only the driver error code (e.g. ECONNREFUSED/28P01), never the message
    // or connection string, so a failed DB never leaks credentials into logs.
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code: unknown }).code)
        : "unknown";
    console.error(`[api] database read failed (${code})`);
    return Response.json(
      { ok: false, error: "database unavailable" },
      { status: 503, headers: NO_STORE },
    );
  }
}

/** Clamp a user-supplied `?limit=` to a safe integer range. */
export function parseLimit(request: Request, fallback: number, max: number): number {
  const raw = new URL(request.url).searchParams.get("limit");
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}
