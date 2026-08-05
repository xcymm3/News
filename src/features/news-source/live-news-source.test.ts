import { describe, expect, it } from "vitest";

import { DEFAULT_CHINESE_RSS_SOURCES, parseRssArticles, type RssNewsSource } from "./live-news-source";

const source: RssNewsSource = {
  id: "test-feed",
  name: "测试新闻源",
  url: "https://feeds.example.test/news.xml",
  language: "zh-CN",
};

describe("parseRssArticles", () => {
  it("registers the five Chinese RSS sources used by the web research Agent", () => {
    expect(DEFAULT_CHINESE_RSS_SOURCES.map((rss) => ({ name: rss.name, maxRecords: rss.maxRecords }))).toEqual([
      { name: "中国新闻网", maxRecords: 30 },
      { name: "36氪", maxRecords: 30 },
      { name: "中央社国际", maxRecords: 20 },
      { name: "IT之家", maxRecords: 60 },
      { name: "虎嗅", maxRecords: 22 },
    ]);
  });

  it("keeps a Chinese RSS item's title, summary, source, URL, and publication time", () => {
    const articles = parseRssArticles(
      `<?xml version="1.0" encoding="UTF-8"?>
      <rss><channel><item>
        <title><![CDATA[中美经贸磋商取得新进展]]></title>
        <link>https://news.example.test/articles/1</link>
        <description><![CDATA[<p>这是可用于摘要的新闻前言。</p>]]></description>
        <pubDate>Thu, 23 Jul 2026 12:30:00 GMT</pubDate>
      </item></channel></rss>`,
      source,
    );

    expect(articles).toEqual([
      expect.objectContaining({
        title: "中美经贸磋商取得新进展",
        excerpt: "这是可用于摘要的新闻前言。",
        sourceName: "测试新闻源",
        sourceDomain: "news.example.test",
        language: "zh-CN",
        canonicalUrl: "https://news.example.test/articles/1",
        publishedAt: "2026-07-23T12:30:00.000Z",
      }),
    ]);
  });

  it("uses an article link when a feed provides a non-URL internal guid", () => {
    const articles = parseRssArticles(
      `<?xml version="1.0" encoding="UTF-8"?>
      <rss><channel><item>
        <title><![CDATA[国际新闻标题]]></title>
        <guid isPermaLink="false">CNA/2026-07-24/000123</guid>
        <link>https://www.cna.com.tw/news/aopl/202607240123.aspx</link>
        <description>新闻摘要</description>
        <pubDate>Fri, 24 Jul 2026 08:00:00 GMT</pubDate>
      </item></channel></rss>`,
      source,
    );

    expect(articles).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.cna.com.tw/news/aopl/202607240123.aspx",
        sourceDomain: "www.cna.com.tw",
      }),
    ]);
  });
});
