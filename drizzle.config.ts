import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// The DB URL comes ONLY from .env (DATABASE_URL). Never hardcode it here.
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill in your PostgreSQL credentials.",
  );
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: false,
});
