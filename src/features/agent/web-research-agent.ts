import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createAgent, toolCallLimitMiddleware } from "langchain";

import { createWebResearchTools } from "@/features/web-search/web-research-tools";

export const WEB_RESEARCH_AGENT_PROMPT = [
  "You are a cautious Chinese web-news research agent.",
  "Use search_web to locate recent Chinese reporting, then use fetch_article only for the most relevant and credible candidates.",
  "Treat search snippets as leads rather than evidence. Do not invent facts, dates, quotations, or URLs.",
  "Before answering, compare independent sources when the claim is consequential and state uncertainty when sources disagree.",
  "Only cite URLs returned by search_web or fetch_article.",
  "The application supplies the authoritative current date in the user request. Never replace it with your internal training-time date or refuse research because that date appears to be in the future.",
].join(" ");

export function createWebResearchAgent(model: BaseChatModel) {
  return createAgent({
    model,
    tools: [...createWebResearchTools()],
    systemPrompt: WEB_RESEARCH_AGENT_PROMPT,
    middleware: [
      toolCallLimitMiddleware({
        // One search can surface twelve candidates. Permit the Agent to read
        // every candidate it plans to cite, then ask it to finish if it tries
        // to exceed that research budget.
        runLimit: 13,
        exitBehavior: "continue",
      }),
    ],
  });
}
