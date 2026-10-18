/**
 * Strict environment parsing. Fail fast at startup with a clear message
 * instead of limping along with missing/garbage config.
 * Secrets are never logged or printed.
 */
import { z } from "zod";

const booleanString = z.enum(["true", "false"]).default("false");

export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // --- Database ---
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (u) => u.startsWith("postgres://") || u.startsWith("postgresql://"),
      "DATABASE_URL must be a postgres:// or postgresql:// URL",
    ),

  // --- Mudrex ---
  MUDREX_API_SECRET: z.string().default(""),
  MUDREX_BASE_URL: z
    .string()
    .min(1)
    .default("https://trade.mudrex.com/fapi/v1"),

  // --- Anthropic review agent ---
  ANTHROPIC_API_KEY: z.string().default(""),
  REVIEW_MODEL: z.string().min(1).default("claude-sonnet-5-5"),

  // --- Live trading gates (defaults = paper) ---
  LIVE_TRADING_ALLOWED: booleanString,
  LIVE_TRADING_CONFIRMATION: z.string().default(""),

  // --- News ---
  NEWS_RSS_FEEDS: z
    .string()
    .default(
      "https://www.coindesk.com/arc/outboundfeeds/rss/,https://cointelegraph.com/rss,https://www.investing.com/rss/news.rss",
    ),
  NEWS_LOOKBACK_HOURS: z.coerce.number().int().positive().default(24),

  // --- Optional API-key news provider (fill in later; empty = disabled) ---
  NEWS_API_URL: z.string().default(""),
  NEWS_API_KEY: z.string().default(""),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n- ${issues.join("\n- ")}`);
    this.name = "EnvError";
    this.issues = issues;
  }
}

/** Parse a raw env object (defaults to process.env). Throws EnvError with all issues listed. */
export function parseEnv(raw: Record<string, unknown> = process.env): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new EnvError(issues);
  }
  return result.data;
}

let cached: Env | null = null;

/** Lazily-parsed singleton for app code. Tests should use parseEnv() directly. */
export function getEnv(): Env {
  if (!cached) cached = parseEnv();
  return cached;
}

/** Test helper: reset the cached env. */
export function resetEnvCache(): void {
  cached = null;
}
