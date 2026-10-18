import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { getEnv } from "@/lib/config/env";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

let pool: pg.Pool | null = null;
let db: Db | null = null;

export function getDb(): Db {
  if (!db) {
    const env = getEnv();
    pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 5,
      // A misconfigured/unreachable database must degrade quickly (CLIs fall
      // back to in-memory paper mode; the dashboard shows a setup message).
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
    });
    db = drizzle(pool, { schema });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}

export * as tables from "./schema";
