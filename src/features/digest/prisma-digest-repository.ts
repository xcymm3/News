import { createHash, randomUUID } from "node:crypto";
import { unstable_cache } from "next/cache";

import {
  AgentRunStatus,
  AgentRunTrigger,
  ArticleLanguage,
  DigestStatus,
  Prisma,
  SourceKind,
  StoryStatus,
} from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/prisma";

import type { DigestRepository } from "./digest-service";
import type { DailyDigest, DigestCitation, DigestStory } from "./types";

type PublishDigestOptions = {
  trigger: "manual" | "cron";
  model?: string;
  retrievedDocumentCount?: number;
};

type RecordFailedAgentRunOptions = {
  trigger: "manual" | "cron";
  digestDate: string;
  model?: string;
  errorMessage: string;
};

export class DigestPersistenceError extends Error {
  constructor() {
    super("日报已生成，但保存到数据库时失败。请稍后重试。");
    this.name = "DigestPersistenceError";
  }
}

function digestDateToDatabaseDate(digestDate: string) {
  return new Date(`${digestDate}T00:00:00.000Z`);
}

function toDate(value: string, fallback: Date) {
  const parsed = new Date(value);

  return Number.isNaN(parsed.valueOf()) ? fallback : parsed;
}

function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableId(prefix: string, value: string) {
  return `${prefix}-${fingerprint(value).slice(0, 24)}`;
}

function getSourceDomain(sourceUrl: string) {
  try {
    return new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    return `invalid-${fingerprint(sourceUrl).slice(0, 16)}`;
  }
}

function toGenerationMode(value: DailyDigest["generationMode"]) {
  return value === "agent" ? "agent" : "rules";
}

function toCitation(article: {
  id: string;
  canonicalUrl: string;
  publishedAt: Date;
  excerpt: string | null;
  title: string;
  source: { name: string };
}): DigestCitation {
  return {
    id: article.id,
    sourceName: article.source.name,
    sourceUrl: article.canonicalUrl,
    publishedAt: article.publishedAt.toISOString(),
    supportingExcerpt: article.excerpt ?? article.title,
  };
}

type DatabaseDigestItem = {
  position: number;
  headlineSnapshot: string;
  summarySnapshot: string;
  impactSnapshot: string;
  story: {
    id: string;
    importanceScore: number;
    updatedAt: Date;
    clusterArticles: Array<{
      article: {
        id: string;
        canonicalUrl: string;
        publishedAt: Date;
        excerpt: string | null;
        title: string;
        source: { name: string };
      };
    }>;
  };
};

function mapDatabaseStory(item: DatabaseDigestItem): DigestStory {
  return {
    id: item.story.id,
    position: item.position,
    headline: item.headlineSnapshot,
    summary: item.summarySnapshot,
    whyItMatters: item.impactSnapshot,
    importanceScore: item.story.importanceScore,
    updatedAt: item.story.updatedAt.toISOString(),
    citations: item.story.clusterArticles.map((link) => toCitation(link.article)),
  };
}

function mapDatabaseDigest(digest: {
  id: string;
  digestDate: Date;
  revision: number;
  generationMode: string | null;
  notice: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  items: DatabaseDigestItem[];
}): DailyDigest {
  return {
    id: digest.id,
    digestDate: digest.digestDate.toISOString().slice(0, 10),
    revision: digest.revision,
    publishedAt: (digest.publishedAt ?? digest.createdAt).toISOString(),
    isDemoData: false,
    generationMode: digest.generationMode === "agent" ? "agent" : "rules",
    notice: digest.notice ?? undefined,
    stories: digest.items.map(mapDatabaseStory),
  };
}

async function persistCitation(
  transaction: Prisma.TransactionClient,
  citation: DigestCitation,
) {
  const domain = getSourceDomain(citation.sourceUrl);
  const source = await transaction.newsSource.upsert({
    where: { domain },
    update: {
      name: citation.sourceName,
      isEnabled: true,
    },
    create: {
      id: stableId("source", domain),
      name: citation.sourceName,
      domain,
      kind: SourceKind.MEDIA,
    },
  });

  return transaction.article.upsert({
    where: { canonicalUrl: citation.sourceUrl },
    update: {
      sourceId: source.id,
      title: citation.supportingExcerpt,
      excerpt: citation.supportingExcerpt,
      publishedAt: toDate(citation.publishedAt, new Date()),
      contentHash: fingerprint(`${citation.sourceUrl}|${citation.supportingExcerpt}`),
    },
    create: {
      id: stableId("article", citation.sourceUrl),
      sourceId: source.id,
      canonicalUrl: citation.sourceUrl,
      externalId: citation.id,
      title: citation.supportingExcerpt,
      excerpt: citation.supportingExcerpt,
      publishedAt: toDate(citation.publishedAt, new Date()),
      language: ArticleLanguage.ZH,
      contentHash: fingerprint(`${citation.sourceUrl}|${citation.supportingExcerpt}`),
    },
  });
}

