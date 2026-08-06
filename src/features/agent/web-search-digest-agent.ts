import { createHash } from "node:crypto";

import { ChatOpenAI } from "@langchain/openai";

import { evaluateAgentRunQuality } from "@/features/digest/agent-run-quality-evaluation";
import { validateGeneratedDigest } from "@/features/digest/live-digest-generator";
import {
  AgentRunTrackingError,
  publishDigest,
  recordAgentRunEventDecisions,
  recordAgentRunQualityEvaluation,
  type AgentRunEventDecisionInput,
  startAgentRunTracker,
  type AgentRunStageKey,
  type AgentRunTracker,
} from "@/features/digest/prisma-digest-repository";
import type { DailyDigest, DigestCitation, DigestStory } from "@/features/digest/types";
import {
  getWebSearchConfig,
  normalizeWebSearchCandidate,
  WebSearchConfigurationError,
  type WebSearchCandidate,
  type WebSourcePolicy,
} from "@/features/web-search/web-search-contract";
import {
  clusterWebSearchCandidates,
  selectDistinctDomainCandidates,
  type WebEventCluster,
} from "@/features/web-search/event-clustering";
import { WebSearchProviderError } from "@/features/web-search/web-search-provider";
import { createWebResearchTools } from "@/features/web-search/web-research-tools";
import { getLatestChineseRssNews, type RawNewsArticle } from "@/features/news-source/live-news-source";

const MAX_WEB_AGENT_STORIES = 12;
const MAX_MODEL_CANDIDATES = 20;
const MAX_DOCUMENT_CONTEXT_CHARACTERS = 3_000;
const MAX_RESULTS_PER_TOPIC = 20;
const MINIMUM_SOURCE_DOMAINS_PER_EVENT = 2;
const MAX_SOURCES_PER_EVENT = 5;
const LLM_REQUEST_TIMEOUT_MS = 90_000;
const SYNTHESIS_MAX_TOKENS = 4_096;
const MAX_SEARCH_RETRIES = 1;
const MAX_FETCH_RETRIES = 1;
const MAX_MODEL_RETRIES = 1;

const INTERNATIONAL_RESEARCH_TOPICS = [
  "国际外交 峰会 双边关系 重大新闻",
  "俄乌 中东 冲突 安全 军事 国际新闻",
  "全球贸易 关税 制裁 国际经济 金融",
  "联合国 多边合作 国际组织 气候 能源",
  "芯片 人工智能 科技监管 地缘政治 国际",
  "美国 欧洲 俄罗斯 乌克兰 外交 安全 国际局势",
  "中东 巴以 伊朗 海湾 红海 航运 国际新闻",
  "东亚 台海 朝鲜半岛 东盟 外交 国际关系",
  "全球市场 货币 利率 供应链 国际经济",
  "国际能源 气候 矿产 航运 重大进展",
] as const;

type WebDigestStoryOutput = {
  headline?: unknown;
  summary?: unknown;
  whyItMatters?: unknown;
  importanceScore?: unknown;
  sourceUrls?: unknown;
};

type WebDigestOutput = {
  stories?: unknown;
};

export type RetrievedWebSource = {
  canonicalUrl: string;
  sourceName: string;
  sourceDomain: string;
  title: string;
  publishedAt: string;
  supportingExcerpt: string;
};

export type RetrievedEventCluster = {
  cluster: WebEventCluster;
  sources: RetrievedWebSource[];
  selectionScore: number;
  selectionDetails: Record<string, number>;
};

type RetriedResult<T> = {
  value: T | null;
  retryCount: number;
  failureReasons: string[];
};

type ModelUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

type SynthesisResult = {
  output: WebDigestOutput;
  usage: ModelUsage;
  retryCount: number;
  rejectedClusters: RetrievedEventCluster[];
  validClusters: RetrievedEventCluster[];
  failureReasons: string[];
};

type RssSearchResult = {
  candidates: WebSearchCandidate[];
  articleCount: number;
  candidateCount: number;
  availableSourceCount: number;
  sourceCounts: Record<RssSourceMetricKey, number>;
};

type RssSourceMetricKey =
  | "rssChinanewsCount"
  | "rss36KrCount"
  | "rssCnaInternationalCount"
  | "rssIthomeCount"
  | "rssHuxiuCount";

export type WebSearchDigestRunResult = {
  digest: DailyDigest;
  model: string;
  searchProvider: string;
  retrievedDocumentCount: number;
};

export type PublishedWebSearchDigestResult = WebSearchDigestRunResult & {
  digest: DailyDigest;
};

