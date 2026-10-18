/**
 * Maps headlines to watchlist symbols by keyword relevance.
 * Word-boundary matching only — substring matches like "eth" inside "method"
 * must not tag ETH/USDT. Macro headlines are tagged MARKET_WIDE and are
 * shown to analysts alongside symbol-specific news.
 */
import { WATCHLIST, type WatchlistSymbol } from "@/lib/config/watchlist";
import type { NewsItem, RawHeadline } from "./types";
import { sanitizeUntrustedText } from "./sanitize";

const SYMBOL_PATTERNS: Record<WatchlistSymbol, RegExp> = {
  "BTC/USDT": /\b(bitcoin|btc)\b/i,
  "ETH/USDT": /\b(ethereum|eth)\b/i,
  "XRP/USDT": /\b(ripple|xrp)\b/i,
  "SOL/USDT": /\b(solana|sol)\b/i,
  "BNB/USDT": /\b(bnb|binance)\b/i,
  "HYPE/USDT": /\b(hyperliquid|hype)\b/i,
  "XAU/USDT": /\b(gold|xau|bullion)\b/i,
};

const MACRO_PATTERN =
  /\b(fed|fomc|cpi|ppi|inflation|interest rates?|rate (?:hike|cut)|macro|dollar|treasur(?:y|ies)|recession|sec|etf (?:approval|inflow|outflow)|crypto market)\b/i;

export interface TaggedHeadline {
  symbols: WatchlistSymbol[];
  marketWide: boolean;
  item: Omit<NewsItem, "symbol">;
}

/** Sanitize + tag one raw headline. Returns null if the title is empty after sanitization. */
export function tagHeadline(raw: RawHeadline): TaggedHeadline | null {
  const title = sanitizeUntrustedText(raw.title);
  if (!title) return null;
  const symbols = WATCHLIST.filter((s) => SYMBOL_PATTERNS[s].test(title));
  const marketWide = MACRO_PATTERN.test(title);
  return {
    symbols,
    marketWide,
    item: {
      title,
      link: sanitizeUntrustedText(raw.link).slice(0, 500),
      source: sanitizeUntrustedText(raw.source) || "unknown",
      publishedAt: raw.publishedAt,
    },
  };
}

/** Dedupe by link first, then by normalized title (feeds repeat stories). */
export function dedupeHeadlines(raws: RawHeadline[]): RawHeadline[] {
  const seenLinks = new Set<string>();
  const seenTitles = new Set<string>();
  const out: RawHeadline[] = [];
  for (const r of raws) {
    const linkKey = r.link.trim().toLowerCase();
    const titleKey = sanitizeUntrustedText(r.title).toLowerCase();
    if (!titleKey) continue;
    if (linkKey && seenLinks.has(linkKey)) continue;
    if (seenTitles.has(titleKey)) continue;
    if (linkKey) seenLinks.add(linkKey);
    seenTitles.add(titleKey);
    out.push(r);
  }
  return out;
}
