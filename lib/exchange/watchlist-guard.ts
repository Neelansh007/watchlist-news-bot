/**
 * Watchlist guard + instrument discovery.
 * The bot may ONLY trade the fixed watchlist. Any other symbol is refused
 * with a SafetyError, even if Mudrex lists it as tradable.
 */
import {
  WATCHLIST,
  isWatchlistSymbol,
  normalizeSymbol,
  type WatchlistSymbol,
} from "@/lib/config/watchlist";
import { SafetyError } from "@/lib/safety/errors";
import type { ExchangeProvider, Instrument } from "./types";

/** Throws unless the symbol is in the fixed watchlist. No override path. */
export function assertWatchlistSymbol(raw: string): asserts raw is WatchlistSymbol {
  if (!isWatchlistSymbol(raw)) {
    throw new SafetyError(
      "SYMBOL_NOT_IN_WATCHLIST",
      `Symbol "${normalizeSymbol(raw) || "(empty)"}" is not in the fixed watchlist [${WATCHLIST.join(
        ", ",
      )}]. Refusing to fetch, analyze or trade it.`,
    );
  }
}

export type DiscoveryStatus = "AVAILABLE" | "UNAVAILABLE";

export interface DiscoveryEntry {
  symbol: WatchlistSymbol;
  status: DiscoveryStatus;
  instrument: Instrument | null;
  /** Set when UNAVAILABLE; human-readable reason. Never fabricate data instead. */
  reason: string | null;
}

export interface DiscoveryResult {
  entries: DiscoveryEntry[];
  available: DiscoveryEntry[];
  unavailable: DiscoveryEntry[];
}

/**
 * Discover which watchlist symbols Mudrex currently lists.
 * Symbols missing from the exchange response are marked UNAVAILABLE with a reason.
 */
export async function discoverWatchlistInstruments(
  provider: ExchangeProvider,
): Promise<DiscoveryResult> {
  const listed = await provider.fetchInstruments();
  const byCanonical = new Map<string, Instrument>();
  for (const inst of listed) {
    if (inst.canonicalSymbol) byCanonical.set(inst.canonicalSymbol, inst);
  }

  const entries: DiscoveryEntry[] = WATCHLIST.map((symbol) => {
    const instrument = byCanonical.get(symbol) ?? null;
    if (!instrument) {
      return {
        symbol,
        status: "UNAVAILABLE" as const,
        instrument: null,
        reason: "Not listed by Mudrex GET /futures (exchange silently omits unknown pairs).",
      };
    }
    return { symbol, status: "AVAILABLE" as const, instrument, reason: null };
  });

  return {
    entries,
    available: entries.filter((e) => e.status === "AVAILABLE"),
    unavailable: entries.filter((e) => e.status === "UNAVAILABLE"),
  };
}