export class WebSearchDigestAgentError extends Error {
  constructor(
    readonly code: "WEB_RESEARCH_NOT_CONFIGURED" | "WEB_RESEARCH_MODEL_NOT_CONFIGURED" | "WEB_RESEARCH_INVALID_RESPONSE" | "WEB_RESEARCH_UNAVAILABLE",
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WebSearchDigestAgentError";
  }
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function getNonNegativeNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function getSafeFailureReason(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : "";
  return (message || fallback).replace(/https?:\/\/\S+/g, "[链接已隐藏]").slice(0, 180);
}

function summarizeFailureReasons(reasons: string[]) {
  const uniqueReasons = [...new Set(reasons.filter(Boolean))].slice(0, 3);
  return uniqueReasons.length > 0 ? uniqueReasons.join("；") : null;
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function runWithRetry<T>(task: () => Promise<T>, maximumRetries: number, fallbackReason: string): Promise<RetriedResult<T>> {
  const failureReasons: string[] = [];

  for (let attempt = 0; attempt <= maximumRetries; attempt += 1) {
    try {
      return {
        value: await task(),
        retryCount: attempt,
        failureReasons,
      };
    } catch (error) {
      failureReasons.push(getSafeFailureReason(error, fallbackReason));

      if (attempt < maximumRetries) {
        await sleep(300 * (attempt + 1));
      }
    }
  }

  return {
    value: null,
    retryCount: maximumRetries,
    failureReasons,
  };
}

function getUsageValue(value: unknown, keys: string[]) {
  if (!isRecord(value)) {
    return 0;
  }

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) {
      return Math.round(candidate);
    }
  }

  return 0;
}

function getModelUsage(message: unknown): ModelUsage {
  const envelope = isRecord(message) ? message : {};
  const usageMetadata = isRecord(envelope.usage_metadata) ? envelope.usage_metadata : {};
  const responseMetadata = isRecord(envelope.response_metadata) ? envelope.response_metadata : {};
  const tokenUsage = isRecord(responseMetadata.tokenUsage) ? responseMetadata.tokenUsage : {};
  const promptTokens = getUsageValue(usageMetadata, ["input_tokens", "prompt_tokens"])
    || getUsageValue(tokenUsage, ["prompt_tokens", "input_tokens"]);
  const completionTokens = getUsageValue(usageMetadata, ["output_tokens", "completion_tokens"])
    || getUsageValue(tokenUsage, ["completion_tokens", "output_tokens"]);
  const totalTokens = getUsageValue(usageMetadata, ["total_tokens"])
    || getUsageValue(tokenUsage, ["total_tokens"])
    || promptTokens + completionTokens;

  return { promptTokens, completionTokens, totalTokens };
}

function sumModelUsage(usages: ModelUsage[]): ModelUsage {
  return usages.reduce<ModelUsage>((total, usage) => ({
    promptTokens: total.promptTokens + usage.promptTokens,
    completionTokens: total.completionTokens + usage.completionTokens,
    totalTokens: total.totalTokens + usage.totalTokens,
  }), { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
}

function estimateModelCostCny(usage: ModelUsage) {
  const inputPrice = getNonNegativeNumber(process.env.AGENT_INPUT_TOKEN_COST_CNY_PER_MILLION);
  const outputPrice = getNonNegativeNumber(process.env.AGENT_OUTPUT_TOKEN_COST_CNY_PER_MILLION);

  if (inputPrice === null || outputPrice === null) {
    return null;
  }

  return Math.round((usage.promptTokens * inputPrice + usage.completionTokens * outputPrice) / 1_000_000 * 1_000_000) / 1_000_000;
}

function stableId(prefix: string, value: string) {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function getDeepSeekDigestModel() {
  const baseUrl = "https://api.deepseek.com";
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";

  if (!apiKey) {
    throw new WebSearchDigestAgentError(
      "WEB_RESEARCH_MODEL_NOT_CONFIGURED",
      503,
      "尚未配置 DeepSeek 日报整理服务。",
    );
  }

  return {
    model,
    client: new ChatOpenAI({
      apiKey,
      model,
      temperature: 0.2,
      maxTokens: SYNTHESIS_MAX_TOKENS,
      timeout: LLM_REQUEST_TIMEOUT_MS,
      maxRetries: 0,
      modelKwargs: {
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
      },
      configuration: { baseURL: baseUrl },
    }),
  };
}

function getMessageText(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    return "";
  }

  return value.flatMap((part) => {
    if (!isRecord(part) || typeof part.text !== "string") {
      return [];
    }

    return [part.text];
  }).join("\n");
}

function parseObject(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractStoriesObject(value: string) {
  const match = /\{\s*"stories"\s*:/.exec(value);
  if (!match || match.index === undefined) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = match.index; index < value.length; index += 1) {
    const character = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(match.index, index + 1);
      }
    }
  }

  return null;
}

export function parseWebSearchDigestOutput(value: string): WebDigestOutput {
  const normalizedValue = value.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  const directlyParsed = parseObject(normalizedValue);
  if (directlyParsed) {
    return directlyParsed as WebDigestOutput;
  }

  const stringWrappedValue = (() => {
    try {
      const parsed: unknown = JSON.parse(normalizedValue);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return null;
    }
  })();
  const candidates = [stringWrappedValue, normalizedValue].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const storiesObject = extractStoriesObject(candidate);
    if (!storiesObject) {
      continue;
    }

    const parsed = parseObject(storiesObject);
    if (parsed) {
      return parsed as WebDigestOutput;
    }
  }

  throw new WebSearchDigestAgentError("WEB_RESEARCH_INVALID_RESPONSE", 502, "全网研究 Agent 未返回可用的日报 JSON。");
}

function getSourceUrls(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.map(getString).filter(Boolean))] : [];
}

function toCitation(storyId: string, index: number, source: RetrievedWebSource): DigestCitation {
  return {
    id: `${storyId}-citation-${index}`,
    sourceName: source.sourceName,
    sourceUrl: source.canonicalUrl,
    publishedAt: source.publishedAt,
    supportingExcerpt: source.supportingExcerpt,
  };
}

