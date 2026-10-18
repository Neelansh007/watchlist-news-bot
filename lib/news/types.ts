/**
 * News domain types + the pluggable provider interface.
 */
import type { WatchlistSymbol } from "@/lib/config/watchlist";

/** A headline as returned by a provider, BEFORE sanitization. Untrusted. */
export interface RawHeadline {
  title: string;
  link: string;
  source: string;
  /** Epoch seconds, or null when the feed provides no usable date. */
  publishedAt: number | null;
}

export interface NewsFetchResult {
  items: RawHeadline[];
  /** Per-feed/per-source soft failures. A provider that totally failed throws. */
  errors: string[];
}

export interface NewsProvider {
  readonly name: string;
  fetchHeadlines(): Promise<NewsFetchResult>;
}

/** A sanitized, symbol-tagged headline ready to be shown to agents/humans. */
export interface NewsItem {
  symbol: WatchlistSymbol | "MARKET_WIDE";
  title: string; // sanitized
  link: string;
  source: string;
  publishedAt: number | null; // epoch seconds
}

export interface NewsBundle {
  /** false when news could not be fetched at all — agents must reduce confidence. */
  available: boolean;
  /** true when some (but not all) sources failed. */
  degraded: boolean;
  errors: string[];
  fetchedAt: number; // epoch seconds
  bySymbol: Record<string, NewsItem[]>;
  marketWide: NewsItem[];
}
