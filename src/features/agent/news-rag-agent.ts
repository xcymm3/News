import { getProcessedLiveNews } from "@/features/news-source/processed-news-service";
import type { NewsClusterCandidate } from "@/features/news-source/article-processing";
import { validateGeneratedDigest } from "@/features/digest/live-digest-generator";
import type { DailyDigest, DigestCitation, DigestStory } from "@/features/digest/types";

const MAX_SEARCH_RESULTS = 12;
const FIXED_AGENT_EVENT_COUNT = 12;
const TARGET_RSS_SOURCE_COVERAGE = 4;
const MAX_DOCUMENTS_PER_EVENT = 3;
const MAX_RETRIEVED_EXCERPT_LENGTH = 450;
const MAX_AGENT_STORIES = FIXED_AGENT_EVENT_COUNT;
const DEFAULT_AGENT_CACHE_TTL_SECONDS = 30 * 60;
const AGENT_REQUEST_TIMEOUT_MS = 90_000;
// RSS 检索材料压缩后，旧摘要不再代表当前检索语料，需强制重新生成。
const AGENT_CACHE_SCHEMA_VERSION = 8;

export type RetrievedNewsDocument = {
  articleId: string;
  eventId: string;
  title: string;
  excerpt: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
};

export type RetrievedNewsEvent = {
  eventId: string;
  headline: string;
  articleCount: number;
  sourceCount: number;
  latestPublishedAt: string;
  documents: RetrievedNewsDocument[];
};

type DeepSeekToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type DeepSeekMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: DeepSeekToolCall[];
  tool_call_id?: string;
};

type CachedAgentDigest = {
  digest: DailyDigest;
  expiresAt: number;
};

type AgentSummaryResponse = {
  stories?: unknown;
};

type AgentCacheStore = {
  schemaVersion: number;
  cachedDigests: Map<string, CachedAgentDigest>;
  pendingRuns: Map<string, Promise<AgentRunResult>>;
};

type GlobalWithAgentCache = typeof globalThis & {
  __internationalBriefingAgentCache?: AgentCacheStore;
};

const agentCacheGlobal = globalThis as GlobalWithAgentCache;
const agentCacheStore = agentCacheGlobal.__internationalBriefingAgentCache?.schemaVersion === AGENT_CACHE_SCHEMA_VERSION
  ? agentCacheGlobal.__internationalBriefingAgentCache
  : {
      schemaVersion: AGENT_CACHE_SCHEMA_VERSION,
      cachedDigests: new Map<string, CachedAgentDigest>(),
      pendingRuns: new Map<string, Promise<AgentRunResult>>(),
    };

agentCacheGlobal.__internationalBriefingAgentCache = agentCacheStore;

const { cachedDigests, pendingRuns } = agentCacheStore;

export class NewsAgentError extends Error {
  constructor(
    readonly code:
      | "AI_AGENT_NOT_CONFIGURED"
      | "AI_AGENT_SEARCH_FAILED"
      | "AI_AGENT_TOOL_CALL_FAILED"
      | "AI_AGENT_INVALID_RESPONSE"
      | "AI_AGENT_UNAVAILABLE",
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "NewsAgentError";
  }
}

export type AgentRunResult = {
  digest: DailyDigest;
  provider: string;
  retrievedDocumentCount: number;
  cacheStatus: "hit" | "miss";
};

type DeepSeekConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function tokenize(value: string) {
  const chunks = value.toLocaleLowerCase("en-US").match(/[\u3400-\u9fff]+|[\p{L}\p{N}]+/gu) ?? [];

  return chunks.flatMap((chunk) => {
    if (/^[\u3400-\u9fff]+$/u.test(chunk)) {
      return Array.from({ length: Math.max(chunk.length - 1, 0) }, (_, index) => chunk.slice(index, index + 2));
    }

    return chunk.length > 1 ? [chunk] : [];
  });
}