export function buildWebSearchDigestFromOutput({
  digestDate,
  generatedAt,
  output,
  retrievedSources,
}: {
  digestDate: string;
  generatedAt: Date;
  output: WebDigestOutput;
  retrievedSources: RetrievedWebSource[];
}): DailyDigest {
  const sourcesByUrl = new Map(retrievedSources.map((source) => [source.canonicalUrl, source]));
  const rawStories = Array.isArray(output.stories) ? output.stories : [];
  const stories: DigestStory[] = [];
  const usedStoryIds = new Set<string>();

  for (const rawStory of rawStories) {
    if (!isRecord(rawStory) || stories.length >= MAX_WEB_AGENT_STORIES) {
      continue;
    }

    const story = rawStory as WebDigestStoryOutput;
    const headline = getString(story.headline).slice(0, 180);
    const summary = getString(story.summary).slice(0, 2_400);
    const whyItMatters = getString(story.whyItMatters).slice(0, 1_000);
    const sources = getSourceUrls(story.sourceUrls)
      .flatMap((url) => {
        const source = sourcesByUrl.get(url);
        return source ? [source] : [];
      })
      .filter((source, index, all) => all.findIndex((other) => other.canonicalUrl === source.canonicalUrl) === index);

    if (!headline || !summary || !whyItMatters || sources.length === 0) {
      continue;
    }

    const storyId = stableId("web-story", `${headline}|${sources.map((source) => source.canonicalUrl).join("|")}`);
    if (usedStoryIds.has(storyId)) {
      continue;
    }

    const requestedScore = typeof story.importanceScore === "number" ? story.importanceScore : 100 - stories.length * 5;
    const sourceBonus = Math.min(Math.max(sources.length - 1, 0), 4) * 5;
    const updatedAt = sources.reduce(
      (latest, source) => new Date(source.publishedAt).valueOf() > new Date(latest).valueOf() ? source.publishedAt : latest,
      sources[0]!.publishedAt,
    );

    stories.push({
      id: storyId,
      position: stories.length + 1,
      headline,
      summary,
      whyItMatters: sources.length > 1 ? `本条综合 ${sources.length} 个网页来源。${whyItMatters}` : whyItMatters,
      importanceScore: clamp(Math.round(requestedScore) + sourceBonus, 1, 100),
      updatedAt,
      citations: sources.map((source, index) => toCitation(storyId, index + 1, source)),
    });
    usedStoryIds.add(storyId);
  }

  const digest: DailyDigest = {
    id: `web-search-digest-${digestDate}-r1`,
    digestDate,
    revision: 1,
    publishedAt: generatedAt.toISOString(),
    isDemoData: false,
    generationMode: "agent",
    notice: "当前日报由 LangChain Agent 检索、阅读并综合近期中文网页材料。引用链接仅来自本轮 Agent 实际读取的网页，尚未进行独立事实核验。",
    stories,
  };

  try {
    validateGeneratedDigest(digest);
  } catch (error) {
    throw new WebSearchDigestAgentError(
      "WEB_RESEARCH_INVALID_RESPONSE",
      502,
      error instanceof Error ? `全网研究 Agent 输出未通过引用校验：${error.message}` : "全网研究 Agent 输出未通过引用校验。",
    );
  }

  return digest;
}

function parseToolContent(content: unknown) {
  const text = getMessageText(content);

  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getMessageName(message: unknown) {
  return isRecord(message) ? getString(message.name) : "";
}

function getMessageContent(message: unknown) {
  return isRecord(message) ? message.content : null;
}

export function collectRetrievedWebSources(messages: unknown[]): RetrievedWebSource[] {
  const searchedCandidates = new Map<string, WebSearchCandidate>();
  const retrievedSources = new Map<string, RetrievedWebSource>();

  for (const message of messages) {
    const name = getMessageName(message);
    const content = parseToolContent(getMessageContent(message));

    if (!content) {
      continue;
    }

    if (name === "search_web" && Array.isArray(content.candidates)) {
      for (const candidate of content.candidates) {
        if (!isRecord(candidate)) {
          continue;
        }

        const url = getString(candidate.canonicalUrl);
        const title = getString(candidate.title);
        if (url && title) {
          searchedCandidates.set(url, candidate as WebSearchCandidate);
        }
      }
    }

    if (name === "fetch_article") {
      const url = getString(content.canonicalUrl);
      const text = getString(content.text);
      const candidate = searchedCandidates.get(url);

      if (!candidate || !text) {
        continue;
      }

      retrievedSources.set(url, {
        canonicalUrl: candidate.canonicalUrl,
        sourceName: candidate.sourceName,
        sourceDomain: candidate.sourceDomain,
        title: candidate.title,
        publishedAt: candidate.publishedAt ?? (getString(content.fetchedAt) || new Date().toISOString()),
        supportingExcerpt: text.slice(0, MAX_DOCUMENT_CONTEXT_CHARACTERS),
      });
    }
  }

  return [...retrievedSources.values()];
}

export function createDigestPrompt(digestDate: string, cluster: RetrievedEventCluster) {
  return [
    `The authoritative application date is ${digestDate}; treat it as the present date for this task.`,
    "The supplied webpages are independent reports of one event from different domains.",
    `The provisional event title is: ${cluster.cluster.headline}.`,
    "Return exactly one story in a JSON object with a stories array.",
    "Return valid JSON only. Begin directly with { and never output analysis, explanations, Markdown fences, or <think> content.",
    "Each story must include headline, summary, whyItMatters, importanceScore (1-100), and sourceUrls (an array of fetched source URLs).",
    "Use this exact JSON shape: {\"stories\":[{\"headline\":\"简短中文标题\",\"summary\":\"中文摘要，可使用 \\n 表示分段\",\"whyItMatters\":\"简短中文影响说明\",\"importanceScore\":80,\"sourceUrls\":[\"https://example.com/source\"]}]}. Replace every example value with evidence from the supplied sources.",
    "Write Chinese. The summary should be roughly 1,600-2,000 Chinese characters when the evidence supports that detail, with 3-5 short Markdown paragraphs. Use ### short section headings, - lists, and **bold** for key facts when helpful. Every ### heading must occupy its own line, followed by a blank line; every list item must also occupy its own line. Keep whyItMatters to 100-180 Chinese characters.",
    "Synthesize only facts confirmed across the supplied sources. If details differ, state the uncertainty briefly. Cite every supplied source URL exactly as given; do not invent or alter URLs.",
  ].join(" ");
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>) {
  const results: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index]!);
    }
  });

  await Promise.all(workers);
  return results;
}

