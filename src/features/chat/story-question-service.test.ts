import { afterEach, describe, expect, it, vi } from "vitest";

import { createGroundedStoryAnswer, StoryQuestionError } from "./story-question-service";
import type { DigestStory } from "@/features/digest/types";

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

describe("createGroundedStoryAnswer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("grounds the DeepSeek request in the story fields and binds citations on the server", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "基于现有材料，后续安排尚未明确。" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const answer = await createGroundedStoryAnswer(story, "下一步是什么？", [
      { role: "user", content: "之前发生了什么？" },
      { role: "assistant", content: "现有摘要如上。" },
    ]);

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { messages: Array<{ content: string }> };

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
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("LLM_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createGroundedStoryAnswer(story, "发生了什么？")).rejects.toMatchObject({
      code: "STORY_QUESTION_NOT_CONFIGURED",
      status: 503,
    } satisfies Partial<StoryQuestionError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("converts an unavailable model response into a safe API error", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("temporarily unavailable", { status: 503 })));

    await expect(createGroundedStoryAnswer(story, "后续会怎样？")).rejects.toMatchObject({
      code: "STORY_QUESTION_UNAVAILABLE",
      status: 502,
    } satisfies Partial<StoryQuestionError>);
  });
});
