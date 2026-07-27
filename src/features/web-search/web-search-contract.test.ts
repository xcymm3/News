import { describe, expect, it } from "vitest";

import {
  createWebSourcePolicy,
  getWebSearchConfig,
  normalizeWebSearchCandidate,
  WebSearchConfigurationError,
} from "./web-search-contract";

describe("web search contract", () => {
  it("normalizes a Chinese search result and removes tracking parameters", () => {
    const policy = createWebSourcePolicy({ WEB_SEARCH_ALLOWED_DOMAINS: "gov.cn,example.com" });
    const candidate = normalizeWebSearchCandidate(
      {
        id: "result-1",
        title: "  政策更新  ",
        snippet: "  可供 Agent 阅读的内容。 ",
        canonicalUrl: "https://www.example.com/article?utm_source=test&id=1",
        sourceName: "示例来源",
        publishedAt: "2026-07-27T08:00:00+08:00",
      },
      policy,
    );

    expect(candidate).toEqual(expect.objectContaining({
      title: "政策更新",
      canonicalUrl: "https://www.example.com/article?id=1",
      sourceDomain: "www.example.com",
      language: "zh-CN",
      publishedAt: "2026-07-27T00:00:00.000Z",
    }));
  });

  it("rejects excluded and non-web search results", () => {
    const policy = createWebSourcePolicy({ WEB_SEARCH_EXCLUDED_DOMAINS: "example.com" });

    expect(normalizeWebSearchCandidate({
      id: "blocked",
      title: "不应纳入",
      snippet: null,
      canonicalUrl: "https://example.com/article",
      sourceName: "示例来源",
    }, policy)).toBeNull();
    expect(normalizeWebSearchCandidate({
      id: "local",
      title: "不应纳入",
      snippet: null,
      canonicalUrl: "http://localhost:3000/article",
      sourceName: "本地来源",
    }, policy)).toBeNull();
  });

  it("requires an API key after a web search provider is selected", () => {
    expect(() => getWebSearchConfig({ WEB_SEARCH_PROVIDER: "tavily" })).toThrow(WebSearchConfigurationError);
    expect(getWebSearchConfig({
      WEB_SEARCH_PROVIDER: "tavily",
      WEB_SEARCH_API_KEY: "test-key",
      WEB_SEARCH_ALLOWED_DOMAINS: "gov.cn",
    })).toEqual(expect.objectContaining({ provider: "tavily" }));
  });
});