const RSS_SOURCE_METRICS: ReadonlyArray<{ name: string; key: RssSourceMetricKey }> = [
  { name: "中国新闻网", key: "rssChinanewsCount" },
  { name: "36氪", key: "rss36KrCount" },
  { name: "中央社国际", key: "rssCnaInternationalCount" },
  { name: "IT之家", key: "rssIthomeCount" },
  { name: "虎嗅", key: "rssHuxiuCount" },
];

function createEmptyRssSourceCounts(): Record<RssSourceMetricKey, number> {
  return {
    rssChinanewsCount: 0,
    rss36KrCount: 0,
    rssCnaInternationalCount: 0,
    rssIthomeCount: 0,
    rssHuxiuCount: 0,
  };
}

export function toRssWebSearchCandidate(article: RawNewsArticle, policy: WebSourcePolicy) {
  return normalizeWebSearchCandidate({
    id: article.externalId,
    title: article.title,
    snippet: article.excerpt,
    canonicalUrl: article.canonicalUrl,
    sourceName: article.sourceName,
    publishedAt: article.publishedAt,
  }, policy);
}

async function retrieveRssSearchCandidates(policy: WebSourcePolicy): Promise<RssSearchResult> {
  const sourceCounts = createEmptyRssSourceCounts();

  try {
    const rss = await getLatestChineseRssNews();
    const sourceMetricByName = new Map(RSS_SOURCE_METRICS.map((source) => [source.name, source.key]));

    for (const article of rss.articles) {
      const metricKey = sourceMetricByName.get(article.sourceName);
      if (metricKey) {
        sourceCounts[metricKey] += 1;
      }
    }

    const candidates = rss.articles.flatMap((article) => {
      const candidate = toRssWebSearchCandidate(article, policy);
      return candidate ? [candidate] : [];
    });

    return {
      candidates,
      articleCount: rss.articles.length,
      candidateCount: candidates.length,
      availableSourceCount: rss.sourceNames.length,
      sourceCounts,
    };
  } catch (error) {
    console.warn("Chinese RSS ingestion failed and was skipped.", error);

    return {
      candidates: [],
      articleCount: 0,
      candidateCount: 0,
      availableSourceCount: 0,
      sourceCounts,
    };
  }
}

function getTimestamp(value: string | null) {
  const timestamp = value ? new Date(value).valueOf() : Number.NaN;
  return Number.isNaN(timestamp) ? null : timestamp;
}

function getClusterSelectionDetails(cluster: WebEventCluster, referenceTime = Date.now()) {
  const publishedAt = getTimestamp(cluster.latestPublishedAt);
  const ageHours = publishedAt === null ? 999 : Math.max(referenceTime - publishedAt, 0) / 3_600_000;
  const freshnessScore = Math.round(clamp(45 * (1 - ageHours / 72), 0, 45));
  const sourceScore = Math.round(clamp(cluster.sourceDomainCount / MAX_SOURCES_PER_EVENT, 0, 1) * 35);
  const corroborationScore = Math.round(clamp(cluster.candidates.length / MAX_SOURCES_PER_EVENT, 0, 1) * 20);

  return {
    freshnessScore,
    sourceScore,
    corroborationScore,
    ageHours: Math.round(ageHours * 10) / 10,
  };
}

export function getClusterSelectionScore(cluster: WebEventCluster, referenceTime = Date.now()) {
  const details = getClusterSelectionDetails(cluster, referenceTime);
  return {
    score: details.freshnessScore + details.sourceScore + details.corroborationScore,
    details,
  };
}