function createStableId(value: string) {
  let hash = 2_166_136_261;

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }

  return `agent-story-${(hash >>> 0).toString(36)}`;
}

function cloneDigest(digest: DailyDigest): DailyDigest {
  return {
    ...digest,
    stories: digest.stories.map((story) => ({
      ...story,
      citations: story.citations.map((citation) => ({ ...citation })),
    })),
  };
}

function getAgentCacheTtlMs() {
  const configuredSeconds = Number(process.env.AGENT_DIGEST_TTL_SECONDS);
  const seconds = Number.isInteger(configuredSeconds) && configuredSeconds >= 60
    ? configuredSeconds
    : DEFAULT_AGENT_CACHE_TTL_SECONDS;

  return seconds * 1_000;
}

function getDeepSeekConfig(): DeepSeekConfig {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim() || process.env.LLM_API_KEY?.trim();

  if (!apiKey) {
    throw new NewsAgentError(
      "AI_AGENT_NOT_CONFIGURED",
      503,
      "尚未配置 DeepSeek API 密钥，请先在 .env.local 中填写 DEEPSEEK_API_KEY。",
    );
  }

  const baseUrl = (process.env.LLM_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
  const model = process.env.DEEPSEEK_MODEL?.trim() || process.env.LLM_MODEL?.trim() || "deepseek-v4-flash";

  try {
    const endpoint = new URL(baseUrl);

    if (endpoint.protocol !== "https:") {
      throw new Error("The DeepSeek base URL must use HTTPS.");
    }
  } catch {
    throw new NewsAgentError("AI_AGENT_NOT_CONFIGURED", 503, "DeepSeek API 地址配置无效。");
  }

  return { apiKey, baseUrl, model };
}

function parseToolCalls(value: unknown): DeepSeekToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || !isRecord(candidate.function)) {
      return [];
    }

    const id = getString(candidate.id);
    const name = getString(candidate.function.name);
    const argumentsValue = getString(candidate.function.arguments);

    return id && name && argumentsValue
      ? [
          {
            id,
            type: "function",
            function: {
              name,
              arguments: argumentsValue,
            },
          },
        ]
      : [];
  });
}

async function callDeepSeek(
  config: DeepSeekConfig,
  body: Record<string, unknown>,
): Promise<{ content: string | null; toolCalls: DeepSeekToolCall[] }> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), AGENT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        ...body,
        thinking: { type: "disabled" },
      }),
      cache: "no-store",
      signal: abortController.signal,
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw new NewsAgentError("AI_AGENT_UNAVAILABLE", 502, "DeepSeek 服务暂时不可用，请稍后重试。");
    }

    let payload: unknown;

    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new NewsAgentError("AI_AGENT_INVALID_RESPONSE", 502, "DeepSeek 返回了无法识别的内容。");
    }

    const message = isRecord(payload) && Array.isArray(payload.choices) && isRecord(payload.choices[0]) && isRecord(payload.choices[0].message)
      ? payload.choices[0].message
      : null;

    if (!message) {
      throw new NewsAgentError("AI_AGENT_INVALID_RESPONSE", 502, "DeepSeek 未返回可用回答。");
    }

    return {
      content: typeof message.content === "string" ? message.content : null,
      toolCalls: parseToolCalls(message.tool_calls),
    };
  } catch (error) {
    if (error instanceof NewsAgentError) {
      throw error;
    }

    const message = error instanceof Error && error.name === "AbortError"
      ? "DeepSeek 响应超时，请稍后重试。"
      : "DeepSeek 服务暂时不可用，请稍后重试。";

    throw new NewsAgentError("AI_AGENT_UNAVAILABLE", 502, message);
  } finally {
    clearTimeout(timeout);
  }
}

