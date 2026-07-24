import { describe, expect, it } from "vitest";

import type { NewsClusterCandidate } from "@/features/news-source/article-processing";

import { DigestValidationError, buildGeneratedDigest, validateGeneratedDigest } from "./live-digest-generator";

const candidate: NewsClusterCandidate = {
  id: "cluster-test",
  headline: "Test event headline with enough detail",
  summary: "A sufficiently detailed source excerpt for validation.",
  latestPublishedAt: "2026-07-23T11:00:00.000Z",
  articleCount: 1,
  sourceCount: 1,
  articles: [
    {
      externalId: "article-test",
      canonicalUrl: "https://example.test/articles/1",
      normalizedUrl: "https://example.test/articles/1",
      title: "Test event headline with enough detail",
      excerpt: "A sufficiently detailed source excerpt for validation.",
      sourceName: "Test source",
      sourceDomain: "example.test",
      language: "en",
      publishedAt: "2026-07-23T11:00:00.000Z",
    },
  ],
};

describe("buildGeneratedDigest", () => {
  it("creates a cited, non-demo digest from valid candidates", () => {
    const digest = buildGeneratedDigest({
      digestDate: "2026-07-23",
      generatedAt: new Date("2026-07-23T12:00:00.000Z"),
      clusters: [candidate],
    });

    expect(digest.isDemoData).toBe(false);
    expect(digest.stories).toHaveLength(1);
    expect(digest.stories[0]?.citations[0]).toMatchObject({
      sourceUrl: "https://example.test/articles/1",
      sourceName: "Test source",
    });
  });

  it("rejects a generated story without a citation", () => {
    const digest = buildGeneratedDigest({
      digestDate: "2026-07-23",
      generatedAt: new Date("2026-07-23T12:00:00.000Z"),
      clusters: [candidate],
    });

    expect(() =>
      validateGeneratedDigest({
        ...digest,
        stories: [{ ...digest.stories[0]!, citations: [] }],
      }),
    ).toThrow(DigestValidationError);
  });
});