function toEventDecision(cluster: WebEventCluster, options: {
  phase: AgentRunEventDecisionInput["phase"];
  decision: AgentRunEventDecisionInput["decision"];
  reason: string;
  readableSourceCount?: number;
  score?: number;
  scoreDetails?: Record<string, number>;
}): AgentRunEventDecisionInput {
  const selection = options.score === undefined || !options.scoreDetails ? getClusterSelectionScore(cluster) : null;

  return {
    phase: options.phase,
    candidateId: cluster.id,
    headline: cluster.headline,
    decision: options.decision,
    reason: options.reason,
    score: options.score ?? selection?.score,
    sourceDomainCount: cluster.sourceDomainCount,
    candidateCount: cluster.candidates.length,
    readableSourceCount: options.readableSourceCount,
    latestPublishedAt: cluster.latestPublishedAt,
    scoreDetails: options.scoreDetails ?? selection?.details,
  };
}

async function recordTrackedEventDecisions(tracker: AgentRunTracker | null | undefined, decisions: AgentRunEventDecisionInput[]) {
  if (!tracker) {
    return;
  }

  await recordAgentRunEventDecisions({ agentRunId: tracker.agentRunId, decisions });
}

async function runObservedStage<T>(
  tracker: AgentRunTracker | null | undefined,
  stage: AgentRunStageKey,
  inputCount: number,
  task: () => Promise<T>,
  getCompletion: (result: T) => { outputCount: number; details?: Record<string, string | number | boolean | null> },
  details?: Record<string, string | number | boolean | null>,
) {
  await tracker?.startStage(stage, { inputCount, details });

  try {
    const result = await task();
    const completion = getCompletion(result);
    await tracker?.completeStage(stage, completion);
    return result;
  } catch (error) {
    await tracker?.failStage(stage, error);
    throw error;
  }
}

function getSearchCandidates(content: string) {
  const payload = parseToolContent(content);

  if (!Array.isArray(payload?.candidates)) {
    return [];
  }

  return payload.candidates.flatMap((candidate) => {
    if (!isRecord(candidate)) {
      return [];
    }

    const typedCandidate = candidate as WebSearchCandidate;
    return typedCandidate.canonicalUrl && typedCandidate.title && typedCandidate.sourceDomain ? [typedCandidate] : [];
  });
}

function toRetrievedSource(candidate: WebSearchCandidate, content: string): RetrievedWebSource | null {
  const payload = parseToolContent(content);
  const canonicalUrl = getString(payload?.canonicalUrl);
  const text = getString(payload?.text);

  if (!text || canonicalUrl !== candidate.canonicalUrl) {
    return null;
  }

  return {
    canonicalUrl: candidate.canonicalUrl,
    sourceName: candidate.sourceName,
    sourceDomain: candidate.sourceDomain,
    title: candidate.title,
    publishedAt: candidate.publishedAt ?? (getString(payload?.fetchedAt) || new Date().toISOString()),
    supportingExcerpt: text.slice(0, 600),
  };
}