function toRetrievedDocument(article: {
  externalId: string;
  title: string;
  excerpt: string | null;
  sourceName: string;
  canonicalUrl: string;
  publishedAt: string;
}, eventId: string): RetrievedNewsDocument {
  const originalExcerpt = article.excerpt?.replace(/\s+/g, " ").trim() || article.title;

  return {
    articleId: article.externalId,
    eventId,
    title: article.title,
    excerpt: originalExcerpt.slice(0, MAX_RETRIEVED_EXCERPT_LENGTH),
    sourceName: article.sourceName,
    sourceUrl: article.canonicalUrl,
    publishedAt: article.publishedAt,
  };
}

export function rankRetrievedArticles(
  articles: RetrievedNewsDocument[],
  query: string,
  maximumResults = MAX_SEARCH_RESULTS,
) {
  const queryTokens = new Set(tokenize(query));
  const resultLimit = clamp(Math.floor(maximumResults), 1, MAX_SEARCH_RESULTS);

  return [...articles]
    .map((article) => {
      const titleTokens = tokenize(article.title);
      const excerptTokens = tokenize(article.excerpt);
      const titleMatches = titleTokens.filter((token) => queryTokens.has(token)).length;
      const excerptMatches = excerptTokens.filter((token) => queryTokens.has(token)).length;

      return {
        article,
        score: titleMatches * 4 + excerptMatches,
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return new Date(right.article.publishedAt).getTime() - new Date(left.article.publishedAt).getTime();
    })
    .slice(0, resultLimit)
    .map(({ article }) => article);
}

function getQueryScore(article: RetrievedNewsDocument, queryTokens: Set<string>) {
  const titleMatches = tokenize(article.title).filter((token) => queryTokens.has(token)).length;
  const excerptMatches = tokenize(article.excerpt).filter((token) => queryTokens.has(token)).length;

  return titleMatches * 4 + excerptMatches;
}

function getEventScore(event: RetrievedNewsEvent, queryTokens: Set<string>) {
  const relevanceScore = event.documents.reduce((score, document) => score + getQueryScore(document, queryTokens), 0);
  const sourceSignal = Math.max(event.sourceCount - 1, 0) * 10_000;
  const reportSignal = Math.max(event.articleCount - 1, 0) * 1_000;
  const recencyHours = Math.max(0, 72 - (Date.now() - new Date(event.latestPublishedAt).getTime()) / 3_600_000);

  return sourceSignal + reportSignal + relevanceScore * 100 + recencyHours;
}

export function rankRetrievedEvents(
  clusters: NewsClusterCandidate[],
  query: string,
  maximumResults = MAX_SEARCH_RESULTS,
): RetrievedNewsEvent[] {
  const queryTokens = new Set(tokenize(query));
  const resultLimit = clamp(Math.floor(maximumResults), 1, MAX_SEARCH_RESULTS);

  const rankedEvents = clusters
    .map((cluster) => {
      const newestArticleBySource = new Map<string, NewsClusterCandidate["articles"][number]>();

      for (const article of [...cluster.articles].sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime())) {
        if (!newestArticleBySource.has(article.sourceName)) {
          newestArticleBySource.set(article.sourceName, article);
        }
      }

      const documents = [...newestArticleBySource.values()]
        .slice(0, MAX_DOCUMENTS_PER_EVENT)
        .map((article) => toRetrievedDocument(article, cluster.id));

      return {
        eventId: cluster.id,
        headline: cluster.headline,
        articleCount: cluster.articleCount,
        sourceCount: cluster.sourceCount,
        latestPublishedAt: cluster.latestPublishedAt,
        documents,
      };
    })
    .filter((event) => event.documents.length > 0)
    .sort((left, right) => {
      const scoreDifference = getEventScore(right, queryTokens) - getEventScore(left, queryTokens);

      return scoreDifference || new Date(right.latestPublishedAt).getTime() - new Date(left.latestPublishedAt).getTime();
    });

  return selectDiverseEvents(rankedEvents, resultLimit);
}

function getEventSourceNames(event: RetrievedNewsEvent) {
  return [...new Set(event.documents.map((document) => document.sourceName))];
}

function getPrimaryEventSource(event: RetrievedNewsEvent) {
  return event.documents[0]?.sourceName ?? "";
}

