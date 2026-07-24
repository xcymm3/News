import { describe, expect, it } from "vitest";

import { createFallbackDigestRepository, type DigestRepository } from "./digest-service";
import type { DailyDigest } from "./types";

const fallbackDigest: DailyDigest = {
  id: "demo-digest-test",
  digestDate: "2026-07-23",
  revision: 1,
  publishedAt: "2026-07-23T12:00:00.000Z",
  isDemoData: true,
  stories: [],
};

describe("createFallbackDigestRepository", () => {
  it("uses the demo repository when live generation fails", async () => {
    const primaryRepository: DigestRepository = {
      async findPublishedByDate() {
        throw new Error("source unavailable");
      },
    };
    const fallbackRepository: DigestRepository = {
      async findPublishedByDate() {
        return fallbackDigest;
      },
    };
    const reportedErrors: unknown[] = [];
    const repository = createFallbackDigestRepository(primaryRepository, fallbackRepository, (error) => {
      reportedErrors.push(error);
    });

    await expect(repository.findPublishedByDate("2026-07-23")).resolves.toEqual(fallbackDigest);
    expect(reportedErrors).toHaveLength(1);
  });
});
