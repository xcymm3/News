import {
  StoryQuestionError,
  createGroundedStoryAnswer,
  type StoryQuestionTurn,
} from "@/features/chat/story-question-service";
import type { StoryChatAnswer } from "@/features/chat/types";
import { DigestStoryNotFoundError, digestService } from "@/features/digest/digest-service";
import type { DigestStory } from "@/features/digest/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUESTION_LENGTH = 500;
const MAX_RECENT_TURNS = 8;
const MAX_TURN_LENGTH = 800;
const STORY_LOOKUP_ATTEMPTS = 2;

type StoryQuestionRequest = {
  storyId?: unknown;
  question?: unknown;
  recentTurns?: unknown;
};

function invalidRequest(message: string) {
  return Response.json(
    {
      error: {
        code: "INVALID_STORY_QUESTION",
        message,
      },
    },
    {
      status: 422,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function noStoreJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function waitForStoryLookupRetry() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 400);
  });
}

async function findCurrentStory(storyId: string) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= STORY_LOOKUP_ATTEMPTS; attempt += 1) {
    try {
      return await digestService.getTodayStory(storyId);
    } catch (error) {
      if (error instanceof DigestStoryNotFoundError) {
        return null;
      }

      lastError = error;

      if (attempt < STORY_LOOKUP_ATTEMPTS) {
        await waitForStoryLookupRetry();
      }
    }
  }

  throw lastError;
}

type StoryQuestionStreamEvent =
  | { type: "delta"; content: string }
  | { type: "done"; answer: StoryChatAnswer }
  | { type: "error"; message: string };

async function createStreamResponse(
  story: DigestStory,
  question: string,
  recentTurns: StoryQuestionTurn[],
) {
  // Generate the complete provider response before opening the browser stream.
  // This preserves the client-side typewriter effect while allowing a real 502
  // to be returned if the upstream model rejects or drops the request.
  const answer = await createGroundedStoryAnswer(story, question, recentTurns);
  const encoder = new TextEncoder();
  const encode = (event: StoryQuestionStreamEvent) => encoder.encode(`${JSON.stringify(event)}\n`);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encode({ type: "delta", content: answer.answer }));
      controller.enqueue(encode({ type: "done", answer }));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}

function parseRecentTurns(value: unknown): StoryQuestionTurn[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(-MAX_RECENT_TURNS).flatMap((turn): StoryQuestionTurn[] => {
    if (!turn || typeof turn !== "object" || !("role" in turn) || !("content" in turn)) {
      return [];
    }

    const role = turn.role;
    const content = typeof turn.content === "string" ? turn.content.replace(/\s+/g, " ").trim().slice(0, MAX_TURN_LENGTH) : "";

    return (role === "user" || role === "assistant") && content ? [{ role, content }] : [];
  });
}

export async function POST(request: Request) {
  let body: StoryQuestionRequest;

  try {
    body = (await request.json()) as StoryQuestionRequest;
  } catch {
    return invalidRequest("请求格式不正确，请重新输入问题。");
  }

  if (typeof body.storyId !== "string" || typeof body.question !== "string") {
    return invalidRequest("请指定当前事件并输入问题。");
  }

  const storyId = body.storyId.trim();
  const question = body.question.trim();

  if (!storyId || !question || question.length > MAX_QUESTION_LENGTH) {
    return invalidRequest("问题不能为空，且不能超过 500 字。");
  }

  let story: DigestStory | null;

  try {
    story = await findCurrentStory(storyId);
  } catch (error) {
    console.error("Failed to load the current story for a question.", error);

    return noStoreJson(
      {
        error: {
          code: "STORY_LOOKUP_UNAVAILABLE",
          message: "暂时无法读取当前新闻，请稍后重试。",
        },
      },
      503,
    );
  }

  if (!story) {
    return Response.json(
      {
        error: {
          code: "STORY_NOT_FOUND",
          message: "未找到当前事件，无法继续追问。",
        },
      },
      {
        status: 404,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  try {
    return await createStreamResponse(story, question, parseRecentTurns(body.recentTurns));
  } catch (error) {
    if (error instanceof StoryQuestionError) {
      return noStoreJson(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        error.status,
      );
    }

    console.error("Failed to answer a story question.", error);

    return noStoreJson(
      {
        error: {
          code: "STORY_QUESTION_UNAVAILABLE",
          message: "暂时无法整理回答，请稍后重试。",
        },
      },
      500,
    );
  }
}
