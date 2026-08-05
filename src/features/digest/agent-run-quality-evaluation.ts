import { getStoryCategory, STORY_CATEGORIES } from "./story-category";
import type { DailyDigest, DigestCitation } from "./types";

const FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1_000;
const DUPLICATE_HEADLINE_SIMILARITY_THRESHOLD = 0.72;

export const AGENT_RUN_EVALUATION_VERSION = "v1";

export type AgentRunQualityEvaluation = {
  evaluationVersion: typeof AGENT_RUN_EVALUATION_VERSION;
  freshnessScore: number;
  multiSourceCoverage: number;
  averageSourcesPerStory: number;
  sourceDomainCount: number;
  categoryCoverage: number;
  duplicateFreeRate: number;
  citationUrlValidity: number;
};

function roundScore(value: number) {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function parseHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function getCitationDomain(citation: DigestCitation) {
  return parseHttpUrl(citation.sourceUrl)?.hostname.toLowerCase() ?? null;
}

function getLatestPublishedAt(citations: DigestCitation[]) {
  return citations.reduce<number | null>((latest, citation) => {
    const publishedAt = new Date(citation.publishedAt).valueOf();

    if (Number.isNaN(publishedAt)) {
      return latest;
    }

    return latest === null ? publishedAt : Math.max(latest, publishedAt);
  }, null);
}

function normalizeHeadline(headline: string) {
  return headline.toLocaleLowerCase("zh-CN").replace(/[^\p{L}\p{N}]+/gu, "");
}

function getHeadlineNgrams(headline: string) {
  const normalized = normalizeHeadline(headline);

  if (normalized.length < 3) {
    return new Set(normalized ? [normalized] : []);
  }

  return new Set(Array.from({ length: normalized.length - 1 }, (_, index) => normalized.slice(index, index + 2)));
}

function getHeadlineSimilarity(left: string, right: string) {
  const leftNgrams = getHeadlineNgrams(left);
  const rightNgrams = getHeadlineNgrams(right);

  if (leftNgrams.size === 0 || rightNgrams.size === 0) {
    return 0;
  }

  let sharedCount = 0;
  for (const ngram of leftNgrams) {
    if (rightNgrams.has(ngram)) {
      sharedCount += 1;
    }
  }

  return sharedCount / (leftNgrams.size + rightNgrams.size - sharedCount);
}

function getDuplicateStoryPositions(digest: DailyDigest) {
  const duplicatePositions = new Set<number>();

  for (let leftIndex = 0; leftIndex < digest.stories.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < digest.stories.length; rightIndex += 1) {
      const left = digest.stories[leftIndex]!;
      const right = digest.stories[rightIndex]!;

      if (getHeadlineSimilarity(left.headline, right.headline) >= DUPLICATE_HEADLINE_SIMILARITY_THRESHOLD) {
        duplicatePositions.add(rightIndex);
      }
    }
  }

  return duplicatePositions;
}

export function evaluateAgentRunQuality(digest: DailyDigest): AgentRunQualityEvaluation {
  const referenceTime = new Date(digest.publishedAt).valueOf();
  const publishedAt = Number.isNaN(referenceTime) ? Date.now() : referenceTime;
  const stories = digest.stories;
  const allCitations = stories.flatMap((story) => story.citations);
  const domainsByStory = stories.map((story) => new Set(
    story.citations.flatMap((citation) => {
      const domain = getCitationDomain(citation);
      return domain ? [domain] : [];
    }),
  ));
  const allDomains = new Set(domainsByStory.flatMap((domains) => [...domains]));
  const freshnessScores = stories.map((story) => {
    const latestPublishedAt = getLatestPublishedAt(story.citations);
    if (latestPublishedAt === null) {
      return 0;
    }

    const age = Math.max(publishedAt - latestPublishedAt, 0);
    return clamp((1 - age / FRESHNESS_WINDOW_MS) * 100, 0, 100);
  });
  const categories = new Set(stories.map((story) => getStoryCategory(story.headline)));
  const duplicatePositions = getDuplicateStoryPositions(digest);
  const validCitationCount = allCitations.filter((citation) => Boolean(parseHttpUrl(citation.sourceUrl))).length;
  const storyCount = stories.length;

  return {
    evaluationVersion: AGENT_RUN_EVALUATION_VERSION,
    freshnessScore: roundScore(storyCount === 0 ? 0 : freshnessScores.reduce((sum, score) => sum + score, 0) / storyCount),
    multiSourceCoverage: roundScore(storyCount === 0 ? 0 : domainsByStory.filter((domains) => domains.size >= 2).length / storyCount * 100),
    averageSourcesPerStory: roundScore(storyCount === 0 ? 0 : domainsByStory.reduce((sum, domains) => sum + domains.size, 0) / storyCount),
    sourceDomainCount: allDomains.size,
    categoryCoverage: roundScore(categories.size / STORY_CATEGORIES.length * 100),
    duplicateFreeRate: roundScore(storyCount === 0 ? 0 : (storyCount - duplicatePositions.size) / storyCount * 100),
    citationUrlValidity: roundScore(allCitations.length === 0 ? 0 : validCitationCount / allCitations.length * 100),
  };
}
