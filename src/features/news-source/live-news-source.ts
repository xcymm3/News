export type RawNewsArticle = {
  externalId: string;
  canonicalUrl: string;
  title: string;
  excerpt: string | null;
  sourceName: string;
  sourceDomain: string;
  language: string | null;
  publishedAt: string;
};

export type NewsSourceProvider = "multi-rss-zh" | "un-news-rss" | "gdelt-doc";

export type LatestLiveNews = {
  articles: RawNewsArticle[];
  provider: NewsSourceProvider;
  sourceNames: string[];
  fetchedAt: string;
  cacheStatus: "hit" | "miss";
};

export type RssNewsSource = {
  id: string;
  name: string;
  url: string;
  language: string;
};

type GdeltArticle = {
  url?: unknown;
  title?: unknown;
  domain?: unknown;
  language?: unknown;
  seendate?: unknown;
};

type GdeltResponse = {
  articles?: unknown;
};

const GDELT_ARTICLE_LIST_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const DEFAULT_QUERY = '(diplomacy OR conflict OR trade OR sanctions OR "international relations")';
const DEFAULT_TIMESPAN = "24h";
const DEFAULT_MAX_RECORDS = 25;
const MAX_RECORDS = 50;
const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60 * 1_000;

const UN_NEWS_RSS_SOURCE: RssNewsSource = {
  id: "un-news-all",
  name: "UN News",
  url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml",
  language: "en",
};

export const DEFAULT_CHINESE_RSS_SOURCES: readonly RssNewsSource[] = [
  {
    id: "chinanews-scroll",
    name: "中国新闻网",
    url: "https://www.chinanews.com.cn/rss/scroll-news.xml",
    language: "zh-CN",
  },
  {
    id: "36kr-general",
    name: "36氪",
    url: "https://36kr.com/feed",
    language: "zh-CN",
  },
  {
    id: "cna-international",
    name: "中央社",
    url: "https://feeds.feedburner.com/rsscna/intworld",
    language: "zh-Hant",
  },
  {
    id: "ithome",
    name: "IT之家",
    url: "https://www.ithome.com/rss/",
    language: "zh-CN",
  },
  {
    id: "huxiu",
    name: "虎嗅",
    url: "https://rss.huxiu.com/",
    language: "zh-CN",
  },
];

let cachedResult: Omit<LatestLiveNews, "cacheStatus"> | null = null;
let cachedAt = 0;
let pendingRequest: Promise<Omit<LatestLiveNews, "cacheStatus">> | null = null;

