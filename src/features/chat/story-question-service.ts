import type { DigestStory } from "@/features/digest/types";
import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";

import type { StoryChatAnswer } from "./types";

const QUESTION_ANSWER_TIMEOUT_MS = 60_000;
const MAX_ANSWER_LENGTH = 1_500;
const MAX_ANSWER_TOKENS = 900;
const MAX_QUESTION_LLM_ATTEMPTS = 2;
const questionLlmProxyAgents = new Map<string, Dispatcher>();

export type StoryQuestionTurn = {
  role: "user" | "assistant";
  content: string;
};

type DeepSeekStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: unknown;
    };
  }>;
};

export class StoryQuestionError extends Error {
  constructor(
    readonly code: "STORY_QUESTION_NOT_CONFIGURED" | "STORY_QUESTION_UNAVAILABLE" | "STORY_QUESTION_INVALID_RESPONSE",
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "StoryQuestionError";
  }
}

function getLlmConfig() {
  const baseUrl = process.env.LLM_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.LLM_API_KEY?.trim();
  const model = process.env.LLM_MODEL?.trim();

  if (!apiKey || !baseUrl || !model) {
    throw new StoryQuestionError(
      "STORY_QUESTION_NOT_CONFIGURED",
      503,
      "尚未完整配置 AI 追问服务，请设置 LLM_API_KEY、LLM_BASE_URL 和 LLM_MODEL。",
    );
  }

  try {
    const endpoint = new URL(baseUrl);

    if (endpoint.protocol !== "https:") {
      throw new Error("The AI base URL must use HTTPS.");
    }
  } catch {
    throw new StoryQuestionError("STORY_QUESTION_NOT_CONFIGURED", 503, "AI 服务地址配置无效。");
  }

  return { apiKey, baseUrl, model };
}

function getQuestionLlmDispatcher() {
  const proxyUrl = process.env.LLM_PROXY_URL?.trim()
    || process.env.HTTPS_PROXY?.trim()
    || process.env.HTTP_PROXY?.trim();

  if (!proxyUrl) {
    return undefined;
  }

  try {
    const protocol = new URL(proxyUrl).protocol;
    if (protocol !== "http:" && protocol !== "https:") {
      throw new Error("Unsupported proxy protocol.");
    }
  } catch {
    throw new StoryQuestionError("STORY_QUESTION_NOT_CONFIGURED", 503, "AI 追问代理地址无效。");
  }

  const cachedAgent = questionLlmProxyAgents.get(proxyUrl);
  if (cachedAgent) {
    return cachedAgent;
  }

  const agent = new ProxyAgent(proxyUrl);
  questionLlmProxyAgents.set(proxyUrl, agent);
  return agent;
}

async function requestQuestionLlm(
  config: ReturnType<typeof getLlmConfig>,
  body: Record<string, unknown>,
  signal: AbortSignal,
) {
  return undiciFetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    dispatcher: getQuestionLlmDispatcher(),
    signal,
  });
}

function createGroundedContext(story: DigestStory) {
  return JSON.stringify({
    headline: story.headline,
    summary: story.summary,
    whyItMatters: story.whyItMatters,
    rssSources: story.citations.map((citation) => ({
      sourceName: citation.sourceName,
      sourceUrl: citation.sourceUrl,
    })),
  });
}

function normalizeAnswer(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_ANSWER_LENGTH);
}

async function logQuestionLlmFailure(response: { status: number; text: () => Promise<string> }, baseUrl: string) {
  const responseBody = await response.text().catch(() => "");
  let provider = "unknown";

  try {
    provider = new URL(baseUrl).hostname;
  } catch {
    // The configuration was already validated before the request.
  }

  console.error("Story question LLM request failed.", {
    provider,
    status: response.status,
    response: responseBody.slice(0, 600),
  });
}

function createDeepSeekMessages(story: DigestStory, question: string, recentTurns: StoryQuestionTurn[]) {
  return [
    {
      role: "system",
      content:
        "你是一位友好、耐心、专业的中文助手，负责解读当前新闻，也能回答与新闻相关的背景问题。先自然、直接地回应用户真正想知道的内容；语气温和有帮助，不要把“材料未说明”或“无法确定”当成完整答复，更不要机械地拒答。\n\n回答依据：\n1. 当前新闻上下文用于核实本事件的当下事实、具体数字、人物当前职务、最新进展、因果关系和引述；这类细节不能补造。\n2. 若新闻材料没有覆盖，但问题属于稳定的通用知识、概念、历史背景或常识（如“股票是什么”“俄乌冲突从何时开始”），请使用你已有的通用知识直接解释，并把它与当前新闻材料清楚区分；不要假装这些知识来自 RSS，也不要因材料未提及就拒绝回答。\n3. 若用户询问材料未覆盖的、会随时间变化的事实，先说明现有材料未给出该细节，再提供你确信的背景或判断范围；没有把握时诚实说明不确定之处，但仍尽量解释已知背景与理解路径。\n\n除非用户主动询问出处、核验或原文，否则不要默认建议查看 RSS 链接，也不要在回答正文中杜撰链接。\n\n排版要求：使用清晰、克制的 Markdown。先用一两句直接回答；问题有多个要点时，用 1.、2. 的编号列表或 - 的项目列表分开说明。必要时最多使用 3 个 ### 小标题，且每段保持简短。只对关键概念使用 **加粗**，不要整段加粗。不要使用表格、代码块、引用块、Markdown 链接或大标题。回答自然、亲切、中文。",
    },
    {
      role: "user",
      content: `当前新闻上下文（仅用于核实本事件的当下事实）：\n${createGroundedContext(story)}\n\n最近对话：\n${JSON.stringify(recentTurns)}\n\n用户问题：\n${question}`,
    },
  ];
}

