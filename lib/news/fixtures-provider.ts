/**
 * Fixtures provider for tests and offline development.
 * Serves canned headlines; can be configured to simulate failures.
 */
import type { NewsFetchResult, NewsProvider, RawHeadline } from "./types";

export class FixturesNewsProvider implements NewsProvider {
  readonly name = "fixtures";

  constructor(
    private readonly headlines: RawHeadline[],
    private readonly opts: { fail?: boolean; errors?: string[] } = {},
  ) {}

  async fetchHeadlines(): Promise<NewsFetchResult> {
    if (this.opts.fail) {
      throw new Error("FixturesNewsProvider configured to fail");
    }
    return { items: this.headlines, errors: this.opts.errors ?? [] };
  }
}
