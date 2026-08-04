import { describe, expect, it } from "vitest";

import {
  buildWebSearchDigestFromOutput,
  collectRetrievedWebSources,
  createFallbackWebDigestStory,
  createDigestPrompt,
  getClusterSelectionScore,
  parseWebSearchDigestOutput,
  toRssWebSearchCandidate,
} from "./web-search-digest-agent";

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

  it("scores fresher and better corroborated events above older single-source events", () => {
    const referenceTime = new Date("2026-08-04T12:00:00.000Z").valueOf();
    const currentMultiSource = getClusterSelectionScore({
      id: "event-current",
      headline: "当前多源事件",
      candidates: [{}, {}, {}, {}] as never[],
      sourceDomainCount: 3,
      latestPublishedAt: "2026-08-04T06:00:00.000Z",
    }, referenceTime);
    const staleSingleSource = getClusterSelectionScore({
      id: "event-stale",
      headline: "过期单来源事件",
      candidates: [{}] as never[],
      sourceDomainCount: 1,
      latestPublishedAt: "2026-08-01T12:00:00.000Z",
    }, referenceTime);

    expect(currentMultiSource.score).toBeGreaterThan(staleSingleSource.score);
    expect(currentMultiSource.details).toMatchObject({ freshnessScore: 41, sourceScore: 21, corroborationScore: 16 });
  });

  it("keeps a publishable multi-source fallback when the model output is invalid", () => {
    const fallback = createFallbackWebDigestStory({
      cluster: {
        id: "event-fallback",
        headline: "多来源测试事件",
        candidates: [{}, {}] as never[],
        sourceDomainCount: 2,
        latestPublishedAt: "2026-08-04T06:00:00.000Z",
      },
      selectionScore: 79,
      selectionDetails: { freshnessScore: 40, sourceScore: 14, corroborationScore: 8, ageHours: 8 },
      sources: [
        {
          canonicalUrl: "https://source-a.example.com/event",
          sourceName: "来源 A",
          sourceDomain: "source-a.example.com",
          title: "来源 A 对事件的报道",
          publishedAt: "2026-08-04T06:00:00.000Z",
          supportingExcerpt: "来源 A 的已读取正文材料，提供了足够的可核实信息用于回退摘要。",
        },
        {
          canonicalUrl: "https://source-b.example.com/event",
          sourceName: "来源 B",
          sourceDomain: "source-b.example.com",
          title: "来源 B 对事件的报道",
          publishedAt: "2026-08-04T05:00:00.000Z",
          supportingExcerpt: "来源 B 的已读取正文材料，提供了独立来源的补充信息与上下文。",
        },
      ],
    });

    expect(fallback).toMatchObject({
      headline: "多来源测试事件",
      importanceScore: 79,
      sourceUrls: ["https://source-a.example.com/event", "https://source-b.example.com/event"],
    });
    expect(fallback.summary).toContain("模型未能按要求返回结构化摘要");
  });

  it("gives DeepSeek an explicit JSON object example for structured output", () => {
    const prompt = createDigestPrompt("2026-08-04", {
      cluster: {
        id: "event-json",
        headline: "JSON 输出测试事件",
        candidates: [{}, {}] as never[],
        sourceDomainCount: 2,
        latestPublishedAt: "2026-08-04T06:00:00.000Z",
      },
      selectionScore: 80,
      selectionDetails: { freshnessScore: 40, sourceScore: 14, corroborationScore: 8, ageHours: 8 },
      sources: [],
    });

    expect(prompt).toContain("Use this exact JSON shape");
    expect(prompt).toContain("\"stories\"");
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
