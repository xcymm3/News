import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildAgentDigestFromOutput,
  getCachedAgentDigest,
  rankRetrievedArticles,
  rankRetrievedEvents,
  type RetrievedNewsDocument,
} from "./news-rag-agent";
import type { DailyDigest } from "@/features/digest/types";
import type { NewsClusterCandidate } from "@/features/news-source/article-processing";

const retrievedDocuments: RetrievedNewsDocument[] = [
  {
    articleId: "source-ceasefire",
    eventId: "event-ceasefire",
    title: "Ceasefire talks continue after regional escalation",
    excerpt: "Diplomats are discussing a ceasefire after renewed regional escalation.",
    sourceName: "Test News",
    sourceUrl: "https://example.test/ceasefire",
    publishedAt: "2026-07-24T08:00:00.000Z",
  },
  {
    articleId: "source-trade",
    eventId: "event-trade",
    title: "Trade ministers meet for economic negotiations",
    excerpt: "The meeting focused on tariffs and international economic cooperation.",
    sourceName: "Test News",
    sourceUrl: "https://example.test/trade",
    publishedAt: "2026-07-24T09:00:00.000Z",
  },
];

describe("news RAG agent", () => {
  it("ranks retrieved documents by the agent search query", () => {
    const documents = rankRetrievedArticles(retrievedDocuments, "regional ceasefire talks", 1);

    expect(documents).toHaveLength(1);
    expect(documents[0]?.articleId).toBe("source-ceasefire");
  });

  it("matches Chinese query terms against Chinese RSS headlines", () => {
    const documents = rankRetrievedArticles(
      [
        {
          ...retrievedDocuments[0]!,
          articleId: "source-chinese-trade",
          title: "中美贸易谈判继续推进",
          excerpt: "双方就贸易与关税议题继续磋商。",
        },
        {
          ...retrievedDocuments[1]!,
          articleId: "source-chinese-sports",
          title: "国际赛事公布新的比赛日程",
          excerpt: "多支队伍将参加本周的国际赛事。",
        },
      ],
      "中美贸易谈判",
      1,
    );

    expect(documents[0]?.articleId).toBe("source-chinese-trade");
  });

  it("ranks corroborated events above single-source events", () => {
    const clusters: NewsClusterCandidate[] = [
      {
        id: "event-single",
        headline: "人工智能产业发布新政策",
        summary: "单一来源报道。",
        latestPublishedAt: "2026-07-24T09:00:00.000Z",
        articleCount: 1,
        sourceCount: 1,
        articles: [
          {
            externalId: "single-source",
            canonicalUrl: "https://single.example.test/1",
            normalizedUrl: "https://single.example.test/1",
            title: "人工智能产业发布新政策",
            excerpt: "单一来源报道。",
            sourceName: "来源甲",
            sourceDomain: "single.example.test",
            language: "zh-CN",
            publishedAt: "2026-07-24T09:00:00.000Z",
          },
        ],
      },
      {
        id: "event-corroborated",
        headline: "人工智能治理规则发布并将实施",
        summary: "多家来源报道同一规则发布。",
        latestPublishedAt: "2026-07-24T08:00:00.000Z",
        articleCount: 2,
        sourceCount: 2,
        articles: [
          {
            externalId: "corroborated-source-a",
            canonicalUrl: "https://first.example.test/1",
            normalizedUrl: "https://first.example.test/1",
            title: "人工智能治理规则正式发布",
            excerpt: "来源甲报道规则发布。",
            sourceName: "来源甲",
            sourceDomain: "first.example.test",
            language: "zh-CN",
            publishedAt: "2026-07-24T08:00:00.000Z",
          },
          {
            externalId: "corroborated-source-b",
            canonicalUrl: "https://second.example.test/1",
            normalizedUrl: "https://second.example.test/1",
            title: "人工智能治理新规即将实施",
            excerpt: "来源乙也报道了规则发布。",
            sourceName: "来源乙",
            sourceDomain: "second.example.test",
            language: "zh-CN",
            publishedAt: "2026-07-24T07:30:00.000Z",
          },
        ],
      },
    ];

    const events = rankRetrievedEvents(clusters, "人工智能政策", 1);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventId: "event-corroborated",
      sourceCount: 2,
    });
  });

  it("keeps the retrieval window balanced across RSS sources", () => {
    const clusters: NewsClusterCandidate[] = ["中国新闻网", "中国新闻网", "中国新闻网", "36氪", "中央社", "IT之家", "虎嗅"].map((sourceName, index) => ({
      id: `event-${index}`,
      headline: `${sourceName} 的当前新闻 ${index}`,
      summary: "用于来源均衡测试的新闻摘要。",
      latestPublishedAt: new Date(Date.UTC(2026, 6, 24, 10, 0, -index)).toISOString(),
      articleCount: 1,
      sourceCount: 1,
      articles: [
        {
          externalId: `source-${index}`,
          canonicalUrl: `https://source-${index}.example.test/${index}`,
          normalizedUrl: `https://source-${index}.example.test/${index}`,
          title: `${sourceName} 的当前新闻 ${index}`,
          excerpt: "用于来源均衡测试的新闻摘要。",
          sourceName,
          sourceDomain: `source-${index}.example.test`,
          language: "zh-CN",
          publishedAt: new Date(Date.UTC(2026, 6, 24, 10, 0, -index)).toISOString(),
        },
      ],
    }));

    const events = rankRetrievedEvents(clusters, "当前新闻", 5);

    expect(events).toHaveLength(5);
    expect(new Set(events.flatMap((event) => event.documents.map((document) => document.sourceName)))).toEqual(
      new Set(["中国新闻网", "36氪", "中央社", "IT之家", "虎嗅"]),
    );
  });

  it("binds AI output citations to retrieved documents only", () => {
    const digest = buildAgentDigestFromOutput({
      digestDate: "2026-07-24",
      generatedAt: new Date("2026-07-24T10:00:00.000Z"),
      retrievedDocuments,
      output: {
        stories: [
          {
            headline: "地区停火谈判仍在推进",
            summary: "多方正就停火安排继续磋商，局势仍有不确定性。",
            whyItMatters: "谈判结果可能影响地区安全与后续人道安排。",
            importanceScore: 92,
            citationArticleIds: ["source-ceasefire", "not-retrieved"],
          },
        ],
      },
    });

    expect(digest.generationMode).toBe("agent");
    expect(digest.stories).toHaveLength(1);
    expect(digest.stories[0]?.citations).toEqual([
      expect.objectContaining({
        sourceName: "Test News",
        sourceUrl: "https://example.test/ceasefire",
      }),
    ]);
  });

  it("adds every RSS source from the selected event as a citation", () => {
    const digest = buildAgentDigestFromOutput({
      digestDate: "2026-07-24",
      generatedAt: new Date("2026-07-24T10:00:00.000Z"),
      retrievedDocuments: [
        {
          ...retrievedDocuments[0]!,
          articleId: "cross-source-a",
          eventId: "event-cross-source",
          sourceName: "中国新闻网",
        },
        {
          ...retrievedDocuments[1]!,
          articleId: "cross-source-b",
          eventId: "event-cross-source",
          sourceName: "中央社",
        },
      ],
      output: {
        stories: [
          {
            headline: "多家媒体跟进地区停火谈判",
            summary: "多家媒体报道停火谈判仍在推进。",
            whyItMatters: "谈判结果可能影响地区安全与人道安排。",
            importanceScore: 80,
            citationArticleIds: ["cross-source-a"],
          },
        ],
      },
    });

    expect(digest.stories[0]).toMatchObject({
      importanceScore: 85,
      whyItMatters: expect.stringContaining("综合 2 家 RSS"),
    });
    expect(digest.stories[0]?.citations).toEqual([
      expect.objectContaining({ sourceName: "中国新闻网" }),
      expect.objectContaining({ sourceName: "中央社" }),
    ]);
    expect(digest.stories[0]?.citations[0]?.supportingExcerpt).toContain("原标题");
  });

  it("allows the model to semantically merge clearly matching retrieved events", () => {
    const digest = buildAgentDigestFromOutput({
      digestDate: "2026-07-24",
      generatedAt: new Date("2026-07-24T10:00:00.000Z"),
      retrievedDocuments: [
        { ...retrievedDocuments[0]!, sourceName: "中国新闻网" },
        {
          ...retrievedDocuments[1]!,
          sourceName: "中央社",
          title: "Regional ceasefire talks continue with new diplomatic push",
          excerpt: "Diplomats are discussing the same ceasefire talks after renewed regional escalation.",
        },
      ],
      output: {
        stories: [
          {
            headline: "多方继续推进地区停火谈判",
            summary: "两家媒体分别报道了同一轮停火磋商的进展。",
            whyItMatters: "谈判走向仍会影响地区安全局势。",
            importanceScore: 88,
            citationArticleIds: ["source-ceasefire", "source-trade"],
          },
        ],
      },
    });

    expect(digest.stories[0]?.citations).toEqual([
      expect.objectContaining({ sourceName: "中国新闻网" }),
      expect.objectContaining({ sourceName: "中央社" }),
    ]);
    expect(digest.stories[0]?.whyItMatters).toContain("综合 2 家 RSS");
  });

  it("fills a fixed story count only with unused retrieved events", () => {
    const digest = buildAgentDigestFromOutput({
      digestDate: "2026-07-24",
      generatedAt: new Date("2026-07-24T10:00:00.000Z"),
      retrievedDocuments: [
        ...retrievedDocuments,
        {
          ...retrievedDocuments[1]!,
          articleId: "source-third",
          eventId: "event-third",
          title: "A third independently retrieved event",
          sourceName: "第三来源",
          sourceUrl: "https://example.test/third",
        },
      ],
      targetStoryCount: 3,
      output: {
        stories: [
          {
            headline: "地区停火谈判仍在推进",
            summary: "多方正就停火安排继续磋商，局势仍有不确定性。",
            whyItMatters: "谈判结果可能影响地区安全与后续人道安排。",
            importanceScore: 92,
            citationArticleIds: ["source-ceasefire"],
          },
        ],
      },
    });

    expect(digest.stories).toHaveLength(3);
    expect(new Set(digest.stories.flatMap((story) => story.citations.map((citation) => citation.sourceUrl)))).toEqual(
      new Set(["https://example.test/ceasefire", "https://example.test/trade", "https://example.test/third"]),
    );
  });
});

