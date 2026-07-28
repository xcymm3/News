import { describe, expect, it, vi } from "vitest";

import { BochaWebSearchProvider } from "./bocha-web-search-provider";
import type { WebSearchConfig } from "./web-search-contract";

const config: WebSearchConfig = {
  provider: "bocha",
  apiKey: "test-key",
  baseUrl: null,
  policy: {
    allowedDomainSuffixes: [],
    excludedDomainSuffixes: [],
    maxResults: 12,
    maxAgeHours: 72,
  },
};

describe("BochaWebSearchProvider", () => {
  it("maps Bocha pages into normalized Chinese web candidates", async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify({
      code: 200,
      data: {
        webPages: {
          value: [{
            id: "bocha-1",
            name: "  博查测试新闻  ",
            url: "https://news.example.com/article?utm_source=bocha&id=1",
            summary: "  可供阅读的摘要。  ",
            siteName: "示例媒体",
            publishedDate: "2026-07-28T08:00:00+08:00",
          }],
        },
      },
    }), { status: 200 }));
    const provider = new BochaWebSearchProvider(config, fetchImplementation);

    const result = await provider.search({
      query: "中国科技新闻",
      language: "zh-CN",
      maxResults: 8,
      maxAgeHours: 24,
    });

    expect(result).toEqual(expect.objectContaining({
      provider: "bocha",
      candidates: [expect.objectContaining({
        title: "博查测试新闻",
        canonicalUrl: "https://news.example.com/article?id=1",
        sourceName: "示例媒体",
        publishedAt: "2026-07-28T00:00:00.000Z",
      })],
    }));
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.bochaai.com/v1/web-search",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
        body: JSON.stringify({ query: "中国科技新闻", freshness: "oneDay", summary: true, count: 8 }),
      }),
    );
  });

  it("reports a clear credential error", async () => {
    const provider = new BochaWebSearchProvider(config, async () => new Response(null, { status: 401 }));

    await expect(provider.search({
      query: "中国科技新闻",
      language: "zh-CN",
      maxResults: 8,
      maxAgeHours: 72,
    })).rejects.toThrow("博查搜索 API Key 无效或没有调用权限。");
  });
});