async function retrieveEventClusters(
  digestDate: string,
  policy: WebSourcePolicy,
  tracker?: AgentRunTracker | null,
): Promise<RetrievedEventCluster[]> {
  const [searchWeb, fetchArticle] = createWebResearchTools({ policy });
  const searchResult = await runObservedStage(
    tracker,
    "SEARCH",
    INTERNATIONAL_RESEARCH_TOPICS.length + RSS_SOURCE_METRICS.length,
    async () => {
      const [rss, contents] = await Promise.all([
        retrieveRssSearchCandidates(policy),
        mapWithConcurrency(INTERNATIONAL_RESEARCH_TOPICS, 2, async (topic) => runWithRetry(
          () => searchWeb.invoke({
            query: `${digestDate} ${topic}`,
            maxResults: MAX_RESULTS_PER_TOPIC,
          }),
          MAX_SEARCH_RETRIES,
          "博查专题搜索失败。",
        )),
      ]);

      return { rss, contents };
    },
    ({ rss, contents }) => {
      const bochaCandidateCount = contents.flatMap((content) => content.value ? getSearchCandidates(content.value) : []).length;
      const searchFailureReasons = contents.flatMap((content) => content.failureReasons);

      return {
        outputCount: rss.candidateCount + bochaCandidateCount,
        details: {
          successfulTopicCount: contents.filter((content) => content.value !== null).length,
          skippedTopicCount: contents.filter((content) => content.value === null).length,
          searchRetryCount: contents.reduce((total, content) => total + content.retryCount, 0),
          searchFailureReason: summarizeFailureReasons(searchFailureReasons),
          rssConfiguredSourceCount: RSS_SOURCE_METRICS.length,
          rssAvailableSourceCount: rss.availableSourceCount,
          rssArticleCount: rss.articleCount,
          rssCandidateCount: rss.candidateCount,
          bochaCandidateCount,
          ...rss.sourceCounts,
        },
      };
    },
    { provider: "bocha+rss" },
  );
  const successfulSearchContents = searchResult.contents.flatMap((content) => content.value ? [content.value] : []);
  const bochaCandidates = successfulSearchContents.flatMap(getSearchCandidates);
  const searchCandidates = [...searchResult.rss.candidates, ...bochaCandidates];

  if (searchCandidates.length === 0) {
    throw new WebSearchDigestAgentError("WEB_RESEARCH_UNAVAILABLE", 502, "所有国际主题的全网搜索均暂时不可用。");
  }

  const candidateClusters = await runObservedStage(
    tracker,
    "CLUSTER",
    searchCandidates.length,
    async () => {
      const allClusters = clusterWebSearchCandidates(searchCandidates);
      const rankedClusters = allClusters.map((cluster) => ({ cluster, ...getClusterSelectionScore(cluster) }))
        .sort((left, right) => right.score - left.score || right.cluster.sourceDomainCount - left.cluster.sourceDomainCount);
      const multiSourceClusters = rankedClusters.filter(({ cluster }) => cluster.sourceDomainCount >= MINIMUM_SOURCE_DOMAINS_PER_EVENT);
      const singleSourceClusters = rankedClusters.filter(({ cluster }) => cluster.sourceDomainCount < MINIMUM_SOURCE_DOMAINS_PER_EVENT);
      const selectedMultiSourceClusters = multiSourceClusters.slice(0, MAX_MODEL_CANDIDATES);
      const requiredReserveCount = Math.max(MAX_MODEL_CANDIDATES - selectedMultiSourceClusters.length, 0);
      const selectedSingleSourceReserves = singleSourceClusters.slice(0, requiredReserveCount);
      const selectedClusters = [...selectedMultiSourceClusters, ...selectedSingleSourceReserves];
      const cutoffClusters = [
        ...multiSourceClusters.slice(MAX_MODEL_CANDIDATES),
        ...singleSourceClusters.slice(requiredReserveCount),
      ];

      await recordTrackedEventDecisions(tracker, [
        ...cutoffClusters.map(({ cluster, score, details }) => toEventDecision(cluster, {
          phase: "CLUSTER",
          decision: "REJECTED",
          reason: cluster.sourceDomainCount < MINIMUM_SOURCE_DOMAINS_PER_EVENT
            ? "INSUFFICIENT_SOURCES"
            : "RANKED_BELOW_CANDIDATE_CUTOFF",
          score,
          scoreDetails: details,
        })),
      ]);

      return selectedClusters;
    },
    (clusters) => ({
      outputCount: clusters.length,
      details: {
        minimumSourceDomains: MINIMUM_SOURCE_DOMAINS_PER_EVENT,
        maximumClusters: MAX_MODEL_CANDIDATES,
        multiSourceCandidateCount: clusters.filter(({ cluster }) => cluster.sourceDomainCount >= MINIMUM_SOURCE_DOMAINS_PER_EVENT).length,
        singleSourceReserveCount: clusters.filter(({ cluster }) => cluster.sourceDomainCount < MINIMUM_SOURCE_DOMAINS_PER_EVENT).length,
        insufficientSourceRejectedCount: clusterWebSearchCandidates(searchCandidates)
          .filter((cluster) => cluster.sourceDomainCount < MINIMUM_SOURCE_DOMAINS_PER_EVENT).length,
      },
    }),
  );
  const plannedCandidates = candidateClusters.flatMap(({ cluster }) => selectDistinctDomainCandidates(cluster, MAX_SOURCES_PER_EVENT));
  const rssCandidateUrls = new Set(searchResult.rss.candidates.map((candidate) => candidate.canonicalUrl));
  const fetchedContents = await runObservedStage(
    tracker,
    "FETCH",
    plannedCandidates.length,
    () => mapWithConcurrency(plannedCandidates, 4, async (candidate) => {
      const result = await runWithRetry(async () => {
        const content = await fetchArticle.invoke({ url: candidate.canonicalUrl });
        if (!toRetrievedSource(candidate, content)) {
          const payload = parseToolContent(content);
          throw new Error(getString(payload?.error) || "候选网页没有可用于摘要的正文。");
        }
        return content;
      }, MAX_FETCH_RETRIES, "候选网页正文读取失败。");

      return { candidate, ...result };
    }),
    (contents) => ({
      outputCount: contents.filter(({ candidate, value }) => value !== null && Boolean(toRetrievedSource(candidate, value))).length,
      details: {
        fetchRetryCount: contents.reduce((total, content) => total + content.retryCount, 0),
        fetchFailedCount: contents.filter((content) => content.value === null).length,
        fetchFailureReason: summarizeFailureReasons(contents.flatMap((content) => content.failureReasons)),
      },
    }),
    {
      maximumSourcesPerEvent: MAX_SOURCES_PER_EVENT,
      rssSelectedCandidateCount: plannedCandidates.filter((candidate) => rssCandidateUrls.has(candidate.canonicalUrl)).length,
      bochaSelectedCandidateCount: plannedCandidates.filter((candidate) => !rssCandidateUrls.has(candidate.canonicalUrl)).length,
    },
  );
  const sourcesByUrl = new Map(
    fetchedContents.flatMap(({ candidate, value }) => {
      const source = value ? toRetrievedSource(candidate, value) : null;
      return source ? [[source.canonicalUrl, source] as const] : [];
    }),
  );

  const readableClusters = candidateClusters
    .map(({ cluster, score, details }) => ({
      cluster,
      selectionScore: score,
      selectionDetails: details,
      sources: selectDistinctDomainCandidates(cluster, MAX_SOURCES_PER_EVENT)
        .flatMap((candidate) => {
          const source = sourcesByUrl.get(candidate.canonicalUrl);
          return source ? [source] : [];
        }),
    }))
  // 双来源事件会在候选排序中优先出现；当天可交叉验证的事件不足 12 条时，
  // 允许已有一篇实际可读原文的候补补位，避免整份日报因来源门槛而无法发布。
  const readableEvents = readableClusters.filter(({ sources }) => sources.length > 0);
  const unreadableEvents = readableClusters.filter(({ sources }) => sources.length === 0);

  await recordTrackedEventDecisions(tracker, unreadableEvents.map(({ cluster, sources, selectionScore, selectionDetails }) => toEventDecision(cluster, {
    phase: "FETCH",
    decision: "REJECTED",
    reason: "NO_READABLE_SOURCE",
    readableSourceCount: new Set(sources.map((source) => source.sourceDomain)).size,
    score: selectionScore,
    scoreDetails: selectionDetails,
  })));

  const finalSelection = readableEvents.slice(0, MAX_WEB_AGENT_STORIES);
  const finalRejectedEvents = readableEvents.slice(MAX_WEB_AGENT_STORIES);
  await recordTrackedEventDecisions(tracker, [
    ...finalSelection.map(({ cluster, sources, selectionScore, selectionDetails }) => toEventDecision(cluster, {
      phase: "FINAL_SELECTION",
      decision: "SELECTED",
      reason: "TOP_SELECTION_SCORE",
      readableSourceCount: new Set(sources.map((source) => source.sourceDomain)).size,
      score: selectionScore,
      scoreDetails: selectionDetails,
    })),
    ...finalRejectedEvents.map(({ cluster, sources, selectionScore, selectionDetails }) => toEventDecision(cluster, {
      phase: "FINAL_SELECTION",
      decision: "REJECTED",
      reason: "RANKED_BELOW_FINAL_CUTOFF",
      readableSourceCount: new Set(sources.map((source) => source.sourceDomain)).size,
      score: selectionScore,
      scoreDetails: selectionDetails,
    })),
  ]);

  return finalSelection;
}

