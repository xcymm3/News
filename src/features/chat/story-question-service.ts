import type { DigestStory } from "@/features/digest/types";

import type { StoryChatAnswer } from "./types";

const QUESTION_ANSWER_TIMEOUT_MS = 30_000;
const MAX_ANSWER_LENGTH = 1_500;

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

function getDeepSeekConfig() {
  const baseUrl = (process.env.LLM_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
  const isDeepSeek = isDeepSeekBaseUrl(baseUrl);
  const apiKey = isDeepSeek
    ? process.env.DEEPSEEK_API_KEY?.trim() || process.env.LLM_API_KEY?.trim()
    : process.env.LLM_API_KEY?.trim() || process.env.DEEPSEEK_API_KEY?.trim();
  const model = isDeepSeek
    ? process.env.DEEPSEEK_MODEL?.trim() || process.env.LLM_MODEL?.trim() || "deepseek-v4-flash"
    : process.env.LLM_MODEL?.trim() || process.env.DEEPSEEK_MODEL?.trim();

  if (!apiKey || !model) {
    throw new StoryQuestionError(
      "STORY_QUESTION_NOT_CONFIGURED",
      503,
      "尚未完整配置 AI 服务，暂时无法进行 AI 追问。",
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

function isDeepSeekBaseUrl(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname === "api.deepseek.com";
  } catch {
    return false;
  }
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

function createDeepSeekMessages(story: DigestStory, question: string, recentTurns: StoryQuestionTurn[]) {
  return [
    {
      role: "system",
      content:
        "你是具有通用知识的严谨中文助手，也负责解读当前新闻。可以直接解释稳定的通用知识、概念、背景和常识，例如“股票是什么”；不必假装这些知识只来自新闻材料。涉及当前事件的时间敏感事实、人物当前职务、数字、进展、因果和引述时，只能以提供的新闻材料与对话为依据，不得补造未披露细节或编造来源。若材料没有回答某个当前事实，应明确说“当前材料未说明”，但可在不混淆事实的前提下补充一般背景。除非用户主动询问出处、核验或原文，否则不要默认建议用户查看 RSS 链接，也不要在回答正文中杜撰链接。\n\n排版要求：使用清晰、克制的 Markdown。先用一两句直接回答；问题有多个要点时，用 1.、2. 的编号列表或 - 的项目列表分开说明。必要时最多使用 3 个 ### 小标题，且每段保持简短。只对关键概念使用 **加粗**，不要整段加粗。不要使用表格、代码块、引用块、Markdown 链接或大标题。回答自然、直接、中文。",
    },
    {
      role: "user",
      content: `当前新闻上下文（仅用于核实本事件的当下事实）：\n${createGroundedContext(story)}\n\n最近对话：\n${JSON.stringify(recentTurns)}\n\n用户问题：\n${question}`,
    },
  ];
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
): Promise<StoryChatAnswer> {
  const config = getDeepSeekConfig();
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), QUESTION_ANSWER_TIMEOUT_MS);

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
        messages: createDeepSeekMessages(story, question, recentTurns),
      }),
      cache: "no-store",
      signal: abortController.signal,
    });
    const responseText = await response.text();

    if (!response.ok) {
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
  const config = getDeepSeekConfig();
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), QUESTION_ANSWER_TIMEOUT_MS);
  let rawAnswer = "";

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
        stream: true,
        messages: createDeepSeekMessages(story, question, recentTurns),
      }),
      cache: "no-store",
      signal: abortController.signal,
    });

    if (!response.ok || !response.body) {
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
