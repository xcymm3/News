import { cachedPrismaDigestRepository } from "./prisma-digest-repository";
import type { DailyDigest, DigestStory } from "./types";

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

export class DigestStoryNotFoundError extends Error {
  constructor(storyId: string) {
    super(`No published story exists for ${storyId}.`);
    this.name = "DigestStoryNotFoundError";
  }
}

export interface DigestRepository {
  findPublishedByDate(digestDate: string): Promise<DailyDigest | null>;
  findPublishedStoryByDate?(digestDate: string, storyId: string): Promise<DigestStory | null>;
}

export interface DigestService {
  getTodayDigest(now?: Date): Promise<DailyDigest>;
  getDigestByDate(digestDate: string): Promise<DailyDigest>;
  getTodayStory(storyId: string, now?: Date): Promise<DigestStory>;
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

export function createDigestService(repository: DigestRepository): DigestService {
  const getDigestByDate = async (digestDate: string) => {
    assertValidDigestDate(digestDate);

    const digest = await repository.findPublishedByDate(digestDate);

    if (!digest) {
      throw new DigestNotFoundError(digestDate);
    }

    return digest;
  };

  const getStoryByDate = async (digestDate: string, storyId: string) => {
    assertValidDigestDate(digestDate);

    const story = repository.findPublishedStoryByDate
      ? await repository.findPublishedStoryByDate(digestDate, storyId)
      : (await getDigestByDate(digestDate)).stories.find((item) => item.id === storyId) ?? null;

    if (!story) {
      throw new DigestStoryNotFoundError(storyId);
    }

    return story;
  };

  return {
    async getTodayDigest(now = new Date()) {
      return getDigestByDate(formatShanghaiDate(now));
    },
    getDigestByDate,
    async getTodayStory(storyId, now = new Date()) {
      return getStoryByDate(formatShanghaiDate(now), storyId);
    },
  };
}

export const digestService = createDigestService(cachedPrismaDigestRepository);