function createSynthesisInput(digestDate: string, cluster: RetrievedEventCluster) {
  return JSON.stringify({
    digestDate,
    eventCandidate: cluster.cluster.headline,
    sources: cluster.sources.map((source) => ({
      url: source.canonicalUrl,
      sourceName: source.sourceName,
      title: source.title,
      publishedAt: source.publishedAt,
      text: source.supportingExcerpt.slice(0, MAX_DOCUMENT_CONTEXT_CHARACTERS),
    })),
  });
}

function isCompliantWebDigestStory(value: unknown): value is WebDigestStoryOutput {
  if (!isRecord(value)) {
    return false;
  }

  return Boolean(
    getString(value.headline)
    && getString(value.summary)
    && getString(value.whyItMatters)
    && typeof value.importanceScore === "number"
    && Array.isArray(value.sourceUrls),
  );
}

async function synthesizeDigestOutput(
  client: ChatOpenAI,
  digestDate: string,
  clusters: RetrievedEventCluster[],
): Promise<SynthesisResult> {
  const outputs = await mapWithConcurrency(clusters, 2, async (cluster) => {
    const result = await runWithRetry(async () => {
      const finalMessage = await client.invoke([
        { role: "system", content: createDigestPrompt(digestDate, cluster) },
        { role: "user", content: createSynthesisInput(digestDate, cluster) },
      ]);
      const output = parseWebSearchDigestOutput(getMessageText(finalMessage.content));
      const firstStory = Array.isArray(output.stories) && isRecord(output.stories[0]) ? output.stories[0] : null;

      if (!isCompliantWebDigestStory(firstStory)) {
        throw new Error("模型未返回符合日报结构的 JSON 事件。");
      }

      return {
        story: {
          ...firstStory,
          sourceUrls: cluster.sources.map((source) => source.canonicalUrl),
        },
        usage: getModelUsage(finalMessage),
      };
    }, MAX_MODEL_RETRIES, "DeepSeek 综合事件失败。");

    return {
      cluster,
      story: result.value?.story ?? null,
      usage: result.value?.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      retryCount: result.retryCount,
      failureReasons: result.failureReasons,
    };
  });

  const usage = sumModelUsage(outputs.map((result) => result.usage));
  const validOutputs = outputs.filter((result): result is typeof result & { story: WebDigestStoryOutput } => result.story !== null);
  const rejectedOutputs = outputs.filter((result) => result.story === null);

  return {
    output: { stories: validOutputs.map((result) => result.story) },
    usage,
    retryCount: outputs.reduce((total, result) => total + result.retryCount, 0),
    validClusters: validOutputs.map((result) => result.cluster),
    rejectedClusters: rejectedOutputs.map((result) => result.cluster),
    failureReasons: outputs.flatMap((result) => result.failureReasons),
  };
}

