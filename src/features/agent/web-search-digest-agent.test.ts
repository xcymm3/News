import { describe, expect, it } from "vitest";

import { buildWebSearchDigestFromOutput, collectRetrievedWebSources, parseWebSearchDigestOutput, toRssWebSearchCandidate } from "./web-search-digest-agent";

const messages = [
  {
    name: "search_web",
    content: JSON.stringify({
      candidates: [{
        id: "search-1",
        title: "政策更新",
        snippet: "用于定位原文的搜索摘要。",
        canonicalUrl: "https://official.example.com/policy",
        sourceName: "官方来源",
        sourceDomain: "official.example.com",
        language: "zh-CN",
        publishedAt: "2026-07-27T01:00:00.000Z",
      }],
    }),
  },
  {
    name: "fetch_article",
    content: JSON.stringify({
      canonicalUrl: "https://official.example.com/policy",
      text: "这是经过 Agent 实际读取的网页正文，长度足以作为日报引用依据。",
      fetchedAt: "2026-07-27T02:00:00.000Z",
    }),
  },
];

describe("web search digest agent", () => {
  it("normalizes a Chinese RSS article into a web research candidate", () => {
    expect(toRssWebSearchCandidate({
      externalId: "rss-1",
      canonicalUrl: "https://rss.example.com/articles/1?utm_source=feed",
      title: " RSS 国际新闻标题 ",
      excerpt: "RSS 摘要。",
      sourceName: "中国新闻网",
      sourceDomain: "rss.example.com",
      language: "zh-CN",
      publishedAt: "2026-08-04T00:00:00.000Z",
    }, {
      allowedDomainSuffixes: [],
      excludedDomainSuffixes: [],
      maxResults: 20,
      maxAgeHours: 72,
    })).toEqual(expect.objectContaining({
      title: "RSS 国际新闻标题",
      canonicalUrl: "https://rss.example.com/articles/1",
      sourceName: "中国新闻网",
      publishedAt: "2026-08-04T00:00:00.000Z",
    }));
  });

  it("extracts a JSON digest from an Agnes text-wrapped response", () => {
    expect(parseWebSearchDigestOutput(JSON.stringify(`已完成资料整理。</think>\n\n{
      "stories": [{"headline": "测试新闻"}]
    }`))).toEqual({
      stories: [{ headline: "测试新闻" }],
    });
  });

  it("only binds citations to sources actually read by the Agent", () => {
    const digest = buildWebSearchDigestFromOutput({
      digestDate: "2026-07-27",
      generatedAt: new Date("2026-07-27T03:00:00.000Z"),
      retrievedSources: collectRetrievedWebSources(messages),
      output: {
        stories: [{
          headline: "政策更新发布",
          summary: "有关部门发布了新的政策安排，正文已由 Agent 读取并整理。",
          whyItMatters: "相关主体需要关注后续执行节点。",
          importanceScore: 88,
          sourceUrls: ["https://official.example.com/policy", "https://unread.example.com/claim"],
        }],
      },
    });

    expect(digest.stories).toHaveLength(1);
    expect(digest.stories[0]?.citations).toEqual([
      expect.objectContaining({
        sourceName: "官方来源",
        sourceUrl: "https://official.example.com/policy",
      }),
    ]);
  });

  it("does not accept a searched URL until its article was read", () => {
    expect(collectRetrievedWebSources([messages[0]!])).toEqual([]);
  });
});
