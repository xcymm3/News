import { prismaDigestRepository } from "./prisma-digest-repository";
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

export const digestService = createDigestService(prismaDigestRepository);
