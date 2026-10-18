import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { RssNewsProvider, type FetchText } from "../rss-provider";

const SAMPLE_XML = readFileSync(
  path.resolve(import.meta.dirname, "../../../tests/fixtures/news/rss-sample.xml"),
  "utf8",
);

function fetchTextReturning(map: Record<string, string | Error>): FetchText {
  return async (url) => {
    const v = map[url];
    if (!v) throw new Error(`unexpected url ${url}`);
    if (v instanceof Error) throw v;
    return v;
  };
}

describe("RssNewsProvider", () => {
  it("parses RSS items into RawHeadlines with epoch-second dates", async () => {
    const provider = new RssNewsProvider({
      feeds: ["https://example.com/feed"],
      fetchText: fetchTextReturning({ "https://example.com/feed": SAMPLE_XML }),
    });
    const result = await provider.fetchHeadlines();

    // empty-title item skipped
    expect(result.items).toHaveLength(3);
    expect(result.errors).toEqual([]);

    const btc = result.items.find((i) => i.title.startsWith("Bitcoin"))!;
    expect(btc.link).toBe("https://example.com/btc-1");
    expect(btc.source).toBe("Test Crypto Feed");
    expect(btc.publishedAt).toBe(Math.floor(Date.parse("2026-10-03T10:00:00Z") / 1000));

    const xrp = result.items.find((i) => i.title.startsWith("Ripple"))!;
    expect(xrp.publishedAt).toBe(Math.floor(Date.parse("2026-10-03T12:45:00Z") / 1000));
  });

  it("is fail-soft: one dead feed does not kill the others", async () => {
    const provider = new RssNewsProvider({
      feeds: ["https://dead.example/feed", "https://example.com/feed"],
      fetchText: fetchTextReturning({
        "https://dead.example/feed": new Error("connect ECONNREFUSED"),
        "https://example.com/feed": SAMPLE_XML,
      }),
    });
    const result = await provider.fetchHeadlines();
    expect(result.items).toHaveLength(3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/dead\.example/);
  });

  it("records an error for malformed XML instead of throwing", async () => {
    const provider = new RssNewsProvider({
      feeds: ["https://example.com/bad"],
      fetchText: fetchTextReturning({ "https://example.com/bad": "<<<not xml at all>>>" }),
    });
    const result = await provider.fetchHeadlines();
    expect(result.errors).toHaveLength(1);
    expect(result.items).toHaveLength(0);
  });
});
