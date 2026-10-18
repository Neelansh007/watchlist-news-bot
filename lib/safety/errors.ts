/**
 * Thrown when an operation is refused by a safety mechanism
 * (paper-mode guard, risk engine hard block, watchlist guard, schema parse failure).
 * SafetyErrors must never be silently caught and ignored: they always
 * result in NO_TRADE / halt plus a logged risk event.
 */
export class SafetyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SafetyError";
    this.code = code;
  }
}

export class ParseError extends SafetyError {
  constructor(message: string) {
    super("PARSE_ERROR", message);
    this.name = "ParseError";
  }
}

/**
 * Thrown when required market/news/external data is missing, stale or unusable.
 * Callers must fail closed (NO_TRADE) — never guess or fabricate data.
 */
export class DataError extends SafetyError {
  constructor(message: string) {
    super("DATA_UNAVAILABLE", message);
    this.name = "DataError";
  }
}
