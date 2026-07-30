import { describe, expect, it } from "vitest";

import {
  createDigestService,
  DigestNotFoundError,
  type DigestRepository,
} from "./digest-service";
import type { DailyDigest, DigestStory } from "./types";

const fallbackStory: DigestStory = {
  id: "story-1",
  position: 1,
  headline: "测试事件",
  summary: "测试摘要",
  whyItMatters: "测试影响",
  importanceScore: 80,
  updatedAt: "2026-07-23T12:00:00.000Z",
  citations: [],
};

const fallbackDigest: DailyDigest = {
  id: "demo-digest-test",
  digestDate: "2026-07-23",
  revision: 1,
  publishedAt: "2026-07-23T12:00:00.000Z",
  isDemoData: true,
  stories: [fallbackStory],
};

describe("createDigestService", () => {
  it("returns only the published digest supplied by its repository", async () => {
    const repository: DigestRepository = {
      async findPublishedByDate() {
        return fallbackDigest;
      },
    };

    await expect(createDigestService(repository).getDigestByDate("2026-07-23")).resolves.toEqual(fallbackDigest);
  });

  it("reports a missing digest instead of falling back to generated content", async () => {
    const repository: DigestRepository = {
      async findPublishedByDate() {
        return null;
      },
    };

    await expect(createDigestService(repository).getDigestByDate("2026-07-23")).rejects.toBeInstanceOf(DigestNotFoundError);
  });

  it("uses the targeted story query when the repository supports it", async () => {
    const repository: DigestRepository = {
      async findPublishedByDate() {
        throw new Error("The full digest query should not run.");
      },
      async findPublishedStoryByDate(digestDate, storyId) {
        return digestDate === "2026-07-23" && storyId === fallbackStory.id ? fallbackStory : null;
      },
    };

    await expect(
      createDigestService(repository).getTodayStory(fallbackStory.id, new Date("2026-07-23T04:00:00.000Z")),
    ).resolves.toEqual(fallbackStory);
  });
});