function selectDiverseEvents(rankedEvents: RetrievedNewsEvent[], resultLimit: number) {
  const selectedEvents: RetrievedNewsEvent[] = [];
  const selectedEventIds = new Set<string>();
  const representedSources = new Set<string>();
  const primarySourceCounts = new Map<string, number>();
  const availableSourceCount = new Set(rankedEvents.flatMap(getEventSourceNames)).size;
  const perSourceLimit = Math.max(1, Math.ceil(resultLimit / Math.max(availableSourceCount, 1)));

  const selectEvent = (event: RetrievedNewsEvent) => {
    if (selectedEventIds.has(event.eventId) || selectedEvents.length >= resultLimit) {
      return false;
    }

    selectedEvents.push(event);
    selectedEventIds.add(event.eventId);

    for (const sourceName of getEventSourceNames(event)) {
      representedSources.add(sourceName);
    }

    const primarySource = getPrimaryEventSource(event);

    if (primarySource) {
      primarySourceCounts.set(primarySource, (primarySourceCounts.get(primarySource) ?? 0) + 1);
    }

    return true;
  };

  // 第一轮先确保每个有候选事件的 RSS 都能进入 Agent 的视野。
  for (const event of rankedEvents) {
    if (getEventSourceNames(event).some((sourceName) => !representedSources.has(sourceName))) {
      selectEvent(event);
    }
  }

  // 第二轮限制同一主来源的占比，避免高频发布的站点淹没其他 RSS。
  for (const event of rankedEvents) {
    const primarySource = getPrimaryEventSource(event);

    if (!primarySource || (primarySourceCounts.get(primarySource) ?? 0) < perSourceLimit) {
      selectEvent(event);
    }
  }

  // 候选源不足时宁可放宽配额，也要尽量返回完整的固定检索窗口。
  for (const event of rankedEvents) {
    selectEvent(event);
  }

  return selectedEvents;
}

export async function searchCurrentNews(query: string, maximumResults = MAX_SEARCH_RESULTS) {
  const processedNews = await getProcessedLiveNews();
  const events = rankRetrievedEvents(processedNews.clusters, query, maximumResults);

  return {
    provider: processedNews.provider,
    events,
    documents: events.flatMap((event) => event.documents),
  };
}

function parseSearchArguments(serializedArguments: string) {
  try {
    const parsed: unknown = JSON.parse(serializedArguments);

    if (!isRecord(parsed)) {
      throw new Error("Invalid search arguments.");
    }

    const query = getString(parsed.query);
    if (!query) {
      throw new Error("Search query is empty.");
    }

    return { query };
  } catch {
    throw new NewsAgentError("AI_AGENT_TOOL_CALL_FAILED", 502, "AI Agent 给出的检索参数无效。");
  }
}

function parseJsonObject(value: string | null): AgentSummaryResponse {
  if (!value) {
    throw new NewsAgentError("AI_AGENT_INVALID_RESPONSE", 502, "AI Agent 未返回日报 JSON。");
  }

  const normalizedValue = value.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();

  try {
    const parsed: unknown = JSON.parse(normalizedValue);

    if (!isRecord(parsed)) {
      throw new Error("Agent response is not an object.");
    }

    return parsed as AgentSummaryResponse;
  } catch {
    throw new NewsAgentError("AI_AGENT_INVALID_RESPONSE", 502, "AI Agent 未返回符合要求的日报 JSON。");
  }
}

function getCitationArticleIds(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(getString).filter(Boolean);
  }

  if (!isRecord(value) || !Array.isArray(value.citations)) {
    return [];
  }

  return value.citations.flatMap((citation) => (isRecord(citation) ? [getString(citation.articleId)] : [])).filter(Boolean);
}

