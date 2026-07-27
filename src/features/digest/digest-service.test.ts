import { describe, expect, it } from "vitest";

import { createDigestService, DigestNotFoundError, type DigestRepository } from "./digest-service";
import type { DailyDigest } from "./types";

const fallbackDigest: DailyDigest = {
  id: "demo-digest-test",
  digestDate: "2026-07-23",
  revision: 1,
  publishedAt: "2026-07-23T12:00:00.000Z",
  isDemoData: true,
  stories: [],
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
});
