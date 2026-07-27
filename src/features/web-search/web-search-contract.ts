export const WEB_SEARCH_PROVIDERS = ["tavily", "brave", "serper", "custom"] as const;

export type WebSearchProviderId = (typeof WEB_SEARCH_PROVIDERS)[number];

export type WebSearchRequest = {
  query: string;
  language: "zh-CN";
  maxResults: number;
  maxAgeHours: number;
};

export type WebSearchCandidate = {
  id: string;
  title: string;
  snippet: string | null;
  canonicalUrl: string;
  sourceName: string;
  sourceDomain: string;
  language: "zh-CN";
  publishedAt: string | null;
};

export type WebSearchResult = {
  provider: WebSearchProviderId;
  query: string;
  candidates: WebSearchCandidate[];
  fetchedAt: string;
};

export interface WebSearchProvider {
  readonly id: WebSearchProviderId;
  search(request: WebSearchRequest): Promise<WebSearchResult>;
}

export type WebSourcePolicy = {
  allowedDomainSuffixes: string[];
  excludedDomainSuffixes: string[];
  maxResults: number;
  maxAgeHours: number;
};

export type WebSearchConfig = {
  provider: WebSearchProviderId;
  apiKey: string;
  baseUrl: string | null;
  policy: WebSourcePolicy;
};

type Environment = Record<string, string | undefined>;

const DEFAULT_MAX_RESULTS = 12;
const DEFAULT_MAX_AGE_HOURS = 72;
const MAX_RESULTS = 20;
const MAX_AGE_HOURS = 24 * 14;
const TRACKING_QUERY_PARAMETER = /^(?:utm_[^=]+|spm|from|source|ref)$/i;

export class WebSearchConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebSearchConfigurationError";
  }
}

function getPositiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function parseDomainSuffixes(value: string | undefined) {
  return [...new Set(
    (value ?? "")
      .split(",")
      .map((domain) => domain.trim().toLowerCase().replace(/^\.+/, ""))
      .filter((domain) => /^[a-z0-9.-]+$/i.test(domain)),
  )];
}

function matchesDomainSuffix(domain: string, suffix: string) {
  return domain === suffix || domain.endsWith(`.${suffix}`);
}

export function createWebSourcePolicy(environment: Environment = process.env): WebSourcePolicy {
  return {
    allowedDomainSuffixes: parseDomainSuffixes(environment.WEB_SEARCH_ALLOWED_DOMAINS),
    excludedDomainSuffixes: parseDomainSuffixes(environment.WEB_SEARCH_EXCLUDED_DOMAINS),
    maxResults: getPositiveInteger(environment.WEB_SEARCH_MAX_RESULTS, DEFAULT_MAX_RESULTS, MAX_RESULTS),
    maxAgeHours: getPositiveInteger(environment.WEB_SEARCH_MAX_AGE_HOURS, DEFAULT_MAX_AGE_HOURS, MAX_AGE_HOURS),
  };
}

export function isAllowedWebSource(domain: string, policy: WebSourcePolicy) {
  const normalizedDomain = domain.trim().toLowerCase();

  if (!normalizedDomain || normalizedDomain === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalizedDomain)) {
    return false;
  }

  if (policy.excludedDomainSuffixes.some((suffix) => matchesDomainSuffix(normalizedDomain, suffix))) {
    return false;
  }

  return policy.allowedDomainSuffixes.length === 0
    || policy.allowedDomainSuffixes.some((suffix) => matchesDomainSuffix(normalizedDomain, suffix));
}

function normalizeCanonicalUrl(value: string) {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    url.username = "";
    url.password = "";
    url.hash = "";

    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_QUERY_PARAMETER.test(key)) {
        url.searchParams.delete(key);
      }
    }

    return url;
  } catch {
    return null;
  }
}

function normalizePublishedAt(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function normalizeWebSearchCandidate(
  candidate: Omit<WebSearchCandidate, "canonicalUrl" | "sourceDomain" | "language" | "publishedAt"> & {
    canonicalUrl: string;
    publishedAt?: string | null;
  },
  policy: WebSourcePolicy,
): WebSearchCandidate | null {
  const title = candidate.title.trim().replace(/\s+/g, " ");
  const url = normalizeCanonicalUrl(candidate.canonicalUrl);

  if (!title || !url || !isAllowedWebSource(url.hostname, policy)) {
    return null;
  }

  return {
    id: candidate.id.trim() || url.toString(),
    title,
    snippet: candidate.snippet?.trim().replace(/\s+/g, " ").slice(0, 1_500) || null,
    canonicalUrl: url.toString(),
    sourceName: candidate.sourceName.trim() || url.hostname,
    sourceDomain: url.hostname.toLowerCase(),
    language: "zh-CN",
    publishedAt: normalizePublishedAt(candidate.publishedAt),
  };
}

export function getWebSearchConfig(environment: Environment = process.env): WebSearchConfig | null {
  const configuredProvider = environment.WEB_SEARCH_PROVIDER?.trim().toLowerCase();

  if (!configuredProvider) {
    return null;
  }

  if (!WEB_SEARCH_PROVIDERS.includes(configuredProvider as WebSearchProviderId)) {
    throw new WebSearchConfigurationError("WEB_SEARCH_PROVIDER 不受支持。");
  }

  const apiKey = environment.WEB_SEARCH_API_KEY?.trim();
  if (!apiKey) {
    throw new WebSearchConfigurationError("已设置 WEB_SEARCH_PROVIDER，但缺少 WEB_SEARCH_API_KEY。");
  }

  const rawBaseUrl = environment.WEB_SEARCH_BASE_URL?.trim();
  if (rawBaseUrl) {
    try {
      const baseUrl = new URL(rawBaseUrl);
      if (baseUrl.protocol !== "https:") {
        throw new Error("Only HTTPS is allowed.");
      }
    } catch {
      throw new WebSearchConfigurationError("WEB_SEARCH_BASE_URL 必须是 HTTPS 地址。");
    }
  }

  return {
    provider: configuredProvider as WebSearchProviderId,
    apiKey,
    baseUrl: rawBaseUrl?.replace(/\/+$/, "") || null,
    policy: createWebSourcePolicy(environment),
  };
}
