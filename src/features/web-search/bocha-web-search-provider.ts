import {
  normalizeWebSearchCandidate,
  type WebSearchCandidate,
  type WebSearchConfig,
  type WebSearchProvider,
  type WebSearchRequest,
  type WebSearchResult,
} from "./web-search-contract";
import { WebSearchProviderError } from "./web-search-provider-error";

const DEFAULT_BOCHA_BASE_URL = "https://api.bochaai.com/v1";
const REQUEST_TIMEOUT_MS = 30_000;

type BochaWebPage = {
  id?: unknown;
  name?: unknown;
  url?: unknown;
  summary?: unknown;
  snippet?: unknown;
  siteName?: unknown;
  publishedDate?: unknown;
  dateLastCrawled?: unknown;
};

type BochaResponse = {
  code?: unknown;
  data?: {
    webPages?: {
      value?: unknown;
    };
  };
};

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getFreshness(maxAgeHours: number) {
  if (maxAgeHours <= 24) return "oneDay";
  if (maxAgeHours <= 24 * 7) return "oneWeek";
  return "oneMonth";
}

function toBochaCandidate(value: unknown, position: number, config: WebSearchConfig): WebSearchCandidate | null {
  if (!isRecord(value)) return null;

  const result = value as BochaWebPage;
  return normalizeWebSearchCandidate({
    id: getString(result.id) || `bocha-${position}-${getString(result.url)}`,
    title: getString(result.name),
    snippet: getString(result.summary) || getString(result.snippet) || null,
    canonicalUrl: getString(result.url),
    sourceName: getString(result.siteName),
    publishedAt: getString(result.publishedDate) || getString(result.dateLastCrawled) || null,
  }, config.policy);
}

export class BochaWebSearchProvider implements WebSearchProvider {
  readonly id = "bocha" as const;

  constructor(
    private readonly config: WebSearchConfig,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await this.fetchImplementation(`${this.config.baseUrl ?? DEFAULT_BOCHA_BASE_URL}/web-search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: request.query,
          freshness: getFreshness(request.maxAgeHours),
          summary: true,
          count: Math.min(request.maxResults, this.config.policy.maxResults),
        }),
        cache: "no-store",
        signal: abortController.signal,
      });

      if (!response.ok) {
        const isCredentialError = response.status === 401 || response.status === 403;
        throw new WebSearchProviderError(
          "WEB_SEARCH_UNAVAILABLE",
          502,
          isCredentialError ? "博查搜索 API Key 无效或没有调用权限。" : "博查搜索服务暂时不可用，请稍后重试。",
        );
      }

      const payload: unknown = await response.json();
      const responseBody = isRecord(payload) ? payload as BochaResponse : null;
      const pages = responseBody?.data?.webPages?.value;

      if (!responseBody || responseBody.code !== 200 || !Array.isArray(pages)) {
        throw new WebSearchProviderError("WEB_SEARCH_INVALID_RESPONSE", 502, "博查搜索未返回可用网页结果。");
      }

      const candidates = pages
        .map((page, index) => toBochaCandidate(page, index + 1, this.config))
        .filter((candidate): candidate is WebSearchCandidate => candidate !== null)
        .filter((candidate, index, all) => all.findIndex((other) => other.canonicalUrl === candidate.canonicalUrl) === index);

      return { provider: this.id, query: request.query, candidates, fetchedAt: new Date().toISOString() };
    } catch (error) {
      if (error instanceof WebSearchProviderError) throw error;

      const isTimeout = error instanceof Error && error.name === "AbortError";
      throw new WebSearchProviderError(
        "WEB_SEARCH_UNAVAILABLE",
        502,
        isTimeout ? "博查搜索服务响应超时，请稍后重试。" : "博查搜索服务暂时不可用，请稍后重试。",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
