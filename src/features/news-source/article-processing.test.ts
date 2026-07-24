import { describe, expect, it } from "vitest";

import { processRawNewsArticles } from "./article-processing";
import type { RawNewsArticle } from "./live-news-source";

const now = new Date("2026-07-23T12:00:00.000Z");

function createArticle(
  id: string,
  canonicalUrl: string,
  title: string,
  publishedAt = "2026-07-23T10:00:00.000Z",
): RawNewsArticle {
  return {
    externalId: id,
    canonicalUrl,
    title,
    excerpt: "A sufficiently detailed source excerpt for testing.",
    sourceName: "Test source",
    sourceDomain: "example.test",
    language: "en",
    publishedAt,
  };
}

describe("processRawNewsArticles", () => {
  it("removes duplicates and stale or invalid articles before clustering", () => {
    const result = processRawNewsArticles(
      [
        createArticle(
          "first",
          "https://example.test/a?utm_source=newsletter",
          "Lebanon ceasefire talks resume after border incident",
        ),
        createArticle("same-url", "https://example.test/a", "A duplicate URL should be removed"),
        createArticle(
          "same-title",
          "https://example.test/c",
          "Lebanon ceasefire talks resume after border incident",
        ),
        createArticle(
          "related",
          "https://example.test/d",
          "Lebanon ceasefire talks resume amid border tensions",
        ),
        createArticle(
          "stale",
          "https://example.test/e",
          "Outdated article title for filtering",
          "2026-07-18T10:00:00.000Z",
        ),
        createArticle("invalid", "ftp://example.test/f", "Invalid protocol article title"),
      ],
      now,
    );

    expect(result.stats).toMatchObject({
      inputCount: 6,
      acceptedCount: 2,
      clusterCount: 1,
      rejected: {
        duplicateUrl: 1,
        duplicateTitle: 1,
        stale: 1,
        invalid: 1,
      },
    });
    expect(result.clusters[0]?.articleCount).toBe(2);
    expect(result.clusters[0]?.articles[0]?.canonicalUrl).toBe("https://example.test/a");
  });

  it("clusters related Chinese headlines from different sources", () => {
    const result = processRawNewsArticles(
      [
        createArticle("first", "https://example.test/chinese-a", "中美贸易谈判取得新的进展"),
        createArticle("second", "https://another.example.test/chinese-b", "中美贸易谈判继续推进并讨论关税"),
      ].map((article) => ({
        ...article,
        sourceDomain: article.externalId === "first" ? "example.test" : "another.example.test",
        sourceName: article.externalId === "first" ? "来源甲" : "来源乙",
      })),
      now,
    );

    expect(result.stats.clusterCount).toBe(1);
    expect(result.clusters[0]).toMatchObject({
      articleCount: 2,
      sourceCount: 2,
    });
  });

  it("keeps matching headlines from different RSS sources as corroborating reports", () => {
    const result = processRawNewsArticles(
      [
        createArticle("first", "https://example.test/first", "中国发布新的人工智能治理规则"),
        createArticle("second", "https://another.example.test/second", "中国发布新的人工智能治理规则"),
      ].map((article) => ({
        ...article,
        sourceName: article.externalId === "first" ? "来源甲" : "来源乙",
      })),
      now,
    );

    expect(result.stats).toMatchObject({
      acceptedCount: 2,
      rejected: { duplicateTitle: 0 },
    });
    expect(result.clusters[0]).toMatchObject({
      articleCount: 2,
      sourceCount: 2,
    });
  });
});
