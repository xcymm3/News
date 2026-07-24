import type { RawNewsArticle } from "./live-news-source";

const DEFAULT_MAX_AGE_HOURS = 72;
const MAX_FUTURE_SKEW_MS = 60 * 60 * 1_000;
const TRACKING_PARAMETER_PREFIXES = ["utm_", "mc_", "fbclid", "gclid"];
const TITLE_STOP_WORDS = new Set([
  "about",
  "after",
  "amid",
  "and",
  "are",
  "with",
  "from",
  "into",
  "news",
  "over",
  "that",
  "the",
  "this",
  "through",
  "under",
  "what",
  "will",
  "中国",
  "国内",
  "国际",
  "新闻",
  "今日",
  "最新",
]);

export type ProcessedNewsArticle = RawNewsArticle & {
  normalizedUrl: string;
};

export type NewsClusterCandidate = {
  id: string;
  headline: string;
  summary: string | null;
  latestPublishedAt: string;
  articleCount: number;
  sourceCount: number;
  articles: ProcessedNewsArticle[];
};

export type NewsProcessingStats = {
  inputCount: number;
  acceptedCount: number;
  clusterCount: number;
  rejected: {
    invalid: number;
    stale: number;
    duplicateUrl: number;
    duplicateTitle: number;
  };
};

export type NewsProcessingResult = {
  clusters: NewsClusterCandidate[];
  stats: NewsProcessingStats;
};

type ArticleWithTokens = ProcessedNewsArticle & {
  titleKey: string;
  titleTokens: Set<string>;
  publishedAtValue: number;
};

type MutableCluster = {
  articles: ArticleWithTokens[];
  tokens: Set<string>;
  sourceNames: Set<string>;
};

function getMaximumAgeHours() {
  const configuredValue = Number(process.env.NEWS_SOURCE_MAX_AGE_HOURS);

  return Number.isInteger(configuredValue) && configuredValue > 0 ? configuredValue : DEFAULT_MAX_AGE_HOURS;
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    url.hash = "";

    for (const parameterName of [...url.searchParams.keys()]) {
      const normalizedName = parameterName.toLocaleLowerCase("en-US");

      if (TRACKING_PARAMETER_PREFIXES.some((prefix) => normalizedName === prefix || normalizedName.startsWith(prefix))) {
        url.searchParams.delete(parameterName);
      }
    }

    url.pathname = url.pathname.replace(/\/+$/, "") || "/";

    return url.toString();
  } catch {
    return null;
  }
}

function normalizeTitle(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTitleTokens(titleKey: string) {
  const chunks = titleKey.match(/[\u3400-\u9fff]+|[a-z0-9]+/gu) ?? [];
  const tokens = chunks.flatMap((chunk) => {
    if (/^[\u3400-\u9fff]+$/u.test(chunk)) {
      return Array.from({ length: Math.max(chunk.length - 1, 0) }, (_, index) => chunk.slice(index, index + 2));
    }

    return chunk.length > 2 ? [chunk] : [];
  });

  return new Set(tokens.filter((token) => !TITLE_STOP_WORDS.has(token)));
}

function countSharedTokens(left: Set<string>, right: Set<string>) {
  let shared = 0;

  for (const token of left) {
    if (right.has(token)) {
      shared += 1;
    }
  }

  return shared;
}

function shouldJoinCluster(article: ArticleWithTokens, cluster: MutableCluster) {
  const sharedTokens = countSharedTokens(article.titleTokens, cluster.tokens);

  if (sharedTokens < 2) {
    return false;
  }

  const combinedTokenCount = new Set([...article.titleTokens, ...cluster.tokens]).size;
  const similarity = combinedTokenCount === 0 ? 0 : sharedTokens / combinedTokenCount;

  return similarity >= 0.2;
}

function getStableId(value: string) {
  let hash = 2_166_136_261;

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }

  return `cluster-${(hash >>> 0).toString(36)}`;
}

function toProcessedArticle(article: ArticleWithTokens): ProcessedNewsArticle {
  return {
    externalId: article.externalId,
    canonicalUrl: article.canonicalUrl,
    title: article.title,
    excerpt: article.excerpt,
    sourceName: article.sourceName,
    sourceDomain: article.sourceDomain,
    language: article.language,
    publishedAt: article.publishedAt,
    normalizedUrl: article.normalizedUrl,
  };
}

function toClusterCandidate(cluster: MutableCluster): NewsClusterCandidate {
  const [representative] = cluster.articles;

  return {
    id: getStableId(representative.normalizedUrl),
    headline: representative.title,
    summary: representative.excerpt,
    latestPublishedAt: representative.publishedAt,
    articleCount: cluster.articles.length,
    sourceCount: cluster.sourceNames.size,
    articles: cluster.articles.map(toProcessedArticle),
  };
}

export function processRawNewsArticles(rawArticles: RawNewsArticle[], now = new Date()): NewsProcessingResult {
  const maximumAgeMs = getMaximumAgeHours() * 60 * 60 * 1_000;
  const newestAllowedTimestamp = now.getTime() + MAX_FUTURE_SKEW_MS;
  const oldestAllowedTimestamp = now.getTime() - maximumAgeMs;
  const seenUrls = new Set<string>();
  const seenSourceTitles = new Set<string>();
  const acceptedArticles: ArticleWithTokens[] = [];
  const stats: NewsProcessingStats = {
    inputCount: rawArticles.length,
    acceptedCount: 0,
    clusterCount: 0,
    rejected: {
      invalid: 0,
      stale: 0,
      duplicateUrl: 0,
      duplicateTitle: 0,
    },
  };

  const sortedArticles = [...rawArticles].sort(
    (left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
  );

  for (const article of sortedArticles) {
    const normalizedUrl = normalizeUrl(article.canonicalUrl);
    const titleKey = normalizeTitle(article.title);
    const publishedAtValue = new Date(article.publishedAt).getTime();

    if (!normalizedUrl || titleKey.length < 12 || Number.isNaN(publishedAtValue)) {
      stats.rejected.invalid += 1;
      continue;
    }

    if (publishedAtValue < oldestAllowedTimestamp || publishedAtValue > newestAllowedTimestamp) {
      stats.rejected.stale += 1;
      continue;
    }

    if (seenUrls.has(normalizedUrl)) {
      stats.rejected.duplicateUrl += 1;
      continue;
    }

    const sourceTitleKey = `${article.sourceName}\u0000${titleKey}`;

    if (seenSourceTitles.has(sourceTitleKey)) {
      stats.rejected.duplicateTitle += 1;
      continue;
    }

    seenUrls.add(normalizedUrl);
    seenSourceTitles.add(sourceTitleKey);
    acceptedArticles.push({
      ...article,
      canonicalUrl: normalizedUrl,
      normalizedUrl,
      titleKey,
      titleTokens: getTitleTokens(titleKey),
      publishedAtValue,
    });
  }

  const clusters: MutableCluster[] = [];

  for (const article of acceptedArticles) {
    const matchingCluster = clusters.find((cluster) => shouldJoinCluster(article, cluster));

    if (matchingCluster) {
      matchingCluster.articles.push(article);

      for (const token of article.titleTokens) {
        matchingCluster.tokens.add(token);
      }
      matchingCluster.sourceNames.add(article.sourceName);
      continue;
    }

    clusters.push({
      articles: [article],
      tokens: new Set(article.titleTokens),
      sourceNames: new Set([article.sourceName]),
    });
  }

  stats.acceptedCount = acceptedArticles.length;
  stats.clusterCount = clusters.length;

  return {
    clusters: clusters.map(toClusterCandidate),
    stats,
  };
}
