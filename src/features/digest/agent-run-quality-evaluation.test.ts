import { describe, expect, it } from "vitest";

import { evaluateAgentRunQuality } from "./agent-run-quality-evaluation";
import type { DailyDigest } from "./types";

function createDigest(stories: DailyDigest["stories"]): DailyDigest {
  return {
    id: "digest-test",
    digestDate: "2026-08-03",
    revision: 1,
    publishedAt: "2026-08-03T12:00:00.000Z",
    isDemoData: false,
    generationMode: "agent",
    stories,
  };
}

describe("agent run quality evaluation", () => {
  it("calculates freshness, source diversity, categories, and valid citation URLs", () => {
    const evaluation = evaluateAgentRunQuality(createDigest([
      {
        id: "story-ai",
        position: 1,
        headline: "人工智能芯片合作出现新进展",
        summary: "测试摘要",
        whyItMatters: "测试影响",
        importanceScore: 90,
        updatedAt: "2026-08-03T12:00:00.000Z",
        citations: [
          { id: "a", sourceName: "来源甲", sourceUrl: "https://alpha.example/a", publishedAt: "2026-08-03T12:00:00.000Z", supportingExcerpt: "a" },
          { id: "b", sourceName: "来源乙", sourceUrl: "https://beta.example/b", publishedAt: "2026-08-03T08:00:00.000Z", supportingExcerpt: "b" },
        ],
      },
      {
        id: "story-market",
        position: 2,
        headline: "全球市场关注最新利率变化",
        summary: "测试摘要",
        whyItMatters: "测试影响",
        importanceScore: 80,
        updatedAt: "2026-08-01T12:00:00.000Z",
        citations: [
          { id: "c", sourceName: "来源甲", sourceUrl: "https://alpha.example/c", publishedAt: "2026-08-01T12:00:00.000Z", supportingExcerpt: "c" },
          { id: "d", sourceName: "无效来源", sourceUrl: "not-a-url", publishedAt: "2026-08-01T12:00:00.000Z", supportingExcerpt: "d" },
        ],
      },
    ]));

    expect(evaluation).toMatchObject({
      evaluationVersion: "v1",
      freshnessScore: 50,
      multiSourceCoverage: 50,
      averageSourcesPerStory: 1.5,
      sourceDomainCount: 2,
      categoryCoverage: 50,
      duplicateFreeRate: 100,
      citationUrlValidity: 75,
    });
  });

  it("marks near-identical headlines as duplicate output", () => {
    const evaluation = evaluateAgentRunQuality(createDigest([
      {
        id: "story-1",
        position: 1,
        headline: "红海航运安全局势出现新变化",
        summary: "测试摘要",
        whyItMatters: "测试影响",
        importanceScore: 90,
        updatedAt: "2026-08-03T12:00:00.000Z",
        citations: [{ id: "a", sourceName: "来源甲", sourceUrl: "https://alpha.example/a", publishedAt: "2026-08-03T12:00:00.000Z", supportingExcerpt: "a" }],
      },
      {
        id: "story-2",
        position: 2,
        headline: "红海航运安全局势出现最新变化",
        summary: "测试摘要",
        whyItMatters: "测试影响",
        importanceScore: 80,
        updatedAt: "2026-08-03T12:00:00.000Z",
        citations: [{ id: "b", sourceName: "来源乙", sourceUrl: "https://beta.example/b", publishedAt: "2026-08-03T12:00:00.000Z", supportingExcerpt: "b" }],
      },
    ]));

    expect(evaluation.duplicateFreeRate).toBe(50);
  });

  it("returns zero scores for an empty digest", () => {
    expect(evaluateAgentRunQuality(createDigest([]))).toMatchObject({
      freshnessScore: 0,
      multiSourceCoverage: 0,
      averageSourcesPerStory: 0,
      sourceDomainCount: 0,
      categoryCoverage: 0,
      duplicateFreeRate: 0,
      citationUrlValidity: 0,
    });
  });
});