function createCitation(storyId: string, citationOrder: number, document: RetrievedNewsDocument): DigestCitation {
  return {
    id: `${storyId}-citation-${citationOrder}`,
    sourceName: document.sourceName,
    sourceUrl: document.sourceUrl,
    publishedAt: document.publishedAt,
    supportingExcerpt: `RSS 来源：${document.sourceName}；原标题：${document.title}`,
  };
}

function getLatestPublishedAt(documents: RetrievedNewsDocument[]) {
  return documents.reduce(
    (latest, document) => (new Date(document.publishedAt).getTime() > new Date(latest).getTime() ? document.publishedAt : latest),
    documents[0]!.publishedAt,
  );
}

function createFallbackStory(storyPosition: number, documents: RetrievedNewsDocument[]): DigestStory {
  const leadDocument = documents[0]!;
  const storyId = createStableId(`fallback|${documents.map((document) => document.articleId).join("|")}`);
  const sourceCount = new Set(documents.map((document) => document.sourceName)).size;
  const sourceContext = sourceCount > 1 ? `本条综合 ${sourceCount} 家 RSS 的报道。` : "本条来自当前 RSS 检索结果。";

  return {
    id: storyId,
    position: storyPosition,
    headline: leadDocument.title,
    summary: leadDocument.excerpt,
    whyItMatters: `${sourceContext}可通过原文链接核验详情。`,
    importanceScore: clamp(100 - storyPosition * 4 + Math.min(Math.max(sourceCount - 1, 0), 4) * 5, 1, 100),
    updatedAt: getLatestPublishedAt(documents),
    citations: documents.map((document, index) => createCitation(storyId, index + 1, document)),
  };
}

