import type { Env } from "@/lib/config/env";
import { MudrexProvider } from "./mudrex-client";
import { MockProvider, type MockProviderOptions } from "./providers/mock";
import { DeterministicProvider, type DeterministicProviderOptions } from "./providers/deterministic";
import { PaperProvider } from "./providers/paper";
import type { ExchangeProvider } from "./types";

export type ProviderKind = ExchangeProvider["kind"];

export function createExchangeProvider(
  kind: ProviderKind,
  env: Env,
  opts: MockProviderOptions & DeterministicProviderOptions = {},
): ExchangeProvider {
  switch (kind) {
    case "mudrex":
      return new MudrexProvider(env);
    case "paper":
      return new PaperProvider(env);
    case "deterministic":
      return new DeterministicProvider(opts);
    case "mock":
      return new MockProvider(opts);
  }
}

export * from "./types";
export { MudrexProvider } from "./mudrex-client";
export { MockProvider, candleKey } from "./providers/mock";
export { DeterministicProvider, TIMEFRAME_SECONDS } from "./providers/deterministic";
export { PaperProvider } from "./providers/paper";
export {
  parseInstrumentsResponse,
  parseKlineResponse,
  canonicalFromExchangeSymbol,
  TIMEFRAME_TO_AGGREGATION,
} from "./parsers";
export {
  assertWatchlistSymbol,
  discoverWatchlistInstruments,
  type DiscoveryEntry,
  type DiscoveryResult,
} from "./watchlist-guard";
