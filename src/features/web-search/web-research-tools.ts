import { tool } from "@langchain/core/tools";
import { z } from "zod";

import {
  createWebSourcePolicy,
  normalizeWebArticleUrl,
  type WebSearchProvider,
  type WebSourcePolicy,
} from "./web-search-contract";
import { createConfiguredWebSearchProvider, WebSearchProviderError } from "./tavily-web-search-provider";

const ARTICLE_REQUEST_TIMEOUT_MS = 12_000;
const MAX_ARTICLE_CHARACTERS = 24_000;

type FetchImplementation = typeof fetch;

type FetchArticleOptions = {
  fetchImplementation?: FetchImplementation;
  policy?: WebSourcePolicy;
};

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlToText(value: string) {
  return decodeHtml(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export async function fetchArticleText(url: string, options: FetchArticleOptions = {}) {
  const policy = options.policy ?? createWebSourcePolicy();
  const normalizedUrl = normalizeWebArticleUrl(url, policy);

  if (!normalizedUrl) {
    throw new WebSearchProviderError("WEB_SEARCH_INVALID_RESPONSE", 400, "网页地址不符合来源准入规则。");
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), ARTICLE_REQUEST_TIMEOUT_MS);

  try {
    const response = await (options.fetchImplementation ?? fetch)(normalizedUrl.canonicalUrl, {
      headers: {
        Accept: "text/html,text/plain;q=0.9",
      },
      cache: "no-store",
      signal: abortController.signal,
    });
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

    if (!response.ok) {
      throw new WebSearchProviderError("WEB_SEARCH_UNAVAILABLE", 502, "暂时无法读取候选网页原文。");
    }

    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new WebSearchProviderError("WEB_SEARCH_INVALID_RESPONSE", 422, "候选网页不是可阅读的文本页面。");
    }

    const body = await response.text();
    const text = (contentType.includes("text/html") ? htmlToText(body) : body.replace(/\s+/g, " ").trim())
      .slice(0, MAX_ARTICLE_CHARACTERS);

    if (!text) {
      throw new WebSearchProviderError("WEB_SEARCH_INVALID_RESPONSE", 422, "候选网页没有可用于摘要的正文。");
    }

    return {
      ...normalizedUrl,
      contentType,
      text,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof WebSearchProviderError) {
      throw error;
    }

    const isTimeout = error instanceof Error && error.name === "AbortError";
    throw new WebSearchProviderError(
      "WEB_SEARCH_UNAVAILABLE",
      502,
      isTimeout ? "读取候选网页原文超时，请稍后重试。" : "暂时无法读取候选网页原文。",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function createWebResearchTools(options: {
  provider?: WebSearchProvider;
  fetchImplementation?: FetchImplementation;
  policy?: WebSourcePolicy;
} = {}) {
  const policy = options.policy ?? createWebSourcePolicy();

  const searchWeb = tool(
    async ({ query, maxResults }) => {
      const provider = options.provider ?? createConfiguredWebSearchProvider();
      const result = await provider.search({
        query: query.trim(),
        language: "zh-CN",
        maxResults: Math.min(maxResults ?? policy.maxResults, policy.maxResults),
        maxAgeHours: policy.maxAgeHours,
      });

      return JSON.stringify(result);
    },
    {
      name: "search_web",
      description: "搜索近期中文网页新闻。返回候选标题、摘要、规范 URL、来源域名与发布时间。",
      schema: z.object({
        query: z.string().min(2).max(160).describe("用于搜索近期中文新闻的简洁关键词"),
        maxResults: z.number().int().min(1).max(20).optional().describe("最多返回多少个候选网页"),
      }),
    },
  );

  const fetchArticle = tool(
    async ({ url }) => JSON.stringify(await fetchArticleText(url, {
      fetchImplementation: options.fetchImplementation,
      policy,
    })),
    {
      name: "fetch_article",
      description: "读取已搜索到的候选网页正文。只能读取符合来源准入规则的 HTTP(S) 网页。",
      schema: z.object({
        url: z.string().url().describe("search_web 返回的候选网页 URL"),
      }),
    },
  );

  return [searchWeb, fetchArticle];
}