export function buildAgentDigestFromOutput({
  digestDate,
  generatedAt,
  output,
  retrievedDocuments,
  targetStoryCount,
}: {
  digestDate: string;
  generatedAt: Date;
  output: AgentSummaryResponse;
  retrievedDocuments: RetrievedNewsDocument[];
  targetStoryCount?: number;
}): DailyDigest {
  const documentsById = new Map(retrievedDocuments.map((document) => [document.articleId, document]));
  const documentsByEventId = new Map<string, RetrievedNewsDocument[]>();

  for (const document of retrievedDocuments) {
    const eventDocuments = documentsByEventId.get(document.eventId) ?? [];
    eventDocuments.push(document);
    documentsByEventId.set(document.eventId, eventDocuments);
  }

  const rawStories = Array.isArray(output.stories) ? output.stories : [];
  const stories: DigestStory[] = [];
  const usedStoryIds = new Set<string>();
  const usedEventIds = new Set<string>();
  const requestedStoryCount = targetStoryCount === undefined ? 0 : clamp(Math.floor(targetStoryCount), 1, MAX_AGENT_STORIES);

  for (const rawStory of rawStories) {
    if (!isRecord(rawStory) || stories.length >= MAX_AGENT_STORIES) {
      continue;
    }

    const headline = getString(rawStory.headline).slice(0, 180);
    const summary = getString(rawStory.summary).slice(0, 900);
    const whyItMatters = getString(rawStory.whyItMatters).slice(0, 600);
    const citationIds = [...new Set(getCitationArticleIds(rawStory.citationArticleIds ?? rawStory))];
    const selectedDocuments = citationIds.flatMap((citationId) => {
      const document = documentsById.get(citationId);

      return document ? [document] : [];
    });

    const citedEventIds = new Set(selectedDocuments.map((document) => document.eventId));

    if (citedEventIds.size === 0) {
      continue;
    }

    // 模型可把不同标题、但明确属于同一事实发展的事件语义归并。
    // 对每个被引用的事件仍自动带回其全部 RSS 报道，确保出处完整。
    const citedDocuments = [...new Map(
      [...citedEventIds].flatMap((eventId) => documentsByEventId.get(eventId) ?? []).map((document) => [document.articleId, document]),
    ).values()];

    if (!headline || !summary || !whyItMatters || citedDocuments.length === 0) {
      continue;
    }

    const storyId = createStableId(`${headline}|${citedDocuments.map((document) => document.articleId).join("|")}`);

    if (usedStoryIds.has(storyId)) {
      continue;
    }

    const requestedScore = typeof rawStory.importanceScore === "number" ? rawStory.importanceScore : 100 - stories.length * 5;
    const sourceCount = new Set(citedDocuments.map((document) => document.sourceName)).size;
    const sourceWeightBonus = Math.min(Math.max(sourceCount - 1, 0), 4) * 5;
    const weightedImportanceScore = clamp(Math.round(requestedScore) + sourceWeightBonus, 1, 100);
    const sourceContext = sourceCount > 1 ? `本条综合 ${sourceCount} 家 RSS 的报道。${whyItMatters}` : whyItMatters;

    stories.push({
      id: storyId,
      position: stories.length + 1,
      headline,
      summary,
      whyItMatters: sourceContext,
      importanceScore: weightedImportanceScore,
      updatedAt: getLatestPublishedAt(citedDocuments),
      citations: citedDocuments.map((document, index) => createCitation(storyId, index + 1, document)),
    });
    usedStoryIds.add(storyId);

    for (const eventId of citedEventIds) {
      usedEventIds.add(eventId);
    }
  }

  // 即便模型遗漏部分条目，首页仍保持固定数量，并且只补入真实检索到的原始材料。
  // 正常情况下这里不会触发；它只防止模型的格式偏差让首页缩水。
  if (requestedStoryCount > 0) {
    for (const [eventId, eventDocuments] of documentsByEventId) {
      if (stories.length >= requestedStoryCount) {
        break;
      }

      if (usedEventIds.has(eventId) || eventDocuments.length === 0) {
        continue;
      }

      const fallbackStory = createFallbackStory(stories.length + 1, eventDocuments);

      if (usedStoryIds.has(fallbackStory.id)) {
        continue;
      }

      stories.push(fallbackStory);
      usedStoryIds.add(fallbackStory.id);
      usedEventIds.add(eventId);
    }
  }

  stories.sort((left, right) => right.importanceScore - left.importanceScore || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  stories.forEach((story, index) => {
    story.position = index + 1;
  });

  const digest: DailyDigest = {
    id: `agent-digest-${digestDate}-r1`,
    digestDate,
    revision: 1,
    publishedAt: generatedAt.toISOString(),
    isDemoData: false,
    generationMode: "agent",
    notice: "当前日报由 AI Agent 基于联网检索到的材料整理。引用链接由系统从检索结果中绑定，尚未进行独立事实核验。",
    stories,
  };

  try {
    validateGeneratedDigest(digest);
  } catch (error) {
    throw new NewsAgentError(
      "AI_AGENT_INVALID_RESPONSE",
      502,
      error instanceof Error ? `AI Agent 输出未通过引用校验：${error.message}` : "AI Agent 输出未通过引用校验。",
    );
  }

  return digest;
}

const searchTool = {
  type: "function",
  function: {
    name: "search_current_news",
    description: "Search clustered current Chinese RSS reports. Events reported by multiple RSS sources are higher-confidence candidates and include all source links.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "A concise Chinese news query that matches the current RSS headlines.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

async function runUncachedAgentDigest(digestDate: string): Promise<AgentRunResult> {
  const config = getDeepSeekConfig();
  const initialMessages: DeepSeekMessage[] = [
    {
      role: "system",
      content:
        "You are a cautious Chinese-news research agent. You must call search_current_news exactly once before writing a daily briefing. Search only for current, high-impact developments covered by the RSS feeds. Use a concise Chinese query. Never invent facts, dates, sources, or citations.",
    },
    {
      role: "user",
      content: "Research the most important current developments and prepare a concise Chinese daily briefing.",
    },
  ];
  const planningResponse = await callDeepSeek(config, {
    messages: initialMessages,
    tools: [searchTool],
  });
  const searchCall = planningResponse.toolCalls.find((toolCall) => toolCall.function.name === "search_current_news");

  if (!searchCall) {
    throw new NewsAgentError("AI_AGENT_TOOL_CALL_FAILED", 502, "AI Agent 未调用联网检索工具，请稍后重试。");
  }

  const searchArguments = parseSearchArguments(searchCall.function.arguments);
  let searchResult: Awaited<ReturnType<typeof searchCurrentNews>>;

  try {
    searchResult = await searchCurrentNews(searchArguments.query, FIXED_AGENT_EVENT_COUNT);
  } catch {
    throw new NewsAgentError("AI_AGENT_SEARCH_FAILED", 502, "联网新闻检索暂时不可用，请稍后重试。");
  }

  if (searchResult.documents.length === 0) {
    throw new NewsAgentError("AI_AGENT_SEARCH_FAILED", 502, "联网检索没有返回可用于生成日报的新闻材料。");
  }

  const finalMessages: DeepSeekMessage[] = [
    ...initialMessages,
    {
      role: "assistant",
      content: planningResponse.content,
      tool_calls: [searchCall],
    },
    {
      role: "tool",
      tool_call_id: searchCall.id,
      content: JSON.stringify({ provider: searchResult.provider, events: searchResult.events }),
    },
    {
      role: "user",
      content:
        `Using only the retrieved clustered events, return JSON with exactly ${FIXED_AGENT_EVENT_COUNT} distinct stories. Across all stories, cover at least ${Math.min(TARGET_RSS_SOURCE_COVERAGE, new Set(searchResult.documents.map((document) => document.sourceName)).size)} different RSS sourceName values. Each story must have headline, summary, whyItMatters, importanceScore (1-100), and citationArticleIds (an array of returned document articleId values). Write each summary as a self-contained Chinese briefing of about 400 to 550 Chinese characters when the retrieved material supports that detail; do not invent facts just to reach a length. Prioritize events with more RSS sources. If documents from different eventIds clearly describe the same factual development, semantically merge them into one story and cite every supporting document; never merge merely related but distinct developments. If you merge events, select another distinct retrieved event so the final stories array still contains exactly ${FIXED_AGENT_EVENT_COUNT} items. For a multi-source event, list every returned articleId in that event. Write headline, summary, and whyItMatters in Chinese. Do not include any citationArticleIds that were not returned by the tool.`,
    },
  ];
  const summaryResponse = await callDeepSeek(config, {
    messages: finalMessages,
    response_format: { type: "json_object" },
  });
  const digest = buildAgentDigestFromOutput({
    digestDate,
    generatedAt: new Date(),
    output: parseJsonObject(summaryResponse.content),
    retrievedDocuments: searchResult.documents,
    targetStoryCount: FIXED_AGENT_EVENT_COUNT,
  });

  cachedDigests.set(digestDate, {
    digest: cloneDigest(digest),
    expiresAt: Date.now() + getAgentCacheTtlMs(),
  });

  return {
    digest,
    provider: searchResult.provider,
    retrievedDocumentCount: searchResult.documents.length,
    cacheStatus: "miss",
  };
}

export function getCachedAgentDigest(digestDate: string): DailyDigest | null {
  const cached = cachedDigests.get(digestDate);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    cachedDigests.delete(digestDate);
    return null;
  }

  return cloneDigest(cached.digest);
}

export async function runAgentDigest(digestDate: string): Promise<AgentRunResult> {
  const cachedDigest = getCachedAgentDigest(digestDate);

  if (cachedDigest) {
    return {
      digest: cachedDigest,
      provider: "cached-agent-run",
      retrievedDocumentCount: cachedDigest.stories.reduce((count, story) => count + story.citations.length, 0),
      cacheStatus: "hit",
    };
  }

  const pendingRun = pendingRuns.get(digestDate);

  if (pendingRun) {
    return pendingRun;
  }

  const run = runUncachedAgentDigest(digestDate).finally(() => {
    pendingRuns.delete(digestDate);
  });

  pendingRuns.set(digestDate, run);

  return run;
}
