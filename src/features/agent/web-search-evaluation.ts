import type { DailyDigest } from "@/features/digest/types";

export type WebSearchEvaluationCase = {
  id: string;
  query: string;
  minStories: number;
  minCitationDomains: number;
  requiredTerms: string[];
};

export const WEB_SEARCH_EVALUATION_CASES: readonly WebSearchEvaluationCase[] = [
  {
    id: "ai-policy",
    query: "中国人工智能监管政策最新进展",
    minStories: 3,
    minCitationDomains: 2,
    requiredTerms: ["人工智能", "政策"],
  },
  {
    id: "cross-border-trade",
    query: "中国跨境贸易关税国际经贸最新消息",
    minStories: 3,
    minCitationDomains: 2,
    requiredTerms: ["贸易", "关税"],
  },
  {
    id: "technology-industry",
    query: "中国科技产业芯片人工智能公司最新动态",
    minStories: 3,
    minCitationDomains: 2,
    requiredTerms: ["科技", "人工智能"],
  },
  {
    id: "international-relations",
    query: "国际关系外交冲突停火谈判最新进展",
    minStories: 3,
    minCitationDomains: 2,
    requiredTerms: ["外交", "国际"],
  },
  {
    id: "consumer-regulation",
    query: "中国互联网平台消费者权益监管最新规定",
    minStories: 3,
    minCitationDomains: 2,
    requiredTerms: ["平台", "监管"],
  },
];

export type WebSearchEvaluationResult = {
  caseId: string;
  storyCount: number;
  citationCount: number;
  citationDomainCount: number;
  missingTerms: string[];
  unsupportedStoryCount: number;
  passed: boolean;
};

export function evaluateWebSearchDigest(digest: DailyDigest, evaluationCase: WebSearchEvaluationCase): WebSearchEvaluationResult {
  const citations = digest.stories.flatMap((story) => story.citations);
  const citationDomains = new Set(citations.flatMap((citation) => {
    try {
      return [new URL(citation.sourceUrl).hostname.toLowerCase()];
    } catch {
      return [];
    }
  }));
  const searchableText = digest.stories.map((story) => `${story.headline}\n${story.summary}`).join("\n").toLocaleLowerCase("zh-CN");
  const missingTerms = evaluationCase.requiredTerms.filter((term) => !searchableText.includes(term.toLocaleLowerCase("zh-CN")));
  const unsupportedStoryCount = digest.stories.filter((story) => story.citations.length === 0).length;

  return {
    caseId: evaluationCase.id,
    storyCount: digest.stories.length,
    citationCount: citations.length,
    citationDomainCount: citationDomains.size,
    missingTerms,
    unsupportedStoryCount,
    passed: digest.stories.length >= evaluationCase.minStories
      && citationDomains.size >= evaluationCase.minCitationDomains
      && unsupportedStoryCount === 0
      && missingTerms.length === 0,
  };
}
