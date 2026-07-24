import type { StoryChatAnswer, StoryChatMessage, StoryChatThread } from "./types";

export const ANONYMOUS_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

const MAX_MESSAGES_PER_THREAD = 40;

type StoredThread = StoryChatThread & {
  sessionId: string;
};

const threads = new Map<string, StoredThread>();

function getThreadKey(sessionId: string, storyId: string) {
  return `${sessionId}:${storyId}`;
}

function copyMessage(message: StoryChatMessage): StoryChatMessage {
  return {
    ...message,
    citations: message.citations?.map((citation) => ({ ...citation })),
  };
}

function copyThread(thread: StoredThread): StoryChatThread {
  return {
    id: thread.id,
    storyId: thread.storyId,
    expiresAt: thread.expiresAt,
    messages: thread.messages.map(copyMessage),
  };
}

function purgeExpiredThreads(now = Date.now()) {
  for (const [key, thread] of threads) {
    if (Date.parse(thread.expiresAt) <= now) {
      threads.delete(key);
    }
  }
}

export function readAnonymousChatThread(sessionId: string, storyId: string): StoryChatThread | null {
  purgeExpiredThreads();

  const thread = threads.get(getThreadKey(sessionId, storyId));

  return thread ? copyThread(thread) : null;
}

type RecordAnonymousChatTurnInput = {
  sessionId: string;
  storyId: string;
  question: string;
  answer: StoryChatAnswer;
};

export function recordAnonymousChatTurn({
  sessionId,
  storyId,
  question,
  answer,
}: RecordAnonymousChatTurnInput): StoryChatThread {
  const now = new Date();
  const nowValue = now.toISOString();
  const key = getThreadKey(sessionId, storyId);

  purgeExpiredThreads(now.getTime());

  const existingThread = threads.get(key);
  const thread: StoredThread =
    existingThread ?? {
      id: crypto.randomUUID(),
      sessionId,
      storyId,
      expiresAt: new Date(now.getTime() + ANONYMOUS_SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
      messages: [],
    };

  thread.messages.push(
    {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
      createdAt: nowValue,
    },
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content: answer.answer,
      citations: answer.citations.map((citation) => ({ ...citation })),
      createdAt: nowValue,
    },
  );

  if (thread.messages.length > MAX_MESSAGES_PER_THREAD) {
    thread.messages.splice(0, thread.messages.length - MAX_MESSAGES_PER_THREAD);
  }

  threads.set(key, thread);

  return copyThread(thread);
}
