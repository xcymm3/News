import { createHash } from "node:crypto";

import { ChatOpenAI } from "@langchain/openai";

import { validateGeneratedDigest } from "@/features/digest/live-digest-generator";
import { publishDigest } from "@/features/digest/prisma-digest-repository";
import type { DailyDigest, DigestCitation, DigestStory } from "@/features/digest/types";
import {
  getWebSearchConfig,
  WebSearchConfigurationError,
  type WebSearchCandidate,
} from "@/features/web-search/web-search-contract";
import { WebSearchProviderError } from "@/features/web-search/web-search-provider";
import { createWebResearchTools } from "@/features/web-search/web-research-tools";

const MAX_WEB_AGENT_STORIES = 12;
const MAX_RESEARCH_DOCUMENTS = 12;
const MAX_DOCUMENT_CONTEXT_CHARACTERS = 2_400;
const LLM_REQUEST_TIMEOUT_MS = 90_000;

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

function stableId(prefix: string, value: string) {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function isDeepSeekBaseUrl(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname === "api.deepseek.com";
  } catch {
    return false;
  }
}

function getConfiguredModel() {
  const baseUrl = (process.env.LLM_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
  const isDeepSeek = isDeepSeekBaseUrl(baseUrl);
  const apiKey = isDeepSeek
    ? process.env.DEEPSEEK_API_KEY?.trim() || process.env.LLM_API_KEY?.trim()
    : process.env.LLM_API_KEY?.trim() || process.env.DEEPSEEK_API_KEY?.trim();
  const model = isDeepSeek
    ? process.env.DEEPSEEK_MODEL?.trim() || process.env.LLM_MODEL?.trim()
    : process.env.LLM_MODEL?.trim() || process.env.DEEPSEEK_MODEL?.trim();

  if (!apiKey || !model) {
    throw new WebSearchDigestAgentError(
      "WEB_RESEARCH_MODEL_NOT_CONFIGURED",
      503,
      "尚未完整配置 AI 模型服务。",
    );
  }

  try {
    if (new URL(baseUrl).protocol !== "https:") {
      throw new Error("Only HTTPS is allowed.");
    }
  } catch {
    throw new WebSearchDigestAgentError("WEB_RESEARCH_MODEL_NOT_CONFIGURED", 503, "AI 服务地址配置无效。");
  }

  return {
    model,
    client: new ChatOpenAI({
      apiKey,
      model,
      temperature: 0.2,
      timeout: LLM_REQUEST_TIMEOUT_MS,
      maxRetries: 0,
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
    const summary = getString(story.summary).slice(0, 1_200);
    const whyItMatters = getString(story.whyItMatters).slice(0, 800);
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
        supportingExcerpt: text.slice(0, 600),
      });
    }
  }

  return [...retrievedSources.values()];
}

function createDigestPrompt(digestDate: string) {
  return [
    `The authoritative application date is ${digestDate}; treat it as the present date for this task.`,
    `The following are webpages actually retrieved from the Chinese web for ${digestDate}.`,
    "Return exactly 12 distinct stories when the retrieved material supports it; otherwise return the maximum defensible number.",
    "Each story must include headline, summary, whyItMatters, importanceScore (1-100), and sourceUrls (an array of fetched source URLs).",
    "Write Chinese. Summaries should be self-contained and detailed enough for a reader who will not open the original page.",
    "Do not invent facts, dates, quotations, or URLs. Cite only sourceUrls present in the supplied material.",
  ].join(" ");
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
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

async function retrieveWebSources(digestDate: string) {
  const [searchWeb, fetchArticle] = createWebResearchTools();
  const searchContent = await searchWeb.invoke({
    query: `${digestDate} 中国 国际 财经 科技 社会 重要新闻`,
    maxResults: MAX_RESEARCH_DOCUMENTS,
  });
  const searchPayload = parseToolContent(searchContent);
  const candidates = Array.isArray(searchPayload?.candidates) ? searchPayload.candidates : [];
  const urls = candidates
    .filter(isRecord)
    .map((candidate) => getString(candidate.canonicalUrl))
    .filter(Boolean)
    .slice(0, MAX_RESEARCH_DOCUMENTS);
  const fetchedContents = await mapWithConcurrency(urls, 4, async (url) => fetchArticle.invoke({ url }));
  const messages = [
    { name: "search_web", content: searchContent },
    ...fetchedContents.map((content) => ({ name: "fetch_article", content })),
  ];

  return collectRetrievedWebSources(messages);
}

function createSynthesisInput(digestDate: string, sources: RetrievedWebSource[]) {
  return JSON.stringify({
    digestDate,
    sources: sources.map((source) => ({
      url: source.canonicalUrl,
      sourceName: source.sourceName,
      title: source.title,
      publishedAt: source.publishedAt,
      text: source.supportingExcerpt.slice(0, MAX_DOCUMENT_CONTEXT_CHARACTERS),
    })),
  });
}

export async function runWebSearchDigest(digestDate: string): Promise<WebSearchDigestRunResult> {
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

  const configuredModel = getConfiguredModel();

  try {
    const retrievedSources = await retrieveWebSources(digestDate);
    if (retrievedSources.length === 0) {
      throw new WebSearchDigestAgentError("WEB_RESEARCH_UNAVAILABLE", 502, "未能读取到可用于生成日报的网页原文。");
    }

    const finalMessage = await configuredModel.client.invoke([
      { role: "system", content: createDigestPrompt(digestDate) },
      { role: "user", content: createSynthesisInput(digestDate, retrievedSources) },
    ]);
    const output = parseWebSearchDigestOutput(getMessageText(finalMessage.content));
    const digest = buildWebSearchDigestFromOutput({
      digestDate,
      generatedAt: new Date(),
      output,
      retrievedSources,
    });

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

    console.error("Failed to run the LangChain web research agent.", error);
    throw new WebSearchDigestAgentError("WEB_RESEARCH_UNAVAILABLE", 502, "全网研究 Agent 暂时不可用，请稍后重试。");
  }
}

export async function generateAndPublishWebSearchDigest(
  digestDate: string,
  trigger: "manual" | "cron",
): Promise<PublishedWebSearchDigestResult> {
  const result = await runWebSearchDigest(digestDate);
  const digest = await publishDigest(result.digest, {
    trigger,
    model: result.model,
    retrievedDocumentCount: result.retrievedDocumentCount,
  });

  return {
    ...result,
    digest,
  };
}
