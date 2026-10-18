/**
 * Fixed watchlist. The bot NEVER trades a symbol outside this list,
 * even if Mudrex lists more instruments. See lib/exchange/watchlist-guard.ts.
 */
export const WATCHLIST = [
  "BTC/USDT",
  "XAU/USDT",
  "XRP/USDT",
  "ETH/USDT",
  "SOL/USDT",
  "HYPE/USDT",
  "BNB/USDT",
] as const;

export type WatchlistSymbol = (typeof WATCHLIST)[number];

/** Normalize user/exchange symbol text to the canonical "BASE/QUOTE" uppercase form. */
export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function isWatchlistSymbol(raw: string): raw is WatchlistSymbol {
  const n = normalizeSymbol(raw);
  return (WATCHLIST as readonly string[]).includes(n);
}
