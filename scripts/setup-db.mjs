/**
 * setup:db — creates the PostgreSQL database named in DATABASE_URL if it
 * does not exist, then applies all Drizzle migrations from ./drizzle.
 *
 * Usage:  npm run setup:db   (after filling .env)
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill in your PostgreSQL credentials.",
  );
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(url);
} catch {
  console.error("DATABASE_URL is not a valid URL.");
  process.exit(1);
}
if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
  console.error("DATABASE_URL must use the postgres:// scheme.");
  process.exit(1);
}

const dbName = parsed.pathname.replace(/^\//, "");
if (!dbName) {
  console.error("DATABASE_URL must include a database name (e.g. .../watchlist_bot).");
  process.exit(1);
}

// Admin connection to the built-in "postgres" database, same credentials.
const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";

const admin = new pg.Client({ connectionString: adminUrl.toString() });
try {
  await admin.connect();
} catch (err) {
  console.error(
    `Could not connect to PostgreSQL at ${parsed.hostname}:${parsed.port || 5432} ` +
      `as user "${parsed.username}". Check that PostgreSQL is running and that the ` +
      `username/password in your .env DATABASE_URL are correct.`,
  );
  console.error(`Connection error: ${err.message}`);
  process.exit(1);
}

try {
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
    dbName,
  ]);
  if (rowCount === 0) {
    // Identifiers cannot be parameterized; dbName came from the user's own .env.
    // Restrict to safe identifier characters as defense in depth.
    if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
      console.error(`Refusing to create database with unsafe name: ${dbName}`);
      process.exit(1);
    }
    await admin.query(`CREATE DATABASE ${dbName}`);
    console.log(`Created database "${dbName}".`);
  } else {
    console.log(`Database "${dbName}" already exists.`);
  }
} finally {
  await admin.end();
}

console.log("Applying migrations (drizzle-kit migrate)...");
execSync("npx drizzle-kit migrate", { stdio: "inherit" });
console.log("Database setup complete.");
