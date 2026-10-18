import type { Env } from "@/lib/config/env";
import { RssNewsProvider } from "./rss-provider";
import { ApiKeyNewsProvider } from "./api-key-provider";
import type { NewsProvider } from "./types";

/** Build the configured provider stack from env (RSS always; API-key only when configured). */
export function createNewsProviders(env: Env): NewsProvider[] {
  const providers: NewsProvider[] = [];
  const feeds = env.NEWS_RSS_FEEDS.split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  if (feeds.length > 0) {
    providers.push(new RssNewsProvider({ feeds }));
  }
  if (ApiKeyNewsProvider.isConfigured(env.NEWS_API_URL, env.NEWS_API_KEY)) {
    providers.push(
      new ApiKeyNewsProvider({ url: env.NEWS_API_URL, apiKey: env.NEWS_API_KEY }),
    );
  }
  return providers;
}

export * from "./types";
export { NewsService } from "./news-service";
export { RssNewsProvider } from "./rss-provider";
export { FixturesNewsProvider } from "./fixtures-provider";
export { ApiKeyNewsProvider } from "./api-key-provider";
export { sanitizeUntrustedText, formatNewsAsDataBlock, MAX_UNTRUSTED_LENGTH } from "./sanitize";
export { tagHeadline, dedupeHeadlines } from "./relevance";
