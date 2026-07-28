import { describe, expect, it } from "vitest";

import type { WebSearchProvider } from "./web-search-contract";
import { fetchArticleText, createWebResearchTools } from "./web-research-tools";

const provider: WebSearchProvider = {
  id: "tavily",
  async search(request) {
    return {
      provider: "tavily",
      query: request.query,
      candidates: [{
        id: "result-1",
        title: "测试标题",
        snippet: "测试摘要",
        canonicalUrl: "https://news.example.com/article",
        sourceName: "示例媒体",
        sourceDomain: "news.example.com",
        language: "zh-CN",
        publishedAt: "2026-07-27T00:00:00.000Z",
      }],
      fetchedAt: "2026-07-27T00:00:00.000Z",
    };
  },
};

describe("web research tools", () => {
  it("exposes normalized provider results as a LangChain search tool", async () => {
    const [searchWeb] = createWebResearchTools({ provider });
    const result = await searchWeb.invoke({ query: "人工智能监管" });

    expect(JSON.parse(result)).toEqual(expect.objectContaining({
      provider: "tavily",
      candidates: [expect.objectContaining({ canonicalUrl: "https://news.example.com/article" })],
    }));
  });

  it("reads readable article text without returning markup", async () => {
    const article = await fetchArticleText("https://news.example.com/article", {
      fetchImplementation: async () => new Response("<html><body><script>ignored()</script><p>网页正文</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    });

    expect(article.text).toBe("网页正文");
  });

  it("returns a recoverable tool result when one article cannot be read", async () => {
    const [, fetchArticle] = createWebResearchTools({
      fetchImplementation: async () => new Response(null, { status: 503 }),
    });
    const result = await fetchArticle.invoke({ url: "https://news.example.com/article" });

    expect(JSON.parse(result)).toEqual(expect.objectContaining({
      canonicalUrl: "https://news.example.com/article",
      error: "暂时无法读取候选网页原文。",
    }));
  });
});
