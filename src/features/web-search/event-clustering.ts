import type { WebSearchCandidate } from "./web-search-contract";

export type WebEventCluster = {
  id: string;
  headline: string;
  candidates: WebSearchCandidate[];
  sourceDomainCount: number;
  latestPublishedAt: string | null;
};

const MINIMUM_TITLE_SIMILARITY = 0.26;

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .replace(/(?:最新|消息|报道|新闻|记者|中国新闻网|新华网|央视网)/g, "");
}

function createTitleTerms(value: string) {
  const normalized = normalizeTitle(value);
  const terms = new Set<string>();

  for (let index = 0; index < normalized.length - 1; index += 1) {
    terms.add(normalized.slice(index, index + 2));
  }

  for (const token of normalized.match(/[a-z0-9]{2,}|\d{2,}/g) ?? []) {
    terms.add(token);
  }

  return terms;
}

function getTitleSimilarity(left: string, right: string) {
  const leftTerms = createTitleTerms(left);
  const rightTerms = createTitleTerms(right);

  if (leftTerms.size === 0 || rightTerms.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) {
      overlap += 1;
    }
  }

  return overlap / Math.min(leftTerms.size, rightTerms.size);
}

function toTimestamp(value: string | null) {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).valueOf();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function sortCandidates(candidates: WebSearchCandidate[]) {
  return [...candidates].sort((left, right) => toTimestamp(right.publishedAt) - toTimestamp(left.publishedAt));
}

function getLatestPublishedAt(candidates: WebSearchCandidate[]) {
  return sortCandidates(candidates).find((candidate) => candidate.publishedAt)?.publishedAt ?? null;
}

function toCluster(id: string, candidates: WebSearchCandidate[]): WebEventCluster {
  const sortedCandidates = sortCandidates(candidates);

  return {
    id,
    headline: sortedCandidates[0]?.title ?? "",
    candidates: sortedCandidates,
    sourceDomainCount: new Set(sortedCandidates.map((candidate) => candidate.sourceDomain)).size,
    latestPublishedAt: getLatestPublishedAt(sortedCandidates),
  };
}

export function clusterWebSearchCandidates(candidates: WebSearchCandidate[]) {
  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.canonicalUrl, candidate])).values()];
  const buckets: Array<{ id: string; candidates: WebSearchCandidate[] }> = [];

  for (const candidate of sortCandidates(uniqueCandidates)) {
    let bestBucket: { id: string; candidates: WebSearchCandidate[] } | null = null;
    let bestSimilarity = 0;

    for (const bucket of buckets) {
      const similarity = Math.max(...bucket.candidates.map((member) => getTitleSimilarity(candidate.title, member.title)));
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestBucket = bucket;
      }
    }

    if (bestBucket && bestSimilarity >= MINIMUM_TITLE_SIMILARITY) {
      bestBucket.candidates.push(candidate);
    } else {
      buckets.push({ id: `event-${buckets.length + 1}`, candidates: [candidate] });
    }
  }

  return buckets
    .map((bucket) => toCluster(bucket.id, bucket.candidates))
    .sort((left, right) => (
      right.sourceDomainCount - left.sourceDomainCount
      || right.candidates.length - left.candidates.length
      || toTimestamp(right.latestPublishedAt) - toTimestamp(left.latestPublishedAt)
    ));
}

export function selectMultiSourceClusters(clusters: WebEventCluster[], {
  minimumSourceDomains,
  maximumClusters,
}: {
  minimumSourceDomains: number;
  maximumClusters: number;
}) {
  return clusters
    .filter((cluster) => cluster.sourceDomainCount >= minimumSourceDomains)
    .slice(0, maximumClusters);
}

export function selectDistinctDomainCandidates(cluster: WebEventCluster, maximumCandidates: number) {
  const selected: WebSearchCandidate[] = [];
  const domains = new Set<string>();

  for (const candidate of cluster.candidates) {
    if (domains.has(candidate.sourceDomain)) {
      continue;
    }

    selected.push(candidate);
    domains.add(candidate.sourceDomain);

    if (selected.length >= maximumCandidates) {
      break;
    }
  }

  return selected;
}