export async function runWebSearchDigest(
  digestDate: string,
  tracker?: AgentRunTracker | null,
): Promise<WebSearchDigestRunResult> {
  let searchConfig;

  try {
    searchConfig = getWebSearchConfig();
  } catch (error) {
    if (error instanceof WebSearchConfigurationError) {
      throw new WebSearchDigestAgentError("WEB_RESEARCH_NOT_CONFIGURED", 503, error.message);
    }

    throw error;
  }

  if (!searchConfig) {
    throw new WebSearchDigestAgentError(
      "WEB_RESEARCH_NOT_CONFIGURED",
      503,
      "尚未配置全网搜索 API。请设置 WEB_SEARCH_PROVIDER 和 WEB_SEARCH_API_KEY。",
    );
  }

  const configuredModel = getDeepSeekDigestModel();

  try {
    const eventClusters = await retrieveEventClusters(digestDate, searchConfig.policy, tracker);
    if (eventClusters.length === 0) {
      throw new WebSearchDigestAgentError(
        "WEB_RESEARCH_UNAVAILABLE",
        502,
        "未找到至少由 2 个不同网站报道且可读取原文的国际事件。",
      );
    }

    const retrievedSources = eventClusters.flatMap((cluster) => cluster.sources);
    const output = await runObservedStage(
      tracker,
      "SYNTHESIZE",
      eventClusters.length,
      () => synthesizeDigestOutput(configuredModel.client, digestDate, eventClusters),
      (result) => ({
        outputCount: Array.isArray(result.output.stories) ? result.output.stories.length : 0,
        details: {
          sourceDocumentCount: retrievedSources.length,
          model: configuredModel.model,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
          estimatedCostCny: estimateModelCostCny(result.usage),
          llmRetryCount: result.retryCount,
          llmRejectedEventCount: result.rejectedClusters.length,
          llmFailureReason: summarizeFailureReasons(result.failureReasons),
        },
      }),
      { model: configuredModel.model, maxRetriesPerEvent: MAX_MODEL_RETRIES },
    );
    await recordTrackedEventDecisions(tracker, [
      ...output.rejectedClusters.map((cluster) => toEventDecision(cluster.cluster, {
        phase: "FINAL_SELECTION",
        decision: "REJECTED",
        reason: "MODEL_OUTPUT_INVALID",
        readableSourceCount: new Set(cluster.sources.map((source) => source.sourceDomain)).size,
        score: cluster.selectionScore,
        scoreDetails: cluster.selectionDetails,
      })),
      ...output.validClusters.map((cluster, index) => toEventDecision(cluster.cluster, {
        phase: "FINAL_SELECTION",
        decision: index < MAX_WEB_AGENT_STORIES ? "SELECTED" : "REJECTED",
        reason: index < MAX_WEB_AGENT_STORIES ? "TOP_SELECTION_SCORE" : "RANKED_BELOW_FINAL_CUTOFF",
        readableSourceCount: new Set(cluster.sources.map((source) => source.sourceDomain)).size,
        score: cluster.selectionScore,
        scoreDetails: cluster.selectionDetails,
      })),
    ]);
    if (output.validClusters.length < MAX_WEB_AGENT_STORIES) {
      throw new WebSearchDigestAgentError(
        "WEB_RESEARCH_INVALID_RESPONSE",
        502,
        `DeepSeek 仅返回 ${output.validClusters.length} 条合规事件，未达到发布所需的 ${MAX_WEB_AGENT_STORIES} 条。`,
      );
    }
    const digest = await runObservedStage(
      tracker,
      "VALIDATE",
      Array.isArray(output.output.stories) ? output.output.stories.length : 0,
      async () => buildWebSearchDigestFromOutput({
        digestDate,
        generatedAt: new Date(),
        output: output.output,
        retrievedSources,
      }),
      (result) => ({ outputCount: result.stories.length }),
    );

    return {
      digest,
      model: configuredModel.model,
      searchProvider: searchConfig.provider,
      retrievedDocumentCount: retrievedSources.length,
    };
  } catch (error) {
    if (error instanceof WebSearchDigestAgentError) {
      throw error;
    }

    if (error instanceof WebSearchProviderError) {
      throw new WebSearchDigestAgentError("WEB_RESEARCH_UNAVAILABLE", error.status, error.message);
    }

    if (error instanceof Error && /timed out/i.test(error.message)) {
      throw new WebSearchDigestAgentError("WEB_RESEARCH_UNAVAILABLE", 502, "AI 服务响应超时，请稍后重试。");
    }

    console.error("Failed to run the LangChain web research agent.", error);
    throw new WebSearchDigestAgentError("WEB_RESEARCH_UNAVAILABLE", 502, "全网研究 Agent 暂时不可用，请稍后重试。");
  }
}

export async function generateAndPublishWebSearchDigest(
  digestDate: string,
  trigger: "manual" | "cron",
): Promise<PublishedWebSearchDigestResult> {
  let tracker: AgentRunTracker;

  try {
    tracker = await startAgentRunTracker({ digestDate, trigger });
  } catch (error) {
    if (error instanceof AgentRunTrackingError) {
      throw new WebSearchDigestAgentError(
        "WEB_RESEARCH_UNAVAILABLE",
        503,
        "运行记录服务暂时不可用，本次日报未执行，请稍后重试。",
      );
    }

    throw error;
  }

  try {
    const result = await runWebSearchDigest(digestDate, tracker);
    await tracker.startStage("PUBLISH", { inputCount: result.digest.stories.length });

    try {
      const digest = await publishDigest(result.digest, {
        trigger,
        model: result.model,
        retrievedDocumentCount: result.retrievedDocumentCount,
        agentRunId: tracker.agentRunId,
      });
      await recordAgentRunQualityEvaluation({
        agentRunId: tracker.agentRunId,
        evaluation: evaluateAgentRunQuality(digest),
      });
      await tracker.completeStage("PUBLISH", { outputCount: digest.stories.length });

      return {
        ...result,
        digest,
      };
    } catch (error) {
      await tracker.failStage("PUBLISH", error);
      throw error;
    }
  } catch (error) {
    await tracker.failRun(error);
    throw error;
  }
}
