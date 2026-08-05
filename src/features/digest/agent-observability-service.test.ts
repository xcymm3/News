import {
  AgentRunStageName,
  AgentRunStageStatus,
  AgentRunStatus,
  AgentRunTrigger,
} from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";

import { toAgentRunSnapshot } from "./agent-observability-service";

describe("agent observability service", () => {
  it("returns only safe aggregate stage data for the public dashboard", () => {
    const snapshot = toAgentRunSnapshot({
      id: "run-1",
      digestDate: new Date("2026-08-03T00:00:00.000Z"),
      trigger: AgentRunTrigger.CRON,
      status: AgentRunStatus.FAILED,
      model: "deepseek-chat",
      retrievedDocumentCount: 18,
      publishedStoryCount: null,
      errorMessage: "Bearer private-token failed at https://private.example/request",
      startedAt: new Date("2026-08-03T01:00:00.000Z"),
      completedAt: new Date("2026-08-03T01:00:03.500Z"),
      stages: [{
        stage: AgentRunStageName.SEARCH,
        status: AgentRunStageStatus.SUCCEEDED,
        inputCount: 10,
        outputCount: 38,
        durationMs: 2_500,
        details: {
          successfulTopicCount: 8,
          apiKey: "must-not-leak",
          sourceUrl: "https://private.example/source",
          nested: { hidden: true },
        },
        errorMessage: null,
      }],
      eventDecisions: [{
        phase: "FINAL_SELECTION",
        candidateId: "event-1",
        headline: "测试事件",
        decision: "SELECTED",
        reason: "TOP_SELECTION_SCORE",
        score: 86,
        sourceDomainCount: 3,
        candidateCount: 4,
        readableSourceCount: 3,
        latestPublishedAt: new Date("2026-08-03T00:30:00.000Z"),
        scoreDetails: { freshnessScore: 41, sourceScore: 21, corroborationScore: 16, prompt: "must-not-leak" },
      }],
      qualityEvaluation: {
        evaluationVersion: "v1",
        freshnessScore: 92,
        multiSourceCoverage: 83,
        averageSourcesPerStory: 2.4,
        sourceDomainCount: 12,
        categoryCoverage: 100,
        duplicateFreeRate: 100,
        citationUrlValidity: 100,
      },
    });

    expect(snapshot).toMatchObject({
      id: "run-1",
      digestDate: "2026-08-03",
      trigger: "cron",
      status: "failed",
      totalDurationMs: 3_500,
      errorMessage: "Bearer [已隐藏] failed at [链接已隐藏]",
      stages: [
        expect.objectContaining({
          stage: "search",
          status: "succeeded",
          details: { successfulTopicCount: 8 },
        }),
      ],
      evaluation: expect.objectContaining({ freshnessScore: 92 }),
      eventDecisions: [expect.objectContaining({
        phase: "final_selection",
        decision: "selected",
        scoreDetails: { freshnessScore: 41, sourceScore: 21, corroborationScore: 16 },
      })],
    });
    expect(JSON.stringify(snapshot)).not.toContain("private-token");
    expect(JSON.stringify(snapshot)).not.toContain("must-not-leak");
    expect(JSON.stringify(snapshot)).not.toContain("private.example");
  });
});
