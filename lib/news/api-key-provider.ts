/**
 * Optional API-key-based news provider (user can fill in later).
 * Disabled unless BOTH NEWS_API_URL and NEWS_API_KEY are set in .env.
 *
 * Expected response shape: NewsAPI.org-style
 *   { articles: [ { title, url, source: { name }, publishedAt } ] }
 * parsed with a strict schema — anything else is an error (fail closed).
 * The API key is only sent as a Bearer token and NEVER appears in error
 * messages or logs.
 */
import { z } from "zod";
import { ParseError } from "@/lib/safety/errors";
import type { NewsFetchResult, NewsProvider, RawHeadline } from "./types";

const articleSchema = z.object({
  title: z.string().min(1),
  url: z.string().default(""),
  source: z
    .object({ name: z.string().default("api") })
    .nullable()
    .transform((s) => ({ name: s?.name ?? "api" })),
  publishedAt: z.string().nullable(),
});

const responseSchema = z.object({
  articles: z.array(articleSchema),
});

export interface ApiKeyNewsProviderOptions {
  url: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class ApiKeyNewsProvider implements NewsProvider {
  readonly name = "api-key";

  constructor(private readonly opts: ApiKeyNewsProviderOptions) {}

  static isConfigured(url: string, apiKey: string): boolean {
    return Boolean(url && apiKey);
  }

  async fetchHeadlines(): Promise<NewsFetchResult> {
    if (!ApiKeyNewsProvider.isConfigured(this.opts.url, this.opts.apiKey)) {
      return {
        items: [],
        errors: ["API-key news provider not configured (NEWS_API_URL/NEWS_API_KEY empty)."],
      };
    }
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await fetchImpl(this.opts.url, {
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      });
    } catch (err) {
      // Never include the URL-with-key or the key itself in errors.
      return { items: [], errors: [`News API network error: ${err instanceof Error ? err.message : String(err)}`] };
    }
    if (!res.ok) {
      return { items: [], errors: [`News API HTTP ${res.status}`] };
    }
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      return { items: [], errors: ["News API returned non-JSON body"] };
    }
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ParseError(
        `Malformed news API response: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
    }
    const items: RawHeadline[] = parsed.data.articles.map((a) => {
      let publishedAt: number | null = null;
      if (a.publishedAt) {
        const ms = Date.parse(a.publishedAt);
        if (!Number.isNaN(ms)) publishedAt = Math.floor(ms / 1000);
      }
      return {
        title: a.title,
        link: a.url,
        source: a.source.name,
        publishedAt,
      };
    });
    return { items, errors: [] };
  }
}
