import {
  getWebSearchConfig,
  normalizeWebSearchCandidate,
  type WebSearchCandidate,
  type WebSearchConfig,
  type WebSearchProvider,
  type WebSearchRequest,
  type WebSearchResult,
} from "./web-search-contract";

const DEFAULT_TAVILY_BASE_URL = "https://api.tavily.com";
const REQUEST_TIMEOUT_MS = 15_000;

type TavilyResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  raw_content?: unknown;
  published_date?: unknown;
};

type TavilyResponse = {
  results?: unknown;
};

export class WebSearchProviderError extends Error {
  constructor(
    readonly code: "WEB_SEARCH_NOT_CONFIGURED" | "WEB_SEARCH_PROVIDER_UNSUPPORTED" | "WEB_SEARCH_UNAVAILABLE" | "WEB_SEARCH_INVALID_RESPONSE",
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WebSearchProviderError";
  }
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toTavilyCandidate(value: unknown, position: number, config: WebSearchConfig): WebSearchCandidate | null {
  if (!isRecord(value)) {
    return null;
  }

  const result = value as TavilyResult;
  const content = getString(result.raw_content) || getString(result.content);

  return normalizeWebSearchCandidate({
    id: `tavily-${position}-${getString(result.url)}`,
    title: getString(result.title),
    snippet: content || null,
    canonicalUrl: getString(result.url),
    sourceName: "",
    publishedAt: getString(result.published_date) || null,
  }, config.policy);
}

export class TavilyWebSearchProvider implements WebSearchProvider {
  readonly id = "tavily" as const;

  constructor(
    private readonly config: WebSearchConfig,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await this.fetchImplementation(`${this.config.baseUrl ?? DEFAULT_TAVILY_BASE_URL}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: this.config.apiKey,
          query: request.query,
          topic: "news",
          search_depth: "advanced",
          max_results: Math.min(request.maxResults, this.config.policy.maxResults),
          days: Math.max(1, Math.ceil(request.maxAgeHours / 24)),
          include_answer: false,
          include_raw_content: true,
        }),
        cache: "no-store",
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new WebSearchProviderError("WEB_SEARCH_UNAVAILABLE", 502, "全网搜索服务暂时不可用，请稍后重试。");
      }

      const payload: unknown = await response.json();
      const responseBody = isRecord(payload) ? payload as TavilyResponse : null;

      if (!responseBody || !Array.isArray(responseBody.results)) {
        throw new WebSearchProviderError("WEB_SEARCH_INVALID_RESPONSE", 502, "全网搜索服务未返回可用结果。");
      }

      const candidates = responseBody.results
        .map((result, index) => toTavilyCandidate(result, index + 1, this.config))
        .filter((candidate): candidate is WebSearchCandidate => candidate !== null)
        .filter((candidate, index, all) => all.findIndex((other) => other.canonicalUrl === candidate.canonicalUrl) === index);

      return {
        provider: this.id,
        query: request.query,
        candidates,
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
        isTimeout ? "全网搜索服务响应超时，请稍后重试。" : "全网搜索服务暂时不可用，请稍后重试。",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createConfiguredWebSearchProvider() {
  const config = getWebSearchConfig();

  if (!config) {
    throw new WebSearchProviderError("WEB_SEARCH_NOT_CONFIGURED", 503, "尚未配置全网搜索 API。请设置 WEB_SEARCH_PROVIDER 和 WEB_SEARCH_API_KEY。");
  }

  if (config.provider === "tavily") {
    return new TavilyWebSearchProvider(config);
  }

  throw new WebSearchProviderError(
    "WEB_SEARCH_PROVIDER_UNSUPPORTED",
    503,
    `当前尚未实现 ${config.provider} 搜索适配器，请先使用 tavily。`,
  );
}