async function findPublishedByDate(digestDate: string) {
  const digest = await getPrismaClient().digest.findFirst({
    where: {
      digestDate: digestDateToDatabaseDate(digestDate),
      status: DigestStatus.PUBLISHED,
    },
    orderBy: {
      revision: "desc",
    },
    include: {
      items: {
        orderBy: {
          position: "asc",
        },
        include: {
          story: {
            include: {
              clusterArticles: {
                include: {
                  article: {
                    include: {
                      source: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  return digest ? mapDatabaseDigest(digest) : null;
}

async function findPublishedStoryByDate(digestDate: string, storyId: string) {
  const item = await getPrismaClient().digestItem.findFirst({
    where: {
      storyId,
      digest: {
        digestDate: digestDateToDatabaseDate(digestDate),
        status: DigestStatus.PUBLISHED,
      },
    },
    include: {
      story: {
        include: {
          clusterArticles: {
            include: {
              article: {
                include: {
                  source: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return item ? mapDatabaseStory(item) : null;
}

const getCachedPublishedDigest = unstable_cache(
  findPublishedByDate,
  ["published-digest"],
  { revalidate: 60 },
);

const getCachedPublishedStory = unstable_cache(
  findPublishedStoryByDate,
  ["published-digest-story"],
  { revalidate: 60 },
);

export const prismaDigestRepository: DigestRepository = {
  findPublishedByDate,
  findPublishedStoryByDate,
};

export const cachedPrismaDigestRepository: DigestRepository = {
  findPublishedByDate: getCachedPublishedDigest,
  findPublishedStoryByDate: getCachedPublishedStory,
};

export async function publishDigest(digest: DailyDigest, options: PublishDigestOptions) {
  const prisma = getPrismaClient();
  const databaseDate = digestDateToDatabaseDate(digest.digestDate);

  try {
    await prisma.$transaction(async (transaction) => {
    const latest = await transaction.digest.findFirst({
      where: { digestDate: databaseDate },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });
    const revision = (latest?.revision ?? 0) + 1;
    const publishedAt = toDate(digest.publishedAt, new Date());

    await transaction.digest.updateMany({
      where: {
        digestDate: databaseDate,
        status: DigestStatus.PUBLISHED,
      },
      data: { status: DigestStatus.SUPERSEDED },
    });

    const persistedStories: Array<{ story: DigestStory; storyId: string }> = [];

    for (const story of digest.stories) {
      const persistedArticles = await Promise.all(story.citations.map((citation) => persistCitation(transaction, citation)));
      const storyId = story.id || stableId("story", `${digest.digestDate}|${story.headline}`);

      await transaction.storyCluster.upsert({
        where: { id: storyId },
        update: {
          headline: story.headline,
          summary: story.summary,
          whyItMatters: story.whyItMatters,
          importanceScore: story.importanceScore,
          status: StoryStatus.PUBLISHED,
          lastEventAt: toDate(story.updatedAt, publishedAt),
        },
        create: {
          id: storyId,
          headline: story.headline,
          summary: story.summary,
          whyItMatters: story.whyItMatters,
          importanceScore: story.importanceScore,
          status: StoryStatus.PUBLISHED,
          startedAt: toDate(story.updatedAt, publishedAt),
          lastEventAt: toDate(story.updatedAt, publishedAt),
        },
      });

      await transaction.clusterArticle.deleteMany({ where: { storyId } });
      await transaction.clusterArticle.createMany({
        data: persistedArticles.map((article, index) => ({
          storyId,
          articleId: article.id,
          relevanceScore: 1,
          isPrimary: index === 0,
        })),
      });

      persistedStories.push({ story, storyId });
    }

    const publishedDigest = await transaction.digest.create({
      data: {
        id: randomUUID(),
        digestDate: databaseDate,
        revision,
        status: DigestStatus.PUBLISHED,
        generationMode: toGenerationMode(digest.generationMode),
        notice: digest.notice,
        publishedAt,
        items: {
          create: persistedStories.map(({ story, storyId }) => ({
            storyId,
            position: story.position,
            headlineSnapshot: story.headline,
            summarySnapshot: story.summary,
            impactSnapshot: story.whyItMatters,
          })),
        },
      },
    });

    await transaction.agentRun.create({
      data: {
        digestDate: databaseDate,
        trigger: options.trigger === "cron" ? AgentRunTrigger.CRON : AgentRunTrigger.MANUAL,
        status: AgentRunStatus.SUCCEEDED,
        model: options.model,
        retrievedDocumentCount: options.retrievedDocumentCount,
        publishedStoryCount: digest.stories.length,
        digestId: publishedDigest.id,
        completedAt: new Date(),
      },
    });
    }, {
      maxWait: 10_000,
      timeout: 30_000,
    });
  } catch (error) {
    console.error("Failed to persist the generated digest.", error);
    throw new DigestPersistenceError();
  }

  const persistedDigest = await prismaDigestRepository.findPublishedByDate(digest.digestDate);
  if (!persistedDigest) {
    throw new Error("The published digest could not be read back from the database.");
  }

  return persistedDigest;
}

export async function recordFailedAgentRun(options: RecordFailedAgentRunOptions) {
  await getPrismaClient().agentRun.create({
    data: {
      digestDate: digestDateToDatabaseDate(options.digestDate),
      trigger: options.trigger === "cron" ? AgentRunTrigger.CRON : AgentRunTrigger.MANUAL,
      status: AgentRunStatus.FAILED,
      model: options.model,
      errorMessage: options.errorMessage.slice(0, 2_000),
      completedAt: new Date(),
    },
  });
}
