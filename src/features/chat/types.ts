export type StoryChatCitation = {
  id: string;
  sourceName: string;
  sourceUrl: string;
};

export type StoryChatAnswer = {
  answer: string;
  citations: StoryChatCitation[];
};

export type StoryChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: StoryChatCitation[];
  createdAt: string;
};

export type StoryChatThread = {
  id: string;
  storyId: string;
  expiresAt: string;
  messages: StoryChatMessage[];
};

export type StoryQuestionResponse = {
  data: {
    answer: StoryChatAnswer;
  };
  meta: {
    dataMode: "demo" | "generated" | "agent";
    storyId: string;
    persistence: "none";
  };
};

export type StoryQuestionHistoryResponse = {
  data: {
    thread: StoryChatThread | null;
  };
  meta: {
    dataMode: "demo" | "generated" | "agent";
    storyId: string;
    persistence: "memory" | "none";
  };
};