function waitForQuestionLlmRetry() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 400);
  });
}

function extractStreamContent(value: unknown) {
  if (!value || typeof value !== "object") {
    return "";
  }

  const chunk = value as DeepSeekStreamChunk;
  const content = chunk.choices?.[0]?.delta?.content;

  return typeof content === "string" ? content : "";
}

export async function createGroundedStoryAnswer(
  story: DigestStory,
  question: string,
  recentTurns: StoryQuestionTurn[] = [],
  attempt = 1,
): Promise<StoryChatAnswer> {
  const config = getLlmConfig();
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), QUESTION_ANSWER_TIMEOUT_MS);

  try {
    const response = await requestQuestionLlm(
      config,
      {
        model: config.model,
        temperature: 0.2,
        max_tokens: MAX_ANSWER_TOKENS,
        messages: createDeepSeekMessages(story, question, recentTurns),
      },
      abortController.signal,
    );
    const responseText = await response.text();

    if (!response.ok) {
      await logQuestionLlmFailure(response, config.baseUrl);
      throw new StoryQuestionError("STORY_QUESTION_UNAVAILABLE", 502, "AI 服务暂时不可用，请稍后重试。");
    }

    let payload: unknown;

    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new StoryQuestionError("STORY_QUESTION_INVALID_RESPONSE", 502, "AI 服务返回了无法识别的回答。");
    }

    const answer = payload && typeof payload === "object"
      && "choices" in payload && Array.isArray(payload.choices)
      && payload.choices[0] && typeof payload.choices[0] === "object"
      && "message" in payload.choices[0] && payload.choices[0].message && typeof payload.choices[0].message === "object"
      ? normalizeAnswer("content" in payload.choices[0].message ? payload.choices[0].message.content : null)
      : "";

    if (!answer) {
      throw new StoryQuestionError("STORY_QUESTION_INVALID_RESPONSE", 502, "AI 服务未返回可用回答。");
    }

    return {
      answer,
      // 引用由服务端固定绑定到当前新闻，模型无法添加或伪造链接。
      citations: story.citations.map((citation) => ({
        id: citation.id,
        sourceName: citation.sourceName,
        sourceUrl: citation.sourceUrl,
      })),
    };
  } catch (error) {
    const isRetryable = error instanceof StoryQuestionError
      ? error.code === "STORY_QUESTION_UNAVAILABLE"
      : true;

    if (isRetryable && attempt < MAX_QUESTION_LLM_ATTEMPTS) {
      await waitForQuestionLlmRetry();
      return createGroundedStoryAnswer(story, question, recentTurns, attempt + 1);
    }

    if (error instanceof StoryQuestionError) {
      throw error;
    }

    const message = error instanceof Error && error.name === "AbortError"
      ? "AI 服务响应超时，请稍后重试。"
      : "AI 服务暂时不可用，请稍后重试。";

    throw new StoryQuestionError("STORY_QUESTION_UNAVAILABLE", 502, message);
  } finally {
    clearTimeout(timeout);
  }
}

export async function streamGroundedStoryAnswer(
  story: DigestStory,
  question: string,
  recentTurns: StoryQuestionTurn[] = [],
  onDelta: (content: string) => void,
): Promise<StoryChatAnswer> {
  const config = getLlmConfig();
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), QUESTION_ANSWER_TIMEOUT_MS);
  let rawAnswer = "";

  try {
    const response = await requestQuestionLlm(
      config,
      {
        model: config.model,
        temperature: 0.2,
        max_tokens: MAX_ANSWER_TOKENS,
        stream: true,
        messages: createDeepSeekMessages(story, question, recentTurns),
      },
      abortController.signal,
    );

    if (!response.ok || !response.body) {
      await logQuestionLlmFailure(response, config.baseUrl);
      throw new StoryQuestionError("STORY_QUESTION_UNAVAILABLE", 502, "AI 服务暂时不可用，请稍后重试。");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";

    const processLine = (line: string) => {
      if (!line.startsWith("data:")) {
        return;
      }

      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") {
        return;
      }

      try {
        const content = extractStreamContent(JSON.parse(payload));
        if (content) {
          rawAnswer += content;
          onDelta(content);
        }
      } catch {
        // Ignore non-content SSE frames while preserving successfully received answer text.
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";

      for (const line of lines) {
        processLine(line.trim());
      }

      if (done) {
        processLine(pending.trim());
        break;
      }
    }

    const answer = normalizeAnswer(rawAnswer);
    if (!answer) {
      throw new StoryQuestionError("STORY_QUESTION_INVALID_RESPONSE", 502, "AI 服务未返回可用回答。");
    }

    return {
      answer,
      citations: story.citations.map((citation) => ({
        id: citation.id,
        sourceName: citation.sourceName,
        sourceUrl: citation.sourceUrl,
      })),
    };
  } catch (error) {
    if (error instanceof StoryQuestionError) {
      throw error;
    }

    const message = error instanceof Error && error.name === "AbortError"
      ? "AI 服务响应超时，请稍后重试。"
      : "AI 服务暂时不可用，请稍后重试。";

    throw new StoryQuestionError("STORY_QUESTION_UNAVAILABLE", 502, message);
  } finally {
    clearTimeout(timeout);
  }
}
