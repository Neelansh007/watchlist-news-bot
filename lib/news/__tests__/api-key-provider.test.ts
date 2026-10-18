import { describe, expect, it } from "vitest";
import { ApiKeyNewsProvider } from "../api-key-provider";
import { ParseError } from "@/lib/safety/errors";

const KEY = "news-key-DO-NOT-LEAK";

describe("ApiKeyNewsProvider", () => {
  it("is disabled (soft error, no throw) when not configured", async () => {
    const p = new ApiKeyNewsProvider({ url: "", apiKey: "" });
    const r = await p.fetchHeadlines();
    expect(r.items).toEqual([]);
    expect(r.errors[0]).toMatch(/not configured/);
  });

  it("parses a NewsAPI-style response strictly", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          articles: [
            {
              title: "Bitcoin ETF inflows surge",
              url: "https://news.example/1",
              source: { name: "ExampleNews" },
              publishedAt: "2026-10-03T10:00:00Z",
            },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const p = new ApiKeyNewsProvider({ url: "https://news.example/v1/top", apiKey: KEY, fetchImpl });
    const r = await p.fetchHeadlines();
    expect(r.errors).toEqual([]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].publishedAt).toBe(Math.floor(Date.parse("2026-10-03T10:00:00Z") / 1000));
  });

  it("throws ParseError on an unknown response shape (fail closed)", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ stories: [] }), { status: 200 })) as unknown as typeof fetch;
    const p = new ApiKeyNewsProvider({ url: "https://news.example", apiKey: KEY, fetchImpl });
    await expect(p.fetchHeadlines()).rejects.toThrow(ParseError);
  });

  it("never leaks the API key in soft errors", async () => {
    const fetchImpl = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    const p = new ApiKeyNewsProvider({ url: "https://news.example", apiKey: KEY, fetchImpl });
    const r = await p.fetchHeadlines();
    expect(r.errors[0]).toMatch(/network error/i);
    expect(r.errors.join("|")).not.toContain(KEY);
  });

  it("reports HTTP errors softly without the key", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const p = new ApiKeyNewsProvider({ url: "https://news.example", apiKey: KEY, fetchImpl });
    const r = await p.fetchHeadlines();
    expect(r.errors[0]).toBe("News API HTTP 401");
    expect(r.errors.join("|")).not.toContain(KEY);
  });
});
