import { demoDigest } from "./data/demo-digest";
import { prismaDigestRepository } from "./prisma-digest-repository";
import { getCachedAgentDigest } from "@/features/agent/news-rag-agent";
import { generateLiveDigest } from "./live-digest-generator";
import type { DailyDigest } from "./types";

const ASIA_SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const DIGEST_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class InvalidDigestDateError extends Error {
  constructor(digestDate: string) {
    super(`Invalid digest date: ${digestDate}`);
    this.name = "InvalidDigestDateError";
  }
}

export class DigestNotFoundError extends Error {
  constructor(digestDate: string) {
    super(`No published digest exists for ${digestDate}.`);
    this.name = "DigestNotFoundError";
  }
}

export interface DigestRepository {
  findPublishedByDate(digestDate: string): Promise<DailyDigest | null>;
}

export interface DigestService {
  getTodayDigest(now?: Date): Promise<DailyDigest>;
  getDigestByDate(digestDate: string): Promise<DailyDigest>;
}

function assertValidDigestDate(digestDate: string) {
  if (!DIGEST_DATE_PATTERN.test(digestDate)) {
    throw new InvalidDigestDateError(digestDate);
  }

  const parsedDate = new Date(`${digestDate}T00:00:00.000Z`);

  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== digestDate) {
    throw new InvalidDigestDateError(digestDate);
  }
}

export function formatShanghaiDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ASIA_SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const partValue = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;

  const year = partValue("year");
  const month = partValue("month");
  const day = partValue("day");

  if (!year || !month || !day) {
    throw new Error("Unable to resolve the current Shanghai date.");
  }

  return `${year}-${month}-${day}`;
}

function replaceIsoDate(isoDateTime: string, digestDate: string) {
  return `${digestDate}${isoDateTime.slice(10)}`;
}

function cloneDemoDigestForDate(digestDate: string): DailyDigest {
  return {
    ...demoDigest,
    id: `demo-digest-${digestDate}-r${demoDigest.revision}`,
    digestDate,
    publishedAt: replaceIsoDate(demoDigest.publishedAt, digestDate),
    notice: `当前为 ${digestDate} 的虚构演示数据，不代表真实新闻或真实来源。`,
    stories: demoDigest.stories.map((story) => ({
      ...story,
      updatedAt: replaceIsoDate(story.updatedAt, digestDate),
      citations: story.citations.map((citation) => ({
        ...citation,
        publishedAt: replaceIsoDate(citation.publishedAt, digestDate),
      })),
    })),
  };
}

export const demoDigestRepository: DigestRepository = {
  async findPublishedByDate(digestDate) {
    assertValidDigestDate(digestDate);
    return cloneDemoDigestForDate(digestDate);
  },
};

export const generatedDigestRepository: DigestRepository = {
  async findPublishedByDate(digestDate) {
    assertValidDigestDate(digestDate);

    if (digestDate !== formatShanghaiDate(new Date())) {
      return null;
    }

    const agentDigest = getCachedAgentDigest(digestDate);

    if (agentDigest) {
      return agentDigest;
    }

    return generateLiveDigest(digestDate);
  },
};

export function createFallbackDigestRepository(
  primaryRepository: DigestRepository,
  fallbackRepository: DigestRepository,
  reportError: (error: unknown) => void = (error) => {
    console.warn("Falling back to the demo digest because live digest generation failed.", error);
  },
): DigestRepository {
  return {
    async findPublishedByDate(digestDate) {
      try {
        const generatedDigest = await primaryRepository.findPublishedByDate(digestDate);

        if (generatedDigest) {
          return generatedDigest;
        }
      } catch (error) {
        reportError(error);
      }

      return fallbackRepository.findPublishedByDate(digestDate);
    },
  };
}

const generatedOrDemoDigestRepository = createFallbackDigestRepository(generatedDigestRepository, demoDigestRepository);
const fallbackDigestRepository = createFallbackDigestRepository(prismaDigestRepository, generatedOrDemoDigestRepository);

export function createDigestService(repository: DigestRepository): DigestService {
  const getDigestByDate = async (digestDate: string) => {
    assertValidDigestDate(digestDate);

    const digest = await repository.findPublishedByDate(digestDate);

    if (!digest) {
      throw new DigestNotFoundError(digestDate);
    }

    return digest;
  };

  return {
    async getTodayDigest(now = new Date()) {
      return getDigestByDate(formatShanghaiDate(now));
    },
    getDigestByDate,
  };
}

export const digestService = createDigestService(fallbackDigestRepository);
