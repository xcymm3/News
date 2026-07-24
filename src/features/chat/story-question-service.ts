import type { DigestStory } from "@/features/digest/types";

import type { StoryChatAnswer } from "./types";

const QUESTION_ANSWER_TIMEOUT_MS = 30_000;
const MAX_ANSWER_LENGTH = 1_500;

export type StoryQuestionTurn = {
  role: "user" | "assistant";
  content: string;
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
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim() || process.env.LLM_API_KEY?.trim();
  const baseUrl = (process.env.LLM_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
  const model = process.env.DEEPSEEK_MODEL?.trim() || process.env.LLM_MODEL?.trim() || "deepseek-v4-flash";

  if (!apiKey) {
    throw new StoryQuestionError(
      "STORY_QUESTION_NOT_CONFIGURED",
      503,
      "尚未配置 DeepSeek API 密钥，暂时无法进行 AI 追问。",
    );
  }

  try {
    const endpoint = new URL(baseUrl);

    if (endpoint.protocol !== "https:") {
      throw new Error("The DeepSeek base URL must use HTTPS.");
    }
  } catch {
    throw new StoryQuestionError("STORY_QUESTION_NOT_CONFIGURED", 503, "DeepSeek API 地址配置无效。");
  }

  return { apiKey, baseUrl, model };
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
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_ANSWER_LENGTH) : "";
}

export async function createGroundedStoryAnswer(
  story: DigestStory,
  question: string,
  recentTurns: StoryQuestionTurn[] = [],
): Promise<StoryChatAnswer> {
  const config = getDeepSeekConfig();
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), QUESTION_ANSWER_TIMEOUT_MS);
  const context = createGroundedContext(story);

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
        messages: [
          {
            role: "system",
            content:
              "你是具有通用知识的严谨中文助手，也负责解读当前新闻。可以直接解释稳定的通用知识、概念、背景和常识，例如“股票是什么”；不必假装这些知识只来自新闻材料。涉及当前事件的时间敏感事实、人物当前职务、数字、进展、因果和引述时，只能以提供的新闻材料与对话为依据，不得补造未披露细节或编造来源。若材料没有回答某个当前事实，应明确说“当前材料未说明”，但可在不混淆事实的前提下补充一般背景。除非用户主动询问出处、核验或原文，否则不要默认建议用户查看 RSS 链接，也不要在回答正文中杜撰链接。回答自然、直接、中文。",
          },
          {
            role: "user",
            content: `当前新闻上下文（仅用于核实本事件的当下事实）：\n${context}\n\n最近对话：\n${JSON.stringify(recentTurns)}\n\n用户问题：\n${question}`,
          },
        ],
      }),
      cache: "no-store",
      signal: abortController.signal,
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw new StoryQuestionError("STORY_QUESTION_UNAVAILABLE", 502, "DeepSeek 服务暂时不可用，请稍后重试。");
    }

    let payload: unknown;

    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new StoryQuestionError("STORY_QUESTION_INVALID_RESPONSE", 502, "DeepSeek 返回了无法识别的回答。");
    }

    const answer = payload && typeof payload === "object"
      && "choices" in payload && Array.isArray(payload.choices)
      && payload.choices[0] && typeof payload.choices[0] === "object"
      && "message" in payload.choices[0] && payload.choices[0].message && typeof payload.choices[0].message === "object"
      ? normalizeAnswer("content" in payload.choices[0].message ? payload.choices[0].message.content : null)
      : "";

    if (!answer) {
      throw new StoryQuestionError("STORY_QUESTION_INVALID_RESPONSE", 502, "DeepSeek 未返回可用回答。");
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
      ? "DeepSeek 响应超时，请稍后重试。"
      : "DeepSeek 服务暂时不可用，请稍后重试。";

    throw new StoryQuestionError("STORY_QUESTION_UNAVAILABLE", 502, message);
  } finally {
    clearTimeout(timeout);
  }
}
