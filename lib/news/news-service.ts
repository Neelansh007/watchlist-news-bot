/**
 * NewsService: runs all providers (fail-soft), sanitizes, de-duplicates,
 * applies the lookback window, and tags headlines per watchlist symbol.
 *
 * HARD RULES enforced here:
 *  - If ALL news fetching fails, the bundle is marked available=false and the
 *    pipeline continues (agents must reduce confidence). It never crashes the bot.
 *  - Headline text is sanitized untrusted data and can never carry newlines or
 *    tag characters into prompts.
 *  - News is CONTEXT ONLY. Nothing in this module can create a trade signal or
 *    alter risk limits.
 */
import { WATCHLIST, type WatchlistSymbol } from "@/lib/config/watchlist";
import { dedupeHeadlines, tagHeadline } from "./relevance";
import type { NewsBundle, NewsItem, NewsProvider, RawHeadline } from "./types";

export interface NewsServiceOptions {
  lookbackHours: number;
  /** Injectable clock (epoch seconds) for tests. */
  nowSeconds?: () => number;
}

export class NewsService {
  constructor(
    private readonly providers: NewsProvider[],
    private readonly opts: NewsServiceOptions,
  ) {}

  async fetchBundle(symbols: readonly WatchlistSymbol[] = WATCHLIST): Promise<NewsBundle> {
    const now = this.opts.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    const lookbackSeconds = this.opts.lookbackHours * 3600;
    const errors: string[] = [];

    const results = await Promise.allSettled(this.providers.map((p) => p.fetchHeadlines()));
    let providersOk = 0;
    const raws: RawHeadline[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        providersOk++;
        raws.push(...r.value.items);
        errors.push(...r.value.errors);
      } else {
        errors.push(
          `News provider "${this.providers[i].name}" failed completely: ${String(
            r.reason instanceof Error ? r.reason.message : r.reason,
          )}`,
        );
      }
    });

    const available = providersOk > 0;
    const deduped = dedupeHeadlines(raws);

    const bySymbol: Record<string, NewsItem[]> = {};
    for (const s of symbols) bySymbol[s] = [];
    const marketWide: NewsItem[] = [];

    for (const raw of deduped) {
      // Lookback filter: dated items outside the window are dropped.
      // Undated items are kept but agents see publishedAt "unknown" (lower trust).
      if (raw.publishedAt !== null && raw.publishedAt < now - lookbackSeconds) continue;
      if (raw.publishedAt !== null && raw.publishedAt > now + 300) continue; // future-dated junk

      const tagged = tagHeadline(raw);
      if (!tagged) continue;

      if (tagged.marketWide) {
        marketWide.push({ symbol: "MARKET_WIDE", ...tagged.item });
      }
      for (const sym of tagged.symbols) {
        if ((symbols as readonly string[]).includes(sym)) {
          bySymbol[sym].push({ symbol: sym, ...tagged.item });
        }
      }
    }

    // Newest first for display/prompts.
    const byDateDesc = (a: NewsItem, b: NewsItem) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0);
    for (const list of Object.values(bySymbol)) list.sort(byDateDesc);
    marketWide.sort(byDateDesc);

    return {
      available,
      degraded: available && (errors.length > 0 || providersOk < this.providers.length),
      errors,
      fetchedAt: now,
      bySymbol,
      marketWide,
    };
  }
}