export class LiveNewsSourceError extends Error {
  constructor(
    readonly code: "NEWS_SOURCE_RATE_LIMITED" | "NEWS_SOURCE_UNAVAILABLE" | "NEWS_SOURCE_INVALID_RESPONSE",
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LiveNewsSourceError";
  }
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function decodeXmlEntities(value: string) {
  return decodeHtmlEntities(value)
    .replace(/&#(\d+);/g, (_, codePoint: string) => String.fromCodePoint(Number(codePoint)))
    .replace(/&#x([\da-f]+);/gi, (_, codePoint: string) => String.fromCodePoint(Number.parseInt(codePoint, 16)));
}

function stripHtml(value: string) {
  return decodeXmlEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function parseGdeltDate(value: string) {
  const compactMatch = value.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);

  if (compactMatch) {
    const [, year, month, day, hour, minute, second] = compactMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getConfiguredProvider(): NewsSourceProvider {
  const configuredProvider = process.env.NEWS_SOURCE_PROVIDER?.trim();

  if (configuredProvider === "gdelt-doc" || configuredProvider === "un-news-rss") {
    return configuredProvider;
  }

  return "multi-rss-zh";
}

function getConfiguredTimespan() {
  const value = process.env.NEWS_SOURCE_TIMESPAN?.trim();

  return value && /^\d+(?:min|h|d|w|m|hours|days|weeks|months)$/.test(value) ? value : DEFAULT_TIMESPAN;
}

function getConfiguredMaxRecords() {
  const value = Number(process.env.NEWS_SOURCE_MAX_RECORDS);

  return Number.isInteger(value) && value > 0 ? Math.min(value, MAX_RECORDS) : DEFAULT_MAX_RECORDS;
}

function toGdeltRawArticle(value: unknown): RawNewsArticle | null {
  if (!isRecord(value)) {
    return null;
  }

  const article = value as GdeltArticle;
  const rawUrl = getString(article.url);
  const title = decodeHtmlEntities(getString(article.title));
  const seenDate = parseGdeltDate(getString(article.seendate));

  if (!rawUrl || !title || !seenDate) {
    return null;
  }

  let articleUrl: URL;

  try {
    articleUrl = new URL(rawUrl);
  } catch {
    return null;
  }

  if (articleUrl.protocol !== "https:" && articleUrl.protocol !== "http:") {
    return null;
  }

  const sourceDomain = getString(article.domain) || articleUrl.hostname;

  return {
    externalId: articleUrl.toString(),
    canonicalUrl: articleUrl.toString(),
    title,
    excerpt: null,
    sourceName: sourceDomain,
    sourceDomain,
    language: getString(article.language) || null,
    publishedAt: seenDate.toISOString(),
  };
}

function getRssTagValue(item: string, tagName: string) {
  const match = item.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  const value = match?.[1]?.trim() ?? "";

  return value.startsWith("<![CDATA[") && value.endsWith("]]>") ? value.slice(9, -3).trim() : value;
}

function getRssLinkValue(item: string) {
  const textLink = getRssTagValue(item, "link");

  if (textLink) {
    return textLink;
  }

  return item.match(/<link\s[^>]*?href=["']([^"']+)["'][^>]*\/?>(?:<\/link>)?/i)?.[1]?.trim() ?? "";
}

function getRssPublishedDate(item: string) {
  const candidates = ["pubDate", "published", "updated", "dc:date", "date"];

  for (const tagName of candidates) {
    const date = new Date(getRssTagValue(item, tagName));

    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

function decodeRssResponse(buffer: ArrayBuffer, contentType: string) {
  const bytes = new Uint8Array(buffer);
  const declaration = new TextDecoder("latin1").decode(bytes.slice(0, 300));
  const charset = contentType.match(/charset=([^;\s]+)/i)?.[1] ?? declaration.match(/<\?xml[^>]+encoding=["']([^"']+)["']/i)?.[1] ?? "utf-8";
  const normalizedCharset = charset.trim().toLocaleLowerCase("en-US") === "gb2312" || charset.trim().toLocaleLowerCase("en-US") === "gbk"
    ? "gb18030"
    : charset.trim();

  try {
    return new TextDecoder(normalizedCharset).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

export function parseRssArticles(rss: string, source: RssNewsSource, maximumRecords = DEFAULT_MAX_RECORDS) {
  const items = rss.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) ?? [];
  const resultLimit = Math.min(Math.max(Math.floor(maximumRecords), 1), MAX_RECORDS);

  return items
    .slice(0, resultLimit)
    .map((item): RawNewsArticle | null => {
      const title = stripHtml(getRssTagValue(item, "title"));
      // RSS guid 不一定是网址（例如中央社会使用 CNA/2026... 形式的内部编号）。
      // 因此优先采用 link，只在 link 缺失时才使用可解析为 URL 的 guid。
      const canonicalUrl = getRssLinkValue(item) || getRssTagValue(item, "guid");
      const excerpt = stripHtml(getRssTagValue(item, "description") || getRssTagValue(item, "content:encoded"));
      const publishedAt = getRssPublishedDate(item);

      if (!title || !canonicalUrl || !publishedAt) {
        return null;
      }

      try {
        const articleUrl = new URL(canonicalUrl);

        if (articleUrl.protocol !== "https:" && articleUrl.protocol !== "http:") {
          return null;
        }

        return {
          externalId: articleUrl.toString(),
          canonicalUrl: articleUrl.toString(),
          title,
          excerpt: excerpt || null,
          sourceName: source.name,
          sourceDomain: articleUrl.hostname,
          language: source.language,
          publishedAt: publishedAt.toISOString(),
        };
      } catch {
        return null;
      }
    })
    .filter((article): article is RawNewsArticle => article !== null);
}

async function fetchRssSource(source: RssNewsSource) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(source.url, {
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
        "User-Agent": "International-Briefing-RSS/0.1",
      },
      cache: "no-store",
      signal: abortController.signal,
    });
    const responseBuffer = await response.arrayBuffer();
    const responseText = decodeRssResponse(responseBuffer, response.headers.get("content-type") ?? "");

    if (!response.ok) {
      throw new LiveNewsSourceError("NEWS_SOURCE_UNAVAILABLE", 502, `${source.name} RSS 暂时不可用。`);
    }

    if (!/<(?:rss|feed)\b/i.test(responseText)) {
      throw new LiveNewsSourceError("NEWS_SOURCE_INVALID_RESPONSE", 502, `${source.name} RSS 返回了无法识别的内容。`);
    }

    return {
      source,
      articles: parseRssArticles(responseText, source, getConfiguredMaxRecords()),
    };
  } catch (error) {
    if (error instanceof LiveNewsSourceError) {
      throw error;
    }

    const message = error instanceof Error && error.name === "AbortError" ? `${source.name} RSS 响应超时。` : `${source.name} RSS 暂时不可用。`;

    throw new LiveNewsSourceError("NEWS_SOURCE_UNAVAILABLE", 502, message);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLatestFromRssSources(sources: readonly RssNewsSource[], provider: Extract<NewsSourceProvider, "multi-rss-zh" | "un-news-rss">): Promise<Omit<LatestLiveNews, "cacheStatus">> {
  const responses = await Promise.allSettled(sources.map((source) => fetchRssSource(source)));
  // 仅把真正解析出可用新闻的源标记为可用；HTTP 200 但空内容、旧格式内容不会再误导前端。
  const usableResponses = responses.flatMap((response) => (
    response.status === "fulfilled" && response.value.articles.length > 0 ? [response.value] : []
  ));
  const articles = usableResponses.flatMap((response) => response.articles);

  if (usableResponses.length === 0 || articles.length === 0) {
    throw new LiveNewsSourceError("NEWS_SOURCE_UNAVAILABLE", 502, "所有 RSS 新闻源暂时不可用，请稍后重试。");
  }

  return {
    articles,
    provider,
    sourceNames: [...new Set(usableResponses.map((response) => response.source.name))],
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchLatestFromGdelt(): Promise<Omit<LatestLiveNews, "cacheStatus">> {
  const params = new URLSearchParams({
    query: process.env.NEWS_SOURCE_QUERY?.trim() || DEFAULT_QUERY,
    mode: "artlist",
    maxrecords: String(getConfiguredMaxRecords()),
    sort: "datedesc",
    timespan: getConfiguredTimespan(),
    format: "json",
  });
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${GDELT_ARTICLE_LIST_URL}?${params}`, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: abortController.signal,
    });
    const responseText = await response.text();

    if (response.status === 429 || /limit requests to one every/i.test(responseText)) {
      throw new LiveNewsSourceError("NEWS_SOURCE_RATE_LIMITED", 429, "实时新闻源暂时限流，请稍后重试。");
    }

    if (!response.ok) {
      throw new LiveNewsSourceError("NEWS_SOURCE_UNAVAILABLE", 502, "实时新闻源暂时不可用，请稍后重试。");
    }

    let payload: GdeltResponse;

    try {
      payload = JSON.parse(responseText) as GdeltResponse;
    } catch {
      throw new LiveNewsSourceError("NEWS_SOURCE_INVALID_RESPONSE", 502, "实时新闻源返回了无法识别的内容。");
    }

    const articles = Array.isArray(payload.articles)
      ? payload.articles.map(toGdeltRawArticle).filter((article): article is RawNewsArticle => article !== null)
      : [];

    return {
      articles,
      provider: "gdelt-doc",
      sourceNames: ["GDELT DOC"],
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof LiveNewsSourceError) {
      throw error;
    }

    const message = error instanceof Error && error.name === "AbortError" ? "实时新闻源响应超时，请稍后重试。" : "实时新闻源暂时不可用，请稍后重试。";

    throw new LiveNewsSourceError("NEWS_SOURCE_UNAVAILABLE", 502, message);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getLatestLiveNews(): Promise<LatestLiveNews> {
  if (cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return {
      ...cachedResult,
      articles: cachedResult.articles.map((article) => ({ ...article })),
      sourceNames: [...cachedResult.sourceNames],
      cacheStatus: "hit",
    };
  }

  if (!pendingRequest) {
    const provider = getConfiguredProvider();
    pendingRequest = (
      provider === "gdelt-doc"
        ? fetchLatestFromGdelt()
        : provider === "un-news-rss"
          ? fetchLatestFromRssSources([UN_NEWS_RSS_SOURCE], provider)
          : fetchLatestFromRssSources(DEFAULT_CHINESE_RSS_SOURCES, provider)
    ).finally(() => {
      pendingRequest = null;
    });
  }

  const result = await pendingRequest;

  cachedResult = {
    ...result,
    articles: result.articles.map((article) => ({ ...article })),
    sourceNames: [...result.sourceNames],
  };
  cachedAt = Date.now();

  return {
    ...result,
    articles: result.articles.map((article) => ({ ...article })),
    sourceNames: [...result.sourceNames],
    cacheStatus: "miss",
  };
}
