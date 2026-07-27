import { describe, expect, it } from "vitest";

import { evaluateWebSearchDigest, WEB_SEARCH_EVALUATION_CASES } from "./web-search-evaluation";
import type { DailyDigest } from "@/features/digest/types";

const evaluationDigest: DailyDigest = {
  id: "evaluation-digest",
  digestDate: "2026-07-27",
  revision: 1,
  publishedAt: "2026-07-27T00:00:00.000Z",
  isDemoData: false,
  generationMode: "agent",
  stories: [
    {
      id: "story-1",
      position: 1,
      headline: "人工智能政策与平台监管出现新进展",
      summary: "这项人工智能政策聚焦平台监管与后续执行安排。",
      whyItMatters: "相关主体需要关注规则变化。",
      importanceScore: 90,
      updatedAt: "2026-07-27T00:00:00.000Z",
      citations: [
        { id: "citation-1", sourceName: "来源甲", sourceUrl: "https://first.example.com/a", publishedAt: "2026-07-27T00:00:00.000Z", supportingExcerpt: "用于评测的第一段原文依据。" },
        { id: "citation-2", sourceName: "来源乙", sourceUrl: "https://second.example.com/b", publishedAt: "2026-07-27T00:00:00.000Z", supportingExcerpt: "用于评测的第二段原文依据。" },
      ],
    },
    {
      id: "story-2",
      position: 2,
      headline: "人工智能行业调整受到关注",
      summary: "政策执行节奏仍需持续观察。",
      whyItMatters: "影响行业参与者的规划。",
      importanceScore: 80,
      updatedAt: "2026-07-27T00:00:00.000Z",
      citations: [{ id: "citation-3", sourceName: "来源甲", sourceUrl: "https://first.example.com/c", publishedAt: "2026-07-27T00:00:00.000Z", supportingExcerpt: "用于评测的第三段原文依据。" }],
    },
    {
      id: "story-3",
      position: 3,
      headline: "政策落地细节仍待观察",
      summary: "监管部门后续信息可能影响人工智能平台安排。",
      whyItMatters: "需跟踪正式执行细则。",
      importanceScore: 70,
      updatedAt: "2026-07-27T00:00:00.000Z",
      citations: [{ id: "citation-4", sourceName: "来源乙", sourceUrl: "https://second.example.com/d", publishedAt: "2026-07-27T00:00:00.000Z", supportingExcerpt: "用于评测的第四段原文依据。" }],
    },
  ],
};

describe("web search evaluation", () => {
  it("passes a digest that meets citation, diversity, and query-term criteria", () => {
    const result = evaluateWebSearchDigest(evaluationDigest, WEB_SEARCH_EVALUATION_CASES[0]!);

    expect(result).toEqual(expect.objectContaining({
      passed: true,
      citationDomainCount: 2,
      unsupportedStoryCount: 0,
      missingTerms: [],
    }));
  });

  it("reports missing terms instead of treating unsupported output as a pass", () => {
    const result = evaluateWebSearchDigest(evaluationDigest, {
      ...WEB_SEARCH_EVALUATION_CASES[0]!,
      requiredTerms: ["不存在的关键词"],
    });

    expect(result.passed).toBe(false);
    expect(result.missingTerms).toEqual(["不存在的关键词"]);
  });
});