type GlobalAgentCache = {
  cachedDigests: Map<string, { digest: DailyDigest; expiresAt: number }>;
};

const globalCache = globalThis as typeof globalThis & {
  __internationalBriefingAgentCache?: GlobalAgentCache;
};

afterEach(() => {
  delete globalCache.__internationalBriefingAgentCache;
  vi.resetModules();
});

describe("Agent digest cache", () => {
  it("survives a server module reload so a refreshed page can read the Agent result", async () => {
    const digest = buildAgentDigestFromOutput({
      digestDate: "2026-07-24",
      generatedAt: new Date("2026-07-24T10:00:00.000Z"),
      retrievedDocuments,
      output: {
        stories: [
          {
            headline: "地区停火谈判仍在推进",
            summary: "多方正就停火安排继续磋商，局势仍有不确定性。",
            whyItMatters: "谈判结果可能影响地区安全与后续人道安排。",
            importanceScore: 92,
            citationArticleIds: ["source-ceasefire"],
          },
        ],
      },
    });
    await import("./news-rag-agent");
    const cache = globalCache.__internationalBriefingAgentCache;

    expect(cache).toBeDefined();
    cache?.cachedDigests.set("2026-07-24", {
      digest,
      expiresAt: Date.now() + 60_000,
    });

    vi.resetModules();
    const reloadedModule = await import("./news-rag-agent");

    expect(getCachedAgentDigest("2026-07-24")).toBeNull();
    expect(reloadedModule.getCachedAgentDigest("2026-07-24")).toMatchObject({
      generationMode: "agent",
      stories: [expect.objectContaining({ headline: "地区停火谈判仍在推进" })],
    });
  });
});
