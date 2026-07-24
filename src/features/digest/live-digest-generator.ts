import type { NewsClusterCandidate } from "@/features/news-source/article-processing";
import { getProcessedLiveNews } from "@/features/news-source/processed-news-service";

import type { DailyDigest, DigestCitation, DigestStory } from "./types";

const MAX_DAILY_STORIES = 12;
const MIN_CITATION_EXCERPT_LENGTH = 12;

export class DigestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DigestValidationError";
  }
}

function getRankingScore(cluster: NewsClusterCandidate) {
  const timestamp = new Date(cluster.latestPublishedAt).getTime();
  const sourceSignal = Math.min(cluster.articleCount - 1, 4) * 1_000_000_000_000;

  return timestamp + sourceSignal;
}

function createImportanceScore(cluster: NewsClusterCandidate, position: number) {
  return Math.max(1, 100 - (position - 1) * 5 + Math.min(cluster.articleCount - 1, 4) * 2);
}

function createWhyItMatters(cluster: NewsClusterCandidate) {
  if (cluster.articleCount > 1) {
    return `该候选汇集 ${cluster.articleCount} 条来自 ${cluster.sourceCount} 个来源域名的近期报道。请阅读下方原文并等待后续更新确认事件范围；本页未作独立事实核验。`;
  }

  return "该候选目前基于 1 条近期原始报道整理。请结合下方原文与后续更新判断其影响范围；本页未作独立事实核验。";
}

function createCitation(clusterId: string, citationOrder: number, article: NewsClusterCandidate["articles"][number]): DigestCitation {
  return {
    id: `${clusterId}-citation-${citationOrder}`,
    sourceName: article.sourceName,
    sourceUrl: article.canonicalUrl,
    publishedAt: article.publishedAt,
    supportingExcerpt: `RSS 来源：${article.sourceName}；原标题：${article.title}`,
  };
}

function createStory(cluster: NewsClusterCandidate, position: number): DigestStory {
  return {
    id: cluster.id,
    position,
    headline: cluster.headline,
    summary: cluster.summary?.trim() || cluster.headline,
    whyItMatters: createWhyItMatters(cluster),
    importanceScore: createImportanceScore(cluster, position),
    updatedAt: cluster.latestPublishedAt,
    citations: cluster.articles.map((article, index) => createCitation(cluster.id, index + 1, article)),
  };
}

function assertValidHttpUrl(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function assertValidDate(value: string, label: string) {
  if (Number.isNaN(new Date(value).getTime())) {
    throw new DigestValidationError(`${label} 的时间无效。`);
  }
}

export function validateGeneratedDigest(digest: DailyDigest) {
  if (digest.isDemoData) {
    throw new DigestValidationError("自动生成的日报不能标记为演示数据。");
  }

  if (digest.stories.length === 0 || digest.stories.length > MAX_DAILY_STORIES) {
    throw new DigestValidationError("日报条目数量不在允许范围内。");
  }

  assertValidDate(digest.publishedAt, "日报");

  const storyIds = new Set<string>();
  const citationIds = new Set<string>();

  for (const [index, story] of digest.stories.entries()) {
    if (story.position !== index + 1 || !story.id || storyIds.has(story.id)) {
      throw new DigestValidationError("日报条目的顺序或标识无效。");
    }

    if (!story.headline.trim() || !story.summary.trim() || !story.whyItMatters.trim()) {
      throw new DigestValidationError("日报条目缺少标题、摘要或范围说明。");
    }

    if (story.citations.length === 0) {
      throw new DigestValidationError("每条日报条目至少需要一个出处。");
    }

    assertValidDate(story.updatedAt, "日报条目");
    storyIds.add(story.id);

    for (const citation of story.citations) {
      if (
        !citation.id ||
        citationIds.has(citation.id) ||
        !citation.sourceName.trim() ||
        !assertValidHttpUrl(citation.sourceUrl) ||
        citation.supportingExcerpt.trim().length < MIN_CITATION_EXCERPT_LENGTH
      ) {
        throw new DigestValidationError("日报条目的出处不完整或不可用。");
      }

      assertValidDate(citation.publishedAt, "出处");
      citationIds.add(citation.id);
    }
  }
}

export function buildGeneratedDigest({
  digestDate,
  generatedAt,
  clusters,
}: {
  digestDate: string;
  generatedAt: Date;
  clusters: NewsClusterCandidate[];
}): DailyDigest {
  const stories = [...clusters]
    .sort((left, right) => getRankingScore(right) - getRankingScore(left))
    .slice(0, MAX_DAILY_STORIES)
    .map((cluster, index) => createStory(cluster, index + 1));
  const digest: DailyDigest = {
    id: `generated-digest-${digestDate}-r1`,
    digestDate,
    revision: 1,
    publishedAt: generatedAt.toISOString(),
    isDemoData: false,
    generationMode: "rules",
    notice: "当前日报由实时来源的事件候选自动整理。每条均附原始出处，但尚未进行独立事实核验。",
    stories,
  };

  validateGeneratedDigest(digest);

  return digest;
}

export async function generateLiveDigest(digestDate: string) {
  const processedNews = await getProcessedLiveNews();

  return buildGeneratedDigest({
    digestDate,
    generatedAt: new Date(),
    clusters: processedNews.clusters,
  });
}
