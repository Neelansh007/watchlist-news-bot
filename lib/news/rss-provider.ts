/**
 * Default news provider: public RSS feeds (configurable list).
 * Each feed is fetched with a timeout and failures are SOFT: one dead feed
 * never kills the whole news pipeline, it only records an error.
 * Fetching is injectable for tests (no network in the test suite).
 */
import Parser from "rss-parser";
import type { NewsFetchResult, NewsProvider, RawHeadline } from "./types";

export type FetchText = (url: string, timeoutMs: number) => Promise<string>;

const defaultFetchText: FetchText = async (url, timeoutMs) => {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

export interface RssNewsProviderOptions {
  feeds: string[];
  timeoutMs?: number;
  fetchText?: FetchText;
}

export class RssNewsProvider implements NewsProvider {
  readonly name = "rss";
  private readonly parser = new Parser();

  constructor(private readonly opts: RssNewsProviderOptions) {}

  async fetchHeadlines(): Promise<NewsFetchResult> {
    const timeoutMs = this.opts.timeoutMs ?? 10_000;
    const fetchText = this.opts.fetchText ?? defaultFetchText;
    const items: RawHeadline[] = [];
    const errors: string[] = [];

    const results = await Promise.allSettled(
      this.opts.feeds.map(async (feedUrl) => {
        const xml = await fetchText(feedUrl, timeoutMs);
        const parsed = await this.parser.parseString(xml);
        for (const entry of parsed.items ?? []) {
          const title = entry.title ?? "";
          if (!title.trim()) continue;
          const dateStr = entry.isoDate ?? entry.pubDate;
          let publishedAt: number | null = null;
          if (dateStr) {
            const ms = Date.parse(dateStr);
            if (!Number.isNaN(ms)) publishedAt = Math.floor(ms / 1000);
          }
          items.push({
            title,
            link: entry.link ?? "",
            source: parsed.title ? String(parsed.title) : new URL(feedUrl).hostname,
            publishedAt,
          });
        }
      }),
    );

    results.forEach((r, i) => {
      if (r.status === "rejected") {
        // Feed URL is not a secret; error message is from our own fetch/parse.
        errors.push(`RSS feed failed (${this.opts.feeds[i]}): ${String(r.reason?.message ?? r.reason)}`);
      }
    });

    return { items, errors };
  }
}
