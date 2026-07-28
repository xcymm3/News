import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGroundedStoryAnswer,
  StoryQuestionError,
  streamGroundedStoryAnswer,
} from "./story-question-service";
import type { DigestStory } from "@/features/digest/types";

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();

  return {
    ...actual,
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  };
});

const story: DigestStory = {
  id: "story-1",
  position: 1,
  headline: "测试新闻标题",
  summary: "这是当前事件的已知摘要。",
  whyItMatters: "这说明事件可能影响后续安排。",
  importanceScore: 80,
  updatedAt: "2026-07-24T10:00:00.000Z",
  citations: [
    {
      id: "citation-1",
      sourceName: "测试新闻网",
      sourceUrl: "https://example.test/news/1",
      publishedAt: "2026-07-24T10:00:00.000Z",
      supportingExcerpt: "不应发送给模型的原文摘录。",
    },
  ],
};

function configureQuestionLlm() {
  vi.stubEnv("LLM_API_KEY", "question-key");
  vi.stubEnv("LLM_BASE_URL", "https://question-llm.example.test/v1");
  vi.stubEnv("LLM_MODEL", "question-model");
  vi.stubEnv("LLM_PROXY_URL", "");
}

describe("createGroundedStoryAnswer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the dedicated LLM configuration and binds citations on the server", async () => {
    configureQuestionLlm();
    vi.stubEnv("DEEPSEEK_API_KEY", "digest-only-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "基于现有材料，后续安排尚未明确。" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const answer = await createGroundedStoryAnswer(story, "下一步是什么？", [
      { role: "user", content: "之前发生了什么？" },
      { role: "assistant", content: "现有摘要如上。" },
    ]);

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { messages: Array<{ content: string }> };

    expect(fetchMock).toHaveBeenCalledWith(
      "https://question-llm.example.test/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer question-key" }),
      }),
    );
    expect(request.messages[0]?.content).toContain("可以直接解释稳定的通用知识");
    expect(request.messages[0]?.content).toContain("不要默认建议用户查看 RSS 链接");
    expect(request.messages[1]?.content).toContain("测试新闻标题");
    expect(request.messages[1]?.content).toContain("https://example.test/news/1");
    expect(request.messages[1]?.content).not.toContain("不应发送给模型的原文摘录");
    expect(answer).toEqual({
      answer: "基于现有材料，后续安排尚未明确。",
      citations: [{ id: "citation-1", sourceName: "测试新闻网", sourceUrl: "https://example.test/news/1" }],
    });
  });

  it("reports a clear configuration error without attempting a request", async () => {
    vi.stubEnv("LLM_API_KEY", "");
    vi.stubEnv("LLM_BASE_URL", "");
    vi.stubEnv("LLM_MODEL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createGroundedStoryAnswer(story, "发生了什么？")).rejects.toMatchObject({
      code: "STORY_QUESTION_NOT_CONFIGURED",
      status: 503,
    } satisfies Partial<StoryQuestionError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("converts an unavailable model response into a safe API error", async () => {
    configureQuestionLlm();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("temporarily unavailable", { status: 503 })));

    await expect(createGroundedStoryAnswer(story, "后续会怎样？")).rejects.toMatchObject({
      code: "STORY_QUESTION_UNAVAILABLE",
      status: 502,
    } satisfies Partial<StoryQuestionError>);
  });

  it("retries one transient provider failure before returning an answer", async () => {
    configureQuestionLlm();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("temporarily unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "重试后成功。" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createGroundedStoryAnswer(story, "再试一次")).resolves.toMatchObject({ answer: "重试后成功。" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forwards stream chunks and preserves the completed formatted answer", async () => {
    configureQuestionLlm();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"先说结论。\\n\\n1. **第一点**"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"：说明。"}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];

    const answer = await streamGroundedStoryAnswer(story, "为什么？", [], (content) => deltas.push(content));

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { stream?: boolean };

    expect(request.stream).toBe(true);
    expect(deltas).toEqual(["先说结论。\n\n1. **第一点**", "：说明。"]);
    expect(answer.answer).toBe("先说结论。\n\n1. **第一点**：说明。");
    expect(answer.citations).toEqual([{ id: "citation-1", sourceName: "测试新闻网", sourceUrl: "https://example.test/news/1" }]);
  });
});
